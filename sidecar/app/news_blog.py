"""news_blog.py — Cape Dispatch "News & Blogs": posts store + routes.

SQLite adaptation of the Part D schema (INTEGER PK, TEXT for JSON
sources, REAL lat/lon — no BIGSERIAL/JSONB/GEOMETRY). Same database
file as news_ingest (cape_dispatch.db, via NEWS_DB_FILE).

Routes (FastAPI APIRouter — main.py includes it, it does not edit main.py):
    GET  /news            list, newest first, category + municipality filters
    GET  /news/{slug}     article page
    GET  /news/feed.xml   RSS 2.0
    GET  /blog            same list, category=Blog
    GET  /api/news/review review queue (JSON; phone push is OUT of scope —
                          the queue is API-only for now)

Every news page carries the footer banner:
"Unofficial. Information from public sources and radio traffic may be
incomplete. Call 911 for emergencies."

HTML is served inline (HTMLResponse) the way main.py already does — no
new template engine. Public pages show published posts only; drafts and
review-queue posts return 404, so nothing unapproved leaks out.
"""
from __future__ import annotations

import html
import json
import logging
import os
import re
import sqlite3
import time
from datetime import datetime, timezone
from email.utils import formatdate
from pathlib import Path
from typing import Any

from fastapi import APIRouter
from fastapi.responses import HTMLResponse, JSONResponse, Response

log = logging.getLogger("cape_dispatch.news_blog")

DB_PATH = Path(os.environ.get("NEWS_DB_FILE", r"C:\cape-dispatch\cape_dispatch.db"))

FOOTER_BANNER = (
    "Unofficial. Information from public sources and radio traffic "
    "may be incomplete. Call 911 for emergencies."
)
AUTHOR = "Cape Dispatch Desk"

_POST_COLUMNS = (
    "id", "slug", "topic_key", "parent_id", "status", "category",
    "municipality", "headline", "dek", "dateline", "body_md",
    "lead_image_url", "lead_image_alt", "lead_image_credit",
    "lead_image_source_url", "sources_json", "lat", "lon",
    "is_update", "confidence", "contains_named_individuals",
    "gate_reasons_json", "published_at", "updated_at",
    "author", "reviewed_by",
)

router = APIRouter()


# ── Posts store (SQLite) ────────────────────────────────────────────────────

def _db(db_path: Any | None) -> Path:
    return Path(db_path) if db_path else DB_PATH


def init_posts_db(db_path: Any | None = None) -> None:
    """Create the posts tables if missing. Never raises."""
    try:
        con = sqlite3.connect(_db(db_path), timeout=10)
        try:
            con.execute(
                """CREATE TABLE IF NOT EXISTS news_posts (
                       id INTEGER PRIMARY KEY AUTOINCREMENT,
                       slug TEXT UNIQUE,
                       topic_key TEXT,
                       parent_id INTEGER REFERENCES news_posts(id),
                       status TEXT CHECK (status IN ('draft','review','published','retracted')),
                       category TEXT,
                       municipality TEXT,
                       headline TEXT,
                       dek TEXT,
                       dateline TEXT,
                       body_md TEXT,
                       lead_image_url TEXT,
                       lead_image_alt TEXT,
                       lead_image_credit TEXT,
                       lead_image_source_url TEXT,
                       sources_json TEXT,
                       lat REAL,
                       lon REAL,
                       is_update INTEGER DEFAULT 0,
                       confidence REAL,
                       contains_named_individuals INTEGER DEFAULT 0,
                       gate_reasons_json TEXT,
                       published_at INTEGER,
                       updated_at INTEGER,
                       author TEXT DEFAULT 'Cape Dispatch Desk',
                       reviewed_by TEXT
                   )"""
            )
            con.execute("CREATE INDEX IF NOT EXISTS idx_posts_status ON news_posts(status, published_at)")
            con.execute("CREATE INDEX IF NOT EXISTS idx_posts_topic ON news_posts(topic_key)")
            con.execute("CREATE INDEX IF NOT EXISTS idx_posts_slug ON news_posts(slug)")
            con.execute(
                """CREATE TABLE IF NOT EXISTS news_post_sources (
                       post_id INTEGER REFERENCES news_posts(id),
                       guid TEXT,
                       PRIMARY KEY (post_id, guid)
                   )"""
            )
            con.commit()
        finally:
            con.close()
    except Exception as exc:
        log.warning("news_blog init_posts_db error: %s", exc)


def slugify(headline: str) -> str:
    """URL slug for a headline (UPDATE: prefix stripped)."""
    text = re.sub(r"^update:\s*", "", (headline or "").strip(), flags=re.I)
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:80].strip("-")
    return slug or "post"


def _unique_slug(con: sqlite3.Connection, base: str) -> str:
    slug, n = base, 2
    while con.execute("SELECT 1 FROM news_posts WHERE slug = ?", (slug,)).fetchone():
        slug = f"{base}-{n}"
        n += 1
    return slug


def _row_to_post(row: sqlite3.Row) -> dict[str, Any]:
    d = {k: row[k] for k in row.keys()}
    for col, key in (("sources_json", "sources"), ("gate_reasons_json", "gate_reasons")):
        try:
            d[key] = json.loads(d.pop(col) or "[]")
        except Exception:
            d[key] = []
    d["is_update"] = bool(d.get("is_update"))
    d["contains_named_individuals"] = bool(d.get("contains_named_individuals"))
    return d


def create_post(fields: dict[str, Any], db_path: Any | None = None) -> dict[str, Any]:
    """Insert one post. Returns the stored post dict (with id/slug)."""
    init_posts_db(db_path)
    now = int(time.time())
    con = sqlite3.connect(_db(db_path), timeout=10)
    try:
        con.row_factory = sqlite3.Row
        # D5: a caller may pin the slug (the daily brief's
        # daily-brief-YYYY-MM-DD); otherwise it derives from the headline
        # as before. Either way it is uniquified against the table.
        wanted = str(fields.get("slug") or "").strip()
        slug = _unique_slug(con, slugify(wanted) if wanted else slugify(str(fields.get("headline") or "post")))
        status = str(fields.get("status") or "draft")
        published_at = now if status == "published" else None
        cur = con.execute(
            """INSERT INTO news_posts
               (slug, topic_key, parent_id, status, category, municipality,
                headline, dek, dateline, body_md,
                lead_image_url, lead_image_alt, lead_image_credit,
                lead_image_source_url, sources_json, lat, lon,
                is_update, confidence, contains_named_individuals,
                gate_reasons_json, published_at, updated_at, author, reviewed_by)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                slug,
                fields.get("topic_key"),
                fields.get("parent_id"),
                status,
                fields.get("category") or "News",
                fields.get("municipality") or "CAPE MAY COURT HOUSE",
                fields.get("headline") or "",
                fields.get("dek") or "",
                fields.get("dateline") or "",
                fields.get("body_md") or "",
                fields.get("lead_image_url"),
                fields.get("lead_image_alt") or "",
                fields.get("lead_image_credit") or "",
                fields.get("lead_image_source_url") or "",
                json.dumps(fields.get("sources") or []),
                fields.get("lat"),
                fields.get("lon"),
                1 if fields.get("is_update") else 0,
                fields.get("confidence"),
                1 if fields.get("contains_named_individuals") else 0,
                json.dumps(fields.get("gate_reasons") or []),
                published_at,
                now,
                fields.get("author") or AUTHOR,
                fields.get("reviewed_by"),
            ),
        )
        con.commit()
        row = con.execute("SELECT * FROM news_posts WHERE id = ?", (cur.lastrowid,)).fetchone()
        return _row_to_post(row)
    finally:
        con.close()


def get_post(post_id: int, db_path: Any | None = None) -> dict[str, Any] | None:
    """One post by id, any status. Never raises."""
    if not _db(db_path).exists():
        return None
    init_posts_db(db_path)
    try:
        con = sqlite3.connect(_db(db_path), timeout=10)
        try:
            con.row_factory = sqlite3.Row
            row = con.execute("SELECT * FROM news_posts WHERE id = ?", (int(post_id),)).fetchone()
            return _row_to_post(row) if row else None
        finally:
            con.close()
    except Exception as exc:
        log.warning("news_blog get_post error: %s", exc)
        return None


def get_post_by_slug(slug: str, db_path: Any | None = None) -> dict[str, Any] | None:
    """One post by slug, any status. Never raises."""
    if not _db(db_path).exists():
        return None
    init_posts_db(db_path)
    try:
        con = sqlite3.connect(_db(db_path), timeout=10)
        try:
            con.row_factory = sqlite3.Row
            row = con.execute("SELECT * FROM news_posts WHERE slug = ?", (slug,)).fetchone()
            return _row_to_post(row) if row else None
        finally:
            con.close()
    except Exception as exc:
        log.warning("news_blog get_post_by_slug error: %s", exc)
        return None


def list_posts(
    *,
    status: str | None = "published",
    category: str | None = None,
    municipality: str | None = None,
    limit: int = 20,
    db_path: Any | None = None,
) -> list[dict[str, Any]]:
    """Posts newest first. Public lists pass status='published'.
    Never raises."""
    if not _db(db_path).exists():
        return []
    init_posts_db(db_path)
    try:
        limit = max(1, min(int(limit or 20), 100))
    except (TypeError, ValueError):
        limit = 20
    where, params = [], []
    if status:
        where.append("status = ?")
        params.append(status)
    if category:
        where.append("category = ?")
        params.append(category)
    if municipality:
        where.append("municipality = ?")
        params.append(municipality)
    sql = "SELECT * FROM news_posts"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY COALESCE(published_at, updated_at) DESC, id DESC LIMIT ?"
    params.append(limit)
    try:
        con = sqlite3.connect(_db(db_path), timeout=10)
        try:
            con.row_factory = sqlite3.Row
            rows = con.execute(sql, params).fetchall()
            return [_row_to_post(r) for r in rows]
        finally:
            con.close()
    except Exception as exc:
        log.warning("news_blog list_posts error: %s", exc)
        return []


def list_review_queue(db_path: Any | None = None) -> list[dict[str, Any]]:
    """Posts waiting for Will's tap (status='review'), oldest first."""
    return list_posts(status="review", limit=100, db_path=db_path)[::-1]


def find_parent_post(topic_key: str, db_path: Any | None = None) -> dict[str, Any] | None:
    """Latest published post for a topic_key — the parent an UPDATE
    attaches to. Returns None if the topic has no published post."""
    if not topic_key or not _db(db_path).exists():
        return None
    init_posts_db(db_path)
    try:
        con = sqlite3.connect(_db(db_path), timeout=10)
        try:
            con.row_factory = sqlite3.Row
            row = con.execute(
                """SELECT * FROM news_posts WHERE topic_key = ? AND status = 'published'
                   ORDER BY COALESCE(published_at, updated_at) DESC, id DESC LIMIT 1""",
                (topic_key,),
            ).fetchone()
            return _row_to_post(row) if row else None
        finally:
            con.close()
    except Exception as exc:
        log.warning("news_blog find_parent_post error: %s", exc)
        return None


def latest_brief(db_path: Any | None = None) -> dict[str, Any] | None:
    """D5: newest daily-brief post of any status, newest first.

    The layer pins this one (a brief in review is shown as in review,
    not hidden). Returns None when no brief has ever been written.
    """
    if not _db(db_path).exists():
        return None
    init_posts_db(db_path)
    try:
        con = sqlite3.connect(_db(db_path), timeout=10)
        try:
            con.row_factory = sqlite3.Row
            row = con.execute(
                """SELECT * FROM news_posts WHERE topic_key = 'daily-brief'
                   ORDER BY COALESCE(published_at, updated_at) DESC, id DESC LIMIT 1"""
            ).fetchone()
            return _row_to_post(row) if row else None
        finally:
            con.close()
    except Exception as exc:
        log.warning("news_blog latest_brief error: %s", exc)
        return None


def get_updates(post_id: int, db_path: Any | None = None) -> list[dict[str, Any]]:
    """Published UPDATE posts threaded to a parent, oldest first."""
    if not _db(db_path).exists():
        return []
    init_posts_db(db_path)
    try:
        con = sqlite3.connect(_db(db_path), timeout=10)
        try:
            con.row_factory = sqlite3.Row
            rows = con.execute(
                """SELECT * FROM news_posts WHERE parent_id = ? AND status = 'published'
                   ORDER BY COALESCE(published_at, updated_at) ASC, id ASC""",
                (int(post_id),),
            ).fetchall()
            return [_row_to_post(r) for r in rows]
        finally:
            con.close()
    except Exception as exc:
        log.warning("news_blog get_updates error: %s", exc)
        return []


def attach_sources(post_id: int, guids: list[str], db_path: Any | None = None) -> None:
    """Link source-item guids to a post. Never raises."""
    if not guids:
        return
    init_posts_db(db_path)
    try:
        con = sqlite3.connect(_db(db_path), timeout=10)
        try:
            for g in guids:
                con.execute(
                    "INSERT OR IGNORE INTO news_post_sources (post_id, guid) VALUES (?, ?)",
                    (int(post_id), str(g)),
                )
            con.commit()
        finally:
            con.close()
    except Exception as exc:
        log.warning("news_blog attach_sources error: %s", exc)


def get_post_sources(post_id: int, db_path: Any | None = None) -> list[str]:
    """Source guids attached to a post. Never raises."""
    if not _db(db_path).exists():
        return []
    init_posts_db(db_path)
    try:
        con = sqlite3.connect(_db(db_path), timeout=10)
        try:
            rows = con.execute(
                "SELECT guid FROM news_post_sources WHERE post_id = ?",
                (int(post_id),),
            ).fetchall()
            return [r[0] for r in rows]
        finally:
            con.close()
    except Exception as exc:
        log.warning("news_blog get_post_sources error: %s", exc)
        return []


def set_post_status(
    post_id: int, status: str, reviewed_by: str | None = None,
    db_path: Any | None = None,
) -> dict[str, Any] | None:
    """Approve / retract a post. Publishing sets published_at.
    Returns the updated post, or None if not found."""
    if status not in ("draft", "review", "published", "retracted"):
        raise ValueError(f"bad status: {status!r}")
    init_posts_db(db_path)
    now = int(time.time())
    con = sqlite3.connect(_db(db_path), timeout=10)
    try:
        con.row_factory = sqlite3.Row
        row = con.execute("SELECT * FROM news_posts WHERE id = ?", (int(post_id),)).fetchone()
        if not row:
            return None
        published_at = row["published_at"]
        if status == "published" and not published_at:
            published_at = now
        con.execute(
            """UPDATE news_posts SET status = ?, reviewed_by = ?,
               published_at = ?, updated_at = ? WHERE id = ?""",
            (status, reviewed_by, published_at, now, int(post_id)),
        )
        con.commit()
        row = con.execute("SELECT * FROM news_posts WHERE id = ?", (int(post_id),)).fetchone()
        return _row_to_post(row)
    finally:
        con.close()


# ── Rendering (inline HTML, same dark theme as main.py) ─────────────────────

def _fmt_date(epoch: int | None) -> str:
    if not epoch:
        return ""
    try:
        from zoneinfo import ZoneInfo

        tz = ZoneInfo("America/New_York")
    except Exception:
        tz = timezone.utc
    return datetime.fromtimestamp(int(epoch), tz=tz).strftime("%b %d, %Y %I:%M %p ET")


def _esc(text: Any) -> str:
    return html.escape(str(text or ""))


_PAGE_CSS = """
body { background:#070b10; color:#e6edf3; font-family:system-ui,-apple-system,sans-serif; margin:0; padding:0; }
a { color:#38bdf8; }
header { padding:18px 22px; border-bottom:1px solid #212d3b; display:flex; align-items:baseline; gap:14px; }
header h1 { margin:0; font-size:20px; } header h1 a { color:#e6edf3; text-decoration:none; }
header .sub { color:#8b98a5; font-size:.85rem; }
.wrap { max-width:860px; margin:0 auto; padding:20px; }
.chips { display:flex; gap:8px; flex-wrap:wrap; margin:0 0 18px; }
.chip { border:1px solid #283648; border-radius:999px; padding:5px 12px; font-size:.82rem; color:#c9d4de; text-decoration:none; }
.chip.on { background:#38bdf8; color:#05121e; border-color:#38bdf8; font-weight:700; }
.card { background:#0d131a; border:1px solid #212d3b; border-radius:12px; padding:16px 18px; margin:0 0 14px; }
.card h2 { margin:0 0 6px; font-size:19px; } .card h2 a { color:#e6edf3; text-decoration:none; }
.card h2 a:hover { text-decoration:underline; }
.meta { color:#8b98a5; font-size:.82rem; margin:0 0 8px; }
.dek { color:#c9d4de; margin:0 0 8px; }
.badge { display:inline-block; background:#f59e0b; color:#1c1005; font-size:.72rem; font-weight:700; border-radius:4px; padding:2px 6px; margin-left:8px; vertical-align:middle; }
.thumb { width:100%; max-height:320px; object-fit:cover; border-radius:8px; margin:0 0 12px; }
.credit { color:#8b98a5; font-size:.78rem; margin:-6px 0 12px; }
.body p { line-height:1.6; margin:0 0 14px; }
.srcs { border-top:1px solid #212d3b; margin-top:18px; padding-top:12px; font-size:.88rem; }
.srcs li { margin-bottom:6px; }
.updates { border-left:3px solid #f59e0b; padding-left:14px; margin:20px 0; }
.banner { background:#1c1005; border:1px solid #7c2d12; color:#fdba74; border-radius:8px; padding:12px 16px; margin:24px 0 0; font-size:.88rem; }
.empty { color:#8b98a5; padding:30px 0; }
"""


def _page_shell(title: str, body: str) -> str:
    return f"""<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{_esc(title)} — Cape Dispatch</title>
<style>{_PAGE_CSS}</style></head><body>
<header><h1><a href="/">Cape Dispatch</a></h1><span class="sub">Cape May County · News &amp; Blogs</span></header>
<div class="wrap">{body}
<div class="banner">{_esc(FOOTER_BANNER)}</div>
</div></body></html>"""


def _card_html(post: dict[str, Any]) -> str:
    badge = '<span class="badge">Updated</span>' if post.get("is_update") else ""
    img = ""
    if post.get("lead_image_url"):
        img = (f'<a href="/news/{_esc(post["slug"])}">'
               f'<img class="thumb" src="{_esc(post["lead_image_url"])}" '
               f'alt="{_esc(post.get("lead_image_alt") or post["headline"])}"></a>')
    return f"""<article class="card">{img}
<h2><a href="/news/{_esc(post["slug"])}">{_esc(post["headline"])}{badge}</a></h2>
<p class="meta">{_esc(post.get("dateline") or _fmt_date(post.get("published_at")))} · {_esc(post.get("category"))} · {_esc(post.get("municipality"))} · {len(post.get("sources") or [])} source(s)</p>
<p class="dek">{_esc(post.get("dek"))}</p>
</article>"""


def render_list_html(
    posts: list[dict[str, Any]],
    *,
    category: str | None = None,
    municipality: str | None = None,
    title: str = "News",
) -> str:
    """News list page (used by /news and /blog). Pure function."""
    cats = ["News", "Public Safety", "Weather", "Government", "Community",
            "Business", "Aviation", "Marine", "Blog"]
    chips = ['<a class="chip%s" href="/news">All</a>' % ("" if category else " on")]
    for c in cats:
        on = " on" if category == c else ""
        chips.append(f'<a class="chip{on}" href="/news?category={c}">{c}</a>')
    cards = "".join(_card_html(p) for p in posts) or '<p class="empty">No posts yet.</p>'
    heading = title if not municipality else f"{title} — {municipality}"
    body = f"<h2>{_esc(heading)}</h2><div class=\"chips\">{''.join(chips)}</div>{cards}"
    return _page_shell(title, body)


def _body_html(body_md: str) -> str:
    """Minimal Markdown → HTML for writer output: paragraphs only.
    Dateline line is bolded; everything is escaped first."""
    _dateline = re.compile(
        r"^[A-Z][A-Z .']+, (Jan\.|Feb\.|Mar\.|Apr\.|May|Jun\.|Jul\.|Aug\.|Sep\.|Sept\.|Oct\.|Nov\.|Dec\.) \d{1,2}, \d{4} —"
    )
    out: list[str] = []
    for para in re.split(r"\n\s*\n", (body_md or "").strip()):
        para = para.strip()
        if not para:
            continue
        esc = html.escape(para).replace("\n", " ")
        if esc.lower().startswith("sources:"):
            out.append(f"<p><strong>Sources:</strong>{esc[len('Sources:'):]} </p>")
        elif _dateline.match(esc):
            out.append(f"<p><strong>{esc}</strong></p>")
        else:
            out.append(f"<p>{esc}</p>")
    return "\n".join(out)


def render_article_html(
    post: dict[str, Any],
    *,
    updates: list[dict[str, Any]] | None = None,
) -> str:
    """Article page for one post. Pure function."""
    img = ""
    if post.get("lead_image_url"):
        img = (f'<img class="thumb" src="{_esc(post["lead_image_url"])}" '
               f'alt="{_esc(post.get("lead_image_alt") or post["headline"])}">')
        if post.get("lead_image_credit"):
            img += f'<p class="credit">{_esc(post["lead_image_credit"])}</p>'
    srcs = ""
    sources = post.get("sources") or []
    if sources:
        items = "".join(
            f'<li><a href="{_esc(s.get("url"))}">{_esc(s.get("name"))}</a>'
            f' ({_esc(s.get("kind") or "source")})</li>'
            for s in sources if isinstance(s, dict)
        )
        srcs = f'<div class="srcs"><strong>Sources</strong><ul>{items}</ul></div>'
    map_link = ""
    if post.get("lat") is not None and post.get("lon") is not None:
        map_link = (f'<p><a href="https://capemaydispatch.com/#v=2'
                    f'&lat={float(post["lat"]):.4f}&lon={float(post["lon"]):.4f}'
                    f'&alt=3000">Related on the map &rarr;</a></p>')
    thread = ""
    if updates:
        blocks = "".join(
            f'<div class="card"><h2><a href="/news/{_esc(u["slug"])}">{_esc(u["headline"])}</a></h2>'
            f'<p class="meta">{_esc(u.get("dateline") or _fmt_date(u.get("published_at")))}</p>'
            f'<p class="dek">{_esc(u.get("dek"))}</p></div>'
            for u in updates
        )
        thread = f'<div class="updates"><h3>Updates</h3>{blocks}</div>'
    body = f"""<article class="card">{img}
<h2>{_esc(post["headline"])}</h2>
<p class="meta">{_esc(post.get("dateline") or _fmt_date(post.get("published_at")))} · {_esc(post.get("category"))} · {_esc(post.get("municipality"))}</p>
<p class="dek">{_esc(post.get("dek"))}</p>
<div class="body">{_body_html(post.get("body_md") or "")}</div>
{map_link}{srcs}</article>{thread}"""
    return _page_shell(post.get("headline") or "News", body)


def render_rss(posts: list[dict[str, Any]], *, base_url: str = "https://capemaydispatch.com") -> str:
    """RSS 2.0 feed, mirroring Scanner's shape: <category> + <guid
    isPermaLink="true">. Pure function."""
    items = []
    for p in posts:
        link = f"{base_url}/news/{p['slug']}"
        pub = formatdate(int(p.get("published_at") or p.get("updated_at") or 0), usegmt=True)
        desc = (p.get("dek") or "") + (" — " + (p.get("dateline") or "") if p.get("dateline") else "")
        items.append(
            "<item>"
            f"<title>{html.escape(p.get('headline') or '')}</title>"
            f"<link>{html.escape(link)}</link>"
            f"<guid isPermaLink=\"true\">{html.escape(link)}</guid>"
            f"<pubDate>{pub}</pubDate>"
            f"<category>{html.escape(p.get('category') or 'News')}</category>"
            f"<description>{html.escape(desc)}</description>"
            "</item>"
        )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<rss version="2.0"><channel>'
        "<title>Cape Dispatch — News &amp; Blogs</title>"
        f"<link>{base_url}/news</link>"
        "<description>Original reporting for Cape May County, New Jersey.</description>"
        + "".join(items) +
        "</channel></rss>"
    )


# ── Routes ──────────────────────────────────────────────────────────────────

@router.get("/news", response_class=HTMLResponse)
def news_list(category: str | None = None, municipality: str | None = None):
    posts = list_posts(status="published", category=category,
                       municipality=municipality, limit=20)
    return HTMLResponse(render_list_html(posts, category=category,
                                         municipality=municipality, title="News"))


@router.get("/news/feed.xml")
def news_feed():
    posts = list_posts(status="published", limit=20)
    return Response(content=render_rss(posts), media_type="application/rss+xml")


@router.get("/news/{slug}", response_class=HTMLResponse)
def news_article(slug: str):
    post = get_post_by_slug(slug)
    if not post or post.get("status") != "published":
        return HTMLResponse(
            _page_shell("Not found", "<p class=\"empty\">That story isn't published.</p>"),
            status_code=404,
        )
    updates = get_updates(post["id"])
    return HTMLResponse(render_article_html(post, updates=updates))


@router.get("/blog", response_class=HTMLResponse)
def blog_list(category: str | None = None, municipality: str | None = None):
    posts = list_posts(status="published", category="Blog",
                       municipality=municipality, limit=20)
    return HTMLResponse(render_list_html(posts, category="Blog",
                                         municipality=municipality, title="Blog"))


@router.get("/api/news/review")
def review_queue():
    queue = list_review_queue()
    return JSONResponse([
        {
            "id": p["id"],
            "slug": p["slug"],
            "headline": p["headline"],
            "category": p["category"],
            "municipality": p["municipality"],
            "topic_key": p.get("topic_key"),
            "is_update": p.get("is_update"),
            "confidence": p.get("confidence"),
            "contains_named_individuals": p.get("contains_named_individuals"),
            "gate_reasons": p.get("gate_reasons") or [],
            "created_at": p.get("updated_at"),
        }
        for p in queue
    ])
