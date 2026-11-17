"""Daily brief (D5, app/daily_brief.py + the shared writer/blog/ingest paths).

No network, no key — the Gemini transport is stubbed. Gate reuse is
pinned: a brief naming a person goes to review; confidence 0.74 goes to
review and 0.75 publishes; a review-only source goes to review; no key
generates nothing and crashes nothing.
"""
import json
import sqlite3
import sys
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app import daily_brief, news_blog, news_ingest, news_writer  # noqa: E402

EST = ZoneInfo("America/New_York")
BRIEF_DAY = date(2026, 11, 17)


def _epoch(year, month, day, hour, minute=0):
    return datetime(year, month, day, hour, minute, tzinfo=EST).timestamp()


# ------------------------------------------------------------------ stubs

class _StubResp:
    def __init__(self, text):
        self.text = text
        self.status_code = 200

    def raise_for_status(self):
        pass

    def json(self):
        return {"candidates": [{"content": {"parts": [{"text": self.text}]}}]}


def _transport_for(*drafts):
    """Stub Gemini transport: returns the given draft dicts as JSON, in order."""
    queue = [json.dumps(d) for d in drafts]

    def send(url, payload, headers, timeout):
        assert "generativelanguage.googleapis.com" in url
        assert headers.get("x-goog-api-key") == "test-key"
        return _StubResp(queue.pop(0) if queue else "{}")

    return send


def _brief_body():
    return (
        "CAPE MAY COURT HOUSE, Nov. 17, 2026 — A freeze warning remains in "
        "effect for Cape May County overnight, according to the National "
        "Weather Service, with coastal flooding possible at high tide.\n\n"
        "## What happened\n\n"
        "The National Weather Service in Mount Holly says a freeze warning is "
        "in effect until 9 a.m. Tuesday.\n\n"
        "## Still active\n\n"
        "The freeze warning remains in effect, according to the National "
        "Weather Service.\n\n"
        "## What to watch\n\n"
        "The coastal flood advisory runs through Tuesday afternoon, according "
        "to the National Weather Service.\n\n"
        "Sources: National Weather Service Mount Holly (https://www.weather.gov/phi/)."
    )


def _brief_draft(**over):
    draft = {
        "headline": "Cape May County — Daily Brief, Nov. 17, 2026",
        "dek": "Freeze warning overnight; coastal flooding at high tide.",
        "dateline": "CAPE MAY COURT HOUSE, Nov. 17, 2026 —",
        "body_md": _brief_body(),
        "category": "Blog",
        "municipality": "CAPE MAY COURT HOUSE",
        "geo": None,
        "sources": [
            {
                "name": "National Weather Service Mount Holly",
                "url": "https://www.weather.gov/phi/",
                "kind": "official",
            }
        ],
        "image_plan": {"kind": "none"},
        "contains_named_individuals": False,
        "is_update": False,
        "confidence": 0.9,
    }
    draft.update(over)
    return draft


def _nws_item():
    return {
        "id": "nws-freeze-1",
        "source_id": "nws_mt_holly_alerts",
        "source_name": "National Weather Service Mount Holly",
        "kind": "alert",
        "title": "Freeze Warning for Cape May County",
        "url": "https://api.weather.gov/alerts/urn:oid:freeze",
        "summary": "A freeze warning is in effect overnight.",
        "publisher": "National Weather Service",
        "published": "2026-11-17T05:00:00-05:00",
        "pub_ms": int(_epoch(2026, 11, 17, 5) * 1000),
    }


def _nws_alert():
    return {
        "incident_key": "nws-freeze-2026-11-17",
        "rule_id": "freeze-warning",
        "severity": "high",
        "title": "Freeze Warning — Cape May County",
        "summary": "Freeze warning in effect overnight.",
        "status": "active",
        "first_seen": int(_epoch(2026, 11, 17, 5)),
        "last_seen": int(_epoch(2026, 11, 17, 6)),
        "alerted_at": int(_epoch(2026, 11, 17, 5)),
        "source_count": 1,
        "sources": ["nws_mt_holly_alerts"],
        "urls": ["https://api.weather.gov/alerts/urn:oid:freeze"],
        "report_md": "",
    }


# ------------------------------------------------------------------ slugs / dates

def test_brief_slug_and_headline():
    assert daily_brief.brief_slug_for(BRIEF_DAY) == "daily-brief-2026-11-17"
    assert (
        daily_brief.brief_headline_for(BRIEF_DAY)
        == "Cape May County — Daily Brief, Nov. 17, 2026"
    )
    # 07:00 EST on Nov 17 is 12:00 UTC.
    assert daily_brief.local_today(_epoch(2026, 11, 17, 7)) == BRIEF_DAY
    assert daily_brief.local_today(_epoch(2026, 11, 17, 6, 59)) == BRIEF_DAY


def test_brief_prompt_has_three_sections_and_house_style():
    prompt = daily_brief.build_brief_prompt(
        [_nws_item()], [_nws_alert()], brief_date=BRIEF_DAY
    )
    for section in daily_brief.BRIEF_SECTIONS:
        assert f"## {section}" in prompt
    assert "Nov. 17, 2026" in prompt or "November 17, 2026" in prompt
    assert "Freeze Warning for Cape May County" in prompt
    assert "never name an individual" in prompt.lower()
    # Quiet day: the prompt says so and asks for a quiet-day brief.
    quiet = daily_brief.build_brief_prompt([], [], brief_date=BRIEF_DAY)
    assert "quiet-day" in quiet
    assert "no source material" in quiet.lower()


def test_alert_maps_to_one_gate_item_per_source():
    alert = _nws_alert()
    alert["sources"] = ["nws_mt_holly_alerts", "capemay_scanner"]
    items = daily_brief.alert_to_gate_items(alert)
    assert [i["source_id"] for i in items] == [
        "nws_mt_holly_alerts",
        "capemay_scanner",
    ]


# ------------------------------------------------------------------ trigger

def test_trigger_daily_after_0700_with_no_brief():
    trigger, _ = daily_brief.should_generate_brief(
        now_s=_epoch(2026, 11, 17, 7),
        today_brief=None,
        latest_brief=None,
        critical_alerts=[],
    )
    assert trigger == "daily"


def test_trigger_nothing_before_0700():
    trigger, _ = daily_brief.should_generate_brief(
        now_s=_epoch(2026, 11, 17, 6, 30),
        today_brief=None,
        latest_brief=None,
        critical_alerts=[],
    )
    assert trigger is None


def test_trigger_nothing_when_todays_brief_is_current():
    brief = {"updated_at": int(_epoch(2026, 11, 17, 7, 5))}
    trigger, _ = daily_brief.should_generate_brief(
        now_s=_epoch(2026, 11, 17, 8),
        today_brief=brief,
        latest_brief=brief,
        critical_alerts=[],
    )
    assert trigger is None


def test_trigger_daily_when_todays_brief_predates_0700():
    brief = {"updated_at": int(_epoch(2026, 11, 17, 3))}
    trigger, _ = daily_brief.should_generate_brief(
        now_s=_epoch(2026, 11, 17, 8),
        today_brief=brief,
        latest_brief=brief,
        critical_alerts=[],
    )
    assert trigger == "daily"


def test_trigger_critical_after_latest_brief():
    brief = {"updated_at": int(_epoch(2026, 11, 17, 7, 5))}
    critical = [{"last_seen": int(_epoch(2026, 11, 17, 7, 30))}]
    trigger, _ = daily_brief.should_generate_brief(
        now_s=_epoch(2026, 11, 17, 7, 35),
        today_brief=brief,
        latest_brief=brief,
        critical_alerts=critical,
    )
    assert trigger == "critical"


def test_trigger_no_critical_when_brief_is_newer_than_alert():
    brief = {"updated_at": int(_epoch(2026, 11, 17, 7, 45))}
    critical = [{"last_seen": int(_epoch(2026, 11, 17, 7, 30))}]
    trigger, _ = daily_brief.should_generate_brief(
        now_s=_epoch(2026, 11, 17, 8),
        today_brief=brief,
        latest_brief=brief,
        critical_alerts=critical,
    )
    assert trigger is None


# ------------------------------------------------------------------ generation + gate

def _generate(tmp_path, draft, items=None, alerts=None, **kw):
    db_path = tmp_path / "news.db"
    return daily_brief.generate_brief(
        items=items if items is not None else [_nws_item()],
        alerts=alerts if alerts is not None else [_nws_alert()],
        api_key="test-key",
        transport=_transport_for(draft),
        db_path=db_path,
        brief_date=BRIEF_DAY,
        **kw,
    ), db_path


def test_clean_brief_publishes_with_daily_slug(tmp_path):
    post, _ = _generate(tmp_path, _brief_draft())
    assert post["status"] == "published"
    assert post["slug"] == "daily-brief-2026-11-17"
    assert post["topic_key"] == "daily-brief"
    assert post["category"] == "Blog"
    assert post["confidence"] == 0.9
    assert post["headline"] == "Cape May County — Daily Brief, Nov. 17, 2026"


def test_brief_naming_a_person_goes_to_review(tmp_path):
    post, _ = _generate(
        tmp_path, _brief_draft(contains_named_individuals=True)
    )
    assert post["status"] == "review"
    assert any("names a person" in r for r in post["gate_reasons"])


def test_brief_confidence_074_goes_to_review_075_publishes(tmp_path):
    low, _ = _generate(tmp_path, _brief_draft(confidence=0.74))
    assert low["status"] == "review"
    assert any("confidence 0.74" in r for r in low["gate_reasons"])
    high, _ = _generate(tmp_path, _brief_draft(confidence=0.75))
    assert high["status"] == "published"


def test_brief_with_review_only_source_goes_to_review(tmp_path):
    pd_item = dict(_nws_item(), source_id="capemay_pd", source_name="Cape May PD")
    post, _ = _generate(tmp_path, _brief_draft(), items=[pd_item], alerts=[])
    assert post["status"] == "review"
    assert any("capemay_pd" in r for r in post["gate_reasons"])


def test_brief_with_no_key_generates_nothing(tmp_path):
    db_path = tmp_path / "news.db"
    try:
        daily_brief.generate_brief(
            items=[_nws_item()],
            alerts=[_nws_alert()],
            api_key="",
            transport=_transport_for(_brief_draft()),
            db_path=db_path,
            brief_date=BRIEF_DAY,
        )
    except RuntimeError as exc:
        assert "GEMINI_API_KEY" in str(exc)
    else:
        raise AssertionError("expected RuntimeError without a key")
    assert not db_path.exists() or news_blog.latest_brief(db_path=db_path) is None


def test_quiet_day_brief_still_generates(tmp_path):
    quiet_body = (
        "CAPE MAY COURT HOUSE, Nov. 17, 2026 — Nothing new was reported in "
        "Cape May County in the last day, according to Cape Dispatch records.\n\n"
        "## What happened\n\n"
        "No new items were reported in the last 24 hours, according to Cape Dispatch records.\n\n"
        "## Still active\n\n"
        "No alerts are active, according to Cape Dispatch records.\n\n"
        "## What to watch\n\n"
        "No warnings are in effect, according to the National Weather Service.\n\n"
        "Sources: No new items in the last 24 hours."
    )
    post, _ = _generate(
        tmp_path,
        _brief_draft(body_md=quiet_body, confidence=0.75, sources=[]),
        items=[],
        alerts=[],
    )
    assert post["status"] == "published"
    assert post["slug"] == "daily-brief-2026-11-17"


def test_second_generation_same_day_is_an_update(tmp_path):
    first, db_path = _generate(tmp_path, _brief_draft())
    assert first["status"] == "published"
    second = daily_brief.generate_brief(
        items=[_nws_item()],
        alerts=[_nws_alert()],
        api_key="test-key",
        transport=_transport_for(_brief_draft()),
        db_path=db_path,
        brief_date=BRIEF_DAY,
    )
    assert second["is_update"] is True
    assert second["parent_id"] == first["id"]
    assert second["headline"].startswith("UPDATE: ")
    assert second["slug"] != first["slug"]
    assert news_blog.latest_brief(db_path=db_path)["id"] == second["id"]


def test_section_headings_do_not_trip_attribution():
    errors = news_writer.validate_post(
        _brief_draft(), [_nws_item(), _nws_alert()]
    )
    assert errors == []


def test_explicit_slug_is_used_and_uniquified(tmp_path):
    db_path = tmp_path / "news.db"
    first = news_blog.create_post(
        {
            "slug": "daily-brief-2026-11-17",
            "topic_key": "daily-brief",
            "headline": "One",
            "status": "published",
        },
        db_path=db_path,
    )
    assert first["slug"] == "daily-brief-2026-11-17"
    second = news_blog.create_post(
        {
            "slug": "daily-brief-2026-11-17",
            "topic_key": "daily-brief",
            "headline": "Two",
            "status": "published",
        },
        db_path=db_path,
    )
    assert second["slug"] == "daily-brief-2026-11-17-2"
    assert news_blog.latest_brief(db_path=db_path)["id"] == second["id"]


# ------------------------------------------------------------------ 24 h window readers

def _seed_ingest_db(monkeypatch, path):
    monkeypatch.setattr(news_ingest, "DB_PATH", path)
    con = sqlite3.connect(path)
    news_ingest._init_db()
    now_ms = int(_epoch(2026, 11, 17, 12) * 1000)
    con.execute(
        "INSERT INTO news_items (id, source_id, source_name, kind, title, url,"
        " summary, publisher, published, pub_ms, fetched_at) VALUES"
        " ('new', 'nws_mt_holly_alerts', 'NWS', 'alert', 'New', 'https://x/1',"
        " 's', 'NWS', '2026-11-17', ?, ?)",
        (now_ms - 3600_000, now_ms),
    )
    con.execute(
        "INSERT INTO news_items (id, source_id, source_name, kind, title, url,"
        " summary, publisher, published, pub_ms, fetched_at) VALUES"
        " ('old', 'nws_mt_holly_alerts', 'NWS', 'alert', 'Old', 'https://x/2',"
        " 's', 'NWS', '2026-11-15', ?, ?)",
        (now_ms - 49 * 3600_000, now_ms),
    )
    con.execute(
        "INSERT INTO news_alerts (incident_key, rule_id, severity, title,"
        " summary, status, first_seen, last_seen, alerted_at, source_count,"
        " sources_json, urls_json, report_md) VALUES"
        " ('new-alert', 'r', 'high', 'New alert', 's', 'active', ?, ?, ?, 1,"
        " '[\"nws_mt_holly_alerts\"]', '[]', '')",
        (
            int(_epoch(2026, 11, 17, 11)),
            int(_epoch(2026, 11, 17, 11)),
            int(_epoch(2026, 11, 17, 11)),
        ),
    )
    con.execute(
        "INSERT INTO news_alerts (incident_key, rule_id, severity, title,"
        " summary, status, first_seen, last_seen, alerted_at, source_count,"
        " sources_json, urls_json, report_md) VALUES"
        " ('old-alert', 'r', 'high', 'Old alert', 's', 'active', ?, ?, ?, 1,"
        " '[\"nws_mt_holly_alerts\"]', '[]', '')",
        (
            int(_epoch(2026, 11, 15, 11)),
            int(_epoch(2026, 11, 15, 11)),
            int(_epoch(2026, 11, 15, 11)),
        ),
    )
    con.commit()
    con.close()


def test_recent_items_and_alerts_filter_to_24h(monkeypatch, tmp_path):
    db_path = tmp_path / "news.db"
    _seed_ingest_db(monkeypatch, db_path)
    now_ms = int(_epoch(2026, 11, 17, 12) * 1000)
    items = news_ingest.recent_items(now_ms - 24 * 3600_000)
    assert [i["id"] for i in items] == ["new"]
    alerts = news_ingest.recent_alerts(int(_epoch(2026, 11, 17, 12)) - 24 * 3600)
    assert [a["incident_key"] for a in alerts] == ["new-alert"]
    assert alerts[0]["sources"] == ["nws_mt_holly_alerts"]
