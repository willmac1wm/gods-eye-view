"""story_link: news -> incident correlation for /news story posts. No network."""
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app import story_link

NOW = int(time.time() * 1000)
H = 3600 * 1000


def _news(title, summary="", hours_ago=5):
    return {"id": "n1", "title": title, "summary": summary,
            "url": "https://example.com/n1", "pub_ms": NOW - int(hours_ago * H)}


def _inc(itype, location, hours_ago=6, units=""):
    return {"id": "i1", "incident_type": itype, "location_text": location,
            "units": units, "created_at_ms": NOW - int(hours_ago * H)}


def test_place_and_type_match_links():
    news = [_news("Flooding from nor'easter inundates North Wildwood",
                  "streets underwater", hours_ago=5)]
    incs = [_inc("weather", "North Wildwood: Atlantic Ave", hours_ago=6)]
    got = story_link.link_news_to_incidents(news, incs)
    assert got[0]["related_count"] == 1
    assert got[0]["related"][0]["id"] == "i1"


def test_outside_time_window_does_not_link():
    news = [_news("Wildwood boardwalk fire", hours_ago=5)]
    incs = [_inc("fire", "Wildwood boardwalk", hours_ago=200)]  # ~8 days ago
    got = story_link.link_news_to_incidents(news, incs)
    assert got[0]["related_count"] == 0


def test_unrelated_incident_does_not_link():
    news = [_news("Ocean City council approves budget", hours_ago=5)]
    incs = [_inc("fire", "Wildwood boardwalk", hours_ago=6)]
    got = story_link.link_news_to_incidents(news, incs)
    assert got[0]["related_count"] == 0


def test_stronger_match_ranks_first():
    news = [_news("Structure fire on Pacific Ave in Wildwood", hours_ago=5)]
    near = _inc("fire", "Wildwood: Pacific Ave", hours_ago=5, units="Station 3")
    far = {"id": "i2", "incident_type": "fire",
           "location_text": "Cape May Court House", "units": "",
           "created_at_ms": NOW - 6 * H}
    got = story_link.link_news_to_incidents(news, [far, near])
    assert got[0]["related_count"] == 2
    assert got[0]["related"][0]["id"] == "i1"  # place+type beats type-only


def test_max_related_is_respected():
    news = [_news("Wildwood fire", hours_ago=5)]
    incs = [_inc("fire", f"Wildwood location {i}", hours_ago=5 + i) for i in range(6)]
    for i, inc in enumerate(incs):
        inc["id"] = f"i{i}"
    got = story_link.link_news_to_incidents(news, incs, max_related=3)
    assert got[0]["related_count"] == 3


def test_inputs_are_not_mutated():
    n = _news("Wildwood fire", hours_ago=5)
    incs = [_inc("fire", "Wildwood", hours_ago=6)]
    story_link.link_news_to_incidents([n], incs)
    assert "related" not in n
    assert "related" not in incs[0]


def test_missing_dates_still_match_on_text():
    news = [_news("Wildwood fire")]
    del news[0]["pub_ms"]
    incs = [_inc("fire", "Wildwood")]
    del incs[0]["created_at_ms"]
    got = story_link.link_news_to_incidents(news, incs)
    assert got[0]["related_count"] == 1


def test_never_raises_on_garbage():
    got = story_link.link_news_to_incidents(None, None)
    assert got == []
    got = story_link.link_news_to_incidents([{"title": None}], [{"id": 1}])
    assert got[0]["related_count"] == 0
