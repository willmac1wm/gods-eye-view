"""gemini_quota.py — one shared Gemini quota pool for the whole sidecar.

The blog writer, the daily brief, the Q&A endpoint and the forecaster
all call Gemini through ``news_writer.generate_content`` — but until now
that call had no retry policy, no rate limit and no memory of the
previous call. Every 5-minute writer cycle re-fired every failed
cluster, every question cost a fresh call, and the three consumers
competed for the same small free-tier pool. The sidecar log held
thousands of 503/429 failure lines, and once the quota was exhausted
every /api/qa call degraded to "writer not configured".

This module is the single funnel all of them share:

* a token bucket (per-minute rate) + a daily request budget, so the
  writer, brief, Q&A and forecaster draw from ONE pool instead of
  competing — env-tunable, conservative free-tier defaults;
* exponential backoff with full jitter on 429/503, honouring the
  Retry-After header when the API sends one, capped at 3 attempts —
  a 429 never triggers an immediate retry storm;
* a circuit breaker: after N consecutive 429/503 responses the pool
  goes open for a cooldown, and calls fail fast WITHOUT touching the
  API (no more doomed calls, no more failure-line spam).

Fail-fast errors are ``GeminiQuotaError``, a ``RuntimeError`` subclass,
so every existing caller degrades exactly as it already does on any
other Gemini failure (Q&A returns its citations + "writer not
configured", the forecaster falls back to rules-only text, a failed
cluster is skipped). Nothing about the response shapes changes.

Pure stdlib, thread-safe (the sidecar runs the writer/brief/snapshot
loops in separate threads). The clock and RNG are injectable so tests
run offline with fake time.
"""
from __future__ import annotations

import os
import random
import threading
import time
from typing import Any

# ── Defaults (free tier, conservative) ──────────────────────────────────────
# gemini-3.5-flash-lite is a free-tier model; the pool is sized so the
# sidecar can never burn a day's quota in one storm. Sustained rate
# 10/min stays under the per-minute free-tier limit; the 200/day budget
# leaves headroom for the Node chat route, which shares the same key.
# Burst capacity (3x the per-minute rate) lets one full writer cycle
# through while still capping the sustained rate.
DEFAULT_MAX_RPM = 10
DEFAULT_MAX_RPD = 200
DEFAULT_BREAKER_FAILURES = 3
DEFAULT_BREAKER_COOLDOWN_S = 900  # 15 min

# Backoff: base 2 s, doubling, capped at 60 s, full jitter. A Retry-After
# header is honoured exactly instead, capped at 300 s.
BACKOFF_BASE_S = 2.0
BACKOFF_CAP_S = 60.0
RETRY_AFTER_CAP_S = 300

# Total attempts per generate_content call (initial + retries).
MAX_ATTEMPTS = 3


class GeminiQuotaError(RuntimeError):
    """The shared pool refused a call: budget spent, bucket empty, or
    the circuit breaker is open. Raised WITHOUT touching the API, so
    callers degrade gracefully instead of burning quota."""


def _env_int(name: str, default: int) -> int:
    try:
        value = int((os.environ.get(name) or "").strip())
    except (TypeError, ValueError):
        return default
    return value if value > 0 else default


def backoff_delay(attempt: int, retry_after: int | None = None,
                  rng: random.Random | None = None) -> float:
    """Seconds to wait before retry ``attempt`` (0-based).

    A Retry-After value is honoured exactly (capped). Otherwise
    exponential with full jitter: uniform(0, min(cap, base * 2**attempt)).
    """
    if retry_after is not None:
        return float(min(max(retry_after, 1), RETRY_AFTER_CAP_S))
    cap = min(BACKOFF_CAP_S, BACKOFF_BASE_S * (2 ** attempt))
    rand = rng if rng is not None else random
    return rand.uniform(0, cap)


class GeminiRateLimiter:
    """Token bucket + daily budget + circuit breaker for one Gemini key.

    All state lives behind one lock. ``acquire()`` consumes one token
    and one daily-budget unit; ``note_success()`` / ``note_retryable_failure()``
    report the outcome. ``peek()`` reports whether a call could proceed
    right now without consuming anything (lets loops skip quietly).

    Breaker states: closed → open (after N consecutive 429/503) →
    half-open (cooldown elapsed: exactly one probe call may go through)
    → closed on probe success, open again on probe failure.
    """

    def __init__(
        self,
        *,
        max_rpm: int = DEFAULT_MAX_RPM,
        max_rpd: int = DEFAULT_MAX_RPD,
        breaker_failures: int = DEFAULT_BREAKER_FAILURES,
        breaker_cooldown_s: float = DEFAULT_BREAKER_COOLDOWN_S,
        clock: Any = None,
        today: Any = None,
        rng: random.Random | None = None,
    ):
        self.max_rpm = max_rpm
        self.max_rpd = max_rpd
        self.breaker_failures = breaker_failures
        self.breaker_cooldown_s = breaker_cooldown_s
        self._clock = clock if clock is not None else time.monotonic
        self._today = today if today is not None else (
            lambda: time.strftime("%Y-%m-%d", time.gmtime())
        )
        self._rng = rng if rng is not None else random
        self._lock = threading.Lock()
        # Bucket starts full: burst = 3 minutes' worth of the rate.
        self._burst = max(1, 3 * max_rpm)
        self._tokens = float(self._burst)
        self._last_refill = self._clock()
        self._day = self._today()
        self._used_today = 0
        self._consecutive_failures = 0
        self._breaker_open_until: float | None = None
        self._half_open = False
        self._probe_in_flight = False

    # -- internal ---------------------------------------------------------

    def _refill(self, now: float) -> None:
        elapsed = max(0.0, now - self._last_refill)
        if elapsed > 0:
            self._tokens = min(
                float(self._burst),
                self._tokens + elapsed * (self.max_rpm / 60.0),
            )
            self._last_refill = now

    def _roll_day(self) -> None:
        today = self._today()
        if today != self._day:
            self._day = today
            self._used_today = 0

    def _breaker_open(self, now: float) -> bool:
        """True while the breaker is open. Rolls an expired cooldown
        into half-open (one probe may go through)."""
        if self._breaker_open_until is None:
            return False
        if now >= self._breaker_open_until:
            self._breaker_open_until = None
            self._half_open = True
            self._probe_in_flight = False
            return False
        return True

    # -- public -----------------------------------------------------------

    def peek(self) -> bool:
        """True when a call could proceed right now (no state consumed)."""
        with self._lock:
            now = self._clock()
            self._refill(now)
            self._roll_day()
            if self._breaker_open(now):
                return False
            if self._probe_in_flight:
                return False
            return self._tokens >= 1.0 and self._used_today < self.max_rpd

    def acquire(self) -> None:
        """Consume one token + one daily-budget unit, or raise
        GeminiQuotaError (fail fast, no API call)."""
        with self._lock:
            now = self._clock()
            self._refill(now)
            self._roll_day()
            if self._breaker_open(now):
                raise GeminiQuotaError(
                    "Gemini quota pool: circuit breaker open after "
                    f"{self.breaker_failures} consecutive 429/503 responses; "
                    "retry after the cooldown"
                )
            if self._half_open:
                if self._probe_in_flight:
                    raise GeminiQuotaError(
                        "Gemini quota pool: circuit breaker half-open, "
                        "a probe call is already in flight"
                    )
                self._probe_in_flight = True
            if self._tokens < 1.0:
                self._probe_in_flight = False
                raise GeminiQuotaError(
                    "Gemini quota pool: per-minute budget spent "
                    f"({self.max_rpm}/min); retry shortly"
                )
            if self._used_today >= self.max_rpd:
                self._probe_in_flight = False
                raise GeminiQuotaError(
                    "Gemini quota pool: daily budget spent "
                    f"({self.max_rpd}/day); retry tomorrow"
                )
            self._tokens -= 1.0
            self._used_today += 1

    def note_success(self) -> None:
        """A call returned 2xx: close the breaker, reset the streak."""
        with self._lock:
            self._consecutive_failures = 0
            self._breaker_open_until = None
            self._half_open = False
            self._probe_in_flight = False

    def note_retryable_failure(self) -> None:
        """A call returned 429/503: count it; open the breaker at the
        threshold. Non-retryable failures (400 etc.) never trip it."""
        with self._lock:
            self._consecutive_failures += 1
            self._probe_in_flight = False
            self._half_open = False
            if self._consecutive_failures >= self.breaker_failures:
                self._breaker_open_until = (
                    self._clock() + self.breaker_cooldown_s
                )

    def backoff(self, attempt: int, retry_after: int | None = None) -> float:
        """Backoff seconds before retry ``attempt`` (0-based)."""
        return backoff_delay(attempt, retry_after, rng=self._rng)

    def status(self) -> dict:
        """Snapshot for /health-style reporting (no secrets)."""
        with self._lock:
            now = self._clock()
            self._refill(now)
            self._roll_day()
            return {
                "tokens": round(self._tokens, 2),
                "burst": self._burst,
                "used_today": self._used_today,
                "max_rpd": self.max_rpd,
                "consecutive_failures": self._consecutive_failures,
                "breaker_open": self._breaker_open(now),
            }


# ── Module singleton: the one pool every caller shares ─────────────────────

_LIMITER: GeminiRateLimiter | None = None
_LIMITER_LOCK = threading.Lock()


def get_limiter() -> GeminiRateLimiter:
    """The shared pool (env-tunable, created once per process)."""
    global _LIMITER
    if _LIMITER is None:
        with _LIMITER_LOCK:
            if _LIMITER is None:
                _LIMITER = GeminiRateLimiter(
                    max_rpm=_env_int("GEMINI_MAX_RPM", DEFAULT_MAX_RPM),
                    max_rpd=_env_int("GEMINI_MAX_RPD", DEFAULT_MAX_RPD),
                    breaker_failures=_env_int(
                        "GEMINI_BREAKER_FAILURES", DEFAULT_BREAKER_FAILURES
                    ),
                    breaker_cooldown_s=_env_int(
                        "GEMINI_BREAKER_COOLDOWN_S", DEFAULT_BREAKER_COOLDOWN_S
                    ),
                )
    return _LIMITER


def reset_limiter() -> None:
    """Drop the shared pool (tests only — the next call rebuilds it)."""
    global _LIMITER
    with _LIMITER_LOCK:
        _LIMITER = None
