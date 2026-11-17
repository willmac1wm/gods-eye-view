"""Real-time lightning watcher (app/lightning_watch.py). No network.

Covers: S3 prefix / listing-URL construction for a given UTC time
(including the hour-rollover case), listing XML parsing, filename
window-start parsing, new-file filtering (last-seen key + 10-minute
lookback), GLM flash parsing from a synthetic NetCDF file built with
netCDF4 (same variable names and types as the real GOES-19 files),
county / ring / outside classification, flash dedupe across
overlapping 20-second windows, the alert rules (first flash after
30 min quiet = high, >=10/min sustained = critical, ring-only = no
alert), the 15-minute cooldown, and the 404-on-listed-key case
(a reprocessed file is skipped, not fatal).
"""
import asyncio
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app import lightning_watch, news_ingest

T0 = 1794000000  # 2026-11-15 ~12:00 UTC, fixed "now" for tests


def _isolate(monkeypatch, tmp_path):
    monkeypatch.setattr(news_ingest, "DB_PATH", tmp_path / "news.db")


def _store(tmp_path, name="lightning.db"):
    return lightning_watch.LightningStore(tmp_path / name)


def _flash(time_s, lat=39.08, lon=-74.82, energy=1e-13, quality=0):
    return {"time_s": time_s, "lat": lat, "lon": lon,
            "energy_j": energy, "quality": quality}


def _make_glm_file(path, flashes, base_iso="2026-11-16T01:00:00.0Z"):
    """Write a minimal GLM-L2-LCFA-shaped NetCDF file with netCDF4.

    flashes: [(offset_s, lat, lon, energy_j, quality)] — offsets are
    seconds since the window start, like the real product.
    """
    import netCDF4

    ds = netCDF4.Dataset(str(path), "w", format="NETCDF4")
    try:
        ds.time_coverage_start = base_iso
        ds.createDimension("number_of_flashes", len(flashes))
        lat = ds.createVariable("flash_lat", "f4", ("number_of_flashes",))
        lon = ds.createVariable("flash_lon", "f4", ("number_of_flashes",))
        off = ds.createVariable(
            "flash_time_offset_of_first_event", "f4", ("number_of_flashes",))
        en = ds.createVariable("flash_energy", "f4", ("number_of_flashes",))
        qf = ds.createVariable(
            "flash_quality_flag", "i2", ("number_of_flashes",))
        fid = ds.createVariable("flash_id", "i2", ("number_of_flashes",))
        lat[:] = [f[1] for f in flashes]
        lon[:] = [f[2] for f in flashes]
        off[:] = [f[0] for f in flashes]
        en[:] = [f[3] for f in flashes]
        qf[:] = [f[4] for f in flashes]
        fid[:] = list(range(len(flashes)))
    finally:
        ds.close()


# ------------------------------------------------------------------ S3 paths

def test_s3_prefix_for():
    dt = datetime(2026, 11, 16, 1, 0, tzinfo=timezone.utc)
    assert lightning_watch.s3_prefix_for(dt) == "GLM-L2-LCFA/2026/320/01/"
    dt2 = datetime(2026, 1, 1, 0, 0, tzinfo=timezone.utc)
    assert lightning_watch.s3_prefix_for(dt2) == "GLM-L2-LCFA/2026/001/00/"


def test_listing_url():
    url = lightning_watch.listing_url("GLM-L2-LCFA/2026/320/01/")
    assert url.startswith("https://noaa-goes19.s3.amazonaws.com/?")
    assert "list-type=2" in url
    assert "prefix=GLM-L2-LCFA%2F2026%2F320%2F01%2F" in url
    url2 = lightning_watch.listing_url(
        "GLM-L2-LCFA/2026/320/01/", start_after="GLM-L2-LCFA/2026/320/01/OR_X.nc")
    assert "start-after=" in url2


def test_parse_listing():
    xml = """<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
      <Name>noaa-goes19</Name><KeyCount>2</KeyCount><IsTruncated>false</IsTruncated>
      <Contents><Key>GLM-L2-LCFA/2026/320/01/OR_A.nc</Key><Size>368296</Size></Contents>
      <Contents><Key>GLM-L2-LCFA/2026/320/01/OR_B.nc</Key><Size>337796</Size></Contents>
    </ListBucketResult>"""
    out = lightning_watch.parse_listing(xml)
    assert [o["key"] for o in out] == [
        "GLM-L2-LCFA/2026/320/01/OR_A.nc",
        "GLM-L2-LCFA/2026/320/01/OR_B.nc",
    ]
    assert out[0]["size"] == 368296
    assert lightning_watch.parse_listing("not xml at all") == []
    assert lightning_watch.parse_listing("") == []


def test_filename_start_s():
    key = ("GLM-L2-LCFA/2026/320/01/OR_GLM-L2-LCFA_G19_s20263200100000"
           "_e20263200100200_c20263200100215.nc")
    start = lightning_watch.filename_start_s(key)
    assert start == datetime(2026, 11, 16, 1, 0, 0,
                             tzinfo=timezone.utc).timestamp()
    assert lightning_watch.filename_start_s("no-timestamp-here.nc") is None
    assert lightning_watch.filename_start_s("") is None


def test_new_file_keys_filters_by_last_seen_and_lookback():
    now = datetime(2026, 11, 16, 1, 10, 0, tzinfo=timezone.utc).timestamp()

    def _key(hhmmss):
        # hhmmss is the 6-digit HHMMSS of the window start (hour 01);
        # the s-field is YYYY + day-of-year + HHMMSS + tenths.
        return ("GLM-L2-LCFA/2026/320/01/OR_GLM-L2-LCFA_G19_s2026320"
                f"{hhmmss}0_e20263200100000_c20263200100000.nc")

    listed = [
        {"key": _key("010000"), "size": 1},  # 10 min old: exactly at edge
        {"key": _key("010500"), "size": 1},  # 5 min old: in window
        {"key": _key("010900"), "size": 1},  # 1 min old: in window
        {"key": _key("011200"), "size": 1},  # 2 min in the future: skip
    ]
    # No last-seen key: window is [now-600, now+60].
    got = lightning_watch.new_file_keys(listed, None, now)
    assert got == [_key("010000"), _key("010500"), _key("010900")]
    # With a last-seen key, older keys are skipped even in-window.
    got = lightning_watch.new_file_keys(listed, _key("010500"), now)
    assert got == [_key("010900")]


def test_hour_prefixes_rollover():
    # 01:02 UTC: current hour 01 plus previous hour 00.
    prefixes = lightning_watch._hour_prefixes(
        datetime(2026, 11, 16, 1, 2, tzinfo=timezone.utc).timestamp())
    assert prefixes == ["GLM-L2-LCFA/2026/320/01/",
                        "GLM-L2-LCFA/2026/320/00/"]
    # Exactly on the hour: the previous hour is still listed, because
    # the 10-minute lookback reaches back into it.
    prefixes = lightning_watch._hour_prefixes(
        datetime(2026, 11, 16, 1, 0, 0, tzinfo=timezone.utc).timestamp())
    assert prefixes == ["GLM-L2-LCFA/2026/320/01/",
                        "GLM-L2-LCFA/2026/320/00/"]


# ------------------------------------------------------------------ parsing

def test_parse_glm_bytes_synthetic(tmp_path):
    path = tmp_path / "sample.nc"
    _make_glm_file(path, [
        (0.5, 39.08, -74.82, 2.5e-13, 0),
        (10.0, 38.95, -74.95, 1.0e-13, 3),
    ])
    flashes = lightning_watch.parse_glm_bytes(path.read_bytes())
    assert len(flashes) == 2
    base = datetime(2026, 11, 16, 1, 0, 0, tzinfo=timezone.utc).timestamp()
    assert abs(flashes[0]["time_s"] - (base + 0.5)) < 0.01
    assert abs(flashes[0]["lat"] - 39.08) < 1e-4
    assert abs(flashes[0]["lon"] - (-74.82)) < 1e-4
    assert flashes[0]["energy_j"] is not None
    assert flashes[1]["quality"] == 3
    assert abs(flashes[1]["time_s"] - (base + 10.0)) < 0.01


def test_parse_glm_bytes_missing_variable(tmp_path):
    import netCDF4

    path = tmp_path / "bad.nc"
    ds = netCDF4.Dataset(str(path), "w", format="NETCDF4")
    try:
        ds.time_coverage_start = "2026-11-16T01:00:00.0Z"
        ds.createDimension("number_of_flashes", 1)
        ds.createVariable("flash_lon", "f4", ("number_of_flashes",))[:] = [-74.8]
    finally:
        ds.close()
    try:
        lightning_watch.parse_glm_bytes(path.read_bytes())
    except ValueError as exc:
        assert "flash_lat" in str(exc)
    else:
        raise AssertionError("expected ValueError for a file without flash_lat")
    try:
        lightning_watch.parse_glm_bytes(b"this is not netcdf")
    except ValueError:
        pass
    else:
        raise AssertionError("expected ValueError for non-NetCDF bytes")


# ------------------------------------------------------------------ geography

def test_classify_flash():
    assert lightning_watch.classify_flash(39.08, -74.82) == "county"  # CMCH
    assert lightning_watch.classify_flash(38.93, -74.91) == "county"  # Cape May
    assert lightning_watch.classify_flash(39.28, -74.58) == "county"  # Ocean City
    assert lightning_watch.classify_flash(39.45, -74.60) == "ring"    # north, in ring
    assert lightning_watch.classify_flash(38.80, -74.90) == "ring"    # south, in ring
    assert lightning_watch.classify_flash(39.08, -75.25) == "ring"    # west, in ring
    assert lightning_watch.classify_flash(39.60, -74.60) == "outside"
    assert lightning_watch.classify_flash(38.50, -75.50) == "outside"
    assert lightning_watch.classify_flash(40.70, -74.00) == "outside"  # NYC


def test_nearest_town():
    name, dist, direction = lightning_watch.nearest_town(39.08, -74.82)
    assert name == "Cape May Court House"
    assert dist < 1.0
    name, dist, direction = lightning_watch.nearest_town(38.94, -74.90)
    assert name == "Cape May"
    assert direction in ("N", "NE", "E", "SE", "S", "SW", "W", "NW")


def test_flash_key_rounding():
    a = _flash(T0 + 0.4, lat=39.0812, lon=-74.8244)
    b = _flash(T0 + 0.49, lat=39.0814, lon=-74.8241)
    assert lightning_watch.flash_key(a) == lightning_watch.flash_key(b)
    c = _flash(T0 + 5.0, lat=39.0812, lon=-74.8244)
    assert lightning_watch.flash_key(a) != lightning_watch.flash_key(c)


# ------------------------------------------------------------------ store

def test_store_dedupes_across_windows(tmp_path):
    store = _store(tmp_path)
    # Same flash in two adjacent 20-s files (overlapping windows).
    f1 = _flash(T0, lat=39.0812, lon=-74.8244)
    f2 = _flash(T0 + 0.49, lat=39.0814, lon=-74.8241)
    assert len(store.record_flashes([f1], T0)) == 1
    assert store.record_flashes([f2], T0 + 20) == []
    # Outside flashes are never stored.
    assert store.record_flashes([_flash(T0, lat=40.7, lon=-74.0)], T0) == []
    # Ring flashes are stored.
    assert len(store.record_flashes(
        [_flash(T0, lat=39.45, lon=-74.60)], T0)) == 1


def test_store_survives_restart(tmp_path):
    path = tmp_path / "lightning.db"
    store = lightning_watch.LightningStore(path)
    store.record_flashes([_flash(T0)], T0)
    store.mark_file_seen("GLM-L2-LCFA/2026/320/01/OR_A.nc", T0)
    store.set_last_alert_s("lightning-county", T0)
    store2 = lightning_watch.LightningStore(path)
    assert store2.is_flash_seen(lightning_watch.flash_key(_flash(T0)))
    assert store2.is_file_seen("GLM-L2-LCFA/2026/320/01/OR_A.nc")
    assert store2.get_last_alert_s("lightning-county") == T0
    assert store2.last_county_s() == T0


# ------------------------------------------------------------------ alert rules

def test_first_flash_after_quiet_alerts(monkeypatch, tmp_path):
    _isolate(monkeypatch, tmp_path)
    store = _store(tmp_path)
    # Last county flash 40 min ago: quiet.
    store.record_flashes([_flash(T0 - 2400)], T0 - 2400)
    alerts, summary = lightning_watch.process_flashes(
        [_flash(T0)], store, now_s=T0)
    assert summary["flashes_in_box"] == 1
    assert len(alerts) == 1
    assert alerts[0]["incident_key"] == "lightning-county"
    assert alerts[0]["status"] == "new"
    # The alert itself is in news_alerts with counts, not raw data.
    rows = news_ingest.latest_alerts(5)
    assert rows and rows[0]["incident_key"] == "lightning-county"
    assert rows[0]["severity"] == "high"
    assert "Cape May Court House" in (rows[0]["report_md"] or "")


def test_first_flash_cold_start_alerts_once(monkeypatch, tmp_path):
    _isolate(monkeypatch, tmp_path)
    store = _store(tmp_path)
    alerts, _ = lightning_watch.process_flashes([_flash(T0)], store, now_s=T0)
    assert [a["incident_key"] for a in alerts] == ["lightning-county"]
    # A second flash 5 min later, mid-storm: no new first-flash alert.
    alerts, _ = lightning_watch.process_flashes(
        [_flash(T0 + 300)], store, now_s=T0 + 300)
    assert alerts == []


def test_ring_only_never_alerts(monkeypatch, tmp_path):
    _isolate(monkeypatch, tmp_path)
    store = _store(tmp_path)
    alerts, summary = lightning_watch.process_flashes(
        [_flash(T0, lat=39.45, lon=-74.60),
         _flash(T0, lat=38.80, lon=-74.90)],
        store, now_s=T0)
    assert alerts == []
    assert summary["flashes_in_box"] == 0
    assert summary["flashes_in_ring"] == 2


def test_rate_alert_critical(monkeypatch, tmp_path):
    _isolate(monkeypatch, tmp_path)
    store = _store(tmp_path)
    # 55 county flashes in the last 5 minutes = 11/min.
    flashes = [_flash(T0 - 295 + i * 5.3) for i in range(55)]
    alerts, summary = lightning_watch.process_flashes(flashes, store, now_s=T0)
    assert summary["flashes_in_box_last_5min"] == 55
    assert summary["max_rate_per_min"] == 11.0
    keys = [a["incident_key"] for a in alerts]
    assert "lightning-rate" in keys
    rows = news_ingest.latest_alerts(5)
    rate = next(r for r in rows if r["incident_key"] == "lightning-rate")
    assert rate["severity"] == "critical"


def test_rate_below_threshold_no_alert(monkeypatch, tmp_path):
    _isolate(monkeypatch, tmp_path)
    store = _store(tmp_path)
    # 49 flashes in 5 min = 9.8/min: under the 10/min line. The first
    # flash still alerts (cold start), the rate rule does not.
    flashes = [_flash(T0 - 295 + i * 5.9) for i in range(49)]
    alerts, summary = lightning_watch.process_flashes(flashes, store, now_s=T0)
    assert summary["max_rate_per_min"] == 9.8
    assert [a["incident_key"] for a in alerts] == ["lightning-county"]


def test_cooldown_15_minutes(monkeypatch, tmp_path):
    _isolate(monkeypatch, tmp_path)
    store = _store(tmp_path)
    flashes = [_flash(T0 - 295 + i * 5.3) for i in range(55)]
    alerts, _ = lightning_watch.process_flashes(flashes, store, now_s=T0)
    assert "lightning-rate" in [a["incident_key"] for a in alerts]
    # 10 minutes later, still >=10/min, but inside the cooldown.
    flashes2 = [_flash(T0 + 600 - 295 + i * 5.3) for i in range(55)]
    alerts, _ = lightning_watch.process_flashes(
        flashes2, store, now_s=T0 + 600)
    assert [a["incident_key"] for a in alerts] == []
    # 16 minutes after the first firing, the cooldown has passed.
    flashes3 = [_flash(T0 + 960 - 295 + i * 5.3) for i in range(55)]
    alerts, _ = lightning_watch.process_flashes(
        flashes3, store, now_s=T0 + 960)
    assert "lightning-rate" in [a["incident_key"] for a in alerts]


# ------------------------------------------------------------------ fetching

class _FakeResp:
    def __init__(self, status=200, text="", content=b""):
        self.status_code = status
        self.text = text
        self.content = content

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


class _FakeClient:
    """Minimal httpx stand-in: maps URLs to _FakeResp."""

    def __init__(self, mapping):
        self.mapping = mapping
        self.seen_urls = []

    async def get(self, url, timeout=None):
        self.seen_urls.append(url)
        for prefix, resp in self.mapping.items():
            if url.startswith(prefix):
                return resp
        return _FakeResp(status=404, text="not found")


def _listing_xml(keys):
    items = "".join(
        f"<Contents><Key>{k}</Key><Size>100</Size></Contents>" for k in keys)
    return ("<ListBucketResult xmlns=\"http://s3.amazonaws.com/doc/2006-03-01/\">"
            f"{items}</ListBucketResult>")


def test_fetch_skips_404_file(tmp_path):
    # One listed file 404s on GET (reprocessed under a new creation
    # timestamp, as seen live). The other downloads fine and its
    # flashes are processed; the poll does not crash.
    import netCDF4  # noqa: F401  (ensures the test env has it)

    now = datetime(2026, 11, 16, 1, 10, 0, tzinfo=timezone.utc).timestamp()
    good_key = ("GLM-L2-LCFA/2026/320/01/OR_GLM-L2-LCFA_G19_s20263200109000"
                "_e20263200109200_c20263200109215.nc")
    gone_key = ("GLM-L2-LCFA/2026/320/01/OR_GLM-L2-LCFA_G19_s20263200108000"
                "_e20263200108200_c20263200108215.nc")
    nc_path = tmp_path / "good.nc"
    _make_glm_file(nc_path, [(0.5, 39.08, -74.82, 1e-13, 0)])
    good_bytes = nc_path.read_bytes()
    listing = _listing_xml([gone_key, good_key])
    client = _FakeClient({
        "https://noaa-goes19.s3.amazonaws.com/?": _FakeResp(text=listing),
        f"https://noaa-goes19.s3.amazonaws.com/{gone_key}":
            _FakeResp(status=404, text="NoSuchKey"),
        f"https://noaa-goes19.s3.amazonaws.com/{good_key}":
            _FakeResp(content=good_bytes),
    })
    store = _store(tmp_path)
    downloaded = asyncio.run(
        lightning_watch.fetch_new_files(client, store, now))
    assert [k for k, _ in downloaded] == [good_key]
    flashes = []
    for key, data in downloaded:
        flashes.extend(lightning_watch.parse_glm_bytes(data))
        store.mark_file_seen(key, now)
    assert len(flashes) == 1
    assert abs(flashes[0]["lat"] - 39.08) < 1e-4  # float32, not exact
