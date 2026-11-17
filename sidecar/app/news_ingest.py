"""news_ingest.py — Verified-source news ingestion for the /news page.

Polls a curated allowlist of RSS/Atom feeds plus official press-release
listing pages (agencies that publish releases as HTML/PDF with no feed),
dedupes them into sqlite, and serves the newest items to the /news page.

This is phase 1 of the "story" vision: official releases and real local media
filling the news page, so a prosecutor's-office post about (say) a Wildwood
boardwalk incident can later be fused with the dispatch audio and map pin for
that same incident. Phases 2 (correlation) and 3 (story view) build on the
items stored here.

Patterns mirror feeds.py: async httpx fetch, background refresher started
from main.py, sqlite history table. Differences: this is editorial content
(headline + link-out), not sensor data, so there is no in-memory cache — the
/news page reads straight from sqlite (indexed, LIMITed, fast).

Safety notes:
- The allowlist is curated. Only feeds William approves go in SOURCES (or in
  the NEWS_SOURCES_JSON env override). A bad feed URL can never break the
  page: per-source failures are isolated and logged, and page_news() wraps
  the whole section in try/except.
- External items are already-published news. They link OUT to the publisher;
  we store headline + short excerpt only, never republish full articles.
- httpx is imported lazily so this module (and the /news page) boots even
  before httpx is installed.
"""
from __future__ import annotations

import asyncio
import email.utils
import hashlib
import json
import logging
import os
import re
import sqlite3
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse

log = logging.getLogger("cape_dispatch.news_ingest")

# ── Storage ─────────────────────────────────────────────────────────────────
# Same DB file feeds.py uses; override for tests / Linux deploys.
DB_PATH = Path(os.getenv("NEWS_DB_FILE", r"C:\cape-dispatch\cape_dispatch.db"))

REFRESH_INTERVAL = 900  # 15 minutes — news moves slower than sensor feeds
# Fast check for anomaly sources only (FAA ground stop, NWS alerts): 5 min.
# A nationwide ground stop was live for ~20 min on 2026-11-13 before anyone
# here knew; a 15-min news cycle is too slow for that class of event.
FAST_REFRESH_INTERVAL = 300
FAST_SOURCE_IDS = frozenset(
    {"gnews_faa_groundstop", "gnews_nj_airports_groundstop", "nws_mt_holly_alerts"}
)
# One alert per incident key per cooldown window; later items update the
# incident report instead of firing a second alert.
ALERT_COOLDOWN_S = 6 * 3600
RETENTION_DAYS = 30
MAX_SUMMARY = 280

# ── Source allowlist ────────────────────────────────────────────────────────
# Curated by William. kind is "official" (agency press releases) or "media".
# Official feeds are commented out until their exact feed URLs are confirmed;
# uncomment + fill in feed_url to enable. Per-source fetch failures are
# isolated: one dead URL never affects the others or the page.
SOURCES: list[dict[str, str]] = [
    {
        "id": "gnews_capemay",
        "name": "Cape May County media",
        "kind": "media",
        "feed_url": (
            "https://news.google.com/rss/search?"
            "q=%22Cape%20May%20County%22%20New%20Jersey"
            "&hl=en-US&gl=US&ceid=US:en"
        ),
        "homepage": "https://news.google.com/",
    },
    {
        "id": "gnews_wildwood",
        "name": "Wildwood media",
        "kind": "media",
        "feed_url": (
            "https://news.google.com/rss/search?"
            "q=Wildwood%20NJ%20boardwalk%20OR%20Wildwood%20Crest%20OR%20North%20Wildwood"
            "&hl=en-US&gl=US&ceid=US:en"
        ),
        "homepage": "https://news.google.com/",
    },
    # --- FAA / aviation (added 2026-11-13) ---------------------------------
    # The 2026-11-13 nationwide FAA ground stop (3:54 p.m. ET, all U.S.
    # airports, comms issue at all Air Route Traffic Control Centers) never
    # reached /news: national FAA stories do not mention "Cape May County",
    # so neither local Google News search matched, and the per-airport FAA
    # delays/closures feed is per-airport, not a national advisory.
    # These two narrowly scoped searches catch the next one. Both were
    # verified live 2026-11-13 ~8 p.m. ET against the live Google News RSS:
    # the national search returned the Reuters / NBC / USA Today ground-stop
    # stories, and the NJ-airports search returned PHL / EWR / ACY ground-stop
    # stories. Queries are ground-stop-only (not "flight delay" generally)
    # to avoid flooding /news with routine delays.
    # NOT used: nasstatus.faa.gov (JS app, no RSS, fragile to scrape) and
    # fly.faa.gov advisories (returned an error page on 2026-11-13).
    {
        "id": "gnews_faa_groundstop",
        "name": "FAA ground stop (national)",
        "kind": "media",
        "feed_url": (
            "https://news.google.com/rss/search?"
            "q=FAA%20ground%20stop%20OR%20%22nationwide%20ground%20stop%22"
            "&hl=en-US&gl=US&ceid=US:en"
        ),
        "homepage": "https://news.google.com/",
    },
    {
        "id": "gnews_nj_airports_groundstop",
        "name": "NJ airports ground stop (ACY / PHL / EWR)",
        "kind": "media",
        "feed_url": (
            "https://news.google.com/rss/search?"
            "q=%22Atlantic%20City%20International%20Airport%22%20OR%20"
            "%22Philadelphia%20International%20Airport%22%20OR%20"
            "%22Newark%20Liberty%22%20ground%20stop"
            "&hl=en-US&gl=US&ceid=US:en"
        ),
        "homepage": "https://news.google.com/",
    },
    # --- Cape May Scanner source map (added 2026-11-13) -------------------
    # Traced ~28 Scanner posts Nov 2-13, 2026 back to their primary sources.
    # Facebook is distribution only; the site is the newsroom. Biggest
    # Scanner source was NWS Mount Holly (6-7 posts), then town/county
    # government, the Prosecutor, Wildwood PD, and local media rewrites.
    # These feeds were each verified live 2026-11-13 ~8-9 p.m. ET (HTTP 200
    # + parsed items with real, relevant stories) by the builder, not just
    # by the research pass — with two corrections to that pass:
    #  * NJ State Police releases are NOT added: first check parsed 0 items,
    #    second check returned HTTP 403. Flaky / bot-gated; retry from
    #    Legion before adding.
    #  * Broad Philly / statewide feeds (NJ101.5, Fox29, 6abc, BreakingAC,
    #    Ocean City Sentinel) are noisy unfiltered — Philly water mains,
    #    "worst drivers" fluff, sports, real-estate listings all appeared
    #    in the live checks. They get a "keywords" filter (see
    #    _filter_by_keywords): an item is kept only if its title/summary
    #    contains a Cape May County / local-airport term. Narrow local
    #    feeds (Herald, Cape May Daily, 973 ESPN) need no filter.
    # NOT added: Press of Atlantic City direct feed (429/blocked — use the
    # Google News site: search below meanwhile), Cape May Scanner itself
    # (no RSS; do not scrape its sitemap), Facebook (do not scrape),
    # RadioReference / Broadcastify (terms — off limits, Oct 30).
    # Headline + short excerpt + link-out only, as with all /news sources.
    {
        "id": "herald",
        "name": "Cape May County Herald",
        "kind": "media",
        "feed_url": "https://www.capemaycountyherald.com/rss.xml",
        "homepage": "https://www.capemaycountyherald.com/",
    },
    {
        "id": "capemay_daily_ps",
        "name": "Cape May Daily (public safety)",
        "kind": "media",
        "feed_url": (
            "https://capemaynjdaily.com/category/news/public-safety/feed/"
        ),
        "homepage": "https://capemaynjdaily.com/",
    },
    {
        "id": "espn973_capemay",
        "name": "97.3 ESPN — Cape May County",
        "kind": "media",
        "feed_url": (
            "https://973espn.com/tags/cape-may-county-nj-news/feed/"
        ),
        "homepage": "https://973espn.com/",
    },
    {
        "id": "nws_mt_holly_alerts",
        "name": "NWS Mount Holly alerts (Cape May County)",
        "kind": "official",
        "api_url": "https://api.weather.gov/alerts/active?zone=NJZ023,NJZ024",
        "homepage": "https://www.weather.gov/phi/",
    },
    {
        "id": "gnews_pressofac",
        "name": "Press of Atlantic City — Cape May (via Google News)",
        "kind": "media",
        "feed_url": (
            "https://news.google.com/rss/search?"
            "q=site%3Apressofatlanticcity.com+%22Cape%20May%22"
            "&hl=en-US&gl=US&ceid=US:en"
        ),
        "homepage": "https://pressofatlanticcity.com/",
    },
    {
        "id": "gnews_6abc_capemay",
        "name": "6abc — Cape May (via Google News)",
        "kind": "media",
        "feed_url": (
            "https://news.google.com/rss/search?"
            "q=site%3A6abc.com+%22Cape%20May%22"
            "&hl=en-US&gl=US&ceid=US:en"
        ),
        "homepage": "https://6abc.com/",
    },
    {
        "id": "nj1015",
        "name": "NJ101.5 (Cape May filtered)",
        "kind": "media",
        "feed_url": "https://nj1015.com/feed/",
        "homepage": "https://nj1015.com/",
        "keywords": [
            "cape may", "wildwood", "ocean city", "atlantic city",
            "lower township", "middle township", "dennis township",
            "cape may court house", "stone harbor", "avalon",
            "sea isle city", "north wildwood", "wildwood crest",
        ],
    },
    {
        "id": "fox29",
        "name": "Fox29 Philadelphia (Cape May filtered)",
        "kind": "media",
        "feed_url": "https://www.fox29.com/rss/category/local-news",
        "homepage": "https://www.fox29.com/",
        "keywords": [
            "cape may", "wildwood", "ocean city", "atlantic city",
            "philadelphia international", "ground stop", "FAA",
        ],
    },
    {
        "id": "abc6",
        "name": "6abc Philadelphia (Cape May filtered)",
        "kind": "media",
        "feed_url": "https://6abc.com/rss/",
        "homepage": "https://6abc.com/",
        "keywords": [
            "cape may", "wildwood", "ocean city", "atlantic city",
            "philadelphia international", "ground stop", "FAA",
        ],
    },
    {
        "id": "oc_sentinel",
        "name": "Ocean City Sentinel (Cape May filtered)",
        "kind": "media",
        "feed_url": "https://www.ocnjsentinel.com/feed/",
        "homepage": "https://www.ocnjsentinel.com/",
        "keywords": [
            "cape may", "ocean city", "fire", "police", "crash",
            "arrest", "court", "council", "school", "road", "bridge",
            "flood", "storm", "wildwood",
        ],
    },
    # --- Cape May Scanner — official RSS feed (verified live 2026-11-14) ---
    # CORRECTION: a Nov 13 note said "no RSS; feed 404" — that was
    # /feed and /rss.xml (both 404), not /feed.xml, which returns 200,
    # RSS 2.0, 30 items, and mirrors their Facebook posts (newest item
    # matches the newest FB post). This is their own published feed, so
    # using it is sanctioned — no Facebook scraping, no groups API.
    # Categories on 2026-11-14: News 8, Community 7, Weather 6,
    # Public Safety 4, Government 3, Business 2. Only Public Safety +
    # Weather are kept (the rest is not incidents); every item is shown
    # with credit + link back to capemayscanner.com.
    {
        "id": "capemay_scanner",
        "name": "Cape May Scanner",
        "kind": "media",
        "feed_url": "https://capemayscanner.com/feed.xml",
        "homepage": "https://capemayscanner.com/",
        "categories": ["Public Safety", "Weather"],
    },
    # --- News & Blogs reporter registry (Part C, verified live 2026-11-14) --
    # County Alert Center — official, no filter: every item is an alert.
    # Live 2026-11-14: 1 item, "CODE BLUE SATURDAY NOV 14 & SUNDAY NOV 15".
    {
        "id": "county_alerts",
        "name": "Cape May County Alert Center",
        "kind": "official",
        "feed_url": "https://www.capemaycountynj.gov/RSSFeed.aspx?ModID=63&CID=All-alertcenter.xml",
        "homepage": "https://www.capemaycountynj.gov/",
    },
    # County newsflash — official, no filter. Live 2026-11-14: 0 items
    # (nothing posted today); it populates when the county posts news.
    {
        "id": "county_news",
        "name": "Cape May County newsflash",
        "kind": "official",
        "feed_url": "https://www.capemaycountynj.gov/RSSFeed.aspx?ModID=1&CID=All-newsflash.xml",
        "homepage": "https://www.capemaycountynj.gov/",
    },
    # Sea Isle News + OCNJ Daily — local outlets, broad feeds (top items
    # tonight are Phillies/sports syndication), so keyword-filtered to
    # Cape May County terms and shown with credit + link only, one
    # paragraph, never a full rewrite. Live 2026-11-14: both 200, 20
    # items each after redirect to /feed/.
    {
        "id": "seaisle_news",
        "name": "Sea Isle News (Cape May filtered)",
        "kind": "media",
        "feed_url": "https://seaislenews.com/feed",
        "homepage": "https://seaislenews.com/",
        "keywords": [
            "cape may", "sea isle", "ocean city", "wildwood", "avalon",
            "stone harbor", "north wildwood", "wildwood crest",
            "lower township", "middle township", "upper township",
            "dennis township", "cape may court house", "woodbine",
        ],
    },
    {
        "id": "ocnj_daily",
        "name": "OCNJ Daily (Cape May filtered)",
        "kind": "media",
        "feed_url": "https://ocnjdaily.com/feed",
        "homepage": "https://ocnjdaily.com/",
        "keywords": [
            "cape may", "ocean city", "wildwood", "sea isle", "avalon",
            "stone harbor", "north wildwood", "wildwood crest",
            "lower township", "middle township", "upper township",
            "dennis township", "cape may court house",
        ],
    },
    # NOT added from the registry: county_agendas RSS (200, calendar
    # items only — draft-only, needs a human to read the PDF agenda),
    # cmc_prosecutor (cmcpo.org unreachable from this VM, 000; test
    # from Legion before adding), municipal pages (wildwoodnj.org
    # redirects to wildwoodnj.gov; no RSS found — review-only HTML),
    # nws_afd / nws_forecast (JSON text products, need a product
    # parser — a later step, not an RSS source).
    # BreakingAC NOT added (2026-11-13 live check): its feed mixes
    # real-estate listings ("3101 BOARDWALK #2412-1, ATLANTIC CITY, NJ")
    # that pass an "Atlantic City" keyword filter. Its FAA / crime
    # stories are already covered by the FAA, 6abc, Herald and ESPN feeds.
    # --- Verified official sources (confirmed live 2026-09-24) ----------------
    # Prosecutor's releases are PDFs; listing dates + PDF filenames carry them.
    {
        "id": "cmcpo_press",
        "name": "Cape May County Prosecutor's Office",
        "kind": "official",
        "page_url": "https://www.cmcpros.net/press",
        "link_include": [r"for immediate release", r"\.pdf$"],
        "link_exclude": [r"page", r"\?"],
        "homepage": "https://www.cmcpros.net/",
    },
    # County News Flash listing; links go to /m/newsflash/Home/Detail/<id>.
    {
        "id": "cmc_county",
        "name": "Cape May County news",
        "kind": "official",
        "page_url": "https://www.capemaycountynj.gov/m/newsflash",
        "link_include": [r"/Home/Detail/"],
        "link_exclude": [r"Archive", r"\?cat="],
        "homepage": "https://www.capemaycountynj.gov/",
    },
    # CrimeWatch agency feed covers Cape May City + West Cape May + Cape May Point.
    {
        "id": "capemay_pd",
        "name": "Cape May Police Department",
        "kind": "official",
        "page_url": "https://crimewatch.net/us/nj/cape-may/cape-may-pd/88056",
        "link_include": [r"/88056/(events|post)/"],
        "link_exclude": [r"\?"],
        "homepage": "https://crimewatch.net/us/nj/cape-may/cape-may-pd/88056",
    },
    # --- Not wired: verified but unsuitable --------------------------------
    # lowertownshippolice.com/news.php — stale ("No New Press Releases
    #   Currently Available"); current releases go out via Nixle.
    # nixle.us/sea-isle-city-police-department — active but nearly all
    #   weather/traffic advisories, not crime releases.
    # Wildwood / Wildwood Crest / Middle Twp / Ocean City / Avalon /
    # Stone Harbor PDs — Facebook-first; not server-scrapable. North
    # Wildwood PD site is Cloudflare-walled.
]


def _has_location(s: dict[str, str]) -> bool:
    """A source is usable when it names a feed, a listing page, or an API."""
    return bool(s.get("feed_url") or s.get("page_url") or s.get("api_url"))


# ── Keyword filter (added 2026-11-13) ───────────────────────────────────────
# Broad feeds (Philly TV, statewide radio) flood /news with stories that
# have nothing to do with Cape May County. A source may carry "keywords":
# keep an item only when its title or summary contains one of them
# (case-insensitive). Narrow local feeds carry no keywords and keep all.

def _matches_keywords(item: dict[str, Any], keywords: list[str]) -> bool:
    if not keywords:
        return True
    hay = f"{item.get('title', '')} {item.get('summary', '')}".lower()
    return any((k or "").lower() in hay for k in keywords)


def _filter_by_keywords(
    items: list[dict[str, Any]], source: dict[str, Any]
) -> list[dict[str, Any]]:
    keywords = source.get("keywords") or []
    if not keywords:
        return items
    return [it for it in items if _matches_keywords(it, keywords)]


def _filter_by_categories(
    items: list[dict[str, Any]], source: dict[str, Any]
) -> list[dict[str, Any]]:
    """Keep only items whose RSS <category> is in source['categories'].

    For feeds like Cape May Scanner's, where most items are community /
    business news, the category is the honest filter — a keyword filter
    would either miss public-safety items or keep the wrong ones. An
    item with no category is dropped when a list is set. Never raises.
    """
    categories = source.get("categories") or []
    if not categories:
        return items
    wanted = {str(c).strip().lower() for c in categories}
    return [
        it
        for it in items
        if str(it.get("category") or "").strip().lower() in wanted
    ]


# ── NWS alerts API (added 2026-11-13) ───────────────────────────────────────
# api.weather.gov/alerts/active?zone=NJZ023,NJZ024 returns GeoJSON, not
# RSS, so it needs its own parser. CORRECTION 2026-11-14: the original
# zone NJZ016 is SALEM County, not Cape May. The Cape May County zones
# are NJZ023 (Cape May) and NJZ024 (Atlantic Coastal Cape May). The
# Nov 13 Freeze Warning still showed up under NJZ016 because that
# warning covered Salem too — do not read that as the zone being
# right. Official, public-domain, no API key. Verified live
# 2026-11-14: NJZ023/NJZ024 endpoint 200, 0 active features tonight
# (the freeze warning expired 9 a.m.).

def parse_nws_alerts(data: dict[str, Any], source: dict[str, Any]) -> list[dict[str, Any]]:
    """Parse an api.weather.gov alerts GeoJSON document. Pure, never raises."""
    items: list[dict[str, Any]] = []
    try:
        features = (data or {}).get("features") or []
    except Exception:
        return []
    for feat in features:
        try:
            props = (feat or {}).get("properties") or {}
            event = (props.get("event") or "").strip()
            headline = (props.get("headline") or "").strip()
            url = (props.get("id") or "").strip()
            if not event and not headline:
                continue
            if not url:
                url = str(source.get("homepage") or "https://www.weather.gov/phi/")
            title = headline or f"{event} — Cape May County"
            desc = (props.get("description") or "").strip()
            effective = (props.get("effective") or "").strip()
            items.append(
                {
                    "id": _item_id(source.get("id", "nws"), url + "|" + event),
                    "source_id": source.get("id", "nws"),
                    "source_name": source.get("name", "NWS Mount Holly"),
                    "kind": source.get("kind", "official"),
                    "title": title,
                    "url": url,
                    "summary": _clean_summary(desc),
                    "publisher": "National Weather Service",
                    "published": effective,
                    "pub_ms": _to_ms(effective),
                }
            )
        except Exception:
            continue
    return items


def _active_sources() -> list[dict[str, str]]:
    """SOURCES, or the NEWS_SOURCES_JSON env override when set and valid."""
    raw = os.getenv("NEWS_SOURCES_JSON", "").strip()
    if raw:
        try:
            data = json.loads(raw)
            if isinstance(data, list) and all(
                isinstance(s, dict) and _has_location(s) for s in data
            ):
                return data
            log.warning("NEWS_SOURCES_JSON ignored: not a list of source objects")
        except Exception as exc:
            log.warning("NEWS_SOURCES_JSON ignored (bad JSON): %s", exc)
    return [s for s in SOURCES if _has_location(s)]


# ── Feed parsing (pure; no network) ─────────────────────────────────────────

def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _text(el: ET.Element | None) -> str:
    if el is None or el.text is None:
        return ""
    return el.text.strip()


def _child_text(parent: ET.Element, *names: str) -> str:
    for child in parent:
        if _local(child.tag) in names:
            t = _text(child)
            if t:
                return t
    return ""


def _to_ms(raw: str) -> int:
    """RFC 2822 (RSS pubDate) or ISO 8601 (Atom) -> epoch ms. 0 when unparsable."""
    s = (raw or "").strip()
    if not s:
        return 0
    dt = None
    try:
        dt = email.utils.parsedate_to_datetime(s)
    except Exception:
        dt = None
    if dt is None:
        try:
            dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        except Exception:
            return 0
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    try:
        return int(dt.timestamp() * 1000)
    except Exception:
        return 0


def _item_id(source_id: str, url: str) -> str:
    return hashlib.sha1(f"{source_id}|{url}".encode("utf-8")).hexdigest()[:20]


def _clean_summary(raw: str) -> str:
    s = _strip_html(raw)
    s = " ".join(s.split())
    if len(s) > MAX_SUMMARY:
        s = s[: MAX_SUMMARY - 1].rstrip() + "…"
    return s


class _TextExtractor(HTMLParser):
    """Collect visible text, dropping all tags. Tolerates broken markup."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._chunks: list[str] = []

    def handle_data(self, data: str) -> None:
        self._chunks.append(data)

    def text(self) -> str:
        return "".join(self._chunks)


def _strip_html(raw: str) -> str:
    """Remove HTML tags/entities from RSS descriptions.

    Google News wraps descriptions in markup like
    <a href="...">Title</a>&nbsp;&nbsp;<font color="#6f6f6f">Publisher</font>
    which must never reach the /news cards (see 2026-09-28 screenshot).
    Never raises.
    """
    if not raw or "<" not in raw:
        return raw or ""
    try:
        ex = _TextExtractor()
        ex.feed(raw)
        ex.close()
        return ex.text()
    except Exception:
        # Last resort: regex strip rather than leaking markup.
        return re.sub(r"<[^>]*>", " ", raw)


# ── Obituary filter ─────────────────────────────────────────────────────────
# Google News search results sweep up paid death notices ("CURRY, WILLIAM A. -
# Cape May County Herald"). Those are not news; drop them at parse time so
# they never reach the /news page.

_OBITUARY_RES = [
    re.compile(r"\bobituar", re.IGNORECASE),
    re.compile(r"\bdeath notice", re.IGNORECASE),
    re.compile(r"\bin memoriam\b", re.IGNORECASE),
    re.compile(r"\bcelebration of life\b", re.IGNORECASE),
    # "LASTNAME, FIRSTNAME M. - Publisher" — the classic death-notice headline.
    re.compile(r"^[A-Z][A-Z' -]+,\s+[A-Z][A-Za-z .'-]+\s+-\s+", re.IGNORECASE),
    # Herald RSS obits without a publisher suffix, e.g. "PARIS, JOHN J., Jr."
    # — all-caps surname, comma, first name (3+ letters, all-caps or
    # title case), optional initial and Jr./Sr. The 3-letter minimum keeps
    # "WILDWOOD, NJ" style datelines out.
    re.compile(
        r"^[A-Z][A-Z' -]+,\s+(?:[A-Z]{3,}|[A-Z][a-z]{2,})"
        r"(?:\s+[A-Z]\.)?(?:,\s+(?:Jr\.|Sr\.|II|III|IV))?$"
    ),
]


def _is_ad(title: str) -> bool:
    """Google News search results sweep up paid ads ("CAPE MAY COUNTY
    LIBRARY - Ad from 2026/11/03"). Those are not news either."""
    return " - ad from " in (title or "").lower()


def _is_obituary(title: str) -> bool:
    t = (title or "").strip()
    if not t:
        return False
    return any(p.search(t) for p in _OBITUARY_RES)


def _parse_rss_item(el: ET.Element, source: dict[str, str]) -> dict[str, Any] | None:
    title = _child_text(el, "title")
    url = _child_text(el, "link")
    if not title or not url:
        return None
    if _is_obituary(title):
        return None  # paid death notices are not news
    if _is_ad(title):
        return None  # paid ads in Google News results are not news
    # Google News puts the real publication in <source name="...">.
    publisher = ""
    for child in el:
        if _local(child.tag) == "source":
            publisher = child.get("name", "").strip() or _text(child)
            break
    return {
        "id": _item_id(source["id"], url),
        "source_id": source["id"],
        "source_name": source.get("name", ""),
        "kind": source.get("kind", "media"),
        "title": title,
        "url": url,
        "summary": _clean_summary(_child_text(el, "description")),
        "publisher": publisher,
        "published": _child_text(el, "pubDate", "date"),
        "pub_ms": _to_ms(_child_text(el, "pubDate", "date")),
        "category": _child_text(el, "category"),
    }


def _parse_atom_entry(el: ET.Element, source: dict[str, str]) -> dict[str, Any] | None:
    title = _child_text(el, "title")
    url = ""
    for child in el:
        if _local(child.tag) == "link":
            href = (child.get("href") or "").strip()
            rel = (child.get("rel") or "alternate").strip()
            if href and (rel == "alternate" or not url):
                url = href
                if rel == "alternate":
                    break
    if not title or not url:
        return None
    if _is_obituary(title):
        return None  # paid death notices are not news
    if _is_ad(title):
        return None  # paid ads in Google News results are not news
    publisher = ""
    for child in el:
        t = _local(child.tag)
        if t == "source":
            publisher = _child_text(child, "name") or _text(child)
            break
        if t == "author" and not publisher:
            publisher = _child_text(child, "name")
    return {
        "id": _item_id(source["id"], url),
        "source_id": source["id"],
        "source_name": source.get("name", ""),
        "kind": source.get("kind", "media"),
        "title": title,
        "url": url,
        "summary": _clean_summary(_child_text(el, "summary", "content")),
        "publisher": publisher,
        "published": _child_text(el, "published", "updated"),
        "pub_ms": _to_ms(_child_text(el, "published", "updated")),
    }


def parse_feed(xml_text: str, source: dict[str, str]) -> list[dict[str, Any]]:
    """Parse an RSS 2.0 or Atom 1.0 document. Never raises, never touches network."""
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return []
    except Exception:
        return []
    items: list[dict[str, Any]] = []
    for el in root.iter():
        tag = _local(el.tag)
        if tag == "item":
            parsed = _parse_rss_item(el, source)
        elif tag == "entry":
            parsed = _parse_atom_entry(el, source)
        else:
            continue
        if parsed:
            items.append(parsed)
    return items


# ── Press-release listing pages (pure; no network) ──────────────────────────
# Official sources that publish releases as HTML listing pages / PDF uploads
# with no RSS feed. parse_listing() scrapes the listing for release links and
# returns items in the same dict shape as parse_feed(), so storage, the /news
# page, and status() need no changes.

_GENERIC_LINK_TEXT = {
    "pdf", "read more", "click here", "more", "download", "view",
    "press release", "news release",
}

_MONTH_RE = (
    r"january|february|march|april|may|june|july|august|september|october|"
    r"november|december|jan\.?|feb\.?|mar\.?|apr\.?|jun\.?|jul\.?|aug\.?|"
    r"sept?\.?|oct\.?|nov\.?|dec\.?"
)


class _LinkExtractor(HTMLParser):
    """Collect (href, title_attr, text) for every <a> in the page."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.links: list[tuple[str, str, str]] = []
        self._open: list | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "a":
            d = dict(attrs)
            href = (d.get("href") or "").strip()
            if href:
                self._open = [href, (d.get("title") or "").strip(), []]

    def handle_data(self, data: str) -> None:
        if self._open is not None:
            self._open[2].append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "a":
            self._flush()

    def _flush(self) -> None:
        if self._open is not None:
            href, title, chunks = self._open
            text = " ".join(" ".join(chunks).split())
            self.links.append((href, title, text))
            self._open = None

    def close(self) -> None:
        self._flush()  # tolerate a never-closed <a> at end of input
        super().close()


def _ymd_ms(year: int, month: int, day: int) -> int:
    """Calendar date -> epoch ms, 0 when the date is impossible (Feb 30…)."""
    try:
        return int(datetime(year, month, day, tzinfo=timezone.utc).timestamp() * 1000)
    except (ValueError, OverflowError):
        return 0


def _display_ms(ms: int) -> str:
    dt = datetime.fromtimestamp(ms / 1000, tz=timezone.utc)
    return f"{dt.strftime('%B')} {dt.day}, {dt.year}"


def _extract_pub_date(text: str, url: str) -> tuple[str, int]:
    """(display, epoch_ms) — first plausible date found in the link text or URL.

    Handles the prosecutor's YYYYMMDD PDF filenames, "April 17, 2026" style
    release headers, ISO dates, and US-style MM/DD/YYYY. Never raises.
    """
    blob = f"{text} {url}"
    m = re.search(
        r"(?P<year>19\d\d|20\d\d)(?P<month>0[1-9]|1[0-2])(?P<day>0[1-9]|[12]\d|3[01])",
        url,
    )
    if m:
        ms = _ymd_ms(int(m.group("year")), int(m.group("month")), int(m.group("day")))
        if ms:
            return _display_ms(ms), ms
    m = re.search(
        rf"(?P<month>{_MONTH_RE})\s+(?P<day>\d{{1,2}}),?\s+(?P<year>19\d\d|20\d\d)",
        blob,
        re.IGNORECASE,
    )
    if m:
        for fmt in ("%B %d %Y", "%b %d %Y"):
            try:
                dt = datetime.strptime(
                    f"{m.group('month')} {m.group('day')} {m.group('year')}", fmt
                )
                ms = _ymd_ms(dt.year, dt.month, dt.day)
                if ms:
                    return _display_ms(ms), ms
            except ValueError:
                continue
    m = re.search(
        r"(?P<year>20\d\d)-(?P<month>0[1-9]|1[0-2])-(?P<day>0[1-9]|[12]\d|3[01])",
        blob,
    )
    if m:
        ms = _ymd_ms(int(m.group("year")), int(m.group("month")), int(m.group("day")))
        if ms:
            return _display_ms(ms), ms
    m = re.search(
        r"(?P<month>0?[1-9]|1[0-2])[/-](?P<day>0?[1-9]|[12]\d|3[01])[/-]"
        r"(?P<year>19\d\d|20\d\d)",
        blob,
    )
    if m:
        ms = _ymd_ms(int(m.group("year")), int(m.group("month")), int(m.group("day")))
        if ms:
            return _display_ms(ms), ms
    return "", 0


def _listing_title(text: str, title_attr: str, url: str, display: str) -> str:
    """Best title for a release link. Falls back honestly when the link text
    is just "PDF" / "Read more": the title attribute, then a dated label,
    then the prettified filename. Never raises."""
    text = " ".join((text or "").split())
    if text and text.lower() not in _GENERIC_LINK_TEXT:
        return text
    title_attr = " ".join((title_attr or "").split())
    if title_attr:
        return title_attr
    if display:
        return f"Press release — {display}"
    try:
        stem = urlparse(url).path.rsplit("/", 1)[-1]
    except Exception:
        stem = ""
    stem = re.sub(r"\.(pdf|html?|aspx?)$", "", stem, flags=re.IGNORECASE)
    stem = re.sub(r"^(19|20)\d\d(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])[-_]", "", stem)
    stem = stem.replace("-", " ").replace("_", " ").strip()
    return stem or "Press release"


def parse_listing(
    html_text: str, page_url: str, source: dict[str, str]
) -> list[dict[str, Any]]:
    """Scrape a press-release listing page for release links.

    Pure function: never raises, never touches the network. Returns items in
    the same shape as parse_feed().
    """
    try:
        includes = [re.compile(p, re.IGNORECASE) for p in source.get("link_include") or []]
        excludes = [re.compile(p, re.IGNORECASE) for p in source.get("link_exclude") or []]
    except re.error:
        return []
    extractor = _LinkExtractor()
    try:
        extractor.feed(html_text or "")
        extractor.close()
    except Exception:
        return []
    items: list[dict[str, Any]] = []
    seen: set[str] = set()
    for href, title_attr, text in extractor.links:
        try:
            url = urljoin(page_url, href).split("#")[0].strip()
        except Exception:
            continue
        if not url.lower().startswith(("http://", "https://")):
            continue  # mailto:, javascript:, tel:, …
        # Match patterns against the URL and the link text separately, so an
        # end-anchored pattern like \.pdf$ tests the URL itself, not the
        # trailing link text.
        parts = (url, text, title_attr)
        if includes and not any(p.search(part) for p in includes for part in parts):
            continue
        if any(p.search(part) for p in excludes for part in parts):
            continue
        if url in seen:
            continue
        seen.add(url)
        display, pub_ms = _extract_pub_date(text, url)
        title = _clean_summary(_listing_title(text, title_attr, url, display))
        if not title:
            continue
        items.append(
            {
                "id": _item_id(source["id"], url),
                "source_id": source["id"],
                "source_name": source.get("name", ""),
                "kind": source.get("kind", "official"),
                "title": title,
                "url": url,
                "summary": "",
                "publisher": source.get("name", ""),
                "published": display,
                "pub_ms": pub_ms,
            }
        )
    return items


# ── Persistence ─────────────────────────────────────────────────────────────

def _init_db() -> None:
    try:
        con = sqlite3.connect(DB_PATH, timeout=10)
        try:
            con.execute(
                """CREATE TABLE IF NOT EXISTS news_items (
                       id TEXT PRIMARY KEY,
                       source_id TEXT,
                       source_name TEXT,
                       kind TEXT,
                       title TEXT,
                       url TEXT UNIQUE,
                       summary TEXT,
                       publisher TEXT,
                       published TEXT,
                       pub_ms INTEGER,
                       fetched_at INTEGER,
                       raw_json TEXT
                   )"""
            )
            con.execute("CREATE INDEX IF NOT EXISTS idx_news_pub ON news_items(pub_ms)")
            con.execute("CREATE INDEX IF NOT EXISTS idx_news_src ON news_items(source_id)")
            # Auto-catch alerts + incident reports (added 2026-11-14).
            # One row per incident_key: first/last seen, corroborating
            # sources, and the auto-built report (markdown). A new alert
            # fires once per incident_key per ALERT_COOLDOWN_S; later
            # items update the report instead of re-alerting.
            con.execute(
                """CREATE TABLE IF NOT EXISTS news_alerts (
                       incident_key TEXT PRIMARY KEY,
                       rule_id TEXT,
                       severity TEXT,
                       title TEXT,
                       summary TEXT,
                       status TEXT,
                       first_seen INTEGER,
                       last_seen INTEGER,
                       alerted_at INTEGER,
                       source_count INTEGER,
                       sources_json TEXT,
                       urls_json TEXT,
                       report_md TEXT
                   )"""
            )
            con.execute(
                "CREATE INDEX IF NOT EXISTS idx_alerts_seen ON news_alerts(last_seen)"
            )
            con.commit()
        finally:
            con.close()
    except Exception as exc:
        log.warning("news_ingest _init_db error: %s", exc)


def save_items(items: list[dict[str, Any]]) -> int:
    """Insert new items, ignoring duplicates by URL. Returns # newly stored."""
    if not items:
        return 0
    _init_db()
    saved = 0
    now_s = int(time.time())
    try:
        con = sqlite3.connect(DB_PATH, timeout=10)
        try:
            for it in items:
                url = (it.get("url") or "").strip()
                if not url:
                    continue
                pub_ms = it.get("pub_ms") or 0
                try:
                    pub_ms = int(pub_ms)
                except (TypeError, ValueError):
                    pub_ms = 0
                cur = con.execute(
                    """INSERT OR IGNORE INTO news_items
                       (id, source_id, source_name, kind, title, url, summary,
                        publisher, published, pub_ms, fetched_at, raw_json)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        str(it.get("id") or _item_id(str(it.get("source_id", "")), url)),
                        str(it.get("source_id") or ""),
                        str(it.get("source_name") or ""),
                        str(it.get("kind") or "media"),
                        str(it.get("title") or ""),
                        url,
                        str(it.get("summary") or ""),
                        str(it.get("publisher") or ""),
                        str(it.get("published") or ""),
                        pub_ms,
                        now_s,
                        json.dumps(it, default=str),
                    ),
                )
                if cur.rowcount > 0:
                    saved += 1
            # Retention: keep the table from growing forever. Dated items
            # expire by publication date; undated ones (some listing pages
            # carry no parseable date) expire by fetch time instead.
            cutoff_ms = int((time.time() - RETENTION_DAYS * 86400) * 1000)
            cutoff_s = int(time.time() - RETENTION_DAYS * 86400)
            con.execute(
                "DELETE FROM news_items WHERE (pub_ms > 0 AND pub_ms < ?)"
                " OR (pub_ms = 0 AND fetched_at < ?)",
                (cutoff_ms, cutoff_s),
            )
            con.commit()
        finally:
            con.close()
    except Exception as exc:
        log.warning("news_ingest save_items error: %s", exc)
    return saved


def latest(limit: int = 15) -> list[dict[str, Any]]:
    """Newest stored items for the /news page. Never raises.

    Read-only path: never creates the DB file. Before the first successful
    refresh there is simply nothing to show.
    """
    if not DB_PATH.exists():
        return []
    _init_db()
    try:
        limit = max(1, min(int(limit or 15), 100))
    except (TypeError, ValueError):
        limit = 15
    out: list[dict[str, Any]] = []
    try:
        con = sqlite3.connect(DB_PATH, timeout=10)
        try:
            con.row_factory = sqlite3.Row
            rows = con.execute(
                """SELECT id, source_id, source_name, kind, title, url, summary,
                          publisher, published, pub_ms
                   FROM news_items ORDER BY pub_ms DESC, fetched_at DESC LIMIT ?""",
                (limit,),
            ).fetchall()
            for r in rows:
                out.append({k: r[k] for k in r.keys()})
        finally:
            con.close()
    except Exception as exc:
        log.warning("news_ingest latest error: %s", exc)
    return out


def recent_items(since_ms: int, limit: int = 200) -> list[dict[str, Any]]:
    """D5: stored items published at/after since_ms (ms epoch), newest first.

    Read-only path for the daily brief's 24 h window. Never raises.
    """
    if not DB_PATH.exists():
        return []
    _init_db()
    try:
        limit = max(1, min(int(limit or 200), 500))
    except (TypeError, ValueError):
        limit = 200
    out: list[dict[str, Any]] = []
    try:
        con = sqlite3.connect(DB_PATH, timeout=10)
        try:
            con.row_factory = sqlite3.Row
            rows = con.execute(
                """SELECT id, source_id, source_name, kind, title, url, summary,
                          publisher, published, pub_ms
                   FROM news_items WHERE pub_ms >= ? ORDER BY pub_ms DESC, fetched_at DESC LIMIT ?""",
                (int(since_ms), limit),
            ).fetchall()
            for r in rows:
                out.append({k: r[k] for k in r.keys()})
        finally:
            con.close()
    except Exception as exc:
        log.warning("news_ingest recent_items error: %s", exc)
    return out


def recent_alerts(since_s: int, limit: int = 100) -> list[dict[str, Any]]:
    """D5: stored alerts last seen at/after since_s (seconds epoch), newest first.

    Read-only path for the daily brief's 24 h window. Never raises.
    """
    if not DB_PATH.exists():
        return []
    _init_db()
    try:
        limit = max(1, min(int(limit or 100), 500))
    except (TypeError, ValueError):
        limit = 100
    out: list[dict[str, Any]] = []
    try:
        con = sqlite3.connect(DB_PATH, timeout=10)
        try:
            con.row_factory = sqlite3.Row
            rows = con.execute(
                """SELECT incident_key, rule_id, severity, title, summary,
                          status, first_seen, last_seen, alerted_at,
                          source_count, sources_json, urls_json, report_md
                   FROM news_alerts WHERE last_seen >= ? ORDER BY last_seen DESC LIMIT ?""",
                (int(since_s), limit),
            ).fetchall()
            for r in rows:
                d = {k: r[k] for k in r.keys()}
                for col, key in (("sources_json", "sources"), ("urls_json", "urls")):
                    try:
                        d[key] = json.loads(d.pop(col) or "[]")
                    except Exception:
                        d[key] = []
                out.append(d)
        finally:
            con.close()
    except Exception as exc:
        log.warning("news_ingest recent_alerts error: %s", exc)
    return out


def count() -> int:
    if not DB_PATH.exists():
        return 0
    _init_db()
    try:
        con = sqlite3.connect(DB_PATH, timeout=10)
        try:
            row = con.execute("SELECT COUNT(*) FROM news_items").fetchone()
            return int(row[0]) if row else 0
        finally:
            con.close()
    except Exception:
        return 0


# ── Auto-catch: anomaly alerts + incident reports (added 2026-11-14) ─────
# Built with what Cape Dispatch already has — no SDR, no new API, no paid
# service, no LiveATC scraping. The sources above (FAA ground-stop Google
# News searches, NWS Mount Holly alerts) are the sensors; this section is
# the watcher. On 2026-11-13 the nationwide FAA ground stop was live for
# ~20 minutes before anyone here knew, because /news only stored items and
# nobody was watching them. Now a matching item fires an alert and builds
# an incident report on its own, long before William has to ask.
#
# Rules are pure functions over already-fetched items (headline + summary
# only, never full articles). Detection runs inside refresh_all() after
# save_items(), so it costs no extra network. Alerts dedupe by
# incident_key: one alert per incident per ALERT_COOLDOWN_S; later items
# from other sources corroborate the incident and update its report.
#
# What it catches today:
#   * FAA ground stop — national, or ACY / PHL / EWR (critical)
#   * Severe NWS warnings — Tornado / Flash Flood / Severe Thunderstorm /
#     Hurricane (high). Routine advisories and watches do NOT alert.
# What it deliberately does NOT do: routine flight delays, weather
# advisories, or anything that needs a radio. Those need the SDR receiver
# (Phase 2) or a human listening.

def _slug(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    return s[:60] or "unknown"


def _haystack(item: dict[str, Any]) -> str:
    return " ".join(
        str(item.get(k) or "") for k in ("title", "summary", "publisher")
    ).lower()


def _has_all(hay: str, *words: str) -> bool:
    return all(w in hay for w in words)


def _has_any(hay: str, *words: str) -> bool:
    return any(w in hay for w in words)


# Each rule: (rule_id, severity, incident_key_fn, title, matcher)
# matcher(haystack, item) -> bool. Keep rules narrow: a false alert that
# cries wolf every week is worse than a missed routine delay.
def _rule_faa_national(hay: str, item: dict[str, Any]) -> bool:
    if "no ground stop" in hay or "not a ground stop" in hay:
        return False
    return _has_all(hay, "ground stop") and _has_any(
        hay, "faa", "nationwide", "national", "all airports", "u.s. airports"
    )


def _rule_faa_local(hay: str, item: dict[str, Any]) -> bool:
    if "no ground stop" in hay or "not a ground stop" in hay:
        return False
    return _has_all(hay, "ground stop") and _has_any(
        hay,
        "atlantic city",
        "philadelphia",
        "newark",
        "acy",
        "phl",
        "ewr",
        "cape may",
    )


_NWS_SEVERE_EVENTS = (
    "tornado warning",
    "flash flood warning",
    "severe thunderstorm warning",
    "hurricane warning",
    "tropical storm warning",
    "blizzard warning",
    "ice storm warning",
)


def _rule_nws_severe(hay: str, item: dict[str, Any]) -> bool:
    if item.get("source_id") != "nws_mt_holly_alerts":
        return False
    return _has_any(hay, *_NWS_SEVERE_EVENTS)


ANOMALY_RULES: list[dict[str, Any]] = [
    {
        "rule_id": "faa_ground_stop_national",
        "severity": "critical",
        "incident_key": lambda item: "faa-ground-stop",
        "title": "FAA nationwide ground stop",
        "summary": "FAA has ground-stopped departures — nationwide or at ACY / PHL / EWR. Check the advisory and expect delays.",
        "match": _rule_faa_national,
    },
    {
        "rule_id": "faa_ground_stop_local",
        "severity": "critical",
        "incident_key": lambda item: "faa-ground-stop",
        "title": "FAA ground stop — local airports",
        "summary": "FAA has ground-stopped departures affecting Atlantic City, Philadelphia or Newark.",
        "match": _rule_faa_local,
    },
    {
        "rule_id": "nws_severe_warning",
        "severity": "high",
        "incident_key": lambda item: "nws-" + _slug(item.get("title") or "warning"),
        "title": "Severe weather warning — Cape May County",
        "summary": "National Weather Service has issued a severe warning for Cape May County.",
        "match": _rule_nws_severe,
    },
]


def detect_anomalies(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Pure: match already-fetched items against ANOMALY_RULES.

    Returns one anomaly per (rule, incident_key), with the matching items
    attached. Never raises.
    """
    grouped: dict[tuple[str, str], dict[str, Any]] = {}
    try:
        for item in items or []:
            hay = _haystack(item)
            for rule in ANOMALY_RULES:
                try:
                    if not rule["match"](hay, item):
                        continue
                except Exception:
                    continue
                key = (rule["rule_id"], rule["incident_key"](item))
                entry = grouped.get(key)
                if entry is None:
                    entry = {
                        "rule_id": rule["rule_id"],
                        "severity": rule["severity"],
                        "incident_key": rule["incident_key"](item),
                        "title": rule["title"],
                        "summary": rule["summary"],
                        "items": [],
                    }
                    grouped[key] = entry
                entry["items"].append(item)
        out = []
        for entry in grouped.values():
            items_sorted = sorted(
                entry["items"], key=lambda i: int(i.get("pub_ms") or 0)
            )
            entry["first_pub_ms"] = (
                int(items_sorted[0].get("pub_ms") or 0) if items_sorted else 0
            )
            entry["last_pub_ms"] = (
                int(items_sorted[-1].get("pub_ms") or 0) if items_sorted else 0
            )
            entry["source_ids"] = sorted(
                {str(i.get("source_id") or "") for i in entry["items"]} - {""}
            )
            entry["urls"] = [
                str(i.get("url") or "")
                for i in items_sorted
                if i.get("url")
            ]
            out.append(entry)
        return out
    except Exception as exc:
        log.warning("news_ingest detect_anomalies error: %s", exc)
        return []


def build_incident_report(anomaly: dict[str, Any]) -> str:
    """Auto-built incident report (markdown) for one anomaly.

    Headline + short excerpt only, with link-outs to the publishers —
    same rule as /news: never republish full articles. Pure, never raises.
    """
    try:
        items = anomaly.get("items") or []
        lines = [f"# {anomaly.get('title') or 'Incident'}", ""]
        lines.append(anomaly.get("summary") or "")
        lines.append("")
        sources = sorted(
            {str(i.get("publisher") or i.get("source_name") or "") for i in items}
            - {""}
        )
        if sources:
            lines.append(f"**Sources:** {', '.join(sources)}")
            lines.append("")
        lines.append("## Timeline")
        lines.append("")
        seen_urls: set[str] = set()
        for it in sorted(items, key=lambda i: int(i.get("pub_ms") or 0)):
            url = str(it.get("url") or "")
            if url and url in seen_urls:
                continue
            seen_urls.add(url)
            when = str(it.get("published") or "") or "—"
            lines.append(
                f"- {when} — {it.get('title') or ''} "
                f"({it.get('publisher') or it.get('source_name') or ''})"
            )
            if it.get("url"):
                lines.append(f"  {it.get('url')}")
        lines.append("")
        lines.append("## What to watch")
        lines.append("")
        lines.append(
            "- Follow the sources above for updates; this report updates "
            "as new items corroborate the incident."
        )
        lines.append("- No action is implied by this report alone.")
        return "\n".join(lines)
    except Exception as exc:
        log.warning("news_ingest build_incident_report error: %s", exc)
        return f"# {anomaly.get('title') or 'Incident'}\n\n{anomaly.get('summary') or ''}\n"


def record_alert(anomaly: dict[str, Any], now_s: int | None = None) -> str:
    """Store/update an alert for one anomaly. Returns 'new' | 'updated' | ''.

    'new' only the first time an incident_key is seen inside
    ALERT_COOLDOWN_S; later items update the report and last_seen.
    """
    if not anomaly or not anomaly.get("incident_key"):
        return ""
    _init_db()
    now_s = int(now_s if now_s is not None else time.time())
    try:
        con = sqlite3.connect(DB_PATH, timeout=10)
        try:
            row = con.execute(
                "SELECT alerted_at, sources_json, urls_json FROM news_alerts"
                " WHERE incident_key = ?",
                (anomaly["incident_key"],),
            ).fetchone()
            sources = sorted(
                set(json.loads(row[1]) if row and row[1] else [])
                | set(anomaly.get("source_ids") or [])
            )
            urls = list(
                dict.fromkeys(
                    (json.loads(row[2]) if row and row[2] else [])
                    + list(anomaly.get("urls") or [])
                )
            )
            report = build_incident_report(
                {**anomaly, "items": anomaly.get("items") or []}
            )
            if row and int(row[0] or 0) > now_s - ALERT_COOLDOWN_S:
                con.execute(
                    """UPDATE news_alerts SET last_seen = ?, source_count = ?,
                           sources_json = ?, urls_json = ?, report_md = ?
                       WHERE incident_key = ?""",
                    (now_s, len(sources), json.dumps(sources),
                     json.dumps(urls), report, anomaly["incident_key"]),
                )
                con.commit()
                return "updated"
            con.execute(
                """INSERT INTO news_alerts
                   (incident_key, rule_id, severity, title, summary, status,
                    first_seen, last_seen, alerted_at, source_count,
                    sources_json, urls_json, report_md)
                   VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(incident_key) DO UPDATE SET
                     rule_id = excluded.rule_id, severity = excluded.severity,
                     title = excluded.title, summary = excluded.summary,
                     status = 'active', last_seen = excluded.last_seen,
                     alerted_at = excluded.alerted_at,
                     source_count = excluded.source_count,
                     sources_json = excluded.sources_json,
                     urls_json = excluded.urls_json,
                     report_md = excluded.report_md""",
                (
                    anomaly["incident_key"],
                    anomaly.get("rule_id", ""),
                    anomaly.get("severity", "high"),
                    anomaly.get("title", ""),
                    anomaly.get("summary", ""),
                    now_s,
                    now_s,
                    now_s,
                    len(sources),
                    json.dumps(sources),
                    json.dumps(urls),
                    report,
                ),
            )
            con.commit()
            return "new"
        finally:
            con.close()
    except Exception as exc:
        log.warning("news_ingest record_alert error: %s", exc)
        return ""


def process_items_for_alerts(
    items: list[dict[str, Any]], now_s: int | None = None
) -> list[dict[str, str]]:
    """Detect anomalies in fetched items and record alerts. Returns
    [{incident_key, status}] for each anomaly found ('new' or 'updated').
    Pure DB side-effect only; never raises, never fetches network.
    """
    out: list[dict[str, str]] = []
    # Two rules can match the same incident (national + local ground stop):
    # merge them first so the incident keeps one title — the first rule's,
    # i.e. the national one — and all corroborating items.
    merged: dict[str, dict[str, Any]] = {}
    for anomaly in detect_anomalies(items):
        key = anomaly["incident_key"]
        if key not in merged:
            merged[key] = {**anomaly, "items": list(anomaly.get("items") or [])}
            continue
        existing = merged[key]
        seen = {str(i.get("url") or i.get("id") or "") for i in existing["items"]}
        for it in anomaly.get("items") or []:
            k = str(it.get("url") or it.get("id") or "")
            if k and k not in seen:
                seen.add(k)
                existing["items"].append(it)
        existing["source_ids"] = sorted(
            set(existing.get("source_ids") or []) | set(anomaly.get("source_ids") or [])
        )
        existing["urls"] = list(
            dict.fromkeys(list(existing.get("urls") or []) + list(anomaly.get("urls") or []))
        )
    for anomaly in merged.values():
        status = record_alert(anomaly, now_s=now_s)
        if status:
            out.append(
                {"incident_key": anomaly["incident_key"], "status": status}
            )
            if status == "new":
                log.info(
                    "news_ingest ALERT %s: %s (%s)",
                    anomaly.get("severity"),
                    anomaly.get("title"),
                    anomaly["incident_key"],
                )
    return out


def latest_alerts(limit: int = 10) -> list[dict[str, Any]]:
    """Newest alerts for the /news page / admin view. Never raises."""
    if not DB_PATH.exists():
        return []
    _init_db()
    try:
        limit = max(1, min(int(limit or 10), 100))
    except (TypeError, ValueError):
        limit = 10
    out: list[dict[str, Any]] = []
    try:
        con = sqlite3.connect(DB_PATH, timeout=10)
        try:
            con.row_factory = sqlite3.Row
            rows = con.execute(
                """SELECT incident_key, rule_id, severity, title, summary,
                          status, first_seen, last_seen, alerted_at,
                          source_count, sources_json, urls_json, report_md
                   FROM news_alerts ORDER BY last_seen DESC LIMIT ?""",
                (limit,),
            ).fetchall()
            for r in rows:
                d = {k: r[k] for k in r.keys()}
                for col, key in (("sources_json", "sources"), ("urls_json", "urls")):
                    try:
                        d[key] = json.loads(d.pop(col) or "[]")
                    except Exception:
                        d[key] = []
                out.append(d)
        finally:
            con.close()
    except Exception as exc:
        log.warning("news_ingest latest_alerts error: %s", exc)
    return out


def get_alert(incident_key: str) -> dict[str, Any] | None:
    """One alert + its report by incident_key. Never raises."""
    alerts = latest_alerts(limit=100)
    for a in alerts:
        if a.get("incident_key") == incident_key:
            return a
    return None


# ── Fetching ────────────────────────────────────────────────────────────────

_STATUS: dict[str, dict[str, Any]] = {}


async def _fetch_source(client: Any, source: dict[str, str]) -> list[dict[str, Any]]:
    sid = source.get("id", "?")
    try:
        if source.get("api_url"):
            r = await client.get(
                source["api_url"],
                timeout=25,
                headers={"Accept": "application/geo+json"},
            )
            r.raise_for_status()
            items = parse_nws_alerts(r.json(), source)
        elif source.get("page_url"):
            r = await client.get(source["page_url"], timeout=25)
            r.raise_for_status()
            items = parse_listing(r.text, source["page_url"], source)
        else:
            r = await client.get(source["feed_url"], timeout=25)
            r.raise_for_status()
            items = parse_feed(r.text, source)
        items = _filter_by_keywords(items, source)
        items = _filter_by_categories(items, source)
        _STATUS[sid] = {
            "name": source.get("name", ""),
            "kind": source.get("kind", "media"),
            "last_ok": int(time.time()),
            "last_count": len(items),
            "last_error": "",
        }
        return items
    except Exception as exc:
        _STATUS[sid] = {
            "name": source.get("name", ""),
            "kind": source.get("kind", "media"),
            "last_ok": _STATUS.get(sid, {}).get("last_ok", 0),
            "last_count": 0,
            "last_error": f"{type(exc).__name__}: {exc}"[:200],
        }
        log.warning("news_ingest: source '%s' failed: %s", sid, exc)
        return []


async def refresh_all() -> int:
    """Fetch every allowlisted source, store new items. Returns # new. Never raises.

    Auto-catch: every fetched item is also run through
    process_items_for_alerts(), so a ground stop / severe warning fires
    an alert and builds an incident report on this cycle, not later.
    """
    import httpx  # lazy: the module (and the /news page) boots without it

    sources = _active_sources()
    if not sources:
        return 0
    return await refresh_sources(sources)


async def refresh_sources(sources: list[dict[str, str]]) -> int:
    """Fetch the given sources, store new items, run auto-catch. Returns # new."""
    import httpx  # lazy

    if not sources:
        return 0
    total_new = 0
    all_items: list[dict[str, Any]] = []
    try:
        async with httpx.AsyncClient(
            timeout=30,
            follow_redirects=True,
            headers={"User-Agent": "CapeDispatch/1.0 (news ingest)"},
        ) as client:
            results = await asyncio.gather(
                *[_fetch_source(client, s) for s in sources],
                return_exceptions=True,
            )
        for result in results:
            if isinstance(result, Exception):
                log.warning("news_ingest refresh error: %s", result)
                continue
            if result:
                all_items.extend(result)
                total_new += save_items(result)
        if all_items:
            process_items_for_alerts(all_items)
    except Exception as exc:
        log.warning("news_ingest refresh_all error: %s", exc)
    if total_new:
        log.info("news_ingest: %d new items", total_new)
    return total_new


async def _background_refresher() -> None:
    """Background task, started from main.py.

    Full refresh every REFRESH_INTERVAL (15 min); anomaly sources
    (FAA ground stop, NWS alerts) every FAST_REFRESH_INTERVAL (5 min).
    """
    try:
        await refresh_all()  # initial fetch at startup
    except Exception as exc:
        log.warning("news_ingest initial refresh failed: %s", exc)
    while True:
        await asyncio.sleep(FAST_REFRESH_INTERVAL)
        try:
            fast = [s for s in _active_sources() if s.get("id") in FAST_SOURCE_IDS]
            await refresh_sources(fast)
        except Exception as exc:
            log.warning("news_ingest fast refresh cycle error: %s", exc)
        # Every third fast cycle is a full cycle (15 min).
        for _ in range(2):
            await asyncio.sleep(FAST_REFRESH_INTERVAL)
            try:
                fast = [s for s in _active_sources() if s.get("id") in FAST_SOURCE_IDS]
                await refresh_sources(fast)
            except Exception as exc:
                log.warning("news_ingest fast refresh cycle error: %s", exc)
        try:
            await refresh_all()
        except Exception as exc:
            log.warning("news_ingest refresh cycle error: %s", exc)


def status() -> dict[str, Any]:
    """Per-source health for admin/health views. Never raises."""
    now = int(time.time())
    srcs = []
    for s in _active_sources():
        st = _STATUS.get(s["id"], {})
        last_ok = st.get("last_ok", 0)
        srcs.append(
            {
                "id": s["id"],
                "name": s.get("name", ""),
                "kind": s.get("kind", "media"),
                "last_ok": last_ok,
                "age_s": (now - last_ok) if last_ok else None,
                "last_count": st.get("last_count", 0),
                "last_error": st.get("last_error", ""),
            }
        )
    return {
        "sources": srcs,
        "stored": count(),
        "alerts": len(latest_alerts(limit=100)),
        "refresh_seconds": REFRESH_INTERVAL,
        "fast_refresh_seconds": FAST_REFRESH_INTERVAL,
    }
