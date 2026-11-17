"""Cape May Scanner RSS feed (capemayscanner.com/feed.xml). No network.

feed.xml was verified live 2026-11-14: 200, RSS 2.0, 30 items, categories
News 8 / Community 7 / Weather 6 / Public Safety 4 / Government 3 /
Business 2. Only Public Safety + Weather are kept in /news.
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app import news_ingest

SOURCE = {
    "id": "capemay_scanner",
    "name": "Cape May Scanner",
    "kind": "media",
    "feed_url": "https://capemayscanner.com/feed.xml",
    "homepage": "https://capemayscanner.com/",
    "categories": ["Public Safety", "Weather"],
}

FEED = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel><title>Cape May Scanner</title>
<item>
<title>3 charged with operating Wildwood drug manufacturing facility</title>
<link>https://capemayscanner.com/article/2026/11/13/3-charged</link>
<description>Three people were charged...</description>
<pubDate>Fri, 13 Nov 2026 20:39:57 GMT</pubDate>
<category>Public Safety</category>
<dc:creator>Cape May Scanner</dc:creator>
</item>
<item>
<title>Freeze warning tonight for mainland Cape May County</title>
<link>https://capemayscanner.com/article/2026/11/13/freeze-warning</link>
<description>A freeze warning is in effect...</description>
<pubDate>Fri, 13 Nov 2026 18:08:58 GMT</pubDate>
<category>Weather</category>
</item>
<item>
<title>Holiday markets, Christmasween and a big-band show top the weekend</title>
<link>https://capemayscanner.com/article/2026/11/12/weekend</link>
<description>Things to do this weekend...</description>
<pubDate>Thu, 12 Nov 2026 15:13:34 GMT</pubDate>
<category>Community</category>
</item>
<item>
<title>Middle Township police pass retired drones to township schools</title>
<link>https://capemayscanner.com/article/2026/11/14/drones</link>
<description>The police department donated...</description>
<pubDate>Sat, 14 Nov 2026 20:54:13 GMT</pubDate>
<category>Community</category>
</item>
</channel></rss>"""


def test_scanner_feed_parses_and_category_filter_keeps_only_ps_and_weather():
    items = news_ingest.parse_feed(FEED, SOURCE)
    assert len(items) == 4
    assert items[0]["category"] == "Public Safety"
    kept = news_ingest._filter_by_categories(items, SOURCE)
    assert len(kept) == 2
    assert {i["category"] for i in kept} == {"Public Safety", "Weather"}
    assert all("capemayscanner.com" in i["url"] for i in kept)


def test_scanner_source_is_registered():
    ids = {s["id"] for s in news_ingest.SOURCES}
    assert "capemay_scanner" in ids
    src = next(s for s in news_ingest.SOURCES if s["id"] == "capemay_scanner")
    assert src["feed_url"] == "https://capemayscanner.com/feed.xml"
    assert src["categories"] == ["Public Safety", "Weather"]


def test_no_category_filter_when_source_has_none():
    items = news_ingest.parse_feed(FEED, SOURCE)
    assert len(news_ingest._filter_by_categories(items, {})) == 4
