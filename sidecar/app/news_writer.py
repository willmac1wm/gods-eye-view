"""news_writer.py — Cape Dispatch "News & Blogs" autonomous reporter:
writer half (handoff Parts D–I).

The poller half (Part C) already lives in app/news_ingest.py. This module
is the rest of the pipeline:

    [clustered source items] → [Writer LLM (Gemini, free tier)]
      → [validate] → [image step] → [gate] → [posts store, app/news_blog.py]

Stack adaptation (the handoff assumes Next.js + Postgres; neither exists):
the live site is FastAPI + SQLAlchemy + SQLite, httpx is already a
dependency, python-dotenv is available. The posts store is plain SQLite
via the stdlib (same pattern as news_ingest.py), and the router is a
FastAPI APIRouter in app/news_blog.py.

Gemini free tier via REST — no SDK, no key in code, no paid service:
    POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
    header: x-goog-api-key: <GEMINI_API_KEY>
Key from env GEMINI_API_KEY, model from env GEMINI_MODEL. Default model
is ONE config constant (DEFAULT_MODEL = "gemini-3.5-flash-lite", Google's
documented replacement for the deprecated gemini-2.5-flash, confirmed
live in AI Studio 2026-11-15). The free key is stored in the vault
(connector custom.gemini); until it exists, write_post() raises a clear
error and nothing is written. The transport is injectable so tests run
offline with a stub, and so a live run can go through the vault's
surrogate exchange instead of an env key.

Guardrails (non-negotiable, from the handoff):
  * Raw ACARS / dispatch free text is never republished verbatim.
  * Block-level addresses only, no house numbers, no patient details,
    no fatalities from radio traffic.
  * Named defendants only from a prosecutor/police release, and always
    → review queue, never auto-published.
  * Images: map default, NWS graphics, agency press-release graphics.
    NEVER Scanner photos, Fire Wire members' photos, Facebook images,
    stock photos, or AI scene photos presented as real.
"""
from __future__ import annotations

import json
import logging
import os
import re
import time
from typing import Any
from urllib.parse import urlparse

log = logging.getLogger("cape_dispatch.news_writer")

# ── Gemini config ───────────────────────────────────────────────────────────
# ONE config constant for the model. gemini-3.5-flash-lite is the free-tier
# default (Google's documented replacement for gemini-2.5-flash, which is
# deprecated and auto-routes to it; confirmed in AI Studio 2026-11-15).
# Change this constant (or set GEMINI_MODEL in the environment) and
# nothing else needs to move.
DEFAULT_MODEL = "gemini-3.5-flash-lite"
GEMINI_API_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
)
GEMINI_TIMEOUT_S = 60

# ── Categories (Part E) ─────────────────────────────────────────────────────
CATEGORIES = (
    "News", "Public Safety", "Weather", "Government", "Community",
    "Business", "Aviation", "Marine", "Blog",
)

# Sources whose items may auto-publish when the rest of the gate passes
# (Part H). Official alert/notice sources, plus local media that Part H
# allows as "summarize + link" (1 paragraph, credit, link — never a full
# rewrite). Prosecutor / police releases and dispatch input are NOT here:
# they always go to review.
AUTO_PUBLISH_SOURCE_IDS = frozenset({
    # Official: NWS alerts, county Alert Center + newsflash, county news.
    "nws_mt_holly_alerts", "county_alerts", "county_news", "cmc_county",
    # FAA ground stop (national + NJ airports).
    "gnews_faa_groundstop", "gnews_nj_airports_groundstop",
    # Local media — summarize + link only.
    "capemay_scanner", "seaisle_news", "ocnj_daily", "herald",
    "capemay_daily_ps", "espn973_capemay", "gnews_capemay",
    "gnews_wildwood", "gnews_pressofac", "gnews_6abc_capemay",
    "nj1015", "fox29", "abc6", "oc_sentinel",
})
# Sources that always force review, whatever the writer says.
REVIEW_SOURCE_IDS = frozenset({
    "cmcpo_press",   # Prosecutor's Office — named defendants
    "capemay_pd",    # Cape May PD — named defendants / arrests
    "dispatch_in",   # radio dispatch webhook — EMS / fatality risk
})

GATE_MIN_CONFIDENCE = 0.75

# Words that mark EMS / patient content in a draft or its sources.
# Any hit → review queue (Part H: radio dispatch with EMS or possible
# fatality needs Will's tap).
EMS_WORDS = (
    "ems", "ambulance", "patient", "fatality", "fatal", "deceased",
    "died", "killed", "victim", "overdose", "hospital", "injured",
    "injuries", "trauma", "cardiac arrest", "unresponsive",
)

# ── Image step (Part F) ─────────────────────────────────────────────────────
# Hosts that are NEVER an image source, whatever the writer asks for.
BLOCKED_IMAGE_HOSTS = (
    "facebook.com", "fbcdn.net", "instagram.com", "capemayscanner.com",
    "istockphoto.com", "shutterstock.com", "gettyimages.com",
    "unsplash.com", "pexels.com", "dreamstime.com",
)
MAP_URL_TEMPLATE = "https://capemaydispatch.com/#v=2&lat={lat:.4f}&lon={lon:.4f}&alt=3000"


# ── Gemini client ───────────────────────────────────────────────────────────

def get_api_key() -> str:
    """GEMINI_API_KEY from the environment (.env via python-dotenv)."""
    try:
        from dotenv import load_dotenv  # type: ignore[import-not-found]

        load_dotenv()
    except Exception:
        pass
    return (os.environ.get("GEMINI_API_KEY") or "").strip()


def get_model() -> str:
    """GEMINI_MODEL env override, else the DEFAULT_MODEL constant."""
    return (os.environ.get("GEMINI_MODEL") or "").strip() or DEFAULT_MODEL


def _default_transport(url: str, payload: dict[str, Any], headers: dict[str, str], timeout: int):
    """Real transport: httpx POST. Isolated so tests can inject a stub."""
    import httpx

    with httpx.Client(timeout=timeout) as client:
        return client.post(url, json=payload, headers=headers)


def generate_content(
    prompt: str,
    *,
    api_key: str | None = None,
    model: str | None = None,
    transport: Any | None = None,
) -> str:
    """One Gemini generateContent call. Returns the model's text.

    Raises RuntimeError if no key is set, the request fails, or the
    response has no text. Never returns a fabricated draft.
    """
    key = (api_key if api_key is not None else get_api_key()).strip()
    if not key:
        raise RuntimeError(
            "GEMINI_API_KEY is not set — the free Gemini key has not been "
            "created yet. Set it in the environment (or .env) and retry; "
            "nothing is written without it."
        )
    mdl = (model or get_model()).strip() or DEFAULT_MODEL
    url = GEMINI_API_URL.format(model=mdl)
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "temperature": 0,
        },
    }
    headers = {"x-goog-api-key": key, "Content-Type": "application/json"}
    send = transport if transport is not None else _default_transport
    try:
        resp = send(url, payload, headers, GEMINI_TIMEOUT_S)
        resp.raise_for_status()
        data = resp.json()
    except Exception as exc:
        raise RuntimeError(f"Gemini request failed ({mdl}): {exc}") from exc
    try:
        parts = data["candidates"][0]["content"]["parts"]
        text = "".join(str(p.get("text") or "") for p in parts).strip()
    except Exception as exc:
        raise RuntimeError(f"Gemini response had no usable text: {data!r:.200}") from exc
    if not text:
        raise RuntimeError("Gemini returned an empty response")
    return text


# ── Writer prompt (Part E) ──────────────────────────────────────────────────

WRITER_SYSTEM = """You are the Cape Dispatch news desk for Cape May County, New Jersey. Write an original news post from the source material provided. Output JSON only — no markdown fences, no commentary, just the JSON object.

Style:
- Dateline first: "<MUNICIPALITY IN CAPS>, <Mon. D, YYYY> —". Use the municipality where the event is; use CAPE MAY COURT HOUSE for countywide items.
- Lede: keep it to 25–30 words (never over 35) with who/what/where/when. Then 2–6 short paragraphs. Plain, neutral, AP style.
- Attribute every fact to its source in the sentence ("according to the Prosecutor's Office", "the National Weather Service in Mount Holly says"). Never state something no source says. Every paragraph except "What it means locally" and the "Sources:" footer must contain an attribution phrase such as "according to X", "X says", or "X announced" — a paragraph with no attribution will be rejected. Do not add general advice or background that no source states; if you include practical guidance, attribute it to the source that gave it.
- Do NOT copy sentences from any source. Do not quote more than 15 words from a news outlet.
- Add a "What it means locally" paragraph when a regional/national item touches Cape May County (ACY/WWD flights, Route 47/50/9 traffic, bay/ocean conditions, evacuation routes).
- End with "Sources:" listing each source by name with its URL.
- If an earlier post exists for this topic, write an UPDATE: headline prefixed "UPDATE: " and only the new facts.
- Weather: include the exact zone names, start/end times in Eastern, and the headline hazard.
- Public safety: block-level addresses only, no house numbers, no patient details, no fatalities from radio traffic. Named defendants are allowed ONLY when the source is a prosecutor/police release; set contains_named_individuals = true so the post goes to review.
- Categories: News, Public Safety, Weather, Government, Community, Business, Aviation, Marine.
- image_plan: choose one of "nws_graphic" (give the URL of an actual image file ending .png/.jpg/.gif — an api.weather.gov alerts link is NOT a graphic; use "map" instead if there is no image), "agency_graphic" (give the image file URL), "map" (give center lat/lon, zoom, label), "own_photo" (give a search tag for our library), "none". Write alt text that describes the image for a screen reader.
- confidence 0–1: lower it if sources disagree or details are thin.

Return exactly this JSON shape:
{"headline": str, "dek": str, "dateline": str, "body_md": str,
 "category": str, "municipality": str,
 "geo": {"lat": number|null, "lon": number|null} or null,
 "sources": [{"name": str, "url": str, "kind": str}],
 "image_plan": {"kind": str, "url": str|null, "lat": number|null, "lon": number|null, "zoom": int|null, "label": str, "alt": str},
 "contains_named_individuals": bool, "is_update": bool, "confidence": number}
"""


def _item_brief(item: dict[str, Any]) -> str:
    return (
        f"- [{item.get('source_name') or item.get('source_id') or 'unknown'}] "
        f"{item.get('title') or ''}\n"
        f"  {item.get('summary') or ''}\n"
        f"  URL: {item.get('url') or ''} | Published: {item.get('published') or ''}"
    )


def build_writer_prompt(
    items: list[dict[str, Any]],
    *,
    existing_post: dict[str, Any] | None = None,
    municipality: str | None = None,
) -> str:
    """House-style prompt (Part E) for one cluster of source items."""
    parts = [WRITER_SYSTEM]
    if existing_post:
        parts.append(
            "An earlier post already exists for this topic. Write an UPDATE:\n"
            f"Headline: {existing_post.get('headline') or ''}\n"
            f"Body so far:\n{existing_post.get('body_md') or ''}\n"
            "Write only the new facts as an UPDATE post."
        )
    if municipality:
        parts.append(f"Municipality for the dateline: {municipality}.")
    parts.append("Source material (do not copy sentences from these):")
    parts.extend(_item_brief(it) for it in items)
    return "\n\n".join(parts)


# ── Writer output: parse + validate ─────────────────────────────────────────

_DATELINE_RE = re.compile(
    r"^[A-Z][A-Z .']+, (Jan\.|Feb\.|Mar\.|Apr\.|May|Jun\.|Jul\.|Aug\.|Sep\.|Sept\.|Oct\.|Nov\.|Dec\.) \d{1,2}, \d{4} —"
)
_ATTRIBUTION_MARKERS = (
    "according to", "says", "said", "reports", "reported",
    "announced", "issued", "confirmed", "posted", "told",
    # Passive constructions the model uses for the same job:
    # "residents are advised by the National Weather Service…"
    "advised", "warned", "urged", "recommended", "cautioned", "alerted",
    # Reporting verbs: "reporting from Cape May Scanner indicates…"
    "indicates", "indicate", "notes", "noted", "adds", "added",
    "explains", "describes", "described",
)
_ATTRIBUTION_RE = re.compile(
    r"\b(?:" + "|".join(re.escape(m) for m in _ATTRIBUTION_MARKERS) + r")\b",
    re.IGNORECASE,
)


def parse_writer_output(text: str) -> dict[str, Any]:
    """Parse the model's JSON (tolerates ```json fences). Raises ValueError."""
    cleaned = (text or "").strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        data = json.loads(cleaned)
    except Exception as exc:
        raise ValueError(f"writer output is not valid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise ValueError("writer output is not a JSON object")
    return data


def _words(text: str) -> list[str]:
    return re.findall(r"[a-z0-9']+", (text or "").lower())


def ngram_overlap(text: str, source_texts: list[str], n: int = 12) -> list[str]:
    """Word n-grams shared between the draft and its sources.

    The 12-gram overlap check (Part I): a copied sentence shows up as a
    shared 12-gram. Returns the overlapping grams (empty = clean).
    """
    words = _words(text)
    if len(words) < n:
        return []
    draft_grams = {" ".join(words[i:i + n]) for i in range(len(words) - n + 1)}
    src_grams: set[str] = set()
    for src in source_texts:
        sw = _words(src)
        src_grams |= {" ".join(sw[i:i + n]) for i in range(len(sw) - n + 1)}
    return sorted(draft_grams & src_grams)


def _source_texts(items: list[dict[str, Any]]) -> list[str]:
    return [
        f"{it.get('title') or ''} {it.get('summary') or ''}" for it in items
    ]


def validate_post(draft: dict[str, Any], items: list[dict[str, Any]]) -> list[str]:
    """Validate a writer draft against the house rules (Part E + Part I).

    Returns a list of problems; empty means the draft passes. Never raises.
    """
    errors: list[str] = []
    try:
        if not isinstance(draft, dict):
            return ["draft is not an object"]
        for field in ("headline", "dek", "dateline", "body_md", "category",
                      "municipality", "sources", "image_plan"):
            if draft.get(field) in (None, ""):
                errors.append(f"missing field: {field}")
        if errors:
            return errors
        if draft.get("category") not in CATEGORIES:
            errors.append(f"unknown category: {draft.get('category')!r}")
        if not _DATELINE_RE.match(str(draft.get("dateline") or "").strip()):
            errors.append(f"dateline does not match house style: {draft.get('dateline')!r}")
        body = str(draft.get("body_md") or "")
        paras = [p.strip() for p in re.split(r"\n\s*\n", body) if p.strip()]
        if not paras:
            errors.append("body is empty")
            return errors
        # Lede: first paragraph after the dateline, ≤ 35 words.
        first = paras[0]
        first = re.sub(r"^[^—]+—\s*", "", first, count=1) if "—" in first else first
        if len(_words(first)) > 35:
            errors.append(f"lede is {len(_words(first))} words (max 35)")
        # Attribution in every factual paragraph.
        for p in paras:
            low = p.lower()
            if low.startswith("sources:"):
                continue
            if low.startswith("what it means locally"):
                continue
            # Markdown section headings (the daily brief's "## What
            # happened" etc.) are structure, not factual claims.
            if low.lstrip().startswith("#"):
                continue
            if not _ATTRIBUTION_RE.search(low):
                errors.append(f"paragraph without attribution: {p[:80]!r}")
                break
        # Sources footer: present, and lists every source by name.
        footer = next((p for p in paras if p.lower().startswith("sources:")), None)
        if footer is None:
            errors.append("missing 'Sources:' footer")
        else:
            for src in draft.get("sources") or []:
                name = str(src.get("name") or "")
                if name and name.lower() not in footer.lower():
                    errors.append(f"source {name!r} missing from Sources footer")
        # Quotes ≤ 15 words.
        for q in re.findall(r'"([^"]+)"', body):
            if len(_words(q)) > 15:
                errors.append(f"quote over 15 words: {q[:60]!r}")
        # 12-gram overlap: 0 copied sentences.
        overlap = ngram_overlap(body, _source_texts(items))
        if overlap:
            errors.append(f"copied text from sources (12-gram overlap): {overlap[0][:80]!r}")
        # Confidence in range.
        try:
            conf = float(draft.get("confidence"))
            if not 0.0 <= conf <= 1.0:
                errors.append(f"confidence out of range: {draft.get('confidence')!r}")
        except (TypeError, ValueError):
            errors.append(f"confidence is not a number: {draft.get('confidence')!r}")
        # Image plan: alt text mandatory unless kind is "none".
        plan = draft.get("image_plan") or {}
        if not isinstance(plan, dict):
            errors.append("image_plan is not an object")
        else:
            if plan.get("kind") not in ("nws_graphic", "agency_graphic", "map", "own_photo", "none"):
                errors.append(f"unknown image_plan kind: {plan.get('kind')!r}")
            if plan.get("kind") != "none" and not str(plan.get("alt") or "").strip():
                errors.append("image_plan has no alt text")
    except Exception as exc:  # validation itself must never crash the pipeline
        errors.append(f"validation error: {exc}")
    return errors


def _ensure_sources_footer(draft: dict[str, Any]) -> dict[str, Any]:
    """Append a "Sources:" footer when the model left it out.

    The footer lists every source by name (validation requires it).
    The writer prompt asks for one; this guarantees it even when the
    model omits it, so a good draft is not held for review.
    """
    body = str(draft.get("body_md") or "")
    paras = [p.strip() for p in re.split(r"\n\s*\n", body) if p.strip()]
    if any(p.lower().startswith("sources:") for p in paras):
        return draft
    parts: list[str] = []
    for src in draft.get("sources") or []:
        name = str(src.get("name") or "").strip()
        url = str(src.get("url") or "").strip()
        if name:
            parts.append(f"{name} ({url})" if url else name)
    if not parts:
        return draft
    draft = dict(draft)
    footer = "Sources: " + "; ".join(parts) + "."
    draft["body_md"] = (body.rstrip() + "\n\n" + footer) if body.strip() else footer
    return draft


def write_post(
    items: list[dict[str, Any]],
    *,
    existing_post: dict[str, Any] | None = None,
    municipality: str | None = None,
    api_key: str | None = None,
    model: str | None = None,
    transport: Any | None = None,
    prompt: str | None = None,
) -> tuple[dict[str, Any], list[str]]:
    """Run the writer for one cluster. Returns (draft, validation errors).

    Raises RuntimeError if the Gemini call fails (no key, network error,
    empty response) — the caller must not publish anything in that case.

    Callers with their own prompt (the daily brief) pass ``prompt`` and
    skip the cluster prompt builder; the parse / validate / retry path
    below is shared, so the gate sees the same draft shape either way.
    """
    if prompt is None:
        prompt = build_writer_prompt(items, existing_post=existing_post,
                                     municipality=municipality)
    raw = generate_content(prompt, api_key=api_key, model=model,
                           transport=transport)
    draft = parse_writer_output(raw)
    draft = _ensure_sources_footer(draft)
    errors = validate_post(draft, items)
    if errors:
        # One self-correction retry: tell the model exactly what failed
        # and let it fix it. Costs one extra free-tier call only when
        # the first draft missed. If the retry also fails, the first
        # draft's errors stand and the post goes to review.
        retry_prompt = (
            prompt + "\n\nYour first draft was rejected for these problems:\n"
            + "\n".join(f"- {e}" for e in errors)
            + "\nFix all of them and return the corrected JSON only."
        )
        try:
            raw2 = generate_content(retry_prompt, api_key=api_key,
                                    model=model, transport=transport)
            draft2 = _ensure_sources_footer(parse_writer_output(raw2))
            errors2 = validate_post(draft2, items)
            draft, errors = draft2, errors2
        except Exception:
            pass
    return draft, errors


# ── Clustering (Part D) ─────────────────────────────────────────────────────

# Longest-first topic phrases, so "freeze warning" wins over "warning".
TOPIC_KEYWORDS: list[tuple[str, str]] = [
    ("freeze warning", "freeze-warning"),
    ("winter storm warning", "winter-storm"),
    ("winter storm", "winter-storm"),
    ("ground stop", "ground-stop"),
    ("code blue", "code-blue"),
    ("road closed", "road-closure"),
    ("road closure", "road-closure"),
    ("power outage", "power-outage"),
    ("structure fire", "fire"),
    ("wildfire", "fire"),
    ("fire", "fire"),
    ("crash", "crash"),
    ("collision", "crash"),
    ("flooding", "flood"),
    ("flood", "flood"),
    ("tornado", "tornado"),
    ("hurricane", "hurricane"),
    ("storm", "storm"),
    ("arrest", "arrest"),
    ("charged", "arrest"),
    ("drug", "drug"),
    ("overdose", "overdose"),
    ("shooting", "shooting"),
    ("council", "council"),
    ("school", "school"),
    ("airport", "aviation"),
    ("flight", "aviation"),
    ("ferry", "ferry"),
    ("beach", "beach"),
    ("drowning", "drowning"),
    ("boat", "marine"),
    ("election", "election"),
    ("tax", "tax"),
    ("bridge", "bridge"),
]
_STOPWORDS = frozenset(
    "a an the and or of to in on for at by with from after before during "
    "is are was were be been it its this that these those as".split()
)


def _places() -> list[str]:
    try:
        from app import story_link  # production / workspace layout
    except ImportError:
        try:
            import story_link  # type: ignore[import-not-found]
        except ImportError:
            return ["cape may", "wildwood", "ocean city", "sea isle city",
                    "avalon", "stone harbor", "cape may court house"]
    return list(story_link.PLACES)


def _find_place(text: str) -> str | None:
    low = (text or "").lower()
    best: str | None = None
    for place in sorted(_places(), key=len, reverse=True):
        if re.search(rf"(?<![a-z]){re.escape(place)}(?![a-z])", low):
            best = place
            break
    return best


def topic_key_for(item: dict[str, Any]) -> str:
    """Cluster key for one source item: topic + place, e.g.
    'freeze-warning-cape-may-county'. Same topic within 48h → one story.
    """
    text = f"{item.get('title') or ''} {item.get('summary') or ''}".lower()
    topic = None
    for phrase, key in TOPIC_KEYWORDS:
        if phrase in text:
            topic = key
            break
    if topic is None:
        sig = [w for w in _words(text) if w not in _STOPWORDS][:4]
        topic = "-".join(sig) if sig else "news"
    place = _find_place(text)
    slug_place = re.sub(r"[^a-z0-9]+", "-", (place or "countywide")).strip("-")
    return f"{topic}-{slug_place}"


def cluster_items(
    items: list[dict[str, Any]], window_hours: float = 48,
) -> list[dict[str, Any]]:
    """Group items into clusters: same topic_key, within the window.

    Returns [{topic_key, items (sorted by pub_ms), first_seen_ms,
    last_seen_ms}]. Never raises.
    """
    window_ms = int(window_hours * 3600 * 1000)
    clusters: list[dict[str, Any]] = []
    try:
        ordered = sorted(items or [], key=lambda it: int(it.get("pub_ms") or 0))
    except Exception:
        ordered = list(items or [])
    for item in ordered:
        try:
            key = topic_key_for(item)
            pub = int(item.get("pub_ms") or 0)
            target = None
            for c in clusters:
                if c["topic_key"] != key:
                    continue
                if pub and c["last_seen_ms"] and (pub - c["last_seen_ms"]) > window_ms:
                    continue
                target = c
                break
            if target is None:
                clusters.append({
                    "topic_key": key,
                    "items": [item],
                    "first_seen_ms": pub,
                    "last_seen_ms": pub,
                })
            else:
                target["items"].append(item)
                target["last_seen_ms"] = max(target["last_seen_ms"], pub)
        except Exception as exc:
            log.warning("news_writer cluster error: %s", exc)
    return clusters


# ── Gate (Part H) ───────────────────────────────────────────────────────────

_EMS_RE = re.compile(
    r"\b(?:" + "|".join(re.escape(w) for w in EMS_WORDS) + r")\b",
    re.IGNORECASE,
)


def contains_ems_content(text: str) -> bool:
    """EMS / patient / fatality language anywhere in the text.

    Whole-word match only: the bare substring "ems" also matches
    "systems", "items", "problems" — a freeze-warning draft about
    irrigation systems must not be held for EMS review.
    """
    return bool(_EMS_RE.search(text or ""))


def decide_gate(
    draft: dict[str, Any],
    items: list[dict[str, Any]],
    *,
    validation_errors: list[str] | None = None,
) -> tuple[str, list[str]]:
    """Auto-publish or review? Returns (status, reasons).

    Auto-publish iff every source is auto-publish AND the writer says no
    named individuals AND confidence ≥ 0.75 AND no EMS/patient content
    AND the draft passes validation. Anything else → review queue.
    """
    reasons: list[str] = []
    source_ids = {str(it.get("source_id") or "") for it in items}
    if source_ids & REVIEW_SOURCE_IDS:
        reasons.append("source requires review: " + ", ".join(sorted(source_ids & REVIEW_SOURCE_IDS)))
    if not source_ids <= AUTO_PUBLISH_SOURCE_IDS:
        reasons.append("source not in auto-publish set: " + ", ".join(sorted(source_ids - AUTO_PUBLISH_SOURCE_IDS)))
    if draft.get("contains_named_individuals"):
        reasons.append("names a person")
    try:
        conf = float(draft.get("confidence"))
    except (TypeError, ValueError):
        conf = 0.0
    if conf < GATE_MIN_CONFIDENCE:
        reasons.append(f"confidence {conf:.2f} below {GATE_MIN_CONFIDENCE}")
    body = str(draft.get("body_md") or "")
    src_text = " ".join(_source_texts(items))
    if contains_ems_content(body) or contains_ems_content(src_text):
        reasons.append("EMS/patient content")
    if validation_errors:
        reasons.append("validation failed: " + "; ".join(validation_errors[:3]))
    if reasons:
        return "review", reasons
    return "published", ["auto-publish: official/summary-link sources, no named individuals, "
                         f"confidence {conf:.2f}, no EMS content"]


# ── Image step (Part F) ─────────────────────────────────────────────────────

def _host(url: str) -> str:
    try:
        return urlparse(url).netloc.lower().removeprefix("www.")
    except Exception:
        return ""


def _looks_like_image(url: str) -> bool:
    """True when the URL path ends in a common image extension.

    An NWS alert API endpoint (api.weather.gov/alerts/...) is not a
    graphic, even though it sits on weather.gov — the model once offered
    one as an nws_graphic lead image. Non-image URLs fall back to map.
    """
    path = urlparse(url or "").path.lower()
    return path.endswith((".png", ".jpg", ".jpeg", ".gif", ".webp"))


def plan_image(
    image_plan: dict[str, Any],
    *,
    source_hosts: list[str] | None = None,
    default_geo: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Resolve the writer's image_plan to a publishable image.

    Returns {kind, url, alt, credit, source_url}. Rules (Part F):
    map is the default for geo stories; NWS graphics by URL with credit;
    agency graphics only from the agency's own host; own_photo is not
    implemented (no library exists yet) → falls back to map. Blocked hosts
    (Facebook, Scanner uploads, stock sites) always fall back to map/none.
    """
    plan = image_plan or {}
    kind = str(plan.get("kind") or "none")
    alt = str(plan.get("alt") or "").strip()
    url = str(plan.get("url") or "").strip()
    geo = default_geo or {}
    lat = plan.get("lat") if plan.get("lat") is not None else geo.get("lat")
    lon = plan.get("lon") if plan.get("lon") is not None else geo.get("lon")

    def _map() -> dict[str, Any]:
        if lat is None or lon is None:
            return {"kind": "none", "url": None, "alt": "",
                    "credit": "", "source_url": ""}
        return {
            "kind": "map",
            "url": MAP_URL_TEMPLATE.format(lat=float(lat), lon=float(lon)),
            "alt": alt or f"Map centered on {plan.get('label') or 'the incident location'}",
            "credit": "Map: Cape Dispatch; data: OpenStreetMap contributors",
            "source_url": "",
        }

    # Blocked hosts win over every kind: Scanner photos, Fire Wire
    # members' photos, Facebook images, stock photos are never used,
    # even if the writer proposes them as an agency graphic.
    if url and not image_url_allowed(url):
        return _map()

    if kind == "map":
        return _map()
    if kind == "nws_graphic":
        if url and _host(url).endswith("weather.gov") and _looks_like_image(url):
            return {"kind": "nws_graphic", "url": url,
                    "alt": alt or "National Weather Service graphic",
                    "credit": "National Weather Service Mount Holly",
                    "source_url": url}
        return _map()
    if kind == "agency_graphic":
        allowed = set(source_hosts or [])
        if url and _host(url) in allowed and _looks_like_image(url):
            return {"kind": "agency_graphic", "url": url,
                    "alt": alt or "Graphic published with the agency release",
                    "credit": "Publishing agency (see Sources)",
                    "source_url": url}
        return _map()
    if kind == "own_photo":
        # No photo library exists yet — map is the honest fallback.
        return _map()
    # "none" or unknown kind.
    return {"kind": "none", "url": None, "alt": "", "credit": "", "source_url": ""}


def image_url_allowed(url: str) -> bool:
    """False for any URL on a blocked image host (Part F)."""
    host = _host(url or "")
    return bool(host) and not any(
        host == b or host.endswith("." + b) for b in BLOCKED_IMAGE_HOSTS
    )


# ── Pipeline: one cluster → one post ────────────────────────────────────────

def process_cluster(
    cluster: dict[str, Any],
    *,
    api_key: str | None = None,
    model: str | None = None,
    transport: Any | None = None,
    db_path: Any | None = None,
) -> dict[str, Any]:
    """Cluster → writer → image → gate → posts store.

    Returns the stored post dict (with status + gate_reasons). Raises
    RuntimeError if the Gemini call fails — nothing is stored then.
    """
    # Late import: news_blog owns the store; the writer owns the pipeline.
    try:
        from app import news_blog
    except ImportError:
        import news_blog  # type: ignore[import-not-found]

    items = cluster.get("items") or []
    topic_key = cluster.get("topic_key") or (
        topic_key_for(items[0]) if items else "news"
    )
    existing = news_blog.find_parent_post(topic_key, db_path=db_path)
    draft, errors = write_post(
        items, existing_post=existing, api_key=api_key, model=model,
        transport=transport,
    )
    is_update = bool(draft.get("is_update")) or existing is not None
    headline = str(draft.get("headline") or "Untitled")
    if is_update and not headline.lower().startswith("update:"):
        headline = "UPDATE: " + headline
    image = plan_image(
        draft.get("image_plan") or {},
        source_hosts=[_host(str(it.get("url") or "")) for it in items],
        default_geo=draft.get("geo") or {},
    )
    status, reasons = decide_gate(draft, items, validation_errors=errors)
    geo = draft.get("geo") or {}
    post = news_blog.create_post(
        {
            "slug": None,
            "topic_key": topic_key,
            "parent_id": existing.get("id") if (existing and is_update) else None,
            "status": status,
            "category": draft.get("category") or "News",
            "municipality": draft.get("municipality") or "CAPE MAY COURT HOUSE",
            "headline": headline,
            "dek": draft.get("dek") or "",
            "dateline": draft.get("dateline") or "",
            "body_md": draft.get("body_md") or "",
            "lead_image_url": image.get("url"),
            "lead_image_alt": image.get("alt") or "",
            "lead_image_credit": image.get("credit") or "",
            "lead_image_source_url": image.get("source_url") or "",
            "sources": draft.get("sources") or [],
            "lat": geo.get("lat"),
            "lon": geo.get("lon"),
            "is_update": is_update,
            "confidence": draft.get("confidence"),
            "contains_named_individuals": bool(draft.get("contains_named_individuals")),
            "gate_reasons": reasons,
            "author": "Cape Dispatch Desk",
        },
        db_path=db_path,
    )
    guids = [str(it.get("id") or it.get("url") or "") for it in items]
    news_blog.attach_sources(post["id"], [g for g in guids if g], db_path=db_path)
    post["gate_reasons"] = reasons
    return post


def process_items(
    items: list[dict[str, Any]],
    *,
    api_key: str | None = None,
    model: str | None = None,
    transport: Any | None = None,
    db_path: Any | None = None,
    window_hours: float = 48,
) -> list[dict[str, Any]]:
    """Cluster a batch of fresh source items and run the pipeline on each.

    One Gemini call per cluster. Clusters with no items are skipped.
    A failed cluster is logged and skipped — it never blocks the others.
    """
    out: list[dict[str, Any]] = []
    for cluster in cluster_items(items, window_hours=window_hours):
        try:
            out.append(process_cluster(
                cluster, api_key=api_key, model=model,
                transport=transport, db_path=db_path,
            ))
        except Exception as exc:
            log.warning("news_writer: cluster %s failed: %s",
                        cluster.get("topic_key"), exc)
    return out
