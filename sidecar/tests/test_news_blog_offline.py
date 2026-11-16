"""News & Blogs reporter — writer half (app/news_writer.py, app/news_blog.py).
No network, no key — the Gemini transport is stubbed.

Covers: writer output validation (dateline, lede, attribution, Sources
footer, 12-gram overlap = 0 copied sentences, quote length, alt text),
clustering (Freeze warning + NWS NJZ023 freeze alert land in one cluster;
an UPDATE attaches to its parent), the gate (a prosecutor's release goes
to review; a Freeze Warning auto-publishes), the image step (Scanner
photos are never used), the posts store, and the router (list / article /
RSS / blog / review queue, pure-function smoke tests — no TestClient in
this VM, so the route handlers are called directly).
"""
import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app import news_blog, news_writer

T0 = 1794608580000  # 2026-11-13 ~12:43 EST, ms


def _nws_freeze(pub_ms=T0, title="Freeze Warning — Cape May County"):
    return {
        "id": "nws-freeze-1",
        "source_id": "nws_mt_holly_alerts",
        "source_name": "NWS Mount Holly alerts",
        "kind": "official",
        "title": title,
        "url": "https://api.weather.gov/alerts/urn:oid:freeze1",
        "summary": "Freeze Warning in effect for Cape May County from 10 PM tonight until 9 AM Sunday. Residents should protect plants and pipes.",
        "publisher": "National Weather Service",
        "published": "2026-11-13T12:43:00-05:00",
        "pub_ms": pub_ms,
    }


def _scanner_freeze(pub_ms=T0 + 3600000):
    return {
        "id": "scanner-freeze-1",
        "source_id": "capemay_scanner",
        "source_name": "Cape May Scanner",
        "kind": "media",
        "title": "Freeze warning tonight across Cape May County",
        "url": "https://capemayscanner.com/freeze-warning-tonight/",
        "summary": "The National Weather Service has issued a Freeze Warning for Cape May County tonight.",
        "publisher": "Cape May Scanner",
        "published": "2026-11-13T13:43:00-05:00",
        "pub_ms": pub_ms,
    }


def _prosecutor(pub_ms=T0):
    return {
        "id": "cmcpo-1",
        "source_id": "cmcpo_press",
        "source_name": "Cape May County Prosecutor's Office",
        "kind": "official",
        "title": "Three charged in Wildwood drug facility",
        "url": "https://www.cmcpros.net/press/2026-11-13-drugs.pdf",
        "summary": "Three Wildwood residents were charged after a drug facility investigation, according to the Prosecutor's Office.",
        "publisher": "Cape May County Prosecutor's Office",
        "published": "2026-11-13T12:00:00-05:00",
        "pub_ms": pub_ms,
    }


def _valid_draft(**over):
    body = (
        "CAPE MAY COURT HOUSE, Nov. 13, 2026 — The National Weather Service in Mount Holly says "
        "a Freeze Warning covers Cape May County overnight, with lows in the 20s and the "
        "warning running from 10 p.m. tonight until 9 a.m. Sunday.\n\n"
        "According to the National Weather Service, temperatures will fall into the upper 20s "
        "after midnight, and the freeze could damage unprotected plants and outdoor pipes.\n\n"
        "What it means locally: gardeners in Lower Township and Middle Township should bring in "
        "tender plants tonight, and drivers on Route 47 should watch for slick spots before dawn.\n\n"
        "Sources: National Weather Service Mount Holly (https://www.weather.gov/phi/), "
        "Cape May Scanner (https://capemayscanner.com/)."
    )
    draft = {
        "headline": "Freeze Warning tonight for Cape May County",
        "dek": "Lows in the upper 20s overnight; protect plants and pipes.",
        "dateline": "CAPE MAY COURT HOUSE, Nov. 13, 2026 —",
        "body_md": body,
        "category": "Weather",
        "municipality": "CAPE MAY COURT HOUSE",
        "geo": {"lat": 39.08, "lon": -74.83},
        "sources": [
            {"name": "National Weather Service Mount Holly", "url": "https://www.weather.gov/phi/", "kind": "official"},
            {"name": "Cape May Scanner", "url": "https://capemayscanner.com/", "kind": "media"},
        ],
        "image_plan": {"kind": "map", "url": None, "lat": 39.08, "lon": -74.83, "zoom": 10,
                       "label": "Cape May County", "alt": "Map of Cape May County with the freeze warning area highlighted"},
        "contains_named_individuals": False,
        "is_update": False,
        "confidence": 0.9,
    }
    draft.update(over)
    return draft


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
    calls = []

    def send(url, payload, headers, timeout):
        calls.append({"url": url, "payload": payload, "headers": headers})
        assert "generativelanguage.googleapis.com" in url
        assert headers.get("x-goog-api-key") == "test-key"
        return _StubResp(queue.pop(0) if queue else "{}")

    send.calls = calls
    return send


def _isolate(monkeypatch, tmp_path):
    monkeypatch.setattr(news_blog, "DB_PATH", tmp_path / "news.db")


# ------------------------------------------------------------------ Gemini client

def test_generate_content_requires_a_key():
    try:
        news_writer.generate_content("hi", api_key="")
    except RuntimeError as exc:
        assert "GEMINI_API_KEY" in str(exc)
    else:
        raise AssertionError("expected RuntimeError without a key")


def test_generate_content_parses_candidates():
    text = news_writer.generate_content(
        "hi", api_key="test-key",
        transport=_transport_for({"headline": "x"}),
    )
    assert '"headline": "x"' in text


def test_generate_content_bad_json_raises():
    class _Bad:
        status_code = 200

        def raise_for_status(self):
            pass

        def json(self):
            return {"nope": True}

    try:
        news_writer.generate_content("hi", api_key="k", transport=lambda *a: _Bad())
    except RuntimeError as exc:
        assert "no usable text" in str(exc)
    else:
        raise AssertionError("expected RuntimeError for a bad response")


def test_default_model_is_one_constant():
    assert news_writer.DEFAULT_MODEL == "gemini-3.5-flash-lite"
    assert news_writer.get_model() == "gemini-3.5-flash-lite"


# ------------------------------------------------------------------ validation

def test_valid_draft_passes():
    errors = news_writer.validate_post(_valid_draft(), [_nws_freeze(), _scanner_freeze()])
    assert errors == []


def test_dateline_must_match_house_style():
    d = _valid_draft(dateline="Cape May, Nov 13 2026")
    assert any("dateline" in e for e in news_writer.validate_post(d, [_nws_freeze()]))


def test_lede_over_35_words_fails():
    long_lede = " ".join(["word"] * 40)
    body = (
        "CAPE MAY COURT HOUSE, Nov. 13, 2026 — " + long_lede + ".\n\n"
        "According to the National Weather Service, it will be cold.\n\n"
        "Sources: National Weather Service Mount Holly (https://www.weather.gov/phi/)."
    )
    d = _valid_draft(body_md=body)
    assert any("lede" in e for e in news_writer.validate_post(d, [_nws_freeze()]))


def test_paragraph_without_attribution_fails():
    body = (
        "CAPE MAY COURT HOUSE, Nov. 13, 2026 — The National Weather Service in Mount Holly says "
        "a Freeze Warning covers Cape May County overnight.\n\n"
        "Temperatures will fall into the upper 20s and everyone should be careful.\n\n"
        "Sources: National Weather Service Mount Holly (https://www.weather.gov/phi/)."
    )
    d = _valid_draft(body_md=body)
    assert any("attribution" in e for e in news_writer.validate_post(d, [_nws_freeze()]))


def test_missing_sources_footer_fails():
    body = (
        "CAPE MAY COURT HOUSE, Nov. 13, 2026 — The National Weather Service in Mount Holly says "
        "a Freeze Warning covers Cape May County overnight.\n\n"
        "According to the National Weather Service, temperatures will fall into the upper 20s."
    )
    d = _valid_draft(body_md=body)
    assert any("Sources" in e for e in news_writer.validate_post(d, [_nws_freeze()]))


def test_copied_sentence_fails_12gram_overlap():
    # Body lifts a sentence verbatim from the NWS summary.
    body = (
        "CAPE MAY COURT HOUSE, Nov. 13, 2026 — The National Weather Service in Mount Holly says "
        "a Freeze Warning is in effect tonight.\n\n"
        "According to the National Weather Service, Freeze Warning in effect for Cape May County "
        "from 10 PM tonight until 9 AM Sunday. Residents should protect plants and pipes.\n\n"
        "Sources: National Weather Service Mount Holly (https://www.weather.gov/phi/)."
    )
    d = _valid_draft(body_md=body)
    errors = news_writer.validate_post(d, [_nws_freeze()])
    assert any("copied" in e for e in errors), errors


def test_quote_over_15_words_fails():
    body = (
        'CAPE MAY COURT HOUSE, Nov. 13, 2026 — The National Weather Service in Mount Holly says '
        'a Freeze Warning covers Cape May County overnight.\n\n'
        'According to the National Weather Service, "this is a very long quoted sentence that keeps '
        'going and going and going past fifteen words without stopping at all."\n\n'
        "Sources: National Weather Service Mount Holly (https://www.weather.gov/phi/)."
    )
    d = _valid_draft(body_md=body)
    assert any("quote" in e for e in news_writer.validate_post(d, [_nws_freeze()]))


def test_image_plan_without_alt_fails():
    d = _valid_draft(image_plan={"kind": "map", "lat": 39.08, "lon": -74.83, "alt": ""})
    assert any("alt text" in e for e in news_writer.validate_post(d, [_nws_freeze()]))


def test_unknown_category_fails():
    d = _valid_draft(category="Sports")
    assert any("category" in e for e in news_writer.validate_post(d, [_nws_freeze()]))


def test_parse_writer_output_strips_fences():
    data = news_writer.parse_writer_output("```json\n{\"a\": 1}\n```")
    assert data == {"a": 1}
    try:
        news_writer.parse_writer_output("not json at all")
    except ValueError:
        pass
    else:
        raise AssertionError("expected ValueError")


# ------------------------------------------------------------------ clustering

def test_freeze_warning_and_nws_alert_land_in_one_cluster():
    items = [_scanner_freeze(), _nws_freeze()]
    clusters = news_writer.cluster_items(items)
    assert len(clusters) == 1
    assert clusters[0]["topic_key"].startswith("freeze-warning-")
    assert len(clusters[0]["items"]) == 2


def test_different_topics_do_not_cluster():
    items = [_nws_freeze(), _prosecutor()]
    clusters = news_writer.cluster_items(items)
    assert len(clusters) == 2


def test_cluster_splits_after_48h():
    items = [_nws_freeze(pub_ms=T0), _nws_freeze(pub_ms=T0 + 49 * 3600 * 1000, title="Freeze Warning — Cape May County (again)")]
    clusters = news_writer.cluster_items(items)
    assert len(clusters) == 2


def test_update_attaches_to_parent(monkeypatch, tmp_path):
    _isolate(monkeypatch, tmp_path)
    transport = _transport_for(_valid_draft(), _valid_draft(
        headline="Freeze Warning extended into Sunday",
        is_update=True,
        sources=[{"name": "National Weather Service Mount Holly",
                  "url": "https://www.weather.gov/phi/", "kind": "official"}],
        body_md=(
            "CAPE MAY COURT HOUSE, Nov. 13, 2026 — The National Weather Service in Mount Holly says "
            "the Freeze Warning now runs until 9 a.m. Sunday.\n\n"
            "According to the National Weather Service, the warning was extended by six hours.\n\n"
            "Sources: National Weather Service Mount Holly (https://www.weather.gov/phi/)."
        ),
    ))
    first = news_writer.process_items(
        [_nws_freeze(), _scanner_freeze()], api_key="test-key",
        transport=transport, db_path=tmp_path / "news.db",
    )
    assert len(first) == 1 and first[0]["status"] == "published"
    parent_id = first[0]["id"]
    second = news_writer.process_items(
        [_nws_freeze(pub_ms=T0 + 5 * 3600 * 1000)], api_key="test-key",
        transport=transport, db_path=tmp_path / "news.db",
    )
    assert len(second) == 1
    assert second[0]["parent_id"] == parent_id
    assert second[0]["is_update"] is True
    assert second[0]["headline"].startswith("UPDATE:")
    assert news_blog.get_updates(parent_id, db_path=tmp_path / "news.db")[0]["id"] == second[0]["id"]


# ------------------------------------------------------------------ gate

def test_freeze_warning_auto_publishes():
    status, reasons = news_writer.decide_gate(_valid_draft(), [_nws_freeze(), _scanner_freeze()])
    assert status == "published", reasons


def test_prosecutor_release_goes_to_review():
    d = _valid_draft(category="Public Safety", contains_named_individuals=True, confidence=0.9)
    status, reasons = news_writer.decide_gate(d, [_prosecutor()])
    assert status == "review"
    assert any("person" in r for r in reasons)


def test_low_confidence_goes_to_review():
    d = _valid_draft(confidence=0.5)
    status, reasons = news_writer.decide_gate(d, [_nws_freeze()])
    assert status == "review"
    assert any("confidence" in r for r in reasons)


def test_ems_content_goes_to_review():
    d = _valid_draft(body_md=(
        "CAPE MAY COURT HOUSE, Nov. 13, 2026 — The National Weather Service in Mount Holly says "
        "a Freeze Warning covers Cape May County overnight.\n\n"
        "According to the National Weather Service, a patient was taken by ambulance to the hospital.\n\n"
        "Sources: National Weather Service Mount Holly (https://www.weather.gov/phi/)."
    ))
    status, reasons = news_writer.decide_gate(d, [_nws_freeze()])
    assert status == "review"
    assert any("EMS" in r for r in reasons)


def test_ems_match_is_whole_word_only():
    # Regression: the bare substring "ems" matched "systems" (and
    # "items", "problems"), so a live freeze-warning draft about
    # irrigation systems was held for EMS review.
    assert news_writer.contains_ems_content("irrigation systems must be drained") is False
    assert news_writer.contains_ems_content("problems with outdoor pipes") is False
    assert news_writer.contains_ems_content("EMS crews responded to the scene") is True
    assert news_writer.contains_ems_content("one fatality was reported") is True
    assert news_writer.contains_ems_content("the patient was taken to hospital") is True


def test_write_post_appends_missing_sources_footer():
    # Regression: the live model returned JSON with a sources array but
    # no "Sources:" footer in the body, so validation failed and the
    # post went to review. write_post repairs that before validating.
    draft = _valid_draft(body_md=(
        "CAPE MAY COURT HOUSE, Nov. 13, 2026 — The National Weather Service in Mount Holly says "
        "a Freeze Warning covers Cape May County overnight, with lows in the 20s.\n\n"
        "According to the National Weather Service, temperatures will fall into the upper 20s "
        "after midnight, and the freeze could damage unprotected plants and outdoor pipes."
    ))
    written, errors = news_writer.write_post(
        [_nws_freeze(), _scanner_freeze()], api_key="test-key",
        transport=_transport_for(draft),
    )
    assert errors == []
    assert "\n\nSources: " in written["body_md"]
    assert "National Weather Service Mount Holly" in written["body_md"]
    assert "Cape May Scanner" in written["body_md"]


def test_write_post_retries_once_after_validation_failure():
    bad = _valid_draft(dateline="wrong")
    good = _valid_draft()
    written, errors = news_writer.write_post(
        [_nws_freeze(), _scanner_freeze()], api_key="test-key",
        transport=_transport_for(bad, good),
    )
    assert errors == []
    assert written["dateline"] == good["dateline"]


def test_validation_errors_go_to_review():
    d = _valid_draft(dateline="wrong")
    errors = news_writer.validate_post(d, [_nws_freeze()])
    assert errors
    status, _ = news_writer.decide_gate(d, [_nws_freeze()], validation_errors=errors)
    assert status == "review"


def test_passive_attribution_counts():
    # Regression: a live draft paragraph "Local property owners are
    # advised by the National Weather Service…" was flagged as having
    # no attribution — the marker list only knew active-voice verbs.
    d = _valid_draft(body_md=(
        "CAPE MAY COURT HOUSE, Nov. 13, 2026 — The National Weather Service in Mount Holly says "
        "a Freeze Warning covers Cape May County overnight.\n\n"
        "Local property owners are advised by the National Weather Service to take precautions "
        "for plants and pipes tonight.\n\n"
        "Sources: National Weather Service Mount Holly (https://www.weather.gov/phi/), "
        "Cape May Scanner (https://capemayscanner.com/)."
    ))
    assert news_writer.validate_post(d, [_nws_freeze(), _scanner_freeze()]) == []


def test_reporting_verb_attribution_counts():
    # Regression: a live draft paragraph "Local emergency reporting from
    # Cape May Scanner indicates…" was flagged as having no attribution.
    d = _valid_draft(body_md=(
        "CAPE MAY COURT HOUSE, Nov. 13, 2026 — The National Weather Service in Mount Holly says "
        "a Freeze Warning covers Cape May County overnight.\n\n"
        "Local emergency reporting from Cape May Scanner indicates that residents throughout "
        "the county should protect plants and pipes tonight.\n\n"
        "Sources: National Weather Service Mount Holly (https://www.weather.gov/phi/), "
        "Cape May Scanner (https://capemayscanner.com/)."
    ))
    assert news_writer.validate_post(d, [_nws_freeze(), _scanner_freeze()]) == []


# ------------------------------------------------------------------ image step

def test_scanner_photo_never_used():
    plan = {"kind": "agency_graphic",
            "url": "https://capemayscanner.com/uploads/fire-photo.jpg",
            "alt": "A fire truck"}
    img = news_writer.plan_image(plan, source_hosts=["capemayscanner.com"],
                                 default_geo={"lat": 39.08, "lon": -74.83})
    assert img["kind"] == "map"
    assert "capemayscanner" not in (img.get("url") or "")


def test_facebook_image_never_used():
    plan = {"kind": "agency_graphic",
            "url": "https://facebook.com/photo.php?fbid=123", "alt": "x"}
    img = news_writer.plan_image(plan, source_hosts=["facebook.com"],
                                 default_geo={"lat": 39.08, "lon": -74.83})
    assert img["kind"] == "map"


def test_nws_graphic_allowed_with_credit():
    plan = {"kind": "nws_graphic",
            "url": "https://www.weather.gov/images/phi/freeze.png",
            "alt": "Freeze warning graphic"}
    img = news_writer.plan_image(plan)
    assert img["kind"] == "nws_graphic"
    assert "National Weather Service" in img["credit"]


def test_nws_graphic_non_image_url_falls_back_to_map():
    # Regression: the live model offered an api.weather.gov alert
    # endpoint (a JSON document, not a graphic) as an nws_graphic lead
    # image. Only image URLs may be used as graphics.
    plan = {"kind": "nws_graphic",
            "url": "https://api.weather.gov/alerts/urn:oid:freeze1",
            "alt": "Freeze warning graphic"}
    img = news_writer.plan_image(plan, default_geo={"lat": 39.08, "lon": -74.83})
    assert img["kind"] == "map"
    assert "api.weather.gov" not in (img.get("url") or "")


def test_map_default_without_geo_is_none():
    img = news_writer.plan_image({"kind": "map", "alt": "map"})
    assert img["kind"] == "none"
    img2 = news_writer.plan_image({"kind": "map", "lat": 39.08, "lon": -74.83, "alt": "map"})
    assert img2["kind"] == "map"
    assert "capemaydispatch.com" in img2["url"]


# ------------------------------------------------------------------ posts store

def _published_post(monkeypatch, tmp_path, **over):
    _isolate(monkeypatch, tmp_path)
    fields = {
        "status": "published", "category": "Weather",
        "municipality": "CAPE MAY COURT HOUSE",
        "headline": "Freeze Warning tonight for Cape May County",
        "dek": "Lows in the upper 20s.",
        "dateline": "CAPE MAY COURT HOUSE, Nov. 13, 2026 —",
        "body_md": "CAPE MAY COURT HOUSE, Nov. 13, 2026 — Cold tonight.",
        "sources": [{"name": "National Weather Service Mount Holly",
                     "url": "https://www.weather.gov/phi/", "kind": "official"}],
        "lat": 39.08, "lon": -74.83,
    }
    fields.update(over)
    return news_blog.create_post(fields, db_path=tmp_path / "news.db")


def test_slug_uniqueness(monkeypatch, tmp_path):
    a = _published_post(monkeypatch, tmp_path)
    b = _published_post(monkeypatch, tmp_path)
    assert a["slug"] == "freeze-warning-tonight-for-cape-may-county"
    assert b["slug"] == "freeze-warning-tonight-for-cape-may-county-2"


def test_set_post_status_publishes_and_timestamps(monkeypatch, tmp_path):
    _isolate(monkeypatch, tmp_path)
    post = news_blog.create_post(
        {"status": "review", "headline": "Needs a tap", "category": "News"},
        db_path=tmp_path / "news.db",
    )
    assert post["published_at"] is None
    done = news_blog.set_post_status(post["id"], "published", reviewed_by="will",
                                     db_path=tmp_path / "news.db")
    assert done["status"] == "published"
    assert done["published_at"] is not None
    assert done["reviewed_by"] == "will"


def test_attach_and_get_sources(monkeypatch, tmp_path):
    post = _published_post(monkeypatch, tmp_path)
    news_blog.attach_sources(post["id"], ["guid-1", "guid-2"], db_path=tmp_path / "news.db")
    assert sorted(news_blog.get_post_sources(post["id"], db_path=tmp_path / "news.db")) == ["guid-1", "guid-2"]


# ------------------------------------------------------------------ router

def test_router_registers_all_routes():
    have = {(methods[0], path) for methods, path, _ in news_blog.router.routes}
    assert ("GET", "/news") in have
    assert ("GET", "/news/{slug}") in have
    assert ("GET", "/news/feed.xml") in have
    assert ("GET", "/blog") in have
    assert ("GET", "/api/news/review") in have


def test_list_page_shows_published_and_banner(monkeypatch, tmp_path):
    post = _published_post(monkeypatch, tmp_path)
    resp = news_blog.news_list()
    html_text = resp.body.decode()
    assert post["headline"] in html_text
    assert "Unofficial. Information from public sources" in html_text
    assert "Call 911 for emergencies" in html_text


def test_list_page_hides_review_posts(monkeypatch, tmp_path):
    _isolate(monkeypatch, tmp_path)
    news_blog.create_post(
        {"status": "review", "headline": "Not yet approved", "category": "News"},
        db_path=tmp_path / "news.db",
    )
    html_text = news_blog.news_list().body.decode()
    assert "Not yet approved" not in html_text


def test_article_page_renders_and_links_map(monkeypatch, tmp_path):
    post = _published_post(monkeypatch, tmp_path)
    resp = news_blog.news_article(post["slug"])
    assert resp.status_code == 200
    html_text = resp.body.decode()
    assert post["headline"] in html_text
    assert "Related on the map" in html_text
    assert "National Weather Service Mount Holly" in html_text
    assert "Unofficial. Information from public sources" in html_text


def test_article_page_404_for_review_post(monkeypatch, tmp_path):
    _isolate(monkeypatch, tmp_path)
    post = news_blog.create_post(
        {"status": "review", "headline": "Held for review", "category": "News"},
        db_path=tmp_path / "news.db",
    )
    resp = news_blog.news_article(post["slug"])
    assert resp.status_code == 404


def test_feed_xml_validates(monkeypatch, tmp_path):
    post = _published_post(monkeypatch, tmp_path)
    resp = news_blog.news_feed()
    root = ET.fromstring(resp.body.decode())
    assert root.tag == "rss"
    items = root.findall("./channel/item")
    assert len(items) == 1
    assert items[0].find("category").text == "Weather"
    guid = items[0].find("guid")
    assert guid.get("isPermaLink") == "true"
    assert guid.text.endswith("/news/" + post["slug"])
    assert items[0].find("link").text == guid.text


def test_review_queue_json(monkeypatch, tmp_path):
    _isolate(monkeypatch, tmp_path)
    post = news_blog.create_post(
        {"status": "review", "headline": "Held for review", "category": "News",
         "gate_reasons": ["names a person"]},
        db_path=tmp_path / "news.db",
    )
    resp = news_blog.review_queue()
    assert isinstance(resp.content, list)
    assert len(resp.content) == 1
    assert resp.content[0]["slug"] == post["slug"]
    assert resp.content[0]["gate_reasons"] == ["names a person"]


def test_blog_list_filters_to_blog_category(monkeypatch, tmp_path):
    _published_post(monkeypatch, tmp_path)
    news_blog.create_post(
        {"status": "published", "category": "Blog", "headline": "A note from the desk"},
        db_path=tmp_path / "news.db",
    )
    html_text = news_blog.blog_list().body.decode()
    assert "A note from the desk" in html_text
    assert "Freeze Warning tonight" not in html_text
