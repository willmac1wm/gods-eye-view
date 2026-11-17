"""News & Blogs reporter registry (Part C). No network.

Covers: county Alert Center RSS (CODE BLUE), county newsflash (empty
today), Sea Isle News + OCNJ Daily keyword filtering (sports
syndication must be dropped), and the NWS zone correction
(NJZ016 is Salem — Cape May is NJZ023/NJZ024).
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app import news_ingest

COUNTY_ALERTS = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Alert Center</title>
<item>
<title>CODE BLUE SATURDAY NOV 14 &amp; SUNDAY NOV 15, 2026</title>
<link>https://www.capemaycountynj.gov/alert/123</link>
<description>Code Blue in effect...</description>
<pubDate>Sat, 14 Nov 2026 12:00:00 GMT</pubDate>
</item>
</channel></rss>"""

SEAISLE_FEED = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Sea Isle News</title>
<item>
<title>Phillies reportedly among teams interested in veteran reliever</title>
<link>https://seaislenews.com/sports/phillies</link>
<description>Baseball...</description>
<pubDate>Sat, 14 Nov 2026 12:00:00 GMT</pubDate>
</item>
<item>
<title>Demolition day set for Ocean City's old public safety building</title>
<link>https://ocnjdaily.com/news/demolition</link>
<description>Ocean City...</description>
<pubDate>Sat, 14 Nov 2026 11:00:00 GMT</pubDate>
</item>
<item>
<title>Sea Isle City approves $10.5M pump station project</title>
<link>https://seaislenews.com/news/pumps</link>
<description>Sea Isle City...</description>
<pubDate>Sat, 14 Nov 2026 10:00:00 GMT</pubDate>
</item>
</channel></rss>"""


def _src(sid):
    return next(s for s in news_ingest.SOURCES if s["id"] == sid)


def test_registry_sources_are_registered():
    for sid in ("county_alerts", "county_news", "seaisle_news", "ocnj_daily"):
        assert sid in {s["id"] for s in news_ingest.SOURCES}, sid


def test_county_alerts_code_blue_parses():
    src = _src("county_alerts")
    items = news_ingest.parse_feed(COUNTY_ALERTS, src)
    assert len(items) == 1
    assert "CODE BLUE" in items[0]["title"]
    assert items[0]["source_id"] == "county_alerts"


def test_county_newsflash_empty_is_fine():
    src = _src("county_news")
    items = news_ingest.parse_feed(
        '<?xml version="1.0"?><rss version="2.0"><channel></channel></rss>', src
    )
    assert items == []


def test_seaisle_and_ocnj_keyword_filter_drops_sports():
    for sid in ("seaisle_news", "ocnj_daily"):
        src = _src(sid)
        items = news_ingest.parse_feed(SEAISLE_FEED, src)
        assert len(items) == 3
        kept = news_ingest._filter_by_keywords(items, src)
        assert len(kept) == 2
        assert all("Phillies" not in i["title"] for i in kept)


def test_nws_source_uses_cape_may_zones_not_salem():
    src = _src("nws_mt_holly_alerts")
    assert "NJZ023" in src["api_url"] and "NJZ024" in src["api_url"]
    assert "NJZ016" not in src["api_url"]
