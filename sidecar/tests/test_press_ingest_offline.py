"""Press-release listing watcher (app/news_ingest.py page sources). No network.

Covers: HTML link extraction, include/exclude filtering, relative-URL
resolution, date extraction from link text and PDF filenames, generic link
text fallbacks, malformed-HTML tolerance, dedupe by URL, retention of undated
items, and env-override acceptance of page sources. The network path
(refresh_all / _fetch_source) is not exercised here — per-source failures are
isolated by design.
"""
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app import news_ingest

SRC = {
    "id": "p",
    "name": "Cape May County Prosecutor's Office",
    "kind": "official",
    "page_url": "https://example.com/press-releases",
    "link_include": [r"for immediate release", r"\.pdf$"],
    "link_exclude": [r"/tips", r"archive"],
    "homepage": "https://example.com/",
}

LISTING = """<html><head><title>Press Releases</title></head><body>
<nav><a href="/home">Home</a> <a href="/tips">Submit a tip</a></nav>
<h1>Press Releases</h1>
<ul>
<li><a href="https://assets.opspolice.network/resources/agency/153/pdf/20260918-KdThmSWJIYKfHjPW.pdf">For Immediate Release &ndash; September 18, 2026: theft and forgery charges filed</a></li>
<li><a href="/resources/agency/153/pdf/20260910-uVhBz7UpFGfQQ0ou.pdf" title="Mental Health Diversion Program">PDF</a></li>
<li><a href="/pdfs/20260902-aBcDeFgHiJk.pdf">PDF</a></li>
<li><a href="/pdfs/press-release-archive.pdf">Press release archive</a></li>
<li><a href="/news/2026-09-20-town-hall-recap">Town hall recap</a></li>
<li><a href="mailto:tips@example.com">Email us</a></li>
<li><a href="javascript:void(0)">Do not follow</a></li>
<li><a href="https://assets.opspolice.network/resources/agency/153/pdf/20260918-KdThmSWJIYKfHjPW.pdf">Duplicate link, same PDF</a></li>
</ul>
</body></html>"""


def _isolate(monkeypatch, tmp_path):
    monkeypatch.setattr(news_ingest, "DB_PATH", tmp_path / "news.db")


# ------------------------------------------------------------------ parsing

def test_parse_listing_extracts_releases_with_dates():
    items = news_ingest.parse_listing(LISTING, SRC["page_url"], SRC)
    assert len(items) == 3
    first = items[0]
    assert "theft and forgery" in first["title"]
    assert first["url"] == (
        "https://assets.opspolice.network/resources/agency/153/pdf/"
        "20260918-KdThmSWJIYKfHjPW.pdf"
    )
    assert first["publisher"] == "Cape May County Prosecutor's Office"
    assert first["kind"] == "official"
    assert first["published"] == "September 18, 2026"
    assert first["pub_ms"] > 0
    assert first["source_id"] == "p"


def test_parse_listing_resolves_relative_urls_and_title_attr():
    items = news_ingest.parse_listing(LISTING, SRC["page_url"], SRC)
    second = items[1]
    assert second["url"] == (
        "https://example.com/resources/agency/153/pdf/20260910-uVhBz7UpFGfQQ0ou.pdf"
    )
    # Link text was just "PDF": the title attribute wins.
    assert second["title"] == "Mental Health Diversion Program"
    assert second["published"] == "September 10, 2026"
    assert second["pub_ms"] > 0


def test_parse_listing_generic_text_falls_back_to_dated_label():
    items = news_ingest.parse_listing(LISTING, SRC["page_url"], SRC)
    third = items[2]
    assert third["title"] == "Press release \u2014 September 2, 2026"
    assert third["published"] == "September 2, 2026"


def test_parse_listing_filters_chrome_and_duplicates():
    items = news_ingest.parse_listing(LISTING, SRC["page_url"], SRC)
    urls = [i["url"] for i in items]
    assert len(urls) == len(set(urls))  # duplicate PDF link deduped
    assert not any("/tips" in u or u.endswith("/home") for u in urls)
    assert not any("town-hall" in u for u in urls)
    assert not any("archive" in u for u in urls)  # link_exclude wins
    assert not any(u.startswith(("mailto:", "javascript:")) for u in urls)


def test_parse_listing_malformed_and_empty_return_empty():
    assert news_ingest.parse_listing("", SRC["page_url"], SRC) == []
    assert news_ingest.parse_listing("no links here at all", SRC["page_url"], SRC) == []
    bad_src = dict(SRC, link_include=["([invalid"])
    assert news_ingest.parse_listing(LISTING, SRC["page_url"], bad_src) == []


def test_parse_listing_tolerates_unclosed_anchor():
    items = news_ingest.parse_listing(
        '<a href="/pdfs/20260921-x.pdf">For Immediate Release September 21, 2026',
        SRC["page_url"], SRC)
    assert len(items) == 1
    assert items[0]["published"] == "September 21, 2026"


def test_extract_pub_date_variants():
    ms = news_ingest._extract_pub_date(
        "For Immediate Release \u2013 April 16, 2026", "https://example.com/x")[1]
    assert ms > 0
    # YYYYMMDD embedded in a PDF filename wins even with empty link text.
    disp, ms = news_ingest._extract_pub_date(
        "", "https://assets.opspolice.network/resources/agency/153/pdf/"
        "20260918-KdThmSWJIYKfHjPW.pdf")
    assert disp == "September 18, 2026" and ms > 0
    disp, ms = news_ingest._extract_pub_date(
        "x", "https://example.com/files/2026-09-02-note.pdf")
    assert disp == "September 2, 2026" and ms > 0
    disp, ms = news_ingest._extract_pub_date("Released 09/18/2026", "https://e.com/y")
    assert disp == "September 18, 2026" and ms > 0
    assert news_ingest._extract_pub_date("sometime last week", "https://e.com/y") == ("", 0)
    assert news_ingest._extract_pub_date("Feb 30, 2026", "https://e.com/y") == ("", 0)


# ------------------------------------------------------------------ storage

def test_save_listing_items_dedupe_by_url(monkeypatch, tmp_path):
    _isolate(monkeypatch, tmp_path)
    items = news_ingest.parse_listing(LISTING, SRC["page_url"], SRC)
    assert news_ingest.save_items(items) == 3
    assert news_ingest.save_items(items) == 0
    assert news_ingest.count() == 3


def test_retention_prunes_undated_old_items(monkeypatch, tmp_path):
    _isolate(monkeypatch, tmp_path)
    news_ingest._init_db()
    import sqlite3
    con = sqlite3.connect(news_ingest.DB_PATH)
    con.execute(
        "INSERT INTO news_items (id, source_id, title, url, pub_ms, fetched_at)"
        " VALUES (?,?,?,?,?,?)",
        ("old0", "p", "Undated old release", "https://example.com/old0",
         0, int(time.time() - 40 * 86400)),
    )
    con.execute(
        "INSERT INTO news_items (id, source_id, title, url, pub_ms, fetched_at)"
        " VALUES (?,?,?,?,?,?)",
        ("new0", "p", "Undated fresh release", "https://example.com/new0",
         0, int(time.time())),
    )
    con.commit()
    con.close()
    # Next save triggers the retention sweep.
    news_ingest.save_items(news_ingest.parse_listing(LISTING, SRC["page_url"], SRC))
    titles = [g["title"] for g in news_ingest.latest(10)]
    assert "Undated old release" not in titles
    assert "Undated fresh release" in titles


def test_active_sources_accepts_page_sources(monkeypatch):
    custom = [dict(SRC)]
    import json
    monkeypatch.setenv("NEWS_SOURCES_JSON", json.dumps(custom))
    got = news_ingest._active_sources()
    assert len(got) == 1 and got[0]["id"] == "p"
    # A source with neither feed_url nor page_url is still rejected.
    bad = [{"id": "x", "name": "Nowhere"}]
    monkeypatch.setenv("NEWS_SOURCES_JSON", json.dumps(bad))
    assert news_ingest._active_sources() != bad


def test_status_shape_for_page_source(monkeypatch, tmp_path):
    _isolate(monkeypatch, tmp_path)
    monkeypatch.setattr(news_ingest, "SOURCES", [dict(SRC)])
    st = news_ingest.status()
    assert len(st["sources"]) == 1
    s = st["sources"][0]
    assert s["id"] == "p" and s["kind"] == "official" and s["last_ok"] == 0
