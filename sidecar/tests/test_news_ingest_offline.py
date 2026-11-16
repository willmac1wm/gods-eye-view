"""Verified-source news ingestion (app/news_ingest.py). No network.

Covers: RSS 2.0 + Atom parsing (pure functions), date handling, dedupe by URL,
newest-first ordering, retention pruning, and the status shape. The network
path (refresh_all / _fetch_source) is not exercised here — it is verified in
production, and per-source failures are isolated by design.
"""
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app import news_ingest

SRC = {"id": "t", "name": "Test Source", "kind": "media",
       "feed_url": "https://example.com/feed", "homepage": "https://example.com/"}

RSS = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel><title>Test</title>
<item>
  <title>Prosecutor announces Wildwood boardwalk arrests</title>
  <link>https://example.com/a1</link>
  <pubDate>Thu, 24 Sep 2026 14:00:00 GMT</pubDate>
  <description>Three arrests on the boardwalk overnight, officials said.</description>
  <source name="Cape May County Herald">Herald</source>
</item>
<item>
  <title>Item without a link is skipped</title>
  <pubDate>Thu, 24 Sep 2026 13:00:00 GMT</pubDate>
</item>
<item>
  <title><![CDATA[Ocean City council approves budget &amp; beach replenishment]]></title>
  <link>https://example.com/a2</link>
  <pubDate>2026-09-24T12:30:00+00:00</pubDate>
  <description>""" + "x" * 500 + """</description>
</item>
</channel></rss>"""

ATOM = """<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<title>Test Atom</title>
<entry>
  <title>Wildwood tram car extension approved</title>
  <link href="https://example.com/b1"/>
  <updated>2026-09-23T09:15:00Z</updated>
  <summary>Tram cars will run an extra hour on summer weekends.</summary>
  <author><name>Shore News</name></author>
</entry>
</feed>"""


def _isolate(monkeypatch, tmp_path):
    monkeypatch.setattr(news_ingest, "DB_PATH", tmp_path / "news.db")


# ------------------------------------------------------------------ parsing

def test_parse_rss_extracts_fields_and_publisher():
    items = news_ingest.parse_feed(RSS, SRC)
    assert len(items) == 2  # the linkless item is skipped
    first = items[0]
    assert first["title"] == "Prosecutor announces Wildwood boardwalk arrests"
    assert first["url"] == "https://example.com/a1"
    assert first["publisher"] == "Cape May County Herald"
    assert "boardwalk overnight" in first["summary"]
    assert first["pub_ms"] > 0
    assert first["source_id"] == "t" and first["kind"] == "media"


def test_parse_rss_handles_cdata_and_truncates_summary():
    items = news_ingest.parse_feed(RSS, SRC)
    second = items[1]
    assert "beach replenishment" in second["title"]
    assert len(second["summary"]) <= news_ingest.MAX_SUMMARY
    assert second["summary"].endswith("…")
    # ISO-8601 pubDate also parses
    assert second["pub_ms"] > 0


def test_parse_atom_entry():
    items = news_ingest.parse_feed(ATOM, SRC)
    assert len(items) == 1
    it = items[0]
    assert it["title"] == "Wildwood tram car extension approved"
    assert it["url"] == "https://example.com/b1"
    assert it["publisher"] == "Shore News"
    assert it["pub_ms"] > 0


def test_parse_malformed_and_empty_return_empty():
    assert news_ingest.parse_feed("not xml at all {{{", SRC) == []
    assert news_ingest.parse_feed("", SRC) == []
    assert news_ingest.parse_feed("<rss></rss>", SRC) == []


# ------------------------------------------------- 2026-09-28 rendering fixes

GNEWS_HTML_RSS = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel><title>Google News</title>
<item>
  <title>Weekend nor'easter still lingers off New Jersey coast</title>
  <link>https://news.google.com/rss/articles/CBMiX</link>
  <pubDate>Mon, 28 Sep 2026 12:00:00 GMT</pubDate>
  <description>&lt;a href="https://news.google.com/rss/articles/CBMiX" target="_blank"&gt;Weekend nor'easter still lingers&lt;/a&gt;&amp;nbsp;&amp;nbsp;&lt;font color="#6f6f6f"&gt;6abc Philadelphia&lt;/font&gt;</description>
  <source name="6abc Philadelphia">6abc</source>
</item>
<item>
  <title>CURRY, WILLIAM A. - Cape May County Herald</title>
  <link>https://example.com/obit1</link>
  <pubDate>Mon, 28 Sep 2026 11:00:00 GMT</pubDate>
  <description>Paid death notice.</description>
</item>
<item>
  <title>Local fire company shares obituary fundraiser details</title>
  <link>https://example.com/obit2</link>
  <pubDate>Mon, 28 Sep 2026 10:00:00 GMT</pubDate>
  <description>Fundraiser announced.</description>
</item>
</channel></rss>"""


def test_google_news_html_is_stripped_from_summary():
    items = news_ingest.parse_feed(GNEWS_HTML_RSS, SRC)
    urls = [i["url"] for i in items]
    assert "https://news.google.com/rss/articles/CBMiX" in urls
    it = next(i for i in items if "nor'easter" in i["title"])
    assert "<a" not in it["summary"] and "<font" not in it["summary"]
    assert "href" not in it["summary"]
    assert "6abc Philadelphia" in it["summary"]


def test_obituaries_are_filtered_from_google_news():
    items = news_ingest.parse_feed(GNEWS_HTML_RSS, SRC)
    titles = [i["title"] for i in items]
    assert not any("CURRY, WILLIAM A." in t for t in titles)
    assert not any("obituary fundraiser" in t for t in titles)
    # The real news item survives.
    assert any("nor'easter" in t for t in titles)


def test_is_obituary_patterns():
    assert news_ingest._is_obituary("CURRY, WILLIAM A. - Cape May County Herald")
    assert news_ingest._is_obituary("Smith, John - Obituary")
    assert news_ingest._is_obituary("In memoriam: former chief")
    assert not news_ingest._is_obituary("Prosecutor announces Wildwood boardwalk arrests")
    assert not news_ingest._is_obituary("Weekend nor'easter still lingers off New Jersey coast")
    assert not news_ingest._is_obituary("")


def test_to_ms_parses_rfc2822_and_iso_and_rejects_garbage():
    assert news_ingest._to_ms("Thu, 24 Sep 2026 14:00:00 GMT") > 0
    assert news_ingest._to_ms("2026-09-24T14:00:00Z") > 0
    assert news_ingest._to_ms("2026-09-24T14:00:00+00:00") > 0
    assert news_ingest._to_ms("") == 0
    assert news_ingest._to_ms("sometime yesterday") == 0
    assert news_ingest._to_ms(None) == 0


def test_item_ids_are_stable_per_source_and_url():
    a = news_ingest.parse_feed(RSS, SRC)[0]["id"]
    b = news_ingest.parse_feed(RSS, SRC)[0]["id"]
    assert a == b
    other_src = dict(SRC, id="other")
    c = news_ingest.parse_feed(RSS, other_src)[0]["id"]
    assert c != a  # same URL, different source -> different id


# ------------------------------------------------------------------ storage

def test_save_dedupes_by_url(monkeypatch, tmp_path):
    _isolate(monkeypatch, tmp_path)
    items = news_ingest.parse_feed(RSS, SRC)
    assert news_ingest.save_items(items) == 2
    assert news_ingest.save_items(items) == 0  # second save: all duplicates
    assert news_ingest.count() == 2


def test_save_ignores_items_without_url(monkeypatch, tmp_path):
    _isolate(monkeypatch, tmp_path)
    assert news_ingest.save_items([{"id": "x", "title": "no url"}]) == 0
    assert news_ingest.save_items([]) == 0
    assert news_ingest.count() == 0


def test_latest_is_newest_first(monkeypatch, tmp_path):
    _isolate(monkeypatch, tmp_path)
    news_ingest.save_items(news_ingest.parse_feed(RSS, SRC))
    news_ingest.save_items(news_ingest.parse_feed(ATOM, SRC))
    got = news_ingest.latest(10)
    assert len(got) == 3
    ms = [g["pub_ms"] for g in got]
    assert ms == sorted(ms, reverse=True)
    assert got[0]["title"] == "Prosecutor announces Wildwood boardwalk arrests"


def test_latest_limit_is_clamped(monkeypatch, tmp_path):
    _isolate(monkeypatch, tmp_path)
    news_ingest.save_items(news_ingest.parse_feed(RSS, SRC))
    assert len(news_ingest.latest(1)) == 1
    assert len(news_ingest.latest(9999)) == 2  # clamped to 100, only 2 stored


def test_retention_prunes_old_items(monkeypatch, tmp_path):
    _isolate(monkeypatch, tmp_path)
    news_ingest._init_db()
    old_ms = int((time.time() - 40 * 86400) * 1000)
    import sqlite3
    con = sqlite3.connect(news_ingest.DB_PATH)
    con.execute(
        "INSERT INTO news_items (id, source_id, title, url, pub_ms, fetched_at)"
        " VALUES (?,?,?,?,?,?)",
        ("old1", "t", "Old news", "https://example.com/old",
         old_ms, int(time.time())),
    )
    con.commit()
    con.close()
    assert news_ingest.count() == 1
    # Next save triggers the retention sweep.
    news_ingest.save_items(news_ingest.parse_feed(ATOM, SRC))
    titles = [g["title"] for g in news_ingest.latest(10)]
    assert "Old news" not in titles
    assert len(titles) == 1


def test_read_paths_do_not_create_db_file(monkeypatch, tmp_path):
    ghost = tmp_path / "does-not-exist" / "news.db"
    monkeypatch.setattr(news_ingest, "DB_PATH", ghost)
    assert news_ingest.latest(10) == []
    assert news_ingest.count() == 0
    assert not ghost.exists()


def test_status_shape_without_any_poll(monkeypatch, tmp_path):
    _isolate(monkeypatch, tmp_path)
    monkeypatch.setattr(news_ingest, "SOURCES", [SRC])
    st = news_ingest.status()
    assert st["stored"] == 0
    assert st["refresh_seconds"] == news_ingest.REFRESH_INTERVAL
    assert len(st["sources"]) == 1
    s = st["sources"][0]
    assert s["id"] == "t" and s["last_ok"] == 0 and s["last_error"] == ""


def test_active_sources_env_override(monkeypatch):
    custom = [{"id": "c", "name": "Custom", "kind": "official",
               "feed_url": "https://example.com/custom.xml"}]
    import json
    monkeypatch.setenv("NEWS_SOURCES_JSON", json.dumps(custom))
    got = news_ingest._active_sources()
    assert len(got) == 1 and got[0]["id"] == "c"


def test_active_sources_bad_env_falls_back(monkeypatch):
    monkeypatch.setenv("NEWS_SOURCES_JSON", "not json {{{")
    got = news_ingest._active_sources()
    assert got == [s for s in news_ingest.SOURCES
                   if news_ingest._has_location(s)]


# ------------------------------------------------- 2026-11-13 FAA ground stop

FAA_GROUNDSTOP_RSS = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel><title>Google News</title>
<item>
  <title>FAA halts departing flights nationwide in ground stop</title>
  <link>https://example.com/faa1</link>
  <pubDate>Fri, 13 Nov 2026 21:00:00 GMT</pubDate>
  <description>All departing traffic should remain ground stopped until further notice.</description>
  <source name="Reuters">Reuters</source>
</item>
<item>
  <title>FAA ground stop updates: Flights grounded across country, including Philadelphia International Airport</title>
  <link>https://example.com/faa2</link>
  <pubDate>Fri, 13 Nov 2026 22:00:00 GMT</pubDate>
  <description>Philadelphia International Airport is among those affected.</description>
  <source name="6abc Philadelphia">6abc</source>
</item>
</channel></rss>"""


def test_faa_sources_are_present_and_use_rss():
    ids = {s["id"] for s in news_ingest.SOURCES}
    assert "gnews_faa_groundstop" in ids
    assert "gnews_nj_airports_groundstop" in ids
    for s in news_ingest.SOURCES:
        if s["id"].startswith("gnews_faa") or s["id"].startswith("gnews_nj_airports"):
            assert s["kind"] == "media"
            assert s["feed_url"].startswith("https://news.google.com/rss/search?")
            assert "ground%20stop" in s["feed_url"] or "ground stop" in s["feed_url"]


def test_faa_groundstop_rss_parses_with_existing_parser():
    src = next(s for s in news_ingest.SOURCES if s["id"] == "gnews_faa_groundstop")
    items = news_ingest.parse_feed(FAA_GROUNDSTOP_RSS, src)
    assert len(items) == 2
    assert "nationwide" in items[0]["title"]
    assert "Philadelphia International" in items[1]["title"]
    assert items[0]["publisher"] == "Reuters"


# ------------------------------------------------- 2026-11-13 Scanner source map

def test_scanner_sources_are_present():
    ids = {s["id"] for s in news_ingest.SOURCES}
    for wanted in [
        "herald", "capemay_daily_ps", "espn973_capemay",
        "nws_mt_holly_alerts", "gnews_pressofac", "gnews_6abc_capemay",
        "nj1015", "fox29", "abc6", "oc_sentinel",
    ]:
        assert wanted in ids, wanted
    # BreakingAC NOT added: feed mixes real-estate listings that pass
    # an "Atlantic City" keyword filter.
    assert "breakingac" not in ids
    # NJ State Police NOT added: live check parsed 0 items, then 403.
    assert "njsp" not in ids
    assert "nws_mt_holly_alerts" in ids
    nws = next(s for s in news_ingest.SOURCES if s["id"] == "nws_mt_holly_alerts")
    # Cape May County zones: NJZ023 (Cape May) + NJZ024 (Atlantic
    # Coastal Cape May). NJZ016 is Salem — corrected 2026-11-14.
    assert nws["api_url"] == "https://api.weather.gov/alerts/active?zone=NJZ023,NJZ024"
    assert nws["kind"] == "official"
    # Broad feeds must carry a keyword filter; narrow local feeds need none.
    for s in news_ingest.SOURCES:
        if s["id"] in ("nj1015", "fox29", "abc6", "oc_sentinel"):
            assert s.get("keywords"), s["id"]
    for s in news_ingest.SOURCES:
        if s["id"] in ("herald", "capemay_daily_ps", "espn973_capemay"):
            assert not s.get("keywords"), s["id"]


def test_keyword_filter_keeps_local_drops_noise():
    src = {"id": "fox29", "keywords": ["cape may", "ground stop", "FAA"]}
    items = [
        {"title": "Rare nationwide ground stop ordered at airports, including Philadelphia International Airport: FAA", "summary": ""},
        {"title": "Repairs underway after water main bursts in Mayfair", "summary": "Philadelphia"},
        {"title": "Wildwood Police Officer Steps In Just In Time to Stop Scam", "summary": ""},
    ]
    kept = news_ingest._filter_by_keywords(items, src)
    assert len(kept) == 1
    assert "ground stop" in kept[0]["title"]
    # No keywords = keep everything.
    assert len(news_ingest._filter_by_keywords(items, {"id": "herald"})) == 3
    assert news_ingest._matches_keywords(items[2], ["CAPE MAY"]) is False
    assert news_ingest._matches_keywords(
        {"title": "Cape May freeze warning", "summary": ""}, ["cape may"]) is True


NWS_SAMPLE = {
    "features": [
        {
            "properties": {
                "id": "https://api.weather.gov/alerts/NWS-IDP-PROD-123",
                "event": "Freeze Warning",
                "headline": "Freeze Warning issued November 13 at 12:43PM EST until November 14 at 9:00AM EST by NWS Mount Holly NJ",
                "description": "Sub-freezing temperatures as low as 28 expected.",
                "effective": "2026-11-13T12:43:00-05:00",
            }
        },
        {"properties": {"event": "", "headline": "", "id": ""}},
    ]
}


def test_parse_nws_alerts():
    src = next(s for s in news_ingest.SOURCES if s["id"] == "nws_mt_holly_alerts")
    items = news_ingest.parse_nws_alerts(NWS_SAMPLE, src)
    assert len(items) == 1  # empty feature skipped
    it = items[0]
    assert it["title"].startswith("Freeze Warning issued November 13")
    assert it["source_id"] == "nws_mt_holly_alerts"
    assert it["kind"] == "official"
    assert it["publisher"] == "National Weather Service"
    assert it["pub_ms"] > 0
    assert "28 expected" in it["summary"]
    assert news_ingest.parse_nws_alerts({}, src) == []
    assert news_ingest.parse_nws_alerts({"features": None}, src) == []


def test_obituary_filter_catches_herald_style_no_suffix():
    assert news_ingest._is_obituary("PARIS, JOHN J., Jr.")
    assert news_ingest._is_obituary("CURRY, WILLIAM A. - Cape May County Herald")
    assert not news_ingest._is_obituary("WILDWOOD, NJ")
    assert not news_ingest._is_obituary("Three Face Drug Charges in Wildwood")
    assert not news_ingest._is_obituary("Bashaw wins Cape May commissioner seat")


def test_ad_filter_drops_google_news_ads():
    assert news_ingest._is_ad("CAPE MAY COUNTY LIBRARY - Ad from 2026/11/03 - Press of Atlantic City")
    assert not news_ingest._is_ad("Cape May County library opens new branch")
