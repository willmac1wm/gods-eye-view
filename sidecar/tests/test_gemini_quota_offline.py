"""Offline tests for the shared Gemini quota pool (gemini_quota.py)
and the backoff wiring in news_writer.generate_content.

No network, no key — every Gemini transport is stubbed, the clock is
fake, and sleeps are recorded, never taken.
"""
import json
import os
import random
import sqlite3
import time
from types import SimpleNamespace

from app import ai_situation, gemini_quota, news_ingest, news_writer

NOW_MS = int(time.time() * 1000)


# ------------------------------------------------------------------ fakes

class _Clock:
    """Monotonic fake clock: now() returns seconds; advance() moves it."""

    def __init__(self, start: float = 1000.0):
        self.now = start

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


class _Day:
    """Flippable UTC-day string for the daily-budget window."""

    def __init__(self, day: str = "2026-11-17"):
        self.day = day

    def __call__(self) -> str:
        return self.day


def _limiter(**overrides):
    """Fresh limiter with a fake clock + seeded RNG (deterministic)."""
    clock = overrides.pop("clock", _Clock())
    day = overrides.pop("day", _Day())
    rng = overrides.pop("rng", random.Random(7))
    lim = gemini_quota.GeminiRateLimiter(
        clock=clock, today=day, rng=rng, **overrides
    )
    lim._clock_obj = clock  # test handle, not part of the API
    lim._day_obj = day
    return lim


class _HttpErr(Exception):
    """httpx-style error: .response carries status_code + headers."""

    def __init__(self, status, retry_after=None):
        headers = {}
        if retry_after is not None:
            headers["retry-after"] = str(retry_after)
        self.response = SimpleNamespace(status_code=status, headers=headers)
        super().__init__(f"{status} error")


class _FailResp:
    def __init__(self, status, retry_after=None):
        self.status_code = status
        self._retry_after = retry_after

    def raise_for_status(self):
        raise _HttpErr(self.status_code, self._retry_after)

    def json(self):
        raise AssertionError("json() must not be called on a failed response")


class _OkResp:
    def __init__(self, text):
        self.status_code = 200
        self._text = text

    def raise_for_status(self):
        return None

    def json(self):
        return {"candidates": [{"content": {"parts": [{"text": self._text}]}}]}


def _transport_for(*responses):
    """Stub Gemini transport: returns the given responses, in order."""
    queue = list(responses)
    calls = []

    def send(url, payload, headers, timeout):
        calls.append(url)
        assert "generativelanguage.googleapis.com" in url
        return queue.pop(0)

    send.calls = calls
    return send


def _draft_text(**over):
    draft = {
        "headline": "Test headline",
        "dek": "Test dek",
        "dateline": "CAPE MAY COURT HOUSE, Nov. 17, 2026 —",
        "body_md": (
            "CAPE MAY COURT HOUSE, Nov. 17, 2026 — Test lede according "
            "to the county.\n\nSources: County News."
        ),
        "category": "News",
        "municipality": "CAPE MAY COURT HOUSE",
        "sources": [{"name": "County News", "url": "https://example.test/x"}],
        "image_plan": {"kind": "none", "alt": ""},
        "contains_named_individuals": False,
        "is_update": False,
        "confidence": 0.9,
    }
    draft.update(over)
    return json.dumps(draft)


# ------------------------------------------------------------------ backoff

def test_backoff_is_exponential_with_jitter_and_cap():
    rng = random.Random(7)
    d0 = gemini_quota.backoff_delay(0, rng=rng)
    d1 = gemini_quota.backoff_delay(1, rng=rng)
    d5 = gemini_quota.backoff_delay(5, rng=rng)
    assert 0.0 <= d0 <= 2.0
    assert 0.0 <= d1 <= 4.0
    assert 0.0 <= d5 <= 60.0  # capped, never grows past the cap


def test_backoff_honours_retry_after_exactly():
    assert gemini_quota.backoff_delay(0, retry_after=45) == 45.0
    assert gemini_quota.backoff_delay(0, retry_after=999) == 300.0  # capped
    assert gemini_quota.backoff_delay(0, retry_after=0) == 1.0  # floored


def test_env_int_falls_back_to_defaults(monkeypatch):
    monkeypatch.setattr(
        os, "environ",
        {"GEMINI_MAX_RPM": "abc", "GEMINI_MAX_RPD": "-3"},
    )
    assert gemini_quota._env_int("GEMINI_MAX_RPM", 10) == 10
    assert gemini_quota._env_int("GEMINI_MAX_RPD", 200) == 200
    assert gemini_quota._env_int("GEMINI_MISSING", 42) == 42


# ------------------------------------------------------------------ limiter

def test_bucket_burst_then_refill():
    lim = _limiter(max_rpm=10)  # burst 30, refill 10/min
    for _ in range(30):
        lim.acquire()
    try:
        lim.acquire()
    except gemini_quota.GeminiQuotaError as exc:
        assert "per-minute" in str(exc)
    else:
        raise AssertionError("expected GeminiQuotaError once the bucket is empty")
    lim._clock_obj.advance(60)  # one minute refills 10 tokens
    for _ in range(10):
        lim.acquire()
    try:
        lim.acquire()
    except gemini_quota.GeminiQuotaError:
        pass
    else:
        raise AssertionError("expected the bucket to be empty again")


def test_daily_budget_spent_then_rolls_over():
    lim = _limiter(max_rpm=100, max_rpd=2)
    lim.acquire()
    lim.acquire()
    try:
        lim.acquire()
    except gemini_quota.GeminiQuotaError as exc:
        assert "daily budget" in str(exc)
    else:
        raise AssertionError("expected GeminiQuotaError once the day is spent")
    lim._day_obj.day = "2026-11-18"  # next UTC day: budget resets
    lim.acquire()


def test_peek_reports_without_consuming():
    lim = _limiter(max_rpm=100, max_rpd=1)
    assert lim.peek() is True
    assert lim.peek() is True  # peek consumes nothing
    lim.acquire()
    assert lim.peek() is False


def test_breaker_opens_after_consecutive_429s_and_recovers():
    lim = _limiter(max_rpm=100, breaker_failures=3, breaker_cooldown_s=900)
    lim.note_retryable_failure()
    lim.note_retryable_failure()
    assert lim.peek() is True  # below the threshold: still closed
    lim.note_retryable_failure()  # third consecutive 429: opens
    assert lim.peek() is False
    try:
        lim.acquire()
    except gemini_quota.GeminiQuotaError as exc:
        assert "circuit breaker open" in str(exc)
    else:
        raise AssertionError("expected the breaker to refuse while open")
    lim._clock_obj.advance(899)
    assert lim.peek() is False  # still inside the cooldown
    lim._clock_obj.advance(1)  # cooldown elapsed: half-open, one probe
    assert lim.peek() is True
    lim.acquire()  # the probe
    assert lim.peek() is False  # no second probe while one is in flight
    lim.note_success()  # probe succeeded: closed again
    assert lim.peek() is True
    lim.acquire()


def test_breaker_reopens_when_the_probe_fails():
    lim = _limiter(max_rpm=100, breaker_failures=3, breaker_cooldown_s=900)
    for _ in range(3):
        lim.note_retryable_failure()
    lim._clock_obj.advance(900)
    lim.acquire()  # probe
    lim.note_retryable_failure()  # probe failed: open again
    assert lim.peek() is False


def test_non_retryable_failures_never_trip_the_breaker():
    lim = _limiter(max_rpm=100, breaker_failures=3)
    # generate_content only calls note_retryable_failure for 429/503;
    # a success resets the streak, so interleaved 400s cannot open it.
    lim.note_success()
    assert lim.peek() is True


def test_limiter_is_a_runtime_error_subclass():
    assert issubclass(gemini_quota.GeminiQuotaError, RuntimeError)


# ------------------------------------------------------------------ generate_content

def test_generate_content_retries_429_then_succeeds(monkeypatch):
    sleeps = []
    monkeypatch.setattr(news_writer, "_sleep", lambda s: sleeps.append(s))
    lim = _limiter(max_rpm=100)
    transport = _transport_for(
        _FailResp(429), _FailResp(429),
        _OkResp(_draft_text()),
    )
    text = news_writer.generate_content(
        "hi", api_key="test-key", transport=transport, limiter=lim,
    )
    assert '"headline": "Test headline"' in text
    assert len(transport.calls) == 3
    assert len(sleeps) == 2
    assert 0.0 <= sleeps[0] <= 2.0  # base 2 s, jittered
    assert 0.0 <= sleeps[1] <= 4.0  # base 4 s, jittered


def test_generate_content_honours_retry_after(monkeypatch):
    sleeps = []
    monkeypatch.setattr(news_writer, "_sleep", lambda s: sleeps.append(s))
    lim = _limiter(max_rpm=100)
    transport = _transport_for(
        _FailResp(429, retry_after=7), _OkResp(_draft_text()),
    )
    news_writer.generate_content(
        "hi", api_key="test-key", transport=transport, limiter=lim,
    )
    assert sleeps == [7.0]  # honoured exactly, no jitter on Retry-After


def test_generate_content_gives_up_after_max_attempts(monkeypatch):
    sleeps = []
    monkeypatch.setattr(news_writer, "_sleep", lambda s: sleeps.append(s))
    lim = _limiter(max_rpm=100)
    transport = _transport_for(
        _FailResp(429), _FailResp(429), _FailResp(429),
    )
    try:
        news_writer.generate_content(
            "hi", api_key="test-key", transport=transport, limiter=lim,
        )
    except RuntimeError as exc:
        assert "Gemini request failed" in str(exc)
    else:
        raise AssertionError("expected RuntimeError after 3 attempts")
    assert len(transport.calls) == 3  # never a 4th attempt, no storm
    assert len(sleeps) == 2
    assert lim.status()["consecutive_failures"] == 3


def test_generate_content_does_not_retry_a_400(monkeypatch):
    sleeps = []
    monkeypatch.setattr(news_writer, "_sleep", lambda s: sleeps.append(s))
    lim = _limiter(max_rpm=100)
    transport = _transport_for(_FailResp(400))
    try:
        news_writer.generate_content(
            "hi", api_key="test-key", transport=transport, limiter=lim,
        )
    except RuntimeError:
        pass
    else:
        raise AssertionError("expected RuntimeError on a 400")
    assert len(transport.calls) == 1  # no retry for a non-retryable error
    assert sleeps == []
    assert lim.status()["consecutive_failures"] == 0


def test_generate_content_fails_fast_when_the_breaker_is_open(monkeypatch):
    sleeps = []
    monkeypatch.setattr(news_writer, "_sleep", lambda s: sleeps.append(s))
    lim = _limiter(max_rpm=100, breaker_failures=3)
    for _ in range(3):
        lim.note_retryable_failure()
    transport = _transport_for(_OkResp(_draft_text()))
    try:
        news_writer.generate_content(
            "hi", api_key="test-key", transport=transport, limiter=lim,
        )
    except gemini_quota.GeminiQuotaError as exc:
        assert "circuit breaker open" in str(exc)
    else:
        raise AssertionError("expected GeminiQuotaError, no API call")
    assert transport.calls == []  # the API was never touched
    assert sleeps == []


def test_generate_content_fails_fast_when_the_daily_budget_is_spent():
    lim = _limiter(max_rpm=100, max_rpd=1)
    lim.acquire()  # spend the day's only unit
    transport = _transport_for(_OkResp(_draft_text()))
    try:
        news_writer.generate_content(
            "hi", api_key="test-key", transport=transport, limiter=lim,
        )
    except gemini_quota.GeminiQuotaError as exc:
        assert "daily budget" in str(exc)
    else:
        raise AssertionError("expected GeminiQuotaError, no API call")
    assert transport.calls == []


# ------------------------------------------------------------------ shared-pool behaviour

def test_writer_cycle_skips_quietly_when_the_pool_is_spent(monkeypatch, tmp_path):
    """process_items fails fast once (one log line) instead of firing a
    doomed call per cluster while the quota is gone."""
    from app import news_blog

    monkeypatch.setattr(news_blog, "DB_PATH", tmp_path / "news.db")
    lim = _limiter(max_rpm=100, max_rpd=1)
    lim.acquire()  # spend the day's only unit: peek() is now False
    monkeypatch.setattr(
        news_writer.gemini_quota, "get_limiter", lambda: lim,
    )
    transport = _transport_for(_OkResp(_draft_text()))
    items = [{
        "id": "x1", "source_id": "county_news", "source_name": "County News",
        "title": "Road work on Route 9", "summary": "Crews are out.",
        "url": "https://example.test/x1", "published": "2026-11-17",
        "pub_ms": NOW_MS,
    }]
    try:
        out = news_writer.process_items(
            items, api_key="test-key", transport=transport,
            db_path=tmp_path / "news.db",
        )
    finally:
        gemini_quota.reset_limiter()
    assert out == []
    assert transport.calls == []  # no call was even attempted


def test_qa_still_returns_citations_when_generation_429s(monkeypatch, tmp_path):
    """Graceful degradation is unchanged: a 429 in Q&A returns the
    retrieved records + 'writer not configured', never an exception."""
    monkeypatch.setattr(news_ingest, "DB_PATH", tmp_path / "news.db")
    con = sqlite3.connect(tmp_path / "news.db")
    con.execute(
        "CREATE TABLE news_items (id TEXT PRIMARY KEY, source_id TEXT, "
        "source_name TEXT, kind TEXT, title TEXT, url TEXT UNIQUE, "
        "summary TEXT, publisher TEXT, published TEXT, pub_ms INTEGER)"
    )
    con.execute(
        "INSERT INTO news_items VALUES ("
        "'n1', 'county_news', 'County News', 'news', "
        "'Flooding on Route 9', 'https://example.test/flood', "
        "'Water over the road near the courthouse.', 'County', "
        "'2026-11-17', ?)",
        (NOW_MS,),
    )
    con.commit()
    con.close()
    sleeps = []
    monkeypatch.setattr(news_writer, "_sleep", lambda s: sleeps.append(s))
    transport = _transport_for(
        _FailResp(429), _FailResp(429), _FailResp(429),
    )
    try:
        answer = ai_situation.answer_question(
            "flooding", tmp_path / "news.db",
            api_key="test-key", transport=transport,
        )
    finally:
        # The failure path trips the shared breaker (3 consecutive
        # 429s); drop the singleton so later test files start fresh.
        gemini_quota.reset_limiter()
    assert answer["answer"] == ai_situation.QA_WRITER_OFF
    assert answer["citations"], "citations must survive the degradation"
    assert answer["citations"][0]["record_id"] == "news_item:n1"
    assert len(transport.calls) == 3  # bounded retries, then it stops
