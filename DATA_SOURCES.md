# Data Sources & Attribution

God's Eye View's **code** is [MIT](LICENSE)-licensed. **The MIT grant covers the source code only — it does NOT extend to third-party data or visual assets.** Every third-party source keeps its own license and terms. This file documents the live and bundled data sources; bundled 3D-model provenance is recorded in [`public/models/README.md`](public/models/README.md).

How to read this:

- **The non-permissive datasets are carved out, not omitted.** Some bundled data (e.g. TeleGeography, CC BY-NC-SA) isn't MIT-compatible. Rather than hide it, we **bundle it with a clear license carve-out** so the app works out of the box — but it stays under the provider's terms.
- **If your use doesn't fit a dataset's license, remove that dataset.** Most importantly: TeleGeography is **NonCommercial** — commercial users must delete it (or license it from TeleGeography). It's one self-contained folder.
- **Attribution is shown in-app** and listed here. Keep it intact. The required Google/Cesium credit renders on the on-globe credit line (bottom-left, `#cesium-credits`), and every per-layer credit below is registered into the expandable **"Data attribution"** lightbox on that line (`src/data/dataCredits.js` → `viewer.creditDisplay.addStaticCredit`). Both stay visible in clean-view and recording modes.
- **Bundled model attribution lives beside the model files.** [`public/models/README.md`](public/models/README.md) records each shipped model's creator, source, license, and modification status.

---

## Live sources (fetched at runtime — not stored in this repo)

| Source                                                                | Used for                                                                                                                            | License / terms                                                                                                                                                                                                                                                                                                                                       | Attribution                                                                                                                                 |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **NOAA GFS (wind)** (`noaa-gfs-bdp-pds.s3.amazonaws.com`) | Global 10 m wind, optional 2 m temperature and mean sea-level pressure for Wind. Keyless; latest 6-hourly 0.25° cycle, byte-range GRIB2 reads, cached for an hour | U.S. public domain (NOAA); keyless via NOAA Open Data on AWS | "NOAA Global Forecast System (GFS)" (courtesy; not an endorsement) |
| **ECMWF IFS (wind)** (`data.ecmwf.int/forecasts`, ECMWF Open Data) | The alternative Wind model: 10 m wind, optional 2 m temperature and mean sea-level pressure. Keyless; latest 6-hourly 0.25° run, byte-range GRIB2 reads, cached for an hour | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) plus the [ECMWF Terms of Use](https://apps.ecmwf.int/datasets/licences/general/) | "This service is based on data and products of the European Centre for Medium-Range Weather Forecasts (ECMWF)", with the CC BY 4.0 link, the modification notice and ECMWF's liability disclaimer — shown in-app |
| **NOAA nowCOAST observed weather** (`nowcoast.noaa.gov/geoserver/observations/{weather_radar,satellite}/ows`, WMS 1.1.1) | Rain radar (MRMS base reflectivity, contiguous US, about 4-minute updates) and Satellite clouds (GOES-19/18 Band 14 regional infrared, about 5-minute updates; global infrared mosaic, hourly). Keyless; layer metadata refreshed every 2 minutes, exact-time images cached for up to 24 hours | [NOAA disclaimer](https://oceanservice.noaa.gov/disclaimer.html) | "NOAA nowCOAST · NWS/OAR MRMS radar; NESDIS GOES and global satellite partners" |
| **NOAA nowCOAST lightning density** (`nowcoast.noaa.gov/geoserver/observations/lightning_detection/ows`) | Lightning density: 15-minute accumulated strike density on an approximately 8 km grid, Americas and Pacific. Keyless; layer metadata refreshed every 10 minutes, exact-time images cached for up to 24 hours | NOAA Level-5 derived product from Vaisala NLDN/GLD360; the [product description](https://ocean.weather.gov/lightning/lightning_pdd.php) permits public distribution of this density product, not of raw Vaisala detections | "NOAA/NWS nowCOAST; derived from Vaisala NLDN/GLD360" |
| **NOAA NHC / CPHC advisories** (`www.nhc.noaa.gov/CurrentStorms.json` + the `mapservices.weather.noaa.gov` tropical weather summary MapServer) | Cyclone advisories: storm positions, forecast tracks, points and cones for the Atlantic and eastern/central North Pacific. Keyless through `/api/cyclones`; cached for 5 minutes | [NWS public-data terms](https://www.weather.gov/disclaimer); no endorsement implied | "NOAA/NWS NHC / CPHC" |
| **Mapillary** (vector tiles, Graph API, MapillaryJS) | Street Level: coverage lines, image cones and the embedded viewer. Coverage tiles kept in server memory for 24 h | Imagery [CC BY-SA 4.0](https://www.mapillary.com/terms); API under the Mapillary terms with a client token | "© Mapillary contributors, CC BY-SA 4.0", shown on the globe while the provider is on |
| **Google Street View** (Maps JavaScript API) | Street Level, on the Google 3D map only (Google's terms): Google's panorama viewer and nearest-panorama lookups; panorama dates and addresses kept for the session only | Google Maps Platform ToS (your own key + billing; every panorama load is billed) | "Street View imagery © Google" on the globe while the provider is on, and Google's logo and terms in the viewer |
| **KartaView** (`api.kartaview.org` coverage tiles and photo API, `cdn.kartaview.org` image proxy, `storage*.openstreetcam.org` photos) | Street Level: coverage lines (z13–14 JSON tiles; with the imagery filter on, KartaView's filtered PNG tiles as a mask), nearest-photo lookups, the photo's sequence and the photo itself, fetched by the browser. Keyless; nothing cached beyond the session | Imagery [CC BY-SA 4.0](https://kartaview.org/terms) (KartaView terms §4); the public API needs no token | "© KartaView contributors, CC BY-SA 4.0", shown on the globe while the provider is on |
| **Panoramax** (`api.panoramax.xyz` meta-catalogue: vector tiles and STAC search; pictures from the federated instance holding each one, e.g. `panoramax.openstreetmap.fr`, `panoramax.ign.fr`) | Street Level: coverage lines, nearest-picture lookups, a sequence's pictures as cones, and the picture itself, fetched by the browser. Keyless; tiles cached by the browser for an hour (the API's own header) | Per picture: mostly [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), IGN's [Licence Ouverte 2.0](https://www.etalab.gouv.fr/licence-ouverte-open-licence/); the API needs no token | "© Panoramax contributors, licence per picture" on the globe while the provider is on; the caption names each picture's author and licence |
| **OpenStreetMap** | Map and place data (roads, military areas and names, ALPR, place search, outlines); via vector tiles, hourly ALPR extract, bundled data, Nominatim and optional self-configured Overpass | [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) | © OpenStreetMap contributors |
| **Google Map Tiles API** (Photorealistic 3D Tiles) + Places/Geocoding | The 3D globe, voice scene context, and on-demand nearby installation search                                                         | Google Maps Platform ToS (proprietary, your own key + billing)                                                                                                                                                                                                                                                                                        | "Google" / "Google Maps" logo — **shown in-app**, required                                                                                  |
| **OpenSky Network**                                                   | Primary worldwide live-flight snapshot                                                                                              | Non-commercial research/education license                                                                                                                                                                                                                                                                                                             | Schäfer et al., _"Bringing Up OpenSky"_, IPSN 2014 + opensky-network.org                                                                    |
| **adsb.lol point API**                                                | Bounded live-flight fallback when OpenSky has no usable snapshot; GNSS Integrity layer (aircraft-reported NIC/NACp and GPS-loss integrity facts, via `/api/gnss-integrity`, 60 s server cache)                                                                    | ODbL 1.0                                                                                                                                                                                                                                                                                                                                              | adsb.lol contributors; `api.adsb.lol/v2/lat/{lat}/lon/{lon}/dist/{radius}`                                                                  |
| **adsb.lol**                                                          | Military flights + aircraft traces                                                                                                  | ODbL 1.0                                                                                                                                                                                                                                                                                                                                              | "adsb.lol" (ODbL)                                                                                                                           |
| **adsbdb** (`api.adsbdb.com`) | Aircraft type, model name and registration by ICAO hex for enriched flights; airline and origin/destination airports for the tracked flight's callsign | No licence or rate limit is published for the service. Its own credits: aircraft data from PlaneBase, ICAO-to-N-number conversion by Guillaume Michel, and flight route data that "is the work of David Taylor, Edinburgh and Jim Mason, Glasgow, and may not be copied, published, or incorporated into other databases without the explicit permission of David J Taylor, Edinburgh" | "adsbdb — api.adsbdb.com" (courtesy); route data credited to David Taylor, Edinburgh, and Jim Mason, Glasgow |
| **AISStream.io**                                                      | Live vessels (AIS)                                                                                                                  | Free, beta, no formal ToS; AIS is a public broadcast                                                                                                                                                                                                                                                                                                  | "AISStream.io" (courtesy)                                                                                                                   |
| **CelesTrak**                                                         | Satellite TLEs (SGP4) and SATCAT records (object type, operational status, owner) that file each satellite under a class                                                                                                            | US-government-origin data, no license; citation requested                                                                                                                                                                                                                                                                                             | "CelesTrak (celestrak.org), Dr. T.S. Kelso"                                                                                                 |
| **The Space Devs — Launch Library 2 v2.3**                            | Recent launch, payload, stage, and recovery metadata for Space Missions (30d)                                                       | [The Space Devs terms of use](https://github.com/TheSpaceDevs/Tutorials/blob/main/faqs/faq_TSD.md#terms-of-use): data may be used and shared in any form; avoid forwarding it without added value; attribution is encouraged (not mandatory). [Official API limits](https://ll.thespacedevs.com/docs/): 15 unauthenticated calls/hour; optional token | "Launch Library 2 — The Space Devs" (courtesy attribution)                                                                                  |
| **Esri World Imagery** (ArcGIS Online tile service)                   | The keyless satellite basemap — the default landing when no Google/ion credential is configured, and the "Esri Satellite" map stack | [Esri Master Agreement](https://www.esri.com/en-us/legal/terms/full-master-agreement): the public World Imagery service is usable in public-facing apps with attribution; no key is required for this classic endpoint, but Esri governs and can change access — an app at scale should review current ArcGIS Location Platform terms                 | "Powered by Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community" (provider carries the service's own credit line) |
| **USGS**                                                              | Earthquakes                                                                                                                         | U.S. public domain                                                                                                                                                                                                                                                                                                                                    | "Data courtesy of the U.S. Geological Survey"                                                                                               |
| **NOAA CO-OPS**                                                       | Tides & water levels                                                                                                                  | U.S. public domain                                                                                                                                                                                                                                                                                                                                    | "Data courtesy of NOAA CO-OPS"                                                                                                              |
| **MassOutage** (`massoutage.com`)                                     | Power outages, Cape May County (FIPS 34009): customers out, per-town breakdown, threshold alerts                                                                                                                                                                                                                                                                                                            | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/): unofficial aggregate of public utility + government data; keyless tier 5 req/5 min per IP, optional free key (`MASSOUTAGE_API_KEY`) sent as `Authorization: Bearer`; fetched through the same-origin `/api/outages` proxy (5-minute server cache, 3 calls per refresh). PowerOutage.us is NOT a source: its terms prohibit scraping and its API is paid | "MassOutage (massoutage.com), unofficial aggregate, as of <time>" |
| **U.S. Energy Information Administration (EIA)** (`api.eia.gov/v2`) | Weekly fuel prices: regular gasoline + diesel (Central Atlantic PADD 1B regional proxy — no New Jersey gasoline series exists) and residential heating oil (real New Jersey series). Fetched through the same-origin `/api/fuel` proxy (6-hour server cache, 2 calls per refresh); requires `EIA_API_KEY` — without a key the layer hides its card and never fabricates a price | U.S. public domain (federal data); [EIA Open Data API terms](https://www.eia.gov/opendata/registration.php) — free key, email-only registration, key sent as `X-Api-Key` header (never in the URL or logs) | "U.S. Energy Information Administration (EIA)" |
| **USGS Water Data API v1** (`api.waterdata.usgs.gov/ogcapi/v1`) | River gauges: gage height + discharge, latest continuous readings for 01411000 (Great Egg Harbor River at Folsom) and 01411300 (Tuckahoe River at Head of River). One batched call per refresh through the same-origin `/api/gauges` proxy (15-minute server cache); keyless, no token needed | U.S. public domain | "Data courtesy of the U.S. Geological Survey" |
| **FAA NAS Status** (`nasstatus.faa.gov/api/airport-status-information`) | Airport ground stops, ground delays, closures and arrival/departure delays, filtered to ACY/PHL/EWR + nationwide per-category counts. One national XML document per refresh through the same-origin `/api/faa-status` proxy (2-minute server cache); keyless, no key, no CORS on the upstream (proxy only) | U.S. public domain | "Source: FAA NAS Status" |
| **aprs.fi / CWOP**                                                     | APRS / CWOP weather stations                                                                                                          | [aprs.fi API terms](https://api.aprs.fi/page/api): free public app only, credit + link-back required, request only when actively needed, no preloading/pre-caching/archival, caching allowed, app must identify itself in User-Agent, no availability guarantee | "Weather: [aprs.fi](https://aprs.fi)"                                                                                                       |
| **USCG NAVCEN**                                                       | Marine Warnings (Broadcast Notices to Mariners)                                                                                        | U.S. public domain                                                                                                                                                                                                                                                                                                                                    | "Marine warnings: U.S. Coast Guard — Sector Delaware Bay / District 5 (NAVCEN)"                                                                 |
| **GDACS (EU JRC / UN OCHA)** | GDACS Hazards (multi-hazard: earthquakes, cyclones, floods, droughts, wildfires, volcanoes, tsunamis) | Public domain (feed); per-event resources EU CC BY 4.0 | "GDACS — Global Disaster Alert and Coordination System" |
| **IODA (Georgia Tech)** | Internet Outages (IODA outage alerts + US/NJ summaries) | Copyright (c) 2021-2025 Georgia Tech Research Corporation; free, keyless | "IODA — Internet Outage Detection and Analysis, Georgia Tech" |
| **HIFLD Next (Data Rescue Project snapshot)** | HIFLD Installations (MIRTA DoD Sites – Points, frozen snapshot) | STAC license "other" (U.S. federal public domain origin); source data August 25, 2023; HIFLD Open shut down August 26, 2025 — never live | "HIFLD Next / MIRTA DoD Sites – Points (snapshot — not live)" |
| **CDC ArboNET** | Outbreaks (CDC West Nile / arbovirus state + NJ county tables) | U.S. federal, public domain; preliminary, updated every 1–2 weeks in season | "CDC ArboNET" |
| **WHO Disease Outbreak News** | Outbreaks (WHO DON headlines) | CC BY-NC-SA 3.0 IGO — **non-commercial only**; re-check before any paid tier | "WHO Disease Outbreak News" |
| **National Weather Service (api.weather.gov)** | Fallout Plume (NWS hourly forecast winds at the Salem/Hope Creek grid cell) | U.S. federal, public domain; no key | "National Weather Service (api.weather.gov) · Simple wind plume — advection only, not a HYSPLIT run" |
| **Environment and Climate Change Canada** (MSC GeoMet OGC API) | Air quality (AQHI) — Canadian station observations | [ECCC Data Servers End-use Licence](https://eccc-msc.github.io/open-data/licence/readme_en/) (open, attribution required, no endorsement implied) | "Contains information licensed under the Environment and Climate Change Canada Data Servers End-use Licence" |
| **NASA GIBS** (WMTS tiles + Worldview Snapshots) and **NASA CMR** (granule catalog) | Recent Imagery layer: HLS S30/L30 (Sentinel-2, Landsat 8/9) and VIIRS true-colour tiles draped on the map, per-day thumbnails and PNG exports; the HLS granule catalog (dates, cloud, footprints) for a selected box | U.S. public domain (NASA data); keyless, browser-direct (CORS `*`); no bulk use — one 30-day catalog query per box, tiles bounded to the box, six tile requests in flight | "We acknowledge the use of imagery provided by services from NASA's Global Imagery Browse Services (GIBS), part of NASA's Earth Science Data and Information System (ESDIS)." — [gibs.earthdata.nasa.gov](https://gibs.earthdata.nasa.gov), [HLS](https://lpdaac.usgs.gov/products/hlss30v002/) |
| **NIFC WFIGS** (Wildland Fire Interagency Geospatial Services, ArcGIS feature service) | Fire Perimeters layer: current interagency wildfire incident perimeters, containment, and incident facts | U.S. public domain (interagency wildland-fire data published through the [NIFC Open Data portal](https://data-nifc.opendata.arcgis.com/)); fetched keyless through `/api/fire-perimeters` (5-minute server cache) with `exceededTransferLimit` paging | "Wildfire perimeters: National Interagency Fire Center (WFIGS)" |
| **S2 Underground GhostMaps** (`github.com/s2underground/GhostMaps`) | S2 GhostMaps layer: the current edition of S2's KMZ intel products (Common Intelligence Picture, 30-day kinetic pull, Border Crisis Map, Iran and Yemen products, newest incident drop). Keyless. `/api/ghostmaps` reads the branch head from git's ref advertisement every 15 s (`GHOSTMAPS_POLL_SECONDS`, minimum 5 s), lists the tree through the GitHub REST API only when the head changes (optional `GITHUB_TOKEN`), downloads files by commit-pinned raw URLs into `.gev-cache/ghostmaps/` and pushes new catalogs to browsers over server-sent events | [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) (repository README: "S2 Underground © 2025 by S2A1"); non-commercial, attribution required; files are fetched at runtime, never stored in this repository | "S2 GhostMaps intel products: S2 Underground © by S2A1, CC BY-NC-SA 4.0" — shown in-app |
| **InciWeb** (inciweb.wildfire.gov)                                    | Per-incident "InciWeb ↗" card links to official incident pages (narratives, evacuation/closure notices) | U.S. government public incident information. Links are matched best-effort by incident name and state, with incident page origin and update times checked on selection. Same-origin `/api/fire-perimeters/inciweb` routes cache the catalog for 1 hour and publication metadata for 30 minutes; linked pages remain InciWeb content | "Incident information: InciWeb (inciweb.wildfire.gov)" |
| **FAA Special Use Airspace** (`services6.arcgis.com` FeatureServer `Special_Use_Airspace`) | Prohibited & Restricted Airspace layer: US prohibited (P) and restricted (R) special-use airspace polygons (not the UAS Facility Map or UAS flight restrictions), altitude limits from the `*_VAL`/`*_UOM`/`*_CODE` fields, times of use, and controlling agency | U.S. public domain (FAA aeronautical data published through the [FAA AIS Open Data portal](https://adds-faa.opendata.arcgis.com/)); fetched keyless through `/api/drone-airspace` (1-hour server cache). Informational only — not a substitute for official UAS flight-planning tools | "Prohibited & restricted airspace: FAA Special Use Airspace" |
| **iNaturalist API** (`api.inaturalist.org/v2/observations`, `/v1/grid/{z}/{x}/{y}.grid.json`) | Wildlife Sightings layer: verifiable wildlife observed within the last 48 h (whales 7 d), by observation time, in the current view, with taxon, observation time, quality grade and eligible photo | Per-record licences; observations default CC BY-NC. Photos CC0/BY/BY-SA/BY-NC/BY-NC-SA shown; ND and all-rights-reserved photos link-only. Keyless via `/api/inaturalist/observations` (5-min cache; global sample 10 min; stale ≤ 1 h; 60 requests/min and 8,000/day upstream caps). **NonCommercial content:** commercial redistributors must filter to CC0/BY/BY-SA or remove the layer. No AI training on this content | "Wildlife sightings: iNaturalist contributors (licences per record; photos credited on each card)" |
| **Acartia** (`acartia.io/api/v1/sightings/current`) | Wildlife Sightings layer: Salish Sea marine mammal reports with validated species, observation time, reporting provider and trust flag; WHALES includes only the frozen cetacean list | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), each provider credited per sighting. Keyless via `/api/acartia/sightings` (10-min cache; stale ≤ 24 h). Positions rounded to 0.01° on the server; free-text comments excluded. Marine-conservation use; Be Whale Wise | "Wildlife sightings: Acartia (CC BY 4.0; each provider credited per sighting) · Be Whale Wise" |
| **OpenFreeMap / OpenMapTiles** | Vector tiles | OpenStreetMap data under ODbL 1.0 | OpenFreeMap © OpenMapTiles |
| **Overture Maps Foundation** | Military area names pack | [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) | Overture Maps Foundation |
| **TomTom Traffic API** (flow vector tiles)                            | Traffic roads and live congestion (optional, BYOK)                                                                     | [TomTom for Developers terms](https://docs.tomtom.com/legal/terms-and-conditions) (proprietary, your own key; free tier currently 200K tile requests/month — see [current pricing](https://docs.tomtom.com/pricing/))                                                                                                                                                       | "Traffic flow data © TomTom" — registered when live mode activates                                                                          |
| **Photon** (komoot)                                                   | Keyless place search — the fallback when no Google Maps key is configured, or when Google declines the Geocoding request            | Service: free public instance, [fair use](https://photon.komoot.io) (no bulk/heavy use); underlying data: **ODbL 1.0**                                                                                                                                                                                                                                | "Photon (komoot)"                                                                                          |
| **Open-Meteo**                                                        | Current weather in the cockpit Local Info page and cockpit-local dynamic atmospheric effects                                        | [CC BY 4.0 data licence and adjacent-link attribution requirement](https://open-meteo.com/en/licence)                                                                                                                                                                                                                                                 | Linked "Weather data by Open-Meteo.com" beside the displayed local data                                                                     |
| **Google News RSS**                                                   | Primary locality-matched headlines in the cockpit Regional News page                                                                | [Google News Terms of Service](https://www.google.com/intl/en_us/terms_google_news.html) restrict use to personal, noncommercial use; linked articles remain third-party publisher content and retain publisher terms                                                                                                                                 | "Google News RSS" plus each article's linked publisher/domain                                                                               |
| **GDELT Project DOC 2.0**                                             | Fail-soft fallback for location-matched cockpit headlines                                                                           | [GDELT Terms of Use](https://www.gdeltproject.org/about.html#termsofuse): unrestricted academic/commercial/governmental dataset use, with citation and link required; linked articles retain publisher terms                                                                                                                                          | "GDELT Project" plus each article's linked publisher/domain                                                                                 |
| **City of Austin Open Data**                                          | CCTV camera catalog + frames                                                                                                        | City of Austin Open Data Terms of Use                                                                                                                                                                                                                                                                                                                 | "City of Austin, TX — data.austintexas.gov"                                                                                                 |
| **TxDOT ITS (its.txdot.gov)**                                         | CCTV camera catalogs + frames, Texas districts                                                                                      | Public TxDOT traffic camera data                                                                                                                                                                                                                                                                                                                      | "Texas Department of Transportation" (courtesy)                                                                                             |
| **FL511 (Florida DOT)** | CCTV camera catalog + frames, Florida statewide | FL511 content, individual personal use only; any other use needs FDOT's express written consent ([terms](https://fl511.com/privacy#disclaimer)). **Off by default**; set `CCTV_FLORIDA_ENABLED=1` to enable | "Florida DOT — FL511.com" (courtesy) |
| **City of Tallinn (ristmikud.tallinn.ee)**                            | CCTV camera catalog + frames, Tallinn intersections                                                                                 | Public City of Tallinn traffic camera data                                                                                                                                                                                                                                                                                                            | "City of Tallinn — ristmikud.tallinn.ee" (courtesy)                                                                                         |
| **Transpordiamet / Tarktee**                                          | CCTV camera catalog + frames, Estonia road-weather cameras                                                                          | Public Transpordiamet / Tarktee road camera data                                                                                                                                                                                                                                                                                                      | "Transpordiamet / Tarktee — tarktee.transpordiamet.ee" (courtesy)                                                                           |
| **Stadt Warendorf webcam**                                            | Webcam frames, Marktplatz / Historisches Rathaus (`config/cctv_sources.warendorf.json`)                                             | Public municipal webcam data                                                                                                                                                                                                                                                                                                                          | "Stadt Warendorf — webcam.warendorf.de" (courtesy)      |
| **Live Traffic NSW (Transport for NSW)**                              | CCTV camera catalog + frames, New South Wales                                                                                       | [CC BY 4.0](https://opendata.transport.nsw.gov.au/) — attribution REQUIRED                                                                                                                                                                                                                                                                            | "Live Traffic NSW — Transport for NSW"                                                                                                      |
| **Caltrans (cwwp2.dot.ca.gov)**                                       | CCTV camera catalogs + frames, California districts                                                                                 | Public Caltrans traffic camera data                                                                                                                                                                                                                                                                                                                   | "Caltrans — cwwp2.dot.ca.gov" (courtesy)                                                                                                    |
| **DelDOT (video.deldot.gov)**                                         | CCTV camera catalog (`tmc.deldot.gov/json/videocamera.json`, cached for 15 minutes) + live HTTPS HLS video, Delaware. Keyless        | Public DelDOT traffic camera streams via the [DelDOT traffic map](https://deldot.gov/map/)                                                                                                                                                                                                                                                            | "DelDOT — Delaware Department of Transportation" (courtesy)                                                                                 |
| **TfL Open Data (JamCams)**                                           | CCTV camera catalog + frames, London                                                                                                | [TfL Open Data terms](https://tfl.gov.uk/info-for/open-data-users/) — attribution REQUIRED                                                                                                                                                                                                                                                            | "Powered by TfL Open Data. Contains OS data © Crown copyright and database rights"                                                          |
| **Ontario 511**                                                       | CCTV camera catalog + frames, Ontario highways including Kitchener-area routes                                                      | [Open Government Licence – Ontario](https://www.ontario.ca/page/open-government-licence-ontario)                                                                                                                                                                                                                                                      | "Ontario 511" plus Open Government Licence - Ontario                                                                                        |
| **Fintraffic / Digitraffic (weathercams)**                            | CCTV camera catalog + frames, Finland                                                                                               | [CC BY 4.0](https://www.digitraffic.fi/en/terms-of-service/) — attribution REQUIRED                                                                                                                                                                                                                                                                   | "Fintraffic / digitraffic.fi, license CC BY 4.0"                                                                                            |
| **DriveBC** (Government of British Columbia)                          | CCTV camera catalog + frames, British Columbia highways                                                                             | [Open Government Licence – British Columbia](https://www2.gov.bc.ca/gov/content/data/open-data/open-government-licence-bc) — attribution REQUIRED                                                                                                                                                                                                     | "DriveBC. Contains information licensed under the Open Government Licence – British Columbia"                                               |
| **Open Calgary** (`data.calgary.ca`)                                  | CCTV camera catalog + frames, Calgary                                                                                               | [Open Government Licence – City of Calgary](https://data.calgary.ca/stories/s/Open-Calgary-Terms-of-Use/u45n-7awa) — attribution REQUIRED                                                                                                                                                                                                             | "Contains information licensed under the Open Government Licence – City of Calgary"                                                         |
| **Servei Català de Trànsit** (+ Ajuntament de Barcelona, Ajuntament de Terrassa) | CCTV camera catalog + frames, Catalonia                                                                              | [Llicència oberta d'ús d'informació - Catalunya](https://web.gencat.cat/ca/generalitat/dades-indicadors/dades-obertes/llicencies) — attribution REQUIRED                                                                                                                                                                                             | "Servei Català de Trànsit"; partner-supplied cameras also name their owner                                                                  |
| **Icelandic Road and Coastal Administration (Vegagerðin, IRCA)** | CCTV camera catalog + frames, Iceland road cameras | [CC BY 4.0](https://www.vegagerdin.is/vegagerdin/gagnasafn/vefthjonustur/terms-and-conditions) (IRCA terms of use, Act 45/2018) — attribution REQUIRED; no suggestion of IRCA endorsement; IRCA and State logos are excluded; real-time data is provided as is | "Icelandic Road and Coastal Administration (Vegagerðin)", CC BY 4.0 |
| **King County Road Services** (`services.arcgis.com`, King County GIS) | CCTV camera catalog + frames, unincorporated King County WA road network                                                            | [KCGIS Center terms](https://kingcounty.gov/en/dept/kcit/data-information-services/gis-center/about/terms-conditions-copyrights) — attribution required; public ArcGIS layer                                                                                                                                                                          | "King County Road Services" (partner-city cameras name their owner)                                                                         |
| **WSDOT** (`data.wsdot.wa.gov`)                                       | CCTV camera catalog + frames, Washington State highways                                                                             | [WSDOT travel information disclaimer](https://wsdot.wa.gov/about/policies/travel-information-disclaimer) — public "low volume" feed; catalog cached, frames on WSDOT's own image host only                                                                                                                                                            | "Washington State Department of Transportation (Travel Center)" (courtesy)                                                                  |
| **Hong Kong Transport Department / DATA.GOV.HK**                      | CCTV camera catalog + frames, Hong Kong traffic snapshot cameras                                                                    | [DATA.GOV.HK Terms of Use](https://data.gov.hk/en/terms-and-conditions) — attribution REQUIRED                                                                                                                                                                                                                                                        | "Hong Kong Transport Department / DATA.GOV.HK"                                                                                              |
| **Webcam Romania — Giroc** (`webcamromania.ro`, `w4.webcamromania.ro`) | Optional Giroc camera metadata, JPEG snapshot and live HLS video | [Provider terms](https://webcamromania.ro/termeni-si-conditii/): video belongs to the original camera operator; no open video redistribution licence asserted. The [camera page](https://webcamromania.ro/webcam-orase/webcam-giroc/) offers an embed. Local opt-in via `CCTV_SOURCES_FILE`; media is fetched at runtime, never bundled. | "Webcam Romania · webcamromania.ro"; source link and rights notice in the Data attribution popover |
| **Statens vegvesen** (catalog `ogckart-sn1.atlas.vegvesen.no`, frames `kamera.atlas.vegvesen.no`, HLS `kamera.vegvesen.no`) | CCTV camera catalog + frames + live HLS video, Norway road cameras                                                                                   | [NLOD 2.0](https://data.norge.no/nlod/en/2.0) — attribution REQUIRED | "Contains data under the Norwegian licence for Open Government data (NLOD) distributed by Statens vegvesen" |
| **Kartverket** (`ws.geonorge.no/hoydedata/v1/punkt`)               | Terrain heights (NN2000) used as the ground prior for Statens vegvesen cameras                                                     | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) — attribution REQUIRED | "© Kartverket", modified (heights over water set to 0 m, rounded to 0.1 m) |
| **NYC DOT Traffic Management Center** (`webcams.nyctmc.org`) | CCTV camera catalog + frames, New York City five boroughs | NYC DOT requires developers to sign a [data-sharing agreement](https://www.nyc.gov/html/dot/html/about/datafeeds.shtml) for the camera feed. **Off by default**; enable only under your own agreement | "NYC DOT Traffic Management Center" + NYC DOT's required application disclaimer (in the Data attribution popover) |
| **City of Toronto Open Data** (`opendata.toronto.ca`)                 | CCTV camera catalog + frames, Toronto city streets                                                                                  | [Open Government Licence – Toronto](https://www.toronto.ca/city-government/data-research-maps/open-data/open-data-licence/) — attribution REQUIRED                                                                                                                                                                                                    | "Contains information licensed under the Open Government Licence – Toronto"                                                                 |
| **Houston TranStar** (`traffic.houstontranstar.org`, frames `www.houstontranstar.org`) | CCTV camera catalog + frames, Greater Houston | No licence. The [TranStar disclaimer](https://traffic.houstontranstar.org/disclaimer.aspx) (Content Usage) prohibits copying or distribution, and external framing or linking to specific images, without TxDOT's prior written permission. **Off by default**; enable only if you hold TxDOT's written permission | "Houston TranStar" (courtesy) |
| **FAA WeatherCams** | Airport / mountain-pass weather camera catalog + stills (CCTV pack) | Public FAA aviation camera imagery; catalog currently requires credentials (401 without a key). Optional `FAA_WEATHERCAMS_API_KEY`. `CCTV_FAA_ENABLED=0` disables the pack | "FAA WeatherCams — weathercams.faa.gov" |
| **NOAA Aviation Weather Center** | International SIGMET polygons | U.S. government public weather data via aviationweather.gov. Keyless. Browser uses same-origin `/api/aviation/isigmet` | "NOAA / Aviation Weather Center — aviationweather.gov" |
| **Cape May Dispatch (GEV) / Fire Wire** | Regional tides, flood gauges, NWS alerts, outages, cameras, CAD, scanner radio metadata + chunk audio, wind, buoys, webcams, local TFRs, airport METARs, board/news | God's Eye View is the Cape Dispatch UI. Allowlisted GETs through `/api/cape/*` hit an **in-app quiet store** (empty-tolerant `quiet` / waiting on SDR). Optional legacy `FIREWIRE_URL` may override to an external API; unset never returns `firewire_unconfigured`. AIS and admin routes are blocked. Camera pins open the CCTV panel; scanner/CAD audio opens the RADIO panel. The `cape` CCTV pack always seeds public ferry cams. `CCTV_CAPE_ENABLED=0` disables the pack. Broadcastify is not an upstream. Managers is ungated in-app | "Cape May Dispatch" / "Fire Wire" |
| **Autostrada del Brennero (A22)** (catalog `tourism.api.opendatahub.com`, frames `www.autobrennero.it/WebCamImg/`) | CCTV camera catalog + frames, A22 Brenner–Modena motorway, Italy | Public Autobrennero webcam images; camera list republished by the Open Data Hub, whose records are tagged CC0 (`ClosedData: false`, licence holder Autobrennero); Autobrennero publishes no terms of its own for the images | "Webcam images © Autostrada del Brennero S.p.A., via the Open Data Hub (NOI Techpark)" (courtesy) |
| **GBFS (Lyft / BCycle / Social Bicycles / PBSC)**                     | Bikeshare availability                                                                                                              | Per-feed (attribution-only)                                                                                                                                                                                                                                                                                                                           | Credit the operator (e.g. Austin BCycle) + its `license_url`                                                                                                   |
| **Bike Share Toronto** (`toronto.publicbikesystem.net`) | Bikeshare station availability, Toronto | Operator GBFS feed. No licence is published: the City's open-data package declares none and the feed has no `license_url`. Attribution is given to the operator. | "Bike Share Toronto (Toronto Parking Authority)" |
| **Bike Itaú / Tembici** (`*.publicbikesystem.net`, seven Brazilian cities, Santiago and Bogotá) | Bikeshare station availability: São Paulo, Rio de Janeiro, Salvador, Recife, Porto Alegre, Brasília, Curitiba, Santiago de Chile and Bogotá | Operator GBFS feeds. No licence is published: the feeds' `system_information.json` carries no `license_url`, operator or attribution fields. Attribution is given to the operator. | "Bike Itaú (Tembici)"; "Tembici Bogotá" |
| **Bicing** (`barcelona.publicbikesystem.net`) | Bikeshare station availability, Barcelona | Operator GBFS feed (PBSC), keyless. The feed publishes no licence; the City's own open-data copy of the same station data is CC BY 4.0 but needs a token. Attribution is given to the operator. | "Bicing, Barcelona City Council (B:SM)" |
| **BiciMAD** (`madrid.publicbikesystem.net`) | Bikeshare station availability, Madrid | Operator GBFS feed (PBSC), keyless. Madrid's open-data catalogue publishes this feed (`datos.madrid.es`, dataset `900021-0-bicimad-gbfs`, owner EMT Madrid) under [EMT's open-data terms](https://mobilitylabs.emtmadrid.es/sip/terms-of-use): commercial and non-commercial reuse, with attribution REQUIRED (section 5.2). | "Powered by EMT de Madrid", linking to `https://www.emtmadrid.es` |
| **Spanish city bikes on PBSC** (`*.publicbikesystem.net`: Zaragoza, Valladolid, A Coruña, Donostia-San Sebastián, Bilbao, Rivas-Vaciamadrid) | Bikeshare station availability: Bizi Zaragoza, BIKI, BiciCoruña, Dbizi, Bilbao Bizi, BicinRivas | Operator GBFS feeds, keyless. The feeds' `system_information.json` carries no `license_url`, and no operator or city publishes a licence for them; MobilityData's catalogue lists CC BY 4.0 without naming a source. Attribution is given to the operator. | "Bizi Zaragoza"; "BIKI, AUVASA (Valladolid)"; "BiciCoruña"; "Dbizi (Donostia-San Sebastián)"; "Bilbao Bizi, Bilbao City Council"; "BicinRivas, Rivas-Vaciamadrid City Council" |
| **AMBici** (nextbike, `gbfs.nextbike.net`) | Bikeshare station availability, Barcelona metropolitan area (e-bikes) | Operator GBFS feed, keyless. `system_information.license_id` is **CC0-1.0**; no attribution required, given anyway. | "AMBici, Àrea Metropolitana de Barcelona, operated by nextbike" |
| **Oslo / Bergen / Trondheim Bysykkel** (Urban Sharing, `gbfs.urbansharing.com`) | Bikeshare availability, Oslo, Bergen and Trondheim city bikes. Keyless GBFS; the proxy sends the `Client-Identifier` header the operators ask for | [NLOD 2.0](https://data.norge.no/nlod/en/2.0) — attribution REQUIRED ([Oslo](https://oslobysykkel.no/en/open-data/realtime), [Bergen](https://bergenbysykkel.no/en/apne-data/sanntid), [Trondheim](https://trondheimbysykkel.no/en/open-data/realtime)) | "Contains data under the Norwegian licence for Open Government data (NLOD) made available by Oslo Bysykkel, Bergen Bysykkel and Trondheim Bysykkel" |
| **Kolumbus / Farte Bysykkel** (Entur Mobility, `api.entur.io/mobility/v2/gbfs`) | Bikeshare availability, Kolumbus Bysykkel (Stavanger/Nord-Jæren) and Farte Bysykkel (Skien/Porsgrunn). Keyless GBFS; the proxy sends the `ET-Client-Name` header Entur requires and is limited to Entur's GBFS paths | [NLOD](https://data.norge.no/nlod/en/2.0) per the [Entur Mobility API docs](https://developer.entur.org/pages-mobility-docs-mobility-v2) — attribution REQUIRED | "Contains data under the Norwegian licence for Open Government data (NLOD) made available by Entur (Kolumbus Bysykkel, Farte Bysykkel)" |
| **JCDecaux Cyclocity** (`api.cyclocity.fr`) | Bikeshare availability: Bysykkel Lillestrøm, Valenbisi (Valencia) and Sevici (Seville). Keyless GBFS; the proxy is limited to JCDecaux contract paths | [Licence Ouverte / Etalab](https://developer.jcdecaux.com/files/Open-Licence-fr.pdf) (each feed's `license_url`) — attribution REQUIRED | "Bysykkel Lillestrøm, Valenbisi, Sevici: JCDecaux, Licence Ouverte" |
| **MBTA / MassDOT** (cdn.mbta.com) | Transit layer live vehicles and up to 15 minutes of recently observed positions, Greater Boston | MBTA / MassDOT open realtime vehicle data, used for the live view and up to fifteen minutes of recently observed positions; published for developer use and not against their use. | Attribution to MBTA / MassDOT (courtesy text) |
| **CapMetro** (data.texas.gov) | Transit layer live vehicles, Austin TX | CapMetro open realtime vehicle data, used for the live view; published for developer use and not against their use. | Attribution to CapMetro (courtesy text) |
| **Metro Transit** (Metropolitan Council) | Transit layer live vehicles, Minneapolis–St Paul | Metro Transit / Metropolitan Council open realtime vehicle data, used for the live view; published for developer use and not against their use. | Attribution to Metro Transit / Metropolitan Council (courtesy text) |
| **OVapi / Stichting OpenGeo** | Transit layer live vehicles, Netherlands | OVapi / Stichting OpenGeo open realtime vehicle data, used for the live view; published for developer use and not against their use. The client sends a User-Agent and conditional requests. | Attribution to OVapi / Stichting OpenGeo (courtesy text) |
| **Entur** (api.entur.io) | Transit layer live vehicles, Norway | Entur open realtime vehicle data, used for the live view; published for developer use and not against their use. The client sends the `ET-Client-Name` identifying header. | Attribution to Entur (courtesy text) |
| **TransLink** (Queensland Government) | Transit layer live vehicles, South East Queensland | TransLink / Queensland Government open realtime vehicle data, used for the live view; published for developer use and not against their use. | Attribution to TransLink / Queensland Government (courtesy text) |
| **HSL** (realtime.hsl.fi) | Transit layer live vehicles, Helsinki | HSL (Helsinki Region Transport) open realtime vehicle data, used for the live view; published for developer use and not against their use. | Attribution to HSL (Helsinki Region Transport) (courtesy text) |
| **TTC** (bustime.ttc.ca) | Transit layer live vehicles, Toronto — surface vehicles (buses and streetcars) only | Toronto Transit Commission BusTime open realtime vehicle data, published through City of Toronto Open Data and used for the live view. The subway publishes no vehicle positions, so Lines 1/2/4 are absent rather than inferred. | Attribution to Toronto Transit Commission — City of Toronto Open Data, under the Open Government Licence – Toronto |
| **MiWay** (miapp.ca) | Transit layer live vehicles, Mississauga ON | MiWay open realtime vehicle data, published by the City of Mississauga under its Open Data Terms of Use, used for the live view. The licence is revocable and asks that the Terms of Use link travel with the data. | Attribution to MiWay — City of Mississauga Open Data, linked to the Terms of Use |
| **Hamilton HSR** (opendata.hamilton.ca) | Transit layer live vehicles, Hamilton ON | Hamilton Street Railway open realtime vehicle data, published by the City of Hamilton for commercial and non-commercial use. Not one of its 80 route ids is the number on the bus, so the route-number table in `src/data/transitFeeds.js` is derived from the City’s own published GTFS `routes.txt` under the same licence; two generations of id run at once and both are listed. | "Contains public sector Data made available under the City of Hamilton’s Open Data Licence" — wording prescribed by the licence |
| **Durham Region Transit** (drtonline.durhamregiontransit.com) | Transit layer live vehicles, Durham Region ON | Durham Region Transit open realtime vehicle data, published under the Region of Durham Open Data Licence v.1.0, which permits commercial use. | "Contains public sector information made available under The Regional Municipality of Durham's Open Data Licence" |
| **Guelph Transit** (glphtrpcloud.com) | Transit layer live vehicles, Guelph ON | Guelph Transit open realtime vehicle data, published by the City of Guelph on its open-data developer page and used for the live view. Its route ids are internal database keys, so the 33-row route-number table in `src/data/transitFeeds.js` is derived from the City’s own published GTFS `routes.txt` under the same licence. | "Contains information licensed under the Open Government Licence – City of Guelph" — wording prescribed by the licence |
| **Kingston Transit** (api.cityofkingston.ca) | Transit layer live vehicles, Kingston ON | Kingston Transit open realtime vehicle data, catalogued by the City of Kingston as open data and used for the live view. | "Contains information licensed under the Open Data Licence – City of Kingston" — wording prescribed by the licence |
| **Barrie Transit** (myridebarrie.ca) | Transit layer live vehicles, Barrie ON | Barrie Transit realtime data, published by the City of Barrie under a licence accepted by use of the data. The licence is revocable and requires no attribution. | Courtesy credit to the City of Barrie (the licence requires none, and its trademark clause is broad) |
| **YRT/Viva** (rtu.york.ca) | Transit layer live vehicles, York Region ON | York Region Transit realtime data, first-party York Region infrastructure under the YRT Open Data Licence v2.0, which permits commercial use and makes attribution optional. Viva route ids are named by colour from York Region’s published GTFS. | "Contains public transit Information made available under YRT’s Open Data Licence" — the licence’s own wording, given though not required |
| **Burlington Transit** (opendata.burlington.ca) | Transit layer live vehicles, Burlington ON | Burlington Transit realtime data under the City of Burlington Open Data Terms of Use, which permit any lawful purpose. The terms are revocable and must travel with the data, so the credit links them. Route ids are internal keys and are joined to the City’s published GTFS. | Credit to the City of Burlington plus a link to its Open Data Terms of Use, which the licence requires |
| **SMTR Rio de Janeiro** (dados.mobilidade.rio) | Transit layer live vehicles, Rio de Janeiro: municipal buses (SPPO) and the Mobi-Rio BRT, as two feeds | CC BY 4.0, stated on both data.rio catalog pages. Keyless GTFS-Realtime published by the Secretaria Municipal de Transportes, labelled beta, with a gateway limit of 5 requests a second and 60 a minute. Line names come from SMTR’s GTFS `routes.txt` (dados.mobilidade.rio/gtfs/schedule), under the same licence. | Attribution to SMTR / Prefeitura da Cidade do Rio de Janeiro under CC BY 4.0 |
| **Radio Browser**                                                     | Geolocated internet-radio station directory and station-level tags                                                                  | Public-domain directory data under PDDL 1.0; individual broadcaster stream terms apply                                                                                                                                                                                                                                                                | "Radio Browser" plus a link to the selected broadcaster                                                                                     |
| **Re:Earth Terrain** (Mapterhorn)                                     | Terrain (keyless globe stacks — OSM etc. — + `/api/terrain/heights` ellipsoidal-height lookups)                                     | Terrain mesh: CC BY 4.0; geoid: EGM2008 (NGA, public domain)                                                                                                                                                                                                                                                                                          | "Terrain (keyless globe stacks): Re:Earth Terrain / Mapterhorn (CC BY 4.0) / EGM2008 (NGA)"                                                 |
| **OpenSeaMap** (`tiles.openseamap.org`) | Sea Marks layer: raster overlay of buoys, lighthouses and ports (#10) | Chart tiles CC BY-SA 2.0; data ODbL 1.0 via OpenStreetMap | "Sea marks © OpenSeaMap contributors (CC BY-SA 2.0) · Data © OpenStreetMap contributors (ODbL)" |
| **OpenSnowMap** (`www.opensnowmap.org`) | Ski Pistes layer: raster overlay of ski runs and lifts (#10) | Tiles CC BY-SA; data ODbL 1.0 via OpenStreetMap; bulk tile download forbidden without prior agreement | "Ski pistes © www.opensnowmap.org (CC BY-SA) · Data © OpenStreetMap contributors (ODbL)" |
| **OSRM on the FOSSGIS routing servers** (`routing.openstreetmap.de`) | Street-following routes for the Directions layer and voice route annotations, via `/api/route` | [FOSSGIS routing usage policy](https://routing.openstreetmap.de/about.html): "Display the required attribution and display a link to 'fix the map'", "Use a valid user agent and, if applicable, a correct referrer", "One request per second max", "No scraping, no heavy usage". The full policy is the German [FOSSGIS Nutzungsbedingungen](https://www.fossgis.de/arbeitsgruppen/osm-server/nutzungsbedingungen/); FOSSGIS also states that the server may be embedded in your own pages but "eine gewerbliche Nutzung ist nur mit Einschränkungen erlaubt" (commercial use only with restrictions). Route data derives from OpenStreetMap (ODbL 1.0) | "Routing: OSRM on the FOSSGIS servers" + a "fix the map" link — shown in the Data attribution popover |

### Fire Wire scanner ingest (separate program)

Fire Wire is **not** part of the GEV browser UI and **not** the retired Cape Dispatch website. It is the station-side service that owns:

1. **SDR station capture** (future — Broadcastify is out; county public-safety channels on local SDRs you attach to Fire Wire).
2. Segment talkgroups / transmissions into audio chunks (`radio/live|seek|buffer`, `/audio` / `/fw-audio`).
3. Transcribe and classify → CAD incidents / calls / units (`cad/*`).
4. Health / board signals the Cape strip reads (`board`, radio chips).

GEV serves `/api/cape/*` from an in-app quiet store (optional legacy `FIREWIRE_URL` override). Clicking a Cape radio pin or CAD clip with `audio_url` opens the right-hand RADIO panel and plays the same-origin rewritten clip. Empty feeds while SDRs are absent are healthy (`quiet` / waiting on SDR), not a hard failure.

GEV’s browser Local RTL-SDR (broadcast FM + ADS-B WebUSB below) is a separate hobbyist feature and is **not** the Fire Wire public-safety ingest path.

### Local receiver input (not fetched from a service)

The optional Local ADS-B layer and the broadcast-FM receiver use radio you receive yourself: a USB RTL-SDR opened in the browser through WebUSB, or the `aircraft.json` of a decoder you run on your own machine or network (`LOCAL_RECEIVER_FEEDS`). Radio samples, audio and the optional receiver location stay in the browser. Decoder feeds are read by your local GEV server and relayed only to your browser, with about a second of in-memory caching. When you select a local aircraft, its ICAO address (and an airline-style callsign) is looked up, and aircraft that qualify for a 3D model are looked up by ICAO address, through the same adsbdb proxy the public flight layers use; your server caches those answers on disk and treats them as fresh for 24 hours. Received radio data is not stored or redistributed. ADS-B is an unauthenticated public broadcast and may be incomplete, delayed, spoofed or decoded in error; it is not suitable for navigation or operational use.

### Notes on the live sources

- **Air quality (ECCC AQHI).** Keyless. Read from the MSC GeoMet OGC API (`api.weather.gc.ca`): the `aqhi-stations` catalog plus `aqhi-observations-realtime`. **Coverage is Canada only** — ECCC is the single registered provider, and the layer row and readout card both say so. Roughly 134 stations across ECCC's five administrative zones (Atlantic, Quebec, Ontario, Prairies & North, Pacific & Yukon). AQHI publishes hourly, so readings poll every 20 minutes and the station catalog, which changes a few times a year, is refetched only every 12 hours. Observations are requested with `latest=true`; without it the collection returns the full history, roughly 2,000 rows nationally. Readings older than six hours are dropped rather than displayed as current.

  Readings are stored as `{ provider, scale, value, band }` rather than a bare number, because air-quality indices are not interchangeable: AQHI runs 1-10+ on health risk, the US AQI runs 0-500 on concentration breakpoints, and Europe's EAQI is a five-step category. Naming the index a value belongs to is what lets another network be added later without inventing a shared numeric meaning that does not exist.

  AQHI is reported by ECCC as an integer from 1 to 10 with an open-ended "10+" above that. The API returns the underlying decimal (1.08, 2.32); the layer rounds to the published form rather than displaying a precision the index does not claim.

  **Quebec is thinly represented**, and that is upstream rather than a filter here: the province runs its own Info-Smog program, so only a handful of Quebec stations appear in ECCC's national feed. The reporting station count also varies hour to hour as stations report or fall silent.

- **Via Lietuva / Eismoinfo (Lithuania).** Public road-camera catalogs and periodically updated still images from [Eismoinfo](https://eismoinfo.lt/), credited to Via Lietuva / eismoinfo.lt in the app. **Off by default.** The camera endpoints are the eismoinfo.lt website backend and are not among the services listed in Via Lietuva's [open-data statement](https://eismoinfo.lt/eismoinfo-backend/content?id=44), whose conditions are attribution and reuse on the same terms. Until the statement is confirmed to cover the camera photos, the pack loads only when an operator sets `CCTV_LITHUANIA_ENABLED=1`; with the flag unset, empty or any other value, the server makes no request to Eismoinfo. `eismoinfo-backend/camera-info-table` is joined by ID to `layer-static-features/VKR`. Without `lks=true`, the latter returns WGS84 `[latitude, longitude]`; the table's `x/y` instead use LKS-94 metres. Only the official HTTPS `/eismoinfo-backend/image-provider/camera/last?id=…` image endpoint is registered. Catalogs use the shared 15-minute cache; frames are fetched on demand and never bundled or archived. These are periodic snapshots, not continuous video. Camera headings are low-confidence estimates. No API key is required. `CCTV_LITHUANIA_MAX_SOURCES` defaults to 400.
- **Freeway Bureau and Highway Bureau, MOTC (Taiwan).** National freeway cameras use the Freeway Bureau’s keyless [MOTC 2.0 CCTV table](https://tisvcloud.freeway.gov.tw/history/motc20/CCTV.xml), refreshed daily and fetched at runtime (never bundled). Freeway Bureau data follows the [Open Government Data License, Taiwan v1.0](https://data.gov.tw/license); the app credits the Bureau, names the dataset and links the licence. If that catalog is unreachable and no last-good source list exists, the app falls back to the Highway Bureau’s free [provincial-road CCTV XML feed](https://thbapp.thb.gov.tw/opendata/), with attribution as requested by the Bureau. Its MJPEG streams are accepted only from cctv-ss01 through cctv-ss08.thb.gov.tw over HTTPS; the frame proxy extracts one bounded JPEG per request. This fallback covers provincial roads, not national freeways. Neither feed requires an API key. CCTV_TAIWAN_ENABLED=0 disables both; CCTV_TAIWAN_MAX_SOURCES defaults to 600 (bounded to 1–2000).
- **Québec CCTV (MTQ / Québec 511, Montréal and scenic links).** `public/quebec-cameras.json` contains 680 MTQ positions from the official georeferenced WFS (CC BY 4.0), 426 Montréal camera locations derived from OSM (ODbL 1.0), and 14 scenic records with per-row provenance and accuracy. The MTQ video is **opt-in** (`CCTV_QUEBEC_VIDEO_ENABLED=1`): the CC BY 4.0 licence covers the camera locations only, and Québec 511's terms for embedding its clips on another site are unconfirmed, so by default MTQ cameras link to the Québec 511 viewer page instead. With the flag set, the 680 MTQ cameras play the operator's five-second MP4 clip directly in the viewer's browser from `www.quebec511.info/Carte/Fenetres/camera.ashx?id=<id>&format=mp4`, only after the viewer presses Play, so Québec 511 sees the viewer's IP address; Québec 511 refreshes those clips every few minutes. A second browser request supplies an approximate map still. The app does not proxy, store, or read video pixels, and no camera images are bundled. The selected-camera credit names both sources: locations MTQ under CC BY 4.0, video Québec 511. Montréal and scenic entries have provider-page links rather than direct frame URLs; their source-page terms apply. The video remains hosted by Québec 511 under its service terms. No API key is required; `CCTV_QUEBEC_ENABLED=0` disables the pack. Confirm Québec 511's terms of use before setting `CCTV_QUEBEC_VIDEO_ENABLED=1` on a public deployment.

- **Google Maps Platform.** You supply your own API key and are bound by [Google's ToS](https://cloud.google.com/maps-platform/terms). Google Maps Content (tiles, geocodes, places) **may not be cached, stored, rehosted, or committed** — this app only ever uses it live, which is the compliant pattern. The "Google" attribution is displayed on the globe and must stay visible. Restrict your key (see [SECURITY.md](SECURITY.md)).
- **Sea Marks and Ski Pistes (#10).** Two keyless raster overlay layers under Infrastructure, OpenSeaMap sea marks and OpenSnowMap ski pistes, requested tile by tile as the camera views them, with no prefetch, bulk download or caching on our side (OpenSnowMap forbids bulk tile download without prior agreement). They drape on the globe on the OSM and Bing stacks and on the Google Photorealistic tileset on Google 3D (see `src/maps/imageryHost.js`). OpenRailwayMap and OpenInfraMap, also requested in #10, are not included: OpenRailwayMap's tile server only answers requests whose Referer is its own site, and OpenInfraMap serves vector tiles that need a vector rendering pipeline.
- **OpenSky Network.** Its license is **non-commercial**, and operational use of the REST API in a live product can require a prior written agreement with OpenSky — even for non-profit/government use. If you deploy this commercially, contact OpenSky for your own terms. The flights layer is a toggle and runs anonymously by default.
- **adsb.lol flight fallback.** When OpenSky is unavailable and no last-good OpenSky response exists, the server requests a cached, capped 250 nm adsb.lol point snapshot around the current camera subpoint. This is regional observed context, not worldwide completeness; provenance is exposed in the Flights stats/context row. Military ICAOs remain reconciled through the existing dedicated military registry rather than duplicated.
<a id="gnss-integrity"></a>

- **GNSS integrity (adsb.lol).** A separate keyless point request samples a 250 nm
  circle around the screen centre, snapped once to whole degrees. This does not
  reuse the Flights fallback cache. Cache lifetime is 60 s; 429 backoff is capped
  at one hour and other upstream failures cool down for 15 s. Future access may
  require feeder keys under the [API terms](https://github.com/adsblol/api).
  Airborne decoded ADS-B v1/v2 aircraft with a known 0–60 s position age qualify,
  including MLAT-positioned aircraft still broadcasting their own quality.
  TIS-B/MLAT-derived NIC and NACp are ignored. GPS-loss evidence uses
  `gpsOkLat/gpsOkLon` when present, otherwise the current known position.
  The proxy strips identity metadata and tags its response with classifier
  `gev-nic-nacp-v2`; rows carry only integrity facts.

  The method has three separately attributed parts:
  1. **GEV classifier (unvalidated):** GPS-loss flag, aircraft-reported NACp < 8,
     or aircraft-reported NIC < 7 except NIC 0 with NACp ≥ 10 (unknown containment).
     The numerical minima come from US 14 CFR 91.227(c), not a published jamming
     classifier. Readsb's [JSON contract](https://github.com/wiedehopf/readsb/blob/dev/README-json.md)
     describes the quality field origins and GPS-loss flag.
  2. **GPSJAM aggregation:** score = `100 × max(0, bad − 1) / total`, with percent
     bands < 2, 2–10, > 10. One bad aircraft is discounted. This is not the raw
     share of bad aircraft. See the [GPSJAM FAQ](https://gpsjam.org/faq).
  3. **GEV window:** 30 minutes over visited views, at least three aircraft per
     0.5° cell. These bands were developed for daily totals; with fewer than ten
     observations a cell can skip the middle band. Source timestamps date evidence
     even through cache replays, and degraded evidence expires independently.

  Medium/high cells report navigation-integrity anomalies. Interference is one
  possible explanation, not a detected or located emitter. Avionics faults and
  manoeuvring military trainers can also lower reported accuracy. Blank areas
  can be outside coverage or lack enough observations. Attribution: adsb.lol
  contributors, ODbL 1.0; GPSJAM for aggregation only.

- **GPSJam daily (gpsjam.org).** The published 24-hour aggregate, fetched
  live at runtime through the same-origin `/api/gpsjam` proxy (gpsjam.org
  sends no CORS headers, verified 2026-11-16). One CSV per UTC day
  (`YYYY-MM-DD-h3_4.csv`, ~48k rows / ~1 MB for 2026-11-15); the proxy
  tries yesterday-UTC and falls back to the prior day on 404 (a day that
  is not published yet 404s), reads the manifest for the day's `suspect`
  flag and `source` column (`adsbexchange` through 2026-08-26, `merged`
  from 2026-08-27 — data from airplanes.live + ADS-B Exchange, deduped
  per aircraft), filters server-side to the county box (lat 38.9–39.35,
  lon −75.15–−74.55) plus a 0.5° margin by H3 cell centroid, and ships
  each surviving cell's centroid + 6 boundary vertices (h3-js,
  server-side only) — the browser never sees the world file. Live check
  2026-11-16: 13 cells at +0.5° margin, all low, 0 bad aircraft in the
  county hexes (e.g. CMCH hex `842aad9ffffffff`, 726 good / 0 bad).
  Levels use the same gpsjam.org formula and bands as the live layer
  (score `100 × max(0, bad − 1) / total`, < 2 / 2–10 / > 10, cells with
  fewer than 3 aircraft dropped), re-derived client-side from the counts.
  Green cells are drawn: with 13 cells there is no clutter, and hiding
  them would confuse "all clear" with "no data". The layer is a daily
  aggregate, not live — the info row leads with the UTC data date — and
  a suspect day is flagged in the panel. The proxy caches 6 hours
  (memory + disk) with single-flight refresh and serve-stale-on-failure.
  Licence: gpsjam.org's own pages state NO licence (FAQ, About and home
  checked live 2026-11-16); downstream users assert CC-BY 4.0, but that
  is NOT claimed here — the credit is "Data: gpsjam.org (John Wiseman /
  ADS-B Exchange)" with no licence label. Do not add a CC-BY claim
  without verifying it from a primary source.

- **VDL2 datalink messages (airframes.io).** Categorized VDL2 messages
  heard by the PhillyRox-VDLM feeder at Philadelphia (KPHL, station id
  237335008), fetched live at runtime through the same-origin `/api/vdl2`
  proxy. One refresh is 12 requests: a baseline station query
  (`station_ids=237335008&timeframe=last-hour&limit=100`) plus one query
  per incident keyword (11, same as the Cape Dispatch ACARS watcher),
  sequential, against the shared anonymous budget of 60 req/min — no key.
  A direct browser fetch works (CORS reflects any Origin, verified
  2026-11-16), but an unfiltered last-hour fetch returns only the newest
  100 messages *globally* (~2M/day), so the proxy does the fan-out once,
  server-side. VDL2 and ACARS share the endpoint and the 31-key record
  shape with no type field; they are distinguished only by `sourceType`
  (`"vdl"` vs `"acars"`) — the `sourceType=vdl` query param is ignored
  by the API (verified live: 87 vdl / 8 acars / 5 aero-acars in 100 rows),
  so filtering is server-side on `sourceType`. Live check 2026-11-16:
  the station query hit the 100-row limit (≥100 msgs/hr), 23% label-None
  / text-null, 15% with no label, text, flight, or tail, 0 of 100 with a
  message-level position (position comes only from the nested flight fix,
  and only when it falls over local airspace — one live message's flight
  fix was 41.06, −104.46, Colorado, i.e. stale). Categories, exclusions,
  and scope are ported from the ACARS watcher: the seven critical
  categories alert nationwide, the rest stay local-only. Guardrail: only
  the category is shown — the raw message text never leaves the proxy.
  Honest limitation: messages with no label, text, or data are counted
  as "undecoded frames" (almost certainly CPDLC/ADS-C AVLC payloads the
  public API does not decode — `decodings: []` on the detail endpoint
  too, verified live); they are NOT presented as a CPDLC feed. The
  PhillyRox feeder is flagged by airframes.io for a rate anomaly
  (verified live 2026-11-16), so coverage may be interrupted; the flag
  is surfaced in the panel. Correction: the watcher's docstring names a
  "Trenton" VDL2 station `RK-KBOS_TRENTON-VDL2`; that station is actually
  in New Hampshire (43.12, −71.77), NOT Trenton — it is not queried. The
  proxy caches 5 minutes (memory + disk) with single-flight refresh and
  serve-stale-on-failure. Credit: "VDL2 datalink messages: airframes.io".
  Licence: airframes.io publishes no licence for the public message feed
  that was found — no licence claim is made here.


- **adsbdb enrichment.** `/api/adsbdb` resolves an ICAO hex to aircraft type, model name and registration, and the tracked flight's callsign to an airline and an origin/destination pair. Fan-out is deliberately small because adsbdb is a free community API that publishes no quota: at most 4 requests in flight, dispatches dripped to roughly 5/s, and each key asked for at most once per session, with route lookups reserved for the tracked aircraft. The dev-server proxy caches each key for 24 hours in `.gev-cache/adsbdb.json`, negative answers included, so fresh entries survive server restarts. That gitignored cache remains local to the deployment and is not bundled with this repo. adsbdb publishes no general service license; its README says the route data may not be copied, published, or incorporated into other databases without the explicit permission of David J Taylor, Edinburgh. Deployers are responsible for obtaining any permission their use requires. Enrichment is best-effort and fail-silent — a flight that gets no answer keeps what the flight feed already gave it.
- **Launch Library 2.** `/api/launches` makes a server-side rolling-30-day query against the supported v2.3 detailed launch endpoint, caches successful responses for 15 minutes in memory and on disk, and serves the last successful response during a throttle or transient outage. Anonymous access is limited to 15 calls/hour; deployments can provide `LL2_API_TOKEN` for authenticated access. The Space Devs' published terms permit using and sharing the API data in any form, ask users not to forward it without adding value, disclaim complete accuracy, and encourage—but do not require—attribution. This app keeps a courtesy credit. Payload and stage/recovery records are shown only when supplied. Failed launches expose their source status and never receive fallback orbit geometry or a live/estimated marker. LL2 supplies launch context and event timing, not continuous ascent telemetry or live orbital state.
- **TfL JamCams.** The camera list comes from the keyless `api.tfl.gov.uk` endpoint (an optional `TFL_APP_KEY` raises its rate limit); frames come from TfL's public S3 bucket. The "Powered by TfL Open Data" attribution is required by TfL's terms and is registered in the Data attribution popover.
- **Ontario 511 CCTV.** The camera list comes from the `511on.ca/api/v2/get/cameras` endpoint, which now requires a free developer key (`ONTARIO_511_API_KEY`: sign up at 511on.ca/my511/register, then request it while logged in at 511on.ca/developers/doc; throttled to 10 calls a minute). Without the key the pack is skipped. Frames are server-registered still images under `511on.ca/map/Cctv/`. The source is live-fetched at runtime and attributed under the Open Government Licence - Ontario. Access is governed by Ontario 511's Developer's Access Agreement (511on.ca/developers/resources): the data stays under the Open Government Licence - Ontario unless otherwise specified; key requests are reviewed case by case and ask for the intended use and any third parties that will receive the data; attribution by link to 511on.ca is encouraged, and the Ontario 511 logo may not be altered or used to imply endorsement (this app links and shows no logo); and the data is provided "as is", a disclaimer distributors should pass on, which the credit does.
- **DelDOT live video cameras.** The keyless `tmc.deldot.gov/json/videocamera.json` catalog supplies active cameras and official `https://video.deldot.gov/live/…/playlist.m3u8` links. The local server transiently buffers bounded MPEG-TS segments in memory and deletes them on session release or idle expiry. No recordings are retained. `CCTV_DELDOT_ENABLED=0` disables the pack. Public availability is not a blanket redistribution license; deployment beyond personal local viewing needs confirmation of applicable DelDOT terms.
- **Fintraffic weathercams.** The camera list is one keyless GeoJSON request to `tie.digitraffic.fi/api/weathercam/v1/stations` (809 stations / 2,275 presets), sent with the `Digitraffic-User: gods-eye-view` header the service asks clients to identify themselves with and with gzip; frames are stills on `weathercam.digitraffic.fi`, refreshed on each station's 600 s collection interval, which is also the client's ambient-still refresh cadence for this pack (the active camera keeps the usual 10-second refresh). One preset (a fixed camera view) is one camera; stations not `GATHERING` and presets not `inCollection` are dropped. Attribution is required by the CC BY 4.0 licence and is registered in the Data attribution popover. `CCTV_FINTRAFFIC_ENABLED=0` is the kill switch.
- **DriveBC highway cameras.** The camera list comes from the keyless `https://www.drivebc.ca/api/webcams/` endpoint served by the DriveBC.ca site ([bcgov/DriveBC.ca](https://github.com/bcgov/DriveBC.ca)); frames come from `https://www.drivebc.ca/images/<id>.jpg`, built from the numeric camera id. DataBC's [DriveBC HighwayCams](https://catalogue.data.gov.bc.ca/dataset/bc-highwaycams) catalogue entry publishes the same cameras under the Open Government Licence – British Columbia, but its CSV still lists the retired `images.drivebc.ca` frame URLs, which now return a placeholder. The licence's attribution statement is required and is registered in the Data attribution popover. By default the 250 cameras nearest Vancouver and Victoria load; `CCTV_DRIVEBC_MAX_SOURCES` changes the cap and `CCTV_DRIVEBC_ENABLED=0` turns the pack off. Some cameras in the feed are supplied by partners (TransLink, the City of Vancouver, the City of Surrey, Parks Canada / Alberta Motor Association and others); the feed's per-camera credit is carried onto the camera record and shown beside the provider in the CCTV panel.
- **City of Ottawa traffic cameras.** Camera images come from the city's [Traffic Camera Images API](https://traffic.ottawa.ca/en/traffic-map-data-lists-and-resources/about-the-data), which requires an access certificate requested through the city's registration form and allows one certificate and user id to fetch a camera at most once every 60 seconds. Set `OTTAWA_CAMERA_CERTIFICATE`; without it the pack is skipped and makes no request. The camera list is the documented keyless `traffic.ottawa.ca/map/service/camera` JSON (camera number, English and French names, coordinates, owner). Frames are `traffic.ottawa.ca/opendata/camera?c=<number>`; the server adds the certificate and the user id `gev` at fetch time, so no catalog response carries the key, and serves each camera from one shared in-memory frame per minute. MTO cameras carried on the city feed keep their owner as a per-camera credit. The feed publishes no bearing, so headings use the shared id-hash fallback at low confidence, and no status field, so a camera the city takes offline still registers. Frames are never stored on disk. The city states no redistribution licence for the images; the certificate request asks how they will be used, so describe the deployment there. `CCTV_OTTAWA_MAX_SOURCES` caps the pack (default 250, nearest downtown) and `CCTV_OTTAWA_ENABLED=0` turns it off.
- **World cams image subset.** The normal CCTV catalog adds 1,176 Oregon TripCheck stills and 1,054 MLIT river cameras from the curated `config/cctv_sources.world-image-cameras.json` export; disable it with `CCTV_WORLD_CAMERAS_ENABLED=0`. The export's Vegagerðin rows are left out because the Iceland pack already loads those cameras. The server validates and pins each image URL to its provider path, fetches a frame only when a camera is viewed, and never stores or redistributes it. [ODOT allows businesses, private citizens and organizations to use TripCheck images and asks for credit](https://www.tripcheck.com/Pages/Frequently-Asked-Questions) ("Camera courtesy of ODOT"); TripCheck also carries partner cameras run by Oregon counties and cities, Caltrans and WSDOT, which keep their owner's name in the camera label. MLIT's [site terms](https://www.river.go.jp/kawabou/kwb_apend/html/caution.html) follow the Government of Japan Standard Terms of Use 2.0 (CC BY 4.0 compatible, commercial use allowed, source credit required) and ask tools not to collect data periodically, pointing regular collection to the river information data service; frames are therefore fetched only on view and refresh at most every ten minutes per camera. Both credits are registered in the Data attribution popover.
- **TxDOT ITS cameras.** The catalog comes from the keyless `its.txdot.gov/its/DistrictIts/GetCctvStatusListByDistrict` endpoint, one call per district. Frames come from the per-camera `GetCctvSnapshotByIcdId` endpoint, which answers JSON carrying a base64 JPEG rather than an image body; the proxy decodes it only for responses from the official TxDOT origin and validates the JPEG header before serving. Only cameras reporting `Device Online` are registered. Districts default to Austin and San Antonio (`CCTV_TXDOT_DISTRICTS`; 25 codes exist statewide); `CCTV_TXDOT_MAX_SOURCES` caps the pack and `CCTV_TXDOT_ENABLED=0` turns it off. Frames are fetched live at request time and are never stored or redistributed.
- **Tallinn ristmikud.** Intersection camera stills are fetched live from `ristmikud.tallinn.ee` (`/last/camNNN.jpg`). The curated catalog (`config/cctv_sources.tallinn.json`) supplies coordinates and heading priors; only server-registered ristmikud HTTPS URLs are proxied. Frames are fetched at request time and never stored or redistributed. Disable with `CCTV_TALLINN_ENABLED=0`.
- **Tarktee / Transpordiamet.** Estonia road-weather camera locations and current JPEG URLs come from keyless DATEX2 endpoints on `tarktee.transpordiamet.ee` (`/api/v1/datex/roadCameraLocations` + `roadCameraImages`). Frame URLs rotate with each capture; the 15-minute CCTV source cache refreshes them. Only `https://tarktee.transpordiamet.ee/images/…` URLs are registered. Disable with `CCTV_TARKTEE_ENABLED=0`.
- **Warendorf webcam.** The Stadt Warendorf Marktplatz webcam, registered from the curated `config/cctv_sources.warendorf.json` (the Kreis Warendorf registration-office cameras from the contributing PR are indoor waiting rooms and were left out); only the municipal image host is proxied, frames are fetched at request time and never stored or redistributed. Disable with `CCTV_WARENDORF_ENABLED=0`.
- **Live Traffic NSW cameras.** The camera list is the keyless public `data.livetraffic.com/cameras/traffic-cam.json` feed (Transport for NSW open data, CC BY 4.0); frames are stills on `webcams.transport.nsw.gov.au`, and only that host is registered. That image host answers non-browser clients with an HTML placeholder, so the proxy identifies as a browser for that one host and as itself everywhere else. Frames are fetched at request time and never stored or redistributed. Disable with `CCTV_NSW_ENABLED=0`.
- **Open Calgary traffic cameras.** Keyless. The camera list is the public Socrata dataset `k7p9-kppz` on `data.calgary.ca`; frames are stills on the city's own `trafficcam.calgary.ca` host, and only that host is registered. Most rows publish an `http://` frame URL and the host redirects those to HTTPS, so URLs are upgraded and pinned to that origin before registration. Frames are fetched at request time and never stored or redistributed. The dataset publishes no camera facing: the `quadrant` field and the quadrant suffix on each camera name are Calgary's address grid, not a bearing, so headings use the shared id-hash fallback at low confidence and are corrected with the in-app calibration gizmo. The licence requires the attribution statement above. Disable with `CCTV_CALGARY_ENABLED=0`.
- **FL511 Florida cameras.** Off by default; set `CCTV_FLORIDA_ENABLED=1` to load them. The camera list is the keyless FL511 traffic camera layer on ArcGIS (`services.arcgis.com/.../FL511_Traffic_Cameras`), published from a Florida Division of Emergency Management account rather than by FL511 directly, and the service carries no licence text of its own. It is paged up to 2,000 rows at a time, ordered by the layer's object id and following ArcGIS's `exceededTransferLimit`, to cover the ~4,000-camera statewide set. Frames are stills on two Divas Cloud hosts (`images-dis.divas.cloud`, `snapshots.divas.cloud`); both are host-pinned and a row whose image resolves elsewhere is dropped. `CCTV_FLORIDA_MAX_SOURCES` caps the pack (default 500, anchored per region across the state). Each catalog page is read under a 2 MiB cap and redirects are refused. Frames are fetched live at request time and never stored or redistributed. FL511's terms (fl511.com/privacy#disclaimer) license its content for individual, personal use only; any other use, including a public deployment, needs FDOT's express written consent.
- **Catalonia (Servei Català de Trànsit) cameras.** The camera list is the keyless `https://www.gencat.cat/transit/opendata/cameres.xml` WFS/GML feed, fetched over https with redirects refused and the body read capped at 1 MiB, since the list decides ids, coordinates and which allowlisted frame path is proxied. It carries a `font` field naming the real publisher per camera; this pack keeps SCT's own highway cameras plus hotlinked Barcelona (IMI) and Terrassa municipal cameras (~130 total), each confirmed to return a real frame, so frame URLs are checked against a small host allowlist (`mct.gencat.cat`, `www.bcn.cat`, `emap.terrassa.cat`) rather than one pinned origin (a link carrying `user:pass@` userinfo or an explicit port, or pointing outside that host's frame directory, is rejected even on an allowed host; an SCT `sctidcam` must be a bare `.gif`/`.jpg` filename), and every non-SCT camera carries its real owner as a `credit` shown beside the shared `provider`. The feed carries no compass heading, so every camera loads at low heading confidence (same as TfL and Fintraffic). SCT's own feed link (`RenderService`) needed a workaround: it always 302s to a second endpoint (`TransitCamera`) on a Location the upstream hardcodes as plain http even when requested over https — refused by `fetchWithinHost`'s same-origin (scheme-included) redirect policy — and separately, `mct.gencat.cat`'s TLS setup fails the handshake with Node's fetch outright (`ERR_SSL_WRONG_SIGNATURE_TYPE`) even though other HTTP clients complete it. The loader therefore builds the `TransitCamera` URL itself, over plain http, from `RenderService`'s `sctidcam` id, rather than registering the (broken) upstream link — the only transport this one host actually serves to this runtime. Camera ids are built from the SCT camera file or the partner image path, not the feed's `fid` (which embeds an upstream server-start stamp and changes on every upstream restart), and rows the feed lists more than once collapse to one camera. The feed carries no camera status field, so a camera its publisher has taken offline still registers and shows the publisher's own "image unavailable" still (SCT and Barcelona both serve one with HTTP 200), the same as other packs without a status field. Frames are fetched at request time and never stored or redistributed. The feed itself states no licence; the pack relies on the Generalitat de Catalunya open-data portal's terms for this dataset (the licence and attribution above). Disable with `CCTV_CATALONIA_ENABLED=0`.
- **Iceland (Vegagerðin / IRCA) cameras.** The camera list is the keyless `https://gagnaveita.vegagerdin.is/api/vefmyndavelar2014_1` JSON feed (about 500 camera views at roughly 170 stations), fetched over https with redirects refused and the body read capped at 2 MiB, since the list decides ids, coordinates and which frame path is proxied. Frames are JPEG stills in `https://www.vegagerdin.is/vgdata/vefmyndavelar/`; only links inside that directory are registered (userinfo, explicit ports and encoded path separators are rejected). Camera ids come from the frame file name. The feed's `Skyring` view description is the camera label, and a stated facing ("til vesturs", "í suður", "séð austur") sets a high-confidence heading; a view that states none, or two different ones ("niður á veg", a bare road direction), takes the id-hash low-confidence pose. The feed has no elevation, so cameras carry a flat prior that the client's ground snap corrects. IRCA publishes road camera images under CC BY 4.0 and requires the licensor to be acknowledged without implying endorsement; the pack shows the attribution above (licensor, dataset, CC BY 4.0, terms link and no-endorsement note) in the Data attribution popover, and every camera record carries the licence string. IRCA describes the images as fetched several times per hour (a live frame's `Last-Modified` was about four minutes old on 2026-11-06) and the real-time data as provided as is, without warranty. Frames are fetched at request time and never stored or redistributed. Disable with `CCTV_ICELAND_ENABLED=0`.
- **King County road cameras.** Keyless. The camera list is one public ArcGIS FeatureServer GeoJSON query (King County DOT Road Services, "King County and WSDOT Traffic Cameras"). The `outFields` list is explicit on purpose: the layer also carries asset-administration columns — including staff names — that are never fetched. Only live, active cameras with frames on the county's own `info.kingcounty.gov` image handler are registered (the feed writes `http://`; the handler serves HTTPS, so URLs are upgraded and pinned before registration). WSDOT-owned rows in the layer are skipped because their frames are WSDOT-hosted, outside the pinned image origin; partner-city cameras hosted on the county image handler (e.g. Newcastle) name their owner as the per-camera credit. The layer publishes no facing, so headings use the shared id-hash fallback at low confidence. Uniquely, the county publishes each camera's hardware `Manufacturer`/`Model` (Cohu 3950/3965, Bosch AUTODOME, Axis PTZ domes); both are carried on the source (and served by `/api/cctv/sources`) as `model` and `manufacturer` for identified-hardware consumers (vendor-generic strings such as `PTZ` name no model and are omitted). Frames are fetched at request time and never stored or redistributed. Disable with `CCTV_KINGCOUNTY_ENABLED=0`.
- **WSDOT highway cameras.** Keyless. The camera list is the Esri JSON layer `data.wsdot.wa.gov/travelcenter/Cameras.json` — the same layer WSDOT's own Travel Center map consumes (~1,700 point features, EPSG:3857 geometry converted to WGS84 on load; the body carries Windows-1252 bytes and is decoded as such). Only frames on WSDOT's own `images.wsdot.wa.gov` host are registered — the catalog also lists ~70 partner cameras (Oregon DOT, City of Seattle, lodges, airports) whose own terms apply, and those are skipped rather than proxied. WSDOT's layer metadata marks the feed for "low volume" use (see WSDOT's [travel information disclaimer](https://wsdot.wa.gov/about/policies/travel-information-disclaimer)). The catalog is fetched once per CCTV catalog refresh (every 15 minutes), and a camera's frame is fetched only when that camera is viewed; frames are never stored or redistributed. The live feed's `CompassDirection` is a single cardinal (N/E/S/W), `B` (both directions — most rows), `O`, or null. A single cardinal gives a high-confidence heading (the diagonals NE/SE/SW/NW are mapped too should they appear); `B`, `O`, null, and any other code carry no single facing and use the shared id-hash fallback at low confidence. By default the 250 cameras nearest Seattle and Spokane load; `CCTV_WSDOT_MAX_SOURCES` changes the cap (8–1,200) and `CCTV_WSDOT_ENABLED=0` turns the pack off. A keyed WSDOT Traveler Information API serves the same population for higher-volume use and is deliberately not required here.
- **Hong Kong Transport Department traffic snapshot cameras.** Keyless. The English camera list is the public DATA.GOV.HK XML at `static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_En.xml`; frames are stills on `tdcctv.data.one.gov.hk`, and only that host is registered. Frame URLs are rebuilt from each camera key (`https://tdcctv.data.one.gov.hk/{KEY}.JPG`) rather than taken verbatim from the catalog. Stills were probed to answer directly on that origin with no redirect hop. Frames are fetched at request time and never stored or redistributed. The dataset publishes no camera facing, so headings use the shared id-hash fallback at low confidence and are corrected with the in-app calibration gizmo. By default nearly the full catalog loads (~1,013; pack cap 1,100), prioritized nearest Central, Tsim Sha Tsui, Sha Tin, Tsuen Wan, Tai Po, Fanling, Tuen Mun, Yuen Long and Tseung Kwan O so a lowered cap still spans Hong Kong Island, Kowloon and the New Territories. When the sum of packs exceeds the catalog-wide ceiling, shared round-robin keeps every lane represented. `CCTV_HK_MAX_SOURCES` (8–1200) changes the cap and `CCTV_HK_ENABLED=0` turns the pack off. The DATA.GOV.HK Terms of Use require attribution to the Government / Transport Department / DATA.GOV.HK.
- **Statens vegvesen road cameras.** Keyless. The camera list is one GeoJSON request to the OGC API Features view of the official DATEX 3.1 CCTV site table (`ogckart-sn1.atlas.vegvesen.no/ogc/features/v1/collections/datex_3_1:CctvSimple/items`), so no DATEX account is needed; frames are stills on `kamera.atlas.vegvesen.no/api/images/<cameraId>`, and only that exact path per camera is registered. Cameras the feed reports as faulty are dropped. About 135 working cameras also publish live HLS (`kamera.vegvesen.no/public/<cameraId>/manifest.m3u8`, MPEG-TS); those play as live video through the bounded in-memory HLS relay, with the still as the snapshot fallback, and only that exact manifest path per camera is registered. `CCTV_VEGVESEN_VIDEO=0` keeps every camera on stills. `orientationDescription` names the place a camera faces, not a bearing, so it goes into the label and headings use the id-hash fallback at low confidence. By default every live camera loads (~850); `CCTV_VEGVESEN_MAX_SOURCES` (8–1000) lowers the cap, keeping the cameras nearest Oslo, Bergen, Stavanger, Trondheim, Kristiansand, Bodø and Tromsø and `CCTV_VEGVESEN_ENABLED=0` turns the pack off. Frames are fetched at request time and never stored or redistributed. The NLOD attribution is registered in the Data attribution popover.
- **Kartverket ground heights for Statens vegvesen cameras.** The camera feed's points are 2D, so the loader asks Kartverket's keyless point-height API (`ws.geonorge.no/hoydedata/v1/punkt`, CC BY 4.0) for the terrain height at each camera. Requests carry 20 points: the API accepts 50, but above ~20 it answers the extra points from contour lines (`hoydekurver`, metres to ~20 m off) or not at all. Eight requests run at a time, about 36 for the whole country: a cold lookup took 6–13 s in testing (single requests 0.6–9.5 s). Answers are matched by the coordinates the API echoes and recorded only for points that request asked about. Over water the API returns the sea-floor depth (`dybdekurver` or `Havflate`), which is replaced by 0 m, the water surface; for the ~14 bridge cameras that is below the deck, but much closer than the sea floor or the flat prior. Heights are cached in memory by position for the life of the server, and points with no height (a few ferry quays and bridges, or a point a 200 answer leaves out) for 6 h, so the 15-minute catalog refresh only asks about new or moved cameras. The first failing request (a 408, 429 or 5xx, a network error, a request over 10 s, or an unreadable or oversized body) stops the lookup, with no retries, and no new lookup starts until the backoff ends (Retry-After when sent, else 30 min, longer than the refresh; bounded to 1 min–1 h). Any other 4xx marks that request's points as having no height and the lookup carries on. The whole lookup has a 30 s deadline; a lookup cut short by it resumes on the next refresh without a backoff. The lane waits at most 12 s, counted from the start of the loader, and only when more than 10% of the cameras have no answer yet; a few new cameras or expired misses are looked up in the background. A slower lookup keeps filling the cache, and the cameras it had not reached keep the flat prior until the next 15-minute refresh (about 190 of 865 on one slow first run). Only coordinates are sent, with the same User-Agent as the other CCTV requests. `CCTV_VEGVESEN_HEIGHTS=0` turns the lookup off. The Kartverket credit, with a note that heights over water are set to 0 m and heights are rounded to 0.1 m, is shown beside the Statens vegvesen entry in the Data attribution popover.
- **NYC DOT Traffic Management Center cameras.** Off by default. NYC DOT's [developer data feeds page](https://www.nyc.gov/html/dot/html/about/datafeeds.shtml) asks developers who want the camera feed to contact `tmcdot@dot.nyc.gov` and sign a data-sharing agreement. This project does not hold one that covers downstream installations, so the pack loads only when an operator who holds their own agreement sets `CCTV_NYC_ENABLED=1`; with the flag unset, empty or any other value, the server makes no request to NYC DOT. The endpoint needs no key. The camera list is the public `webcams.nyctmc.org/api/cameras` catalog (~980 cameras across the five boroughs); frames are stills at `webcams.nyctmc.org/api/cameras/<uuid>/image`, synthesized from a validated UUID rather than taken from the payload, and only that host is registered. Cameras the feed reports as offline are dropped. The catalog publishes no camera facing, so headings use the shared id-hash fallback at low confidence and are corrected with the in-app calibration gizmo. Once enabled, the 250 cameras nearest the borough cores load; `CCTV_NYC_MAX_SOURCES` (8–400) changes the cap. Frames are fetched at request time and never stored or redistributed. NYC DOT asks every application that uses its data to carry its disclaimer; it is registered verbatim in the Data attribution popover.
- **City of Toronto RESCU cameras.** Keyless. The camera list is the City's public `tmcearthcameras.json` on `opendata.toronto.ca` (dataset "Traffic Cameras", Transportation Services), served as JSONP and unwrapped with an anchored pattern. This is the municipal network the Ontario 511 pack does not carry: downtown arterials plus the Gardiner, DVP, Allen and Lake Shore. The list publishes no frame URL, so frame URLs are BUILT from the documented `CameraImages/loc####.jpg` convention and a strictly-digits camera number, pinning the frame proxy to the portal origin by construction; the list fetch refuses redirects and bounds the body it buffers. Frames are fetched at request time and never stored or redistributed. The dataset publishes no camera facing: the `D1`-`D4` fields are the directions of the *comparison* images (static reference stills captured in 2016 under a different path), not a bearing for the live pan-tilt-zoom frame, so headings use the shared id-hash fallback at low confidence and are corrected with the in-app calibration gizmo. A camera that is temporarily out of service still answers 200 with a byte-identical "Image Unavailable" placeholder rather than an error (about 6% of the network at any moment), so such a camera reads as healthy; the frame it shows is the agency's, not a synthesized one. The licence requires the attribution statement above. Disable with `CCTV_TORONTO_ENABLED=0`.
- **Houston TranStar cameras.** Keyless. The camera list is the public `traffic.houstontranstar.org/data/layers/cctvSnapshots_json.js` catalog (~1,000 cameras across Greater Houston); frames are stills at `www.houstontranstar.org/snapshots/cctv/<id>.jpg`, synthesized from a validated numeric id rather than taken from the payload, and only that host is registered. Cameras whose catalog id is `0` (a different, non-snapshot class) and cameras outside Greater Houston are dropped. TranStar's `dir` field is the side of the freeway the camera sits on, not the way it faces: TranStar's own map shows it as "Traffic closest to the camera is traveling …" (South → eastbound, North → westbound, West → southbound, East → northbound). That travel direction (90°, 270°, 180°, 0°) seeds the heading as a low-confidence prior with the low-confidence pose; `None` or an unknown value uses the shared id-hash fallback at low confidence. Headings are corrected with the in-app calibration gizmo. Off by default. TranStar's [Content Usage terms](https://traffic.houstontranstar.org/disclaimer.aspx) prohibit copying or distributing the site's information, and external framing or linking to specific images, without TxDOT's prior written permission; its FAQ grants permission-free use only for the RSS feeds. This project does not hold that permission for downstream installations, so the pack loads only when an operator who holds TxDOT's written permission sets `CCTV_HOUSTON_ENABLED=1`; with the flag unset, empty or any other value, the server makes no request to TranStar. Once enabled, it loads the 250 cameras nearest downtown, Uptown, the Medical Center, IAH and Galveston; `CCTV_HOUSTON_MAX_SOURCES` (8–400) changes the cap. Snapshots update about every 3 minutes, which is also the ambient still cadence. Frames are fetched from TranStar and relayed to the browser on demand, buffered only transiently per request, sent with `Cache-Control: no-store`, and not archived.
- **Autostrada del Brennero (A22) webcams.** Keyless. The camera list is one request to the Open Data Hub tourism API (`tourism.api.opendatahub.com/v1/WebcamInfo?source=a22`), run by NOI Techpark in South Tyrol, which republishes Autobrennero's own list of 13 motorway webcams with coordinates and kilometre markers. Frames are the operator's stills on `www.autobrennero.it/WebCamImg/km<N>.jpg`, refreshed about once a minute, and only the exact image for each camera's kilometre is registered. The feed names no bearing, so headings use the id-hash fallback at low confidence. The road climbs from about 20 m in the Po valley to about 1,370 m at the Brenner Pass, so each camera's ground elevation comes from a per-kilometre table sampled from the Copernicus GLO-90 DEM (via Open-Meteo's elevation API); a camera not in the table uses a 200 m prior. The Open Data Hub tags every record CC0 (`ClosedData: false`, Autobrennero as licence holder), but that tag is the aggregator's metadata and Autobrennero publishes no terms of its own for the images, so they are credited to the operator as a courtesy and are not redistributed. Frames are fetched at request time and never stored. Disable with `CCTV_A22_ENABLED=0`.
- **Camera frame content.** Public camera frames can contain people, vehicles and license plates, and the camera layer does nothing with them beyond putting them on the map. A successful upstream response is relayed as the provider served it: nothing in the camera pipeline blurs, redacts, enhances or restores it, and nothing there runs face, plate or object detection or otherwise recognises or classifies what is in the picture. (The ALPR layer described below maps where plate-reader cameras are, from locations contributors tagged in OpenStreetMap; it reads nothing from any camera frame.) When an upstream has no frame for a camera, what you see instead is a Google Street View still or the app's own placeholder card; the panel's source badge names which of them you are looking at, and a refresh that fails after a frame has arrived leaves the last good picture on screen rather than replacing it. The browser resamples each frame for display: onto a fixed 1920x1080 surface for the camera's projection plane in the scene, and onto a 192x108 canvas for the small ambient card. That scaling is the only change made to the picture, and the only pixels the camera layer reads back are a 64x36 downscale hashed to tell whether the picture has changed. Live streams are piped through; the still path reads the image into memory to pass it on — TxDOT wraps its JPEG in a JSON envelope, which is decoded there — and no frame is written to disk (the disk cache, `.gev-cache/`, holds feed JSON for other layers and never camera imagery). Outside that pipeline, the voice assistant is the one feature that sends imagery anywhere: when it answers a question about what is in view it may attach a downscaled screenshot of the rendered scene — including any camera plane on screen — to the request it sends to the voice model. Frames are fetched only from server-registered camera URLs — a client cannot hand the proxy a URL (see [SECURITY.md](SECURITY.md)). What the app does stays inside the line README draws: no named-person search, no face recognition, no tracking individuals.
- **Transit (GTFS-Realtime).** The proxy requests only registered operator feeds, validates redirects, bounds responses, and uses conditional requests, short snapshot caching and failure backoff. All eighteen registered feeds, covering seventeen regions, are live-enabled; each can be disabled independently. Vehicles use delayed playback between reports, with report age and waiting states shown separately. Session-local selected trails are available for every feed. MBTA additionally retains up to 15 minutes of recently observed positions in the running proxy, so available history can survive a browser reload; server restart clears it. History reads never fetch upstream, and other feeds have no proxy retention. Nothing is archived to disk or collected in the background. Operator text credits are included as a courtesy and do not imply endorsement. Heights are aligned to work with Google 3D tiles; subway markers are shown at street level because these feeds do not supply depth. The TTC feed is BusTime, the surface system: it carries buses and streetcars and no subway at all. About four in ten of its vehicles report no route at all (unassigned or deadheading), and those are shown with the feed default rather than a route-established mode. It sends no ETag or Last-Modified, so its conditional requests fall through to the ordinary snapshot cache. Three Golden Horseshoe neighbours run alongside it — MiWay, Hamilton HSR and Durham Region Transit — each bus-only and each polled only near its own region. Durham Region Transit publishes no bearing on any vehicle, so those sprites take their heading from observed movement like any other feed that omits it. Guelph, Kingston and Barrie extend the same pattern eastward and north. Hamilton, Guelph, Burlington, YRT and Rio’s SMTR publish route ids that are not the number on the vehicle, so those entries carry a route-name table taken from each operator’s own published GTFS; any id missing from a table renders unchanged rather than blank. A label is never invented: YRT runs a route `9101` that appears nowhere in its published routes, so it stays as the feed sends it. Burlington’s is the one that cannot be shortcut: `351` is route 1 while `3510` is route 10, so the table is a real join rather than a trimmed prefix. GO Transit / Metrolinx is deliberately absent: its REALTIME feed requires an API key issued by manual review, which the keyless admission rule excludes (its static schedule download is keyless, but carries no vehicle positions). Barrie and YRT/Viva each invite acceptance of their licence through a form, and each licence also states that using the data is itself acceptance; this deployment relies on that clause, which is recorded in both entries. Grand River Transit in Waterloo is absent for a different reason: it answers, but its feed header was months stale and it publishes no per-vehicle timestamps, so it would render vehicles that look live and are not. Ottawa’s OC Transpo falls to the same keyless admission rule as GO Transit — its realtime feed requires an API key. London Transit and Thunder Bay Transit publish vehicle positions over plain HTTP with no HTTPS endpoint available. Every other Ontario system — Brampton, Oakville, Niagara, Milton, Windsor, Greater Sudbury, UP Express and a dozen smaller operators — publishes static GTFS schedules only, with no realtime vehicle positions to register. Between the nine included and these exclusions, every Ontario realtime vehicle-position feed catalogued in the Mobility Database is accounted for.
- **Radio country coverage (optional).** Set `RADIO_PRIORITY_COUNTRIES=IN,PL` in the local `.env` and restart to include stations beyond the global click charts. The operator may choose up to eight unique ISO alpha-2 country codes; no key is needed. Each country adds one bounded query (at most 200 rows) and reserves up to 40 unique, usable stations inside the existing 750-station catalog. Country seeds precede specialist-tag seeds and global popularity fill; unused slots return to the shared pool. This is a coverage preference, not an exhaustive national directory or a guarantee of stations in every city. Countries with no eligible HTTPS MP3/AAC geolocated stations remain empty. An unset list preserves global selection. Country requests share the directory cache and three-worker pool; failed country queries are reported in coverage without blocking a healthy global refresh. Failed/degraded refreshes back off for one minute, with at most three mirrors per query.

- **Radio Browser.** In every installation, including when `RADIO_PRIORITY_COUNTRIES` is unset, each request tries at most three mirror candidates (later fallback candidates are skipped), and failed or partial catalog refreshes back off for 60 seconds. A cold-start failure therefore continues returning 503 during that delay even if upstream recovers. `/api/radio/stations` discovers official API mirrors, makes bounded and coalesced healthy/geolocated HTTPS-station queries, caches the normalized public-domain directory for 45 minutes, and may serve the last good catalog for up to seven days during an outage. Refreshes must meet minimum accepted-query and station coverage before replacing a warm catalog; broad/specialist responses whose rows all fail the product's health policy do not count as successful queries. Optional priority-country outcomes are advisory: valid, in-limit responses with no eligible stations succeed as empty results, while failed or malformed country queries report unsuccessful coverage without degrading the global catalog. A usable partial cold catalog is explicitly `DEGRADED`, and non-array or empty broad/specialist payloads are rejected atomically. Individual structurally malformed rows are skipped rather than failing the whole query; the response carries their bounded `rejectedStationCount` (at most 10,000), which the client adds to its own rejected rows and reports as degraded coverage without discarding the accepted generation. Every directory and click-count request rejects redirects, validates all resolved addresses as globally routable (including reserved/documentation IPv4 and special/non-global IPv6 exclusions), and pins the TLS connection to a validated address. Only MP3/AAC non-HLS directory rows with public HTTPS stream targets are returned; favicons are intentionally omitted. Pressing play connects one browser audio element directly to the selected broadcaster and calls the directory's click counter through known-ID-only `POST /api/radio/click/:uuid`. GEV never proxies, caches, records, bundles, or redistributes audio. Radio Browser supplies station-level tags, not dependable current-song or upcoming-program metadata, so Radio filtering never claims either. Direct playback exposes the listener's IP address to the broadcaster, whose own stream terms apply.
- **TomTom Traffic.** Optional and BYOK: without `TOMTOM_API_KEY` the traffic layer runs its built-in simulation and no TomTom data (or attribution) appears. With a key, flow vector tiles are fetched through the server-side `/api/tomtom` proxy (120 s cache + a daily tile-budget governor — `TOMTOM_DAILY_TILE_BUDGET`, default 6,000 — sized so a 31-day month stays inside TomTom's 200K monthly free allowance; still a configurable application safety ceiling, not a guarantee; TomTom's [current pricing](https://docs.tomtom.com/pricing/) lists 200K free tile requests per month) and the "Traffic flow data © TomTom" credit is registered in the Data attribution popover the moment live mode activates. TomTom data is served live and cached only transiently (≤120 s TTL under `.gev-cache/`, gitignored) — it is not bundled or redistributed. One 23 KB point-in-time tile snapshot is committed as a decode-test fixture (`src/data/fixtures/`, © TomTom, never served to the app).
- **Routing (OSRM / FOSSGIS).** `/api/route` proxies the public OSRM instances FOSSGIS e.V. runs for the OpenStreetMap community (car, bike, foot profiles). They are keyless and intended for fair, interactive use — the proxy rate-limits clients (60/min, 200/min total), caps route span and response size, caches each route for 10 minutes, and identifies itself in the User-Agent. Heavy or automated use must run its own OSRM. Routes are computed from OpenStreetMap data (ODbL); the Directions layer and voice routes never redistribute them. A route the router cannot find is reported as such; the Directions layer draws nothing in that case, and voice routes fall back to a clearly labeled straight line.
- **Re:Earth Terrain.** Keyless (no API key). Used two ways: (1) `src/mapStackController.js` swaps in a `Cesium.CesiumTerrainProvider` pointed at Re:Earth's `cesium-mesh/ellipsoid` quantized-mesh endpoint for globe stacks without a Cesium ion token (e.g. OSM), replacing a flat `EllipsoidTerrainProvider`; falls back to the flat provider if the endpoint can't be reached. (2) The server-side `/api/terrain/heights` proxy (disk-cached, serve-stale) resolves per-point ellipsoidal ground height for entity placement. Both are best-effort with a keyless-safe fallback (bundled EGM96 geoid math) if Re:Earth is unreachable.
- **OSRM on the FOSSGIS routing servers.** Keyless (no API key). Every route is requested by a person: clicking A and B in the Directions layer, or a voice "route from A to B". The server-side `/api/route` proxy sends an identifying `User-Agent`, pins the upstream host, accepts 2-12 coordinates, rejects any leg over 600 km or a total over 2,500 km, caps the buffered response at 8 MB, times the upstream out at 12 s, rate-limits per client, caches each route for 10 minutes, and coalesces identical requests that are in flight at the same time. Turn-by-turn maneuvers are asked for only when a caller wants them (`steps=1`), so the callers that do not read them send the smaller request. The "fix the map" link the policy asks for is in the Data attribution popover beside the OpenStreetMap credit.
- **FAA Special Use Airspace.** Keyless. `/api/drone-airspace` queries the public FAA AIS FeatureServer for prohibited (P) and restricted (R) zones only — not MOAs, TFRs or other SUA types — with simplified geometry, a body cap, paging, a one-hour cache and stale-on-error. The layer is US coverage, informational only, and is not a substitute for B4UFLY, LAANC or a preflight briefing. Data is fetched at request time and never stored or redistributed. US government public domain; courtesy attribution is registered in the Data attribution popover.
- **iNaturalist.** Keyless. `/api/inaturalist/observations` returns cached random view samples (newest first globally), at most 200 per request. Recency uses observation time: the v1 `d1` filter and a rolling 48 h cutoff (whales 7 d); date-only rows qualify when their day starts within the window. Observation caches last 5 min (global 10 min), with stale fallback ≤1 h. `/api/inaturalist/grid` supplies density counts, cached 15 min. Both share a paced queue capped at 60/min and 8,000/day; only request counters persist in `.gev-cache/`. The server caches projected records, never raw responses. Private records are excluded; obscured coordinates become 0.2° cells. Observer identity is retained only for photo attribution. Eligible photos load directly from `inaturalist-open-data.s3.amazonaws.com`, with creator credit on ambient cards and creator/licence on selection. Per-record licences and noncommercial restrictions apply as listed above. Attribution appears in the layer row and Data attribution popover. Coverage follows community observations, not a census; Acartia adds Salish Sea marine mammals.
- **iNaturalist grid (cell schema risk).** `/api/inaturalist/grid` shares observation-date, taxa, quality, pacing and budget rules with observations. A strict 64×64 UTFGrid schema guard fails closed; only logical-cell keys, counts and coordinates survive projection. Raw tiles, observation identifiers and free text are not retained. Projected tiles use a 400-entry LRU, 15-minute freshness and at most one hour of stale fallback. Views request at most six tiles; cached and adjacent-zoom coverage publishes before network waits, independently of observation pages. Cells supply a noninteractive density glow ranked within the view, from teal to amber with mono/CRT support. Every sighting badge comes from a real observation at its public position. Counts describe observations, not a population census. The endpoint is documented in the v1 and v2 API docs as “Grid Tiles UTFGrid” (`/grid/{z}/{x}/{y}.grid.json`), but its per-cell records are not specified; schema drift disables grids until revalidated. See `docs/KNOWN-ISSUES.md`.
- **Acartia.** Keyless. `/api/acartia/sightings` reads the current 7-day marine-mammal feed for ALL, MAMMALS and WHALES views intersecting 45.5–50.5° N, 126–121° W in the Salish Sea. WHALES accepts recognized cetaceans; other identified marine mammals appear under ALL/MAMMALS. The server rounds positions to 0.01° and drops comments before caching projected records (10 min fresh, stale ≤24 h); raw responses are not retained. Selected text cards credit the reporting provider under CC BY 4.0 and show Be Whale Wise guidance. `/sightings/current` answers without a key today, but Acartia's README asks API users to create an account and generate an API key on the [Acartia dashboard](https://acartia.io/) and to follow its [community guidelines](https://acartia.io/register). Attribution also appears in the layer row and Data attribution popover. Opportunistic sightings, not a census.
- **Mapped installations.** OpenFreeMap military polygons use a bundled Overture/OSM name index; wide views show named points. Optional operator-configured Overpass and explicit Google Places searches keep their own source paths. Mapped data does not establish current activity or complete coverage.
- **Place search.** Named-place fly-to uses Google Geocoding when a Maps key is configured, then Photon (`PHOTON_URL`; unset uses the public instance, empty disables it), then `/api/geocode` (Nominatim search) when neither answers. `/api/geocode` and the voice outline route `/api/geocode/outline` share one Nominatim queue (`NOMINATIM_URL`; unset, empty and invalid values disable it; an operator must explicitly select an authorized endpoint): one request at a time at least 1.1 s apart, an identifying `User-Agent` and `Referer`, a short queue that refuses a burst, a pause after 429/403/5xx answers (honouring `Retry-After` in full), at most one retry after a network failure, and a per-install daily cap on public-instance requests (`NOMINATIM_DAILY_CAP`, default 50). Processes using the same installation state file hold one lock through the actual fetch invocation and recording the next public start, with the daily slot persisted before invocation; restarts share that count, spacing and any pause. An unfinished dispatch marker fails closed until operator recovery; it is never automatically reclaimed. Public access fails closed if the state file cannot be read, locked, written or semantically validated. This coordination does not span independent installations or state directories and does not establish an application-wide public-service allowance or authorize public use. An operator-selected non-public endpoint is outside the public cap, spacing and durable-state requirement; an upstream cooldown is kept with the endpoint that returned it rather than leaking across operator URLs. Answers are cached on disk (outlines 90 days, places 30 days, no-results 24 hours); failures are not cached. Outlines are looked up only for an explicit ask, after bundled data and any configured Overpass, and only results whose type suits the ask are used. Administrative outline responses expose country/admin-1/admin-2 identity only when the selected Nominatim row has a recognized, unambiguous address type consistent with its own name; numeric rank, ambiguous types, missing fields and contradictory names do not manufacture identity. It is not used for systematic or bulk queries.
- **Street and building outlines.** Voice street highlights, pointed-at buildings and grounds use the OpenFreeMap vector tiles the traffic layer already loads. Traffic and outlines share one bounded pending fetch/decode owner per immutable XYZ tile; materialized outline geometry is charged to the retained-byte ceiling and capped by coordinate count. Consumer result caches and request lifetimes remain independent, while eviction or explicit teardown cancels queued idle projections and releases their decoded owner. No Overpass request is made unless `OVERPASS_UPSTREAMS` is configured. Named grounds require a returned name matching the selected place, except that an ask whose head noun names a kind of grounds (a school, university or college, hospital, cemetery, stadium or zoo) may use the part of the smallest unnamed tile area of that class that holds the resolved place; a differently named area never answers. Other anonymous landcover polygons cannot establish identity, so unsupported grounds stay unavailable rather than borrowing a nearby POI name.
- **Voice areas and place search.** Voice areas (`resolve_area`) use the same outline sources as voice outlines. Voice place search (`osm_query`, `/api/osm/features`) runs only on an operator-configured Overpass: a fixed list of kinds, a bounded box and result count, one query at a time, answers cached for a day. It never uses Nominatim.
- **Cockpit regional briefing.** `/api/regional-brief` rounds aircraft coordinates into 0.1° cache cells, caches results for five minutes, and resolves physical regions from bundled public-domain Natural Earth polygons without reverse-geocoding requests. Google News RSS is queried with the resolved locality/region first; GDELT is used only when that RSS query fails or is empty. Google's published Google News terms restrict that source to personal, noncommercial use, so commercial deployments must disable/replace it or obtain separate permission; GDELT permits commercial dataset use with citation. The Data attribution popover identifies the active headline sources; article links retain publisher attribution. Headlines are location-query matches, not verified incidents, risk rankings, or evidence that a location is safe. Empty, partial, stale, and unavailable source states remain distinct. Open-Meteo supplies current conditions independently of the news source. `WX OFF` disables cockpit weather rendering only; the Local Info briefing still fetches its source-backed weather values and displays the required linked Open-Meteo credit.
- **Dynamic weather presentation.** While cockpit mode is active, `/api/weather-effects` requests current Open-Meteo observations for the aircraft/camera location, rounds coordinates into 0.1° cache cells, caches results for five minutes, and may retain a stale observation for up to 30 minutes during a transient outage. WMO condition code selects the visual family; observed cloud cover, precipitation, visibility, wind speed, and wind direction bound its strength and motion. Missing or expired weather renders no synthetic atmospheric effect, and normal globe view never renders the weather overlay.

---

## Bundled snapshots

Static datasets shipped in the repo for an out-of-the-box experience. **None are MIT** — each keeps its own license (see the carve-out in [LICENSE](LICENSE)). Each folder also has its own provenance README.

The [Bhote Koshi event pack](public/events/bhote-koshi-2026/README.md), under `public/events/`, contains Vantor imagery crops and a GeoPera-derived river centerline under **CC BY-NC 4.0**, separately from the MIT code. The derived coordinate dataset in `src/data/bhoteKoshiFloodPath.js` has the same non-commercial restriction and is compiled into the Nepal scene. Commercial users must obtain separate permission or exclude both the event pack and that source-derived dataset from their source and build. Deleting only `public/events/bhote-koshi-2026/` does not remove all restricted data; excluding the scene also requires removing its registrations and imports before building. Linked witness posts and geolocation-map records retain their owners' terms; no social-media clips or cached posters are bundled. Other snapshots below are under `src/data/local_data/`.

| Dataset                                                                     | Folder                            | License                                                                                                   | Commercial use?                                  | Attribution                                                                 |
| --------------------------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------- |
| **Datacenters** (4,352) | `datacenters/` | **ODbL 1.0** (OpenStreetMap extract) | ✅ (attribution + share-alike on data) | © OpenStreetMap contributors (shared credit) |
| **Dams** (704) | `dams/` | **ODbL 1.0** (OpenInfraMap / OSM extract) | ✅ (attribution + share-alike on data) | © OpenStreetMap contributors (shared credit) + Open Infrastructure Map |
| **Military area names** (36,466) | `osm_military_names/` | **ODbL 1.0** (OpenStreetMap, via Overture Maps) | ✅ (attribution + share-alike on data) | © OpenStreetMap contributors (shared credit) + Overture Maps Foundation |
| **Québec CCTV source catalog** (1,120 locations) | `public/quebec-cameras.json` | Mixed: MTQ locations CC BY 4.0; Montréal camera nodes ODbL 1.0; scenic records retain per-record provenance. No video files are bundled or cached. | Location data is per-record; video remains hosted by Québec 511 and its platform terms apply; scenic source pages may have separate terms | MTQ / Données Québec CC BY 4.0; © OpenStreetMap contributors (ODbL); scenic operator and position source shown in the selected-camera panel |
| **World camera image subset** (2,230 locations) | `config/cctv_sources.world-image-cameras.json` | Mixed: ODOT TripCheck public images (ODOT permits use with credit) and MLIT site content under terms compatible with CC BY 4.0. Frames are not bundled or persisted; the server holds a bounded in-memory cache. | Per-source terms apply; NZTA Journey Planner web-cache rows are excluded; Vegagerðin rows are served by the Iceland pack instead | Oregon Department of Transportation (Camera courtesy of ODOT) and Japan Ministry of Land, Infrastructure, Transport and Tourism (出典：国土交通省 川の防災情報) |
| **TeleGeography Submarine Cable Map** (712 cables + 1,917 landing points)   | `telegeography_submarine_cables/` | **CC BY-NC-SA 3.0**                                                                                       | ❌ **NonCommercial — remove for commercial use** | "© TeleGeography — submarinecablemap.com"                                   |
| **UCS Satellite Database** UCS-Satellite-Database 5-1-2023 (3,564 records; operator, owner country, purpose) | `ucs_satellites/` | **Free, unrestricted use** (UCS database manual, section 3) | ✅ (acknowledgement requested) | "UCS Satellite Database (UCS-Satellite-Database 5-1-2023), https://www.ucsusa.org/satellite_database" |
| **Imaging sensor pack** (46 Earth-observation platforms: swath, resolution) | `imaging_sensors/` | Individual specification facts from operator and agency pages, cited per entry | ✅ (facts only) | "Imaging sensor swaths: operator and agency specifications" |
| **Natural Earth physical regions** (1,046 land + 292 marine named polygons) | `natural_earth/`                  | **Public domain**                                                                                         | ✅ (no restrictions)                             | "Made with Natural Earth" (courtesy credit — not legally required)          |
| **DataSF Analysis Neighborhoods** (41 SF neighborhood polygons)             | `neighborhoods/`                  | **PDDL 1.0** (public domain)                                                                              | ✅ (no restrictions)                             | "City & County of San Francisco — DataSF" (courtesy — not legally required) |
| **Natural Earth countries, states and provinces** (260 admin-0/map units + 4,587 admin-1 polygons)             | `natural_earth/`                  | **Public domain**                                                                                         | ✅ (no restrictions)                             | "Made with Natural Earth" (courtesy credit — not legally required)          |
| **Natural Earth populated places** (7,342 points: name, position, rank)     | `natural_earth/`                  | **Public domain**                                                                                         | ✅ (no restrictions)                             | "Made with Natural Earth" (courtesy credit — not legally required)          |
| **US Census Bureau counties** (3,235 county polygons)                       | `us_census_counties/`             | **Public domain**                                                                                         | ✅ (no restrictions)                             | "U.S. Census Bureau" (courtesy — not legally required)                      |
| **US Census Bureau places** (32,629 city, town and CDP polygons)            | `us_census_places/`               | **Public domain**                                                                                         | ✅ (no restrictions)                             | "U.S. Census Bureau" (courtesy — not legally required)                      |
| **Who's On First neighborhoods** (61,441 polygons)                          | `wof_neighborhoods/`              | Per source: CC BY, ODC-By, Open Government licences, CC0, PDDL, public domain (folder `ATTRIBUTION.md`)   | ✅ (attribution)                                 | "Neighborhood boundaries: Who's On First and contributors"; per-source credits in the folder |
| **Yale Bright Star Catalogue** (9,096 stars, sky background)                | `sky/`                            | **Public domain**                                                                                         | ✅ (no restrictions)                             | "Yale Bright Star Catalogue (Hoffleit & Warren, via CDS)" (courtesy credit) |
| **ESO Milky Way panorama** (eso0932a, blurred cube map, sky background)     | `sky/`                            | **CC BY 4.0**                                                                                             | ✅ (attribution; changes stated)                 | "ESO/S. Brunier"                                                            |
| **CCTV ground heights** (3,445 cameras)                                     | `cctv_ground_heights/`            | Precomputed camera placement heights, aligned to work with Google Photorealistic 3D Tiles (folder README) | —                                                | —                                                                           |
| **CCTV Camera Database** model-enrichment extract v2.26.0 + v2.29.0 (20 camera-model records) | `src/layers/cctv/modelSpecs.js` | **CC0-1.0** (public domain dedication) | ✅ (no restrictions) | "Specs: cctv-database.com" (courtesy — not legally required) |

### ⚠️ TeleGeography is bundled but NonCommercial

The submarine-cable GeoJSON is **CC BY-NC-SA 3.0** (Attribution-**NonCommercial**-**ShareAlike**). It is bundled so the cables layer works out of the box, but it is **not covered by this project's MIT license**. CC BY-NC-SA permits redistribution with attribution and share-alike — which is exactly how it ships here — but the **NonCommercial** clause means:

> If you use God's Eye View commercially, delete `src/data/local_data/telegeography_submarine_cables/` (or obtain a commercial license from TeleGeography). It is one self-contained folder; the rest of the app runs without it.

The richer structured dataset is licensed separately/commercially by TeleGeography.

Snapshot refresh (manual, documented): `scripts/refresh-telegeography-snapshot.mjs`
fetches both public endpoints (keyless, verified serving 2026-11-17), validates
the shape, and — with `--write` — replaces the bundled files and updates
`source.json` and the folder README. The regression pins in
`src/layers/submarineCables/bundledSnapshot.test.mjs` (712 cables, 1,917
landing points, hashes, the three New Jersey landings) must be updated by hand
after a refresh, so a refresh can never silently change the data.

### ALPR camera mapping

The optional ALPR layer reads OpenStreetMap `surveillance:type=ALPR` nodes
from a community-hosted hourly US/Canada extract, using detail vector tiles.
It shows mapped locations and available tags, not plate records, camera video,
current operating status or exhaustive coverage. OSM edit timestamps are not
presented as field-verification dates. Other regions show no ALPR data.

Reads are viewport-bounded, with at most 16 tiles per country, four concurrent
reads per country, 1,500 displayed records and an hour-long decoded-tile cache.
When the tile extract is unreachable, the layer falls back to a bounded
Overpass query for the same viewport via the app's `/api/overpass` proxy and
returns those records with the box as coverage; if Overpass fails too, the
original tile error surfaces, never a silent empty map. Verified live
2026-11-16 for Cape May County (bbox lat 38.90–39.35, lon −75.15–−74.55): the
Overpass query returns 30 ALPR nodes, and the county z10 tile (299/390)
decodes to 8 of them with matching OSM ids.
Displayed OSM-derived layers retain a short inline OpenStreetMap credit, plus
OpenMapTiles while OpenFreeMap tiles are used; Data attribution retains the full credits. ODbL permits
commercial use with attribution and applicable database share-alike/access
obligations; it does not license the application code. Trimmed test-only tile
fixtures retain their provenance in `src/data/fixtures/README.md`.

### Surveillance camera locations

The optional surveillance-cameras layer maps where fixed cameras are,
from OpenStreetMap `man_made=surveillance` features whose tags say
`camera` — it shows locations only, never live frames, plate reads or
facial recognition, and it is a different layer from the CCTV layer,
which shows live camera frames. A bounded Overpass query for the
current viewport (at most 3° wide, refetched at most once per 24 hours
per viewport) runs through the app's `/api/overpass` proxy; the
response is filtered client-side to camera-like features, and ALPR
features are dropped (they belong to the ALPR layer). Verified live
2026-11-16 for Cape May County (bbox lat 38.90–39.35, lon
−75.15–−74.55): the query returns 2 camera nodes — a bare pole camera
and a parking camera with direction and mount tags. Community mapping
is a floor, never a total; the county count will grow as contributors
map more cameras. If Overpass is unavailable the layer reports the
error and keeps the last good pins; it never invents locations.
Attribution: "© OpenStreetMap contributors, ODbL" (ODbL 1.0).

### Disaster history

The optional disaster-history layer is a timeline, not a live feed: it
lists the federal disaster declarations for Cape May County from the
OpenFEMA API v2 (keyless, public domain) and pairs them with a curated
in-repo snapshot of NOAA Storm Events (NCEI) rows for the county. The
declarations half is fetched live at runtime through the same-origin
`/api/disaster-history` proxy (24-hour server cache, layer polls once a
day); the Storm Events half is a static snapshot generated by
`scripts/generate-storm-events-snapshot.mjs` from NCEI's bulk CSV files,
because Storm Events has no query API — NCEI's access API rejects
`dataset=stormevents` ("Unsupported dataset", verified 2026-11-16) and
one year's details file is ~12 MB gzipped. Verified live 2026-11-16:
34 declarations, 1965-08-18 (DR-205-NJ, Drought, WATER SHORTAGE) to
2021-09-05 (DR-4614-NJ, Hurricane, REMNANTS OF HURRICANE IDA); by type
Hurricane 10, Snowstorm 6, Severe Storm 5, Flood 4, Biological 2,
Drought 2, Coastal Storm 2, Fire 1, Other 1, Severe Ice Storm 1 (DR 22,
EM 12). The snapshot covers 2012 (78 rows, incl. 6 Hurricane Sandy
rows 28–29 Oct, ~$415M county damage, 4 injuries), 2021 (16 rows),
2024 (24 rows) and 2025 (27 rows) — 145 rows total. If OpenFEMA is
unavailable the layer serves the stale cache with its fetch time; a
cold cache shows the source-unavailable state and never invents a
declaration. Attribution: "OpenFEMA / FEMA" and "NOAA NCEI Storm
Events Database" (both U.S. public domain).

### Live traffic cameras

The optional traffic-cameras layer shows live stills from the NJDOT
511NJ and DelDOT traffic-camera networks, reusing the providers that
landed in PR #19 (`server/providers/nj511.js` and `deldot.js`) — A8
adds the layer UI and the DelDOT/NJ511 wiring on top of them. Terms
verified before any 511 data is displayed: the 511NJ footer "Terms of
Use" links to the NJDOT Website Legal Statement
(`https://www.nj.gov/transportation/legal/`, crawled 2026-11-14),
whose Section E says "anyone may view, copy or distribute department
information found here without obligation to the department, unless
otherwise stated" — no restriction on displaying camera images found;
Section A is an "as is" disclaimer and Section F restricts the NJDOT
seal/logo. Caveat: the 511NJ *API developer agreement* is
registration-gated and still unread — re-read it at registration; if
it forbids display, NJ511 stays off and the layer is DelDOT-only.
Verified live 2026-11-16: `GET https://511nj.org/api/GetCameras?format=json`
without a key answers HTTP 401 (the endpoint exists; the key is the
gate), and the DelDOT TMC feed
`https://tmc.deldot.gov/json/videocamera.json` answers HTTP 200 keyless
(189,639 bytes). The NJ511 key unlocks the New Jersey cameras; without
`NJ511_API_KEY` the provider answers 200 `{configured: false, cameras:
[]}` and the layer is DelDOT-only by design (the Delaware cameras plus
the static DRBA ferry-webcam seed). The layer fetches both halves in
parallel; one half failing never kills the other. Camera stills refresh
on card open, never on a timer; the layer never re-hosts video.
Attribution: "NJDOT 511NJ (as-is) · DelDOT · Delaware River and Bay
Authority". Open item: `NJ511_API_KEY` — William supplies it from
1Password on return; do not create a 511NJ account or key.

### NWS alerts, plain-English card

The optional nws-alert-card layer is a plain-English card over the
existing NWS feed — not a new fetch. It reuses the native NWS provider
that landed in PR #17 (`server/providers/nws.js`, `/api/nws`, zones
NJZ023 + NJZ024, keyless) and adds plain-language glosses of the 22
alert types in the layer, plus the NWS `instruction` text shown
verbatim (safety instructions come from NWS, never paraphrased; when
NWS sends no instruction the card falls back to the gloss action).
A9 extends the provider's `normalizeNwsAlerts` with the card fields
(`instruction`, `description`, `effective`, `expires`, `onset`,
`senderName`) — additive only; existing tests assert properties, not
whole objects. Verified live 2026-11-16: `GET
https://api.weather.gov/alerts/active?zone=NJZ023` answers HTTP 200
with `features: []` (0 active — a quiet night, the expected steady
state); NJZ024 also 200. Past-alert fixtures (Sep 1–Nov 16, 2026): a
Freeze Warning (Severe), Nov 14 00:56 EST → 09:00 EST, NWS Mount
Holly; a Coastal Flood Advisory (Minor), Nov 13 14:47 → 15:00 EST;
and a cancelled Freeze Warning headline ("The Freeze Warning has been
cancelled."). Zero active alerts renders "No active NWS alerts", not
an error. Attribution: "National Weather Service / NWS Mount Holly"
(U.S. public domain).

### Space weather / Kp index

The optional space-weather layer shows the NOAA Space Weather
Prediction Center (SWPC) Kp index, the 3-day Kp forecast, the 3-day
text forecast and ACE solar-wind / magnetic-field readings, through
the same-origin `/api/space-weather` proxy (keyless, public domain).
Two caches: Kp 1-minute + ACE refresh every 5 minutes; the Kp
forecast + 3-day text every 6 hours (SWPC updates the 3-day forecast
twice daily). On upstream failure the layer serves the last good
payload per family, labeled stale; a cold cache answers 502. Kp
unknown is never guessed — the card says "Kp unavailable" and shows
the forecast only. Verified live 2026-11-16: Kp 1-minute JSON
(`services.swpc.noaa.gov/json/planetary_k_index_1m.json`) answers
HTTP 200 (358 rows; latest 2026-11-16T22:27:00, kp_index 0,
estimated_kp 0.0 — quiet); the Kp forecast JSON answers 200 (81
entries, 3-hourly); the 3-day text answers 200 (issued 2026 Nov 16
1230 UTC: greatest observed 3 hr Kp past 24 h was 1; greatest
expected 4.67, NOAA Scale G1, Nov 16–18; isolated G1 likely Nov
17–18 from a coronal-hole high-speed stream plus a possible 14 Nov
CME; S1+ 5%; R1–R2 25%); ACE solar-wind and magnetometer 1-hour
JSONs both answer 200. The `products/solar-wind/plasma-2-hour.json`
and `mag-2-hour.json` paths 404 — do not use them. The honest
mid-latitude frame: at 39°N, visible aurora needs Kp ~7+ (G3); Kp 5
(G1) means possible GPS/HF effects, never visible aurora in Cape
May. G-scale: G1=Kp5, G2=6, G3=7, G4=8, G5=9. Open item: extracting
the Ovation aurora oval ("oval reaches 39°N") from the aurora JSON
was dropped from v1 as too heavy; ship Kp + forecast + solar wind
only. Attribution: "NOAA Space Weather Prediction Center (SWPC)"
(U.S. public domain).

### Drought — U.S. Drought Monitor

The optional drought layer shows the U.S. Drought Monitor category
for Cape May County, through the same-origin `/api/drought` proxy.
The proxy downloads the national GeoJSON
(`https://droughtmonitor.unl.edu/data/json/usdm_current.json` — note:
the `/data/geojson/usdm_current.geojson` path 404s; the `/data/json/`
path is the working one), runs point-in-polygon over 7 county sample
points (the county seat plus 6 bounding-box points) and serves a tiny
JSON with the worst category touching the county. The map is released
weekly on Thursdays; the proxy caches 24 hours and the card always
shows the release date. Verified live 2026-11-16: 5 features (one per
DM category 0–4, national polygons); `Last-Modified: Thu, 12 Nov 2026
11:15:51 GMT`. Point-in-polygon for the county seat (−74.90, 39.08)
lands inside the DM 0 polygon only — **Cape May County is D0,
Abnormally Dry, on the Nov 12, 2026 map** (Atlantic City also D0;
Trenton/Newark in no drought polygon). On upstream failure the layer
serves the last cached category with its release date, labeled stale.
Open item: the USDM county statistics tables are a possible v2, not
v1. Attribution: "U.S. Drought Monitor (droughtmonitor.unl.edu)".

### Radiation — EPA RadNet + Safecast

The optional radiation layer is a card, not a live feed of county
readings: it shows the nearest EPA RadNet gamma monitors' current
dose rate, with Safecast crowd measurements as a clearly-labeled
supplement, through the same-origin `/api/radiation` proxy (keyless).
The honest frame: there is **no RadNet monitor in Cape May County**
— the nearest are ~60–100 miles away (Philadelphia ~63 mi, Edison
~101 mi, haversine from the county seat) — so the card reports
*regional* background, not county radiation, and says so. The proxy
fetches the RadNet CDX REST CSVs for Edison, NJ and Philadelphia, PA
and takes the last APPROVED row of each (hourly readings, times UTC,
displayed in ET); Safecast is queried within 200 km (note: Safecast's
`distance` parameter is in **meters**, not kilometres). The CDX year
segment rolls yearly — the provider uses the current year and falls
back to the previous year in early January before the new file
exists. Readings are hourly; the proxy caches 60 minutes. On
upstream failure the layer serves the last cached readings with their
sample timestamps, labeled stale. A dose rate is never fabricated:
if a monitor has no reading, the card shows the other monitor +
"unavailable", never 0 nSv/h. Verified live 2026-11-16: Edison 39
nSv/h at 21:42 UTC (6,900 rows YTD), Philadelphia 41 nSv/h at 21:39
UTC — both APPROVED; typical background is ~30–60 nSv/h, so both are
in normal background. Edison is NJ's ONLY RadNet air monitor (gamma
since May 17, 2007; exposure rate since July 7, 2021); PA monitors:
Philadelphia, Bloomsburg, Pittsburgh; DE/MD have none. The old
Envirofacts efservice path is dead (301 → 404); do not use it.
Safecast's nearest rows within 200 km are 2017 Maryland measurements
(17–26 cpm) — a supplement only, never the headline. Open items:
monitor coordinates are city centers (pin the exact monitor
locations from the RadNet monitor pages at build time); air-filter
lab results are out of scope. Attribution: "EPA RadNet" (federal
public domain) and "Safecast (CC0)".

### Sanctions Watch — ArcNautical + AIS dark-vessel signals

The sanctions / dark-vessel watch layer (`sanctions-watch`, token `0u`)
screens vessels against sanctions lists and flags AIS-derived
dark-vessel signals. It is two halves: an on-demand ArcNautical
sanctions check (keyless) and local signals computed from the AIS feed
alone — silence vs coverage, impossible speed, identity change.

**HullCipher has NO public API** (verified 2026-11-16: the site is a
JS app, no developer docs found) — it is a link-out only, never
scraped or integrated. The live screening source is **ArcNautical**
(`https://arcnautical.com/developers/`), verified live 2026-11-17
~03:19 UTC: `GET https://arcnautical.com/api/v1/vessels/9169067/check`
→ HTTP 200, IMO 9169067 "MSC MIA SUMMER II", sanctions **GREEN**
across OFAC SDN, OpenSanctions, EU FSD, UN Consolidated, UK OFSI;
ownership opacity HIGH 70; vetting grade C 43; `checkedAt
2026-11-17T03:19:09Z`; tier keyless. The keyless tier is explicitly
"a sample for evaluation and occasional lookups, not a data feed":
**100 requests/hour per IP**, bursts smoothed (429 + `Retry-After`),
a fresh screen waits up to 10 s for one of 4 shared screening slots
else 503 `keyless_busy`. The layer therefore screens vessels one at a
time — only vessels with a dark-vessel signal, at most five per
refresh, never a bulk sweep — through the same-origin
`/api/sanctions/check?imo=…` proxy, which caches one hour per IMO
(the docs: a hull checked in the last hour answers from cache at
once) and honors 429/503 + `Retry-After`, serving the last cached
screening labeled stale or answering 502 with no cache. A free API
key (self-serve, no card, 2,000 screenings, full record) is William's
to mint on return — the layer keeps working keyless without it, and
this PR sends no key. A GREEN result is worded "no matches found in
the sources screened at <time>", never "this vessel is clean"; a
screening result is a match against a list, not a legal finding. The
full report links out to `https://arcnautical.com/check?imo=…`.
Attribution: "Screening: ArcNautical · AIS dark-vessel signals".

Dark-vessel signals (local, no third party): **silence** — no
position for >6 h while ≥3 other vessels in the box reported in the
last 15 min (rules out a receiver outage); the copy says "last seen
<time>, <n> h ago", never "gone dark" as a fact. **Impossible
speed** — reported speed >30 kn, or implied speed >50 kn between two
consecutive fixes (spoofed positions / mis-decoded MMSI).
**Identity change** — same MMSI reports a different name/IMO than its
last-seen identity, kept in-memory per MMSI. Signals are
observations, never accusations. Without `AISSTREAM_KEY` the AIS half
is inert ("no live vessels to screen") and the on-demand screener
still works from a pasted IMO. Open items: ArcNautical free key
(William mints on return); tap-a-vessel manual screening (no vessel
detail panel wiring in v1 — auto-screening of signaled vessels only);
flag from MMSI MID (needs a MID→country table, not shipped).

### Fishing Activity — own AIS presence + Global Fishing Watch link-out

The fishing-activity layer (`fishing-activity`, token `0v`) shows
which fishing vessels are present now in the county / Delaware Bay
box (lat 38.90–39.35, lon −75.15–−74.55), from our own AIS feed. It
shows **presence** — name/MMSI, position, speed, course, last-seen
time — never "fishing activity" or "fishing effort": a fishing
vessel underway is not necessarily fishing, and apparent fishing
effort belongs to Global Fishing Watch's model. The filter is AIS
ship type **30 (Fishing)** (31/32 towing excluded; a `/fishing/i`
type-string match is the defensive fallback for labeled types).
Zero fishing vessels in the box is a real steady state, shown
explicitly. No new server provider in v1: the layer reads the AIS
layer's analyst records client-side, and the GFW half is a link-out.

**Global Fishing Watch v3 API is key-gated** (verified 2026-11-17
~03:19 UTC: `GET https://gateway.api.globalfishingwatch.org/v3/vessels/search?query=test`
→ HTTP 401 — every v3 endpoint requires a Bearer token; no keyless
or demo path). The free token is William's to request on return
(register at `https://globalfishingwatch.org/our-apis/`); v2 wires
`/v3/4wings/report` (apparent fishing effort over the bbox) behind
`GFW_API_KEY`. **License flag: GFW data is CC BY-NC 4.0,
non-commercial use only** — Cape Dispatch is a free public service
today, which fits, but if it ever monetizes the GFW half must be
re-licensed or removed. The map itself
(`globalfishingwatch.org/map`) is free, no account; the layer links
to it centered on Delaware Bay
(`…/map/fishing-activity/default-public/?latitude=39.12&longitude=-74.85&zoom=9`
— the `latitude`/`longitude`/`zoom` params follow GFW's own example
workspace URLs; if they ever stop working, the link falls back to
the map home). Without `AISSTREAM_KEY` the layer shows the GFW map
link-out + the explainer ("fishing-vessel presence needs the AIS
feed — not configured"), never an empty map presented as "no fishing
vessels". Open items: GFW free token (William, on return); IUU risk
scoring from the GFW events API (encounters, loitering, AIS gaps) —
v1 claims no IUU judgment from AIS presence alone. Attribution:
"Fishing-vessel presence: own AIS · Apparent fishing effort: Global
Fishing Watch (CC BY-NC 4.0)".

### Vessel Info — AIS background + Equasis / Maritime Database link-outs

The vessel-info layer (`vessel-info`, token `0w`) is an enrichment
panel, not a map layer: it carries background rows for the vessels in
the AIS feed — identity fields from AIS plus link-outs to Equasis and
Maritime Database, where inspection / casualty / company records
live. Nothing is fetched from either reference, ever. The selected
vessel's card on the AIS layer carries the same enrichment as text
lines (IMO, reference names) — the overlay is text-only, so the
clickable links live in the analyst seam, not on the map.

**Equasis — free, registration required, bulk use restricted**
(verified live 2026-11-17: home → HTTP 200, "Its services are free
of any charge. You only need to register as a user."; last data
updates ~1 h old at check; 102,298,772 connections since 2007).
There is no public API, and **no Equasis account was created in this
PR** (no signups). Search needs registration, so the panel links the
home page with the vessel's name/IMO in the link text.

**Maritime Database — free core, no account for search** (verified
live 2026-11-17 ~03:21 UTC and again 2026-11-17 ~05:02 UTC: home →
HTTP 200, "50,000+ Vessels, 2,000+ Ports, 150+ Countries"; vessel
page example USNS BIG HORN, IMO 8812162, MMSI 368889000, callsign
NBIG, 207/30 m, GT 25742, built 1992). **URL caveat:** the vessel
page URL carries an internal `vesselid:` (54711) that cannot be
derived from IMO/MMSI alone, and no search URL is verified — a
`GET /search?query=8812162` probe returns the home page, not
results — so the panel links the home page and says so. Do not guess
a deep link, do not scrape the site to resolve vesselid → IMO. Free
core data is "provided for informational reasons only" per the
site's own disclaimer — the panel repeats that framing ("reference
only") and never presents Maritime Database data as Cape Dispatch's
own.

Many Class-B and fishing vessels broadcast no IMO — the panel says
"no IMO broadcast — search by name", never "unknown vessel". Without
`AISSTREAM_KEY` the panel is unreachable (it hangs off AIS vessels)
and the catalog entry says so. Open items: Equasis account — only
ever William's, if he wants in-app lookups later (out of scope, no
signups, no bulk use); casualty/inspection data in-app is impossible
without an Equasis account + a terms-compliant feed. Attribution:
"Background references: Equasis · Maritime Database (reference
only)".


### NAVAREA Warnings — NGA Maritime Safety Information (degraded: NGA 503)

The NAVAREA warnings layer (`navarea-warnings`, token `0x`) plots
navigational warnings in force from NGA's daily NAVAREA IV bulletin
— naval warnings, wrecks, drifting hazards, live-fire areas, failed
aids to navigation. Our waters are **NAVAREA IV** (NGA coordinates
IV and XII; IV covers the western Atlantic including the U.S. East
Coast, Caribbean, and Gulf of Mexico). The bulletins are **U.S.
federal public domain**; no key, no registration. The layer carries
NGA's note verbatim: "Never navigate from this map — check the
official bulletin." (NGA warnings supplement SOLAS broadcast
services.)

**BUILD BLOCKER — NGA is not serving automated fetches (verified
2026-11-17):** `msi.nga.mil` returns **HTTP 503** (Akamai apology
page) for the portal (`/NavWarnings`), the home page (`/home`), and
the documented bulletin download URL, from **both** this VM and
Legion (the server runs there). The VM's page fetcher earlier
returned 403 for the portal — the edge response varies, but the
outcome is the same: no live bulletin can be fetched today. No
workaround was attempted (no mirrors, no header tricks, no
alternate host). The provider degrades to the last cached bulletin
(disk cache survives restarts) labeled stale, or 502 with no cache —
the layer shows "NAVAREA warnings unavailable" with a link to the
portal, never an empty map presented as "no warnings". The layer is
complete and lights up when NGA serves again.

The download URL pattern is verified from NGA's own indexed
publication record:
`https://msi.nga.mil/api/publications/download?key=16694640/SFH00000/DailyMemIV.txt&type=view`
(crawled 2026-11-17; the indexed file content is real bulletin
text, 131651Z NOV 26, 109 warnings in force). The `key=` value may
rotate when NGA republishes — re-verify it from the live portal
when the site serves again, or override it with the `NGA_NAVAREA_KEY`
environment variable (same `key=` value form). **HYDROLANT is not
fetched in v1:** its download key/filename is unverified — that is
the follow-on once the portal serves again. Do NOT build on the
SeaLagom / LiveEarthViewer mirrors (third-party republishers, used
only as evidence the bulletins exist and are current).

Parsing (in `records.js`, shared by the provider): positions in
maritime format (`DD-MM.MM[N/S] DDD-MM.MM[E/W]`, also one-decimal
and no-decimal minutes); the in-force list inside the 1098/26-style
index block is authoritative; `CANCEL NAVAREA IV nnn/yy` lines drop
their warnings; the index block itself is not a warning; warnings
with no parseable position still list, without a pin. Categories
are OUR keyword reading (live-fire, wreck, drifting-object,
cable-work, aid-to-navigation, survey, other) — NGA publishes prose
with no subject field, and the layer never presents them as NGA's
own. A bulletin with zero warnings in our box is normal (most
NAVAREA IV warnings are Caribbean/Gulf) — the stats say "0 warnings
plotted in this view — <n> in force across NAVAREA IV". Polling is
once per day (bulletins are rebuilt daily); the provider caches
24 h. Attribution: "NGA Maritime Safety Information (msi.nga.mil)
— public domain".

### Ports + Chokepoints — NGA World Port Index snapshot (static)

The ports layer (`ports`, token `0y`) plots 10 Mid-Atlantic ports
(Cape May, Atlantic City, Philadelphia, Wilmington DE, Baltimore,
Hampton Roads/Norfolk, Newport News, New York, Newark, Brooklyn)
plus 9 global chokepoints (Hormuz, Malacca, Bab al-Mandab, Suez,
Panama, Gibraltar, Turkish Straits, Dover, Taiwan Strait) from a
hand-curated snapshot bundled in the repo
(`src/layers/ports/portsSnapshot.json`, version 1). Ports are
slow-moving, so this is a snapshot + manual refresh, not a live poll:
there is no server provider and no upstream to fail.

**Why a hand-curated snapshot (verified 2026-11-17):** the bulk WPI
download could not be fetched — The Port Index download URL
(`theportindex.online/data`) 404s, and `msi.nga.mil` returns HTTP 503
(the same blocker as the NAVAREA layer, verified from both this VM
and Legion). The Hugging Face mirror
(`programmer47/world-seaports-and-airports`) was not used: its
dataset viewer errors on the seaports file. Each coordinate in the
snapshot was pinned from a verified source and never invented:
port coordinates and depth classes from Rynda.io (which republishes
NGA WPI particulars) and USACE fact sheets / releases (Philadelphia
45 ft, Wilmington DE 38 ft, Baltimore 50 ft, Hampton Roads 50 ft);
chokepoint coordinates from Wikipedia infoboxes. Depths are carried
only where a solid source gave a number — otherwise null with a depth
class (`shallow` / `medium` / `deep`) and a note; the layer never
invents a number. Wilmington DE carries no UN/LOCODE: `USILM` is
Wilmington, North Carolina — do not use it for Delaware. Cape May's
pin is the harbor centroid (Canyon Club 38.95377,-74.90162; Cape May
Marina 38.94766,-74.91346).

Refresh (manual, documented in the snapshot's `method` field):
re-fetch WPI / The Port Index when it serves again, verify each
coordinate, bump `version`, update the pinning tests in
`src/layers/ports/records.test.mjs`. The snapshot is **U.S. federal
public domain** (NGA World Port Index, Pub 150); chokepoint
coordinates are facts from Wikipedia. Attribution: "Ports: NGA World
Port Index (public domain) · Chokepoints: Wikipedia".

### CCTV Camera Database (`src/layers/cctv/modelSpecs.js`)

The CCTV layer's hardware-model specs are a small extract (v2.26.0, plus the Bosch MIC
records from v2.29.0) of the
[CCTV Camera Database](https://github.com/ch-bas/cctv-camera-database), an open dataset of
camera models transcribed from manufacturer datasheets, dedicated to the public domain under
**CC0-1.0**. Only records for hardware named by the integrated public catalogs (King County,
Sarasota County and Sioux Falls) or by the City of Amsterdam register proposed in
[#251](https://github.com/bilawalsidhu/gods-eye-view/pull/251) are bundled, compiled into the
module. Nothing is fetched at runtime. The MIC records keep their specification fields; their
titles are shortened to model codes and colour aliases are added. The records describe camera
products (optics, resolution, night vision) only, never endpoints, stream paths or access data. CC0 requires no attribution; the CCTV HUD
credits it anyway as `SPECS: CCTV-DATABASE.COM` beside any spec line it renders.

### Bundled OpenStreetMap data

Bundled OSM-derived data is distributed under [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/), separately from the MIT code: [datacenters](src/data/local_data/datacenters/), [dams](src/data/local_data/dams/) (via Open Infrastructure Map), [military names](src/data/local_data/osm_military_names/), and [OSM test fixtures](src/data/fixtures/). Keep © OpenStreetMap contributors and offer modified databases under ODbL.

### NASA FIRMS acknowledgement

> We acknowledge the use of data and/or imagery from NASA's Fire Information for Resource Management System (FIRMS) (https://earthdata.nasa.gov/firms), part of NASA's Earth Observing System Data and Information System (EOSDIS).

FIRMS active fires are **fetched live at runtime** (CC0 / U.S. public domain data): the
`/api/firms` server-side proxy merges the three VIIRS NRT sources (NOAA-20, NOAA-21,
Suomi-NPP) and MODIS NRT (Terra + Aqua), clamped to the trailing 24 h, cached 30 min to respect the shared MAP_KEY
transaction quota. Requires a free `FIRMS_MAP_KEY`
(https://firms.modaps.eosdis.nasa.gov/api/map_key/); the layer is empty without it.
The former bundled 2026-05-25 snapshot was removed 2026-07-16.
### aprs.fi / CWOP weather stations

APRS / CWOP weather stations are **fetched live at runtime** through the
same-origin `/api/aprs` server-side proxy, which makes one batched
`what=wx` call for six Cape May County stations (KC2DUX, DW8913, FW2611,
K2GFM, CW8812, FW6400) every 5 minutes, only while the layer is enabled
(aprs.fi sends no CORS headers, and the key must never reach the browser).
Requires a free `APRSFI_API_KEY` (aprs.fi account settings); the layer is
empty without it. The proxy keeps a 5-minute memory cache only — no disk
cache, per the aprs.fi terms against archival collection. Credit, as the
terms require: "Weather: [aprs.fi](https://aprs.fi)".

### MassOutage — power outages, Cape May County

County power outages are **fetched live at runtime** through the
same-origin `/api/outages` server-side proxy, which makes three batched
calls (county headline, per-town areas, threshold alerts) for FIPS 34009
every 5 minutes, only while the layer is enabled. Keyless works; an
optional free key (`MASSOUTAGE_API_KEY`, created at
https://massoutage.com/account/api) is sent as `Authorization: Bearer`
and removes the keyless 5 req/5 min per-IP limit. On HTTP 429 the proxy
honors `Retry-After` and escalates keyless backoff 10 → 20 → 40 min
(capped at 60 min), serving stale cache meanwhile. Data is licensed
CC BY 4.0 and is an **unofficial aggregate** — confirm with the utility /
NJOEM / DOE EAGLE-I before acting; never present it as authoritative.
The alerts endpoint encodes the NJ 10% major-event line (N.J.A.C.
14:5-8.9); a utility is only shown "clear" when its connector status is
`county` or `utility` with `visible: true` and zero customers out.
Masked counts (`"<N"`) are unknown, never 0. The incidents endpoint
returned `[]` on 2026-11-16 while the county headline reported 4
incidents, so it is not a runtime source here; the per-town areas
endpoint (with bounding boxes) carries the map geometry instead.
Credit: "MassOutage (massoutage.com), unofficial aggregate, as of
<time>".

### EIA — weekly fuel prices (gasoline / diesel / heating oil)

Weekly fuel prices are **fetched live at runtime** through the
same-origin `/api/fuel` server-side proxy, which makes two batched
calls (retail gas/diesel route `petroleum/pri/gnd` and heating-oil
route `petroleum/pri/wfr`, 52 weeks each) every 6 hours, only while
the layer is enabled. A free key is **required** (`EIA_API_KEY`,
registered at https://www.eia.gov/opendata/register.php — email only,
no card); the key is sent as an `X-Api-Key` header, never in the URL
or logs. **Without a key the layer shows no prices at all** — it hides
its card and never fabricates a value. On HTTP 429 the proxy honors
`Retry-After` (else 60 s) and serves the last cached week meanwhile.
Series, week of 2026-11-09 (verified live 2026-11-16): PADD 1B regular
gas $4.146, US gas $3.995, PADD 1B diesel $6.412, US diesel $6.127, NJ
heating oil $6.052, PADD 1B heating oil $6.002, US heating oil $5.915.
There is **no New Jersey gasoline series** — PADD 1B (DE, DC, MD, NJ,
PA) is shown as a labeled regional proxy, never as a "NJ price";
heating oil does have a real NJ series (`W_EPD2F_PRS_SNJ_DPG`).
Heating oil is marked current ≤14 days, stale 15–60 days, and
season-ended after 60 days. Data is U.S. public domain.
Credit: "U.S. Energy Information Administration (EIA)".

### USGS Water Data API v1 — river gauges

River gauges are **fetched live at runtime** through the same-origin
`/api/gauges` server-side proxy, which makes **one batched call** per
refresh (comma-separated site + parameter values — repeated query
parameters do NOT batch on this API; it keeps the last value of each)
every 15 minutes, only while the layer is enabled. The new Water Data
API v1 (`api.waterdata.usgs.gov/ogcapi/v1/collections/
latest-continuous/items`) answers **200 keyless with no token** and
sends `Access-Control-Allow-Origin: *` (the proxy is still the shipped
path); the legacy endpoint is NOT used — it retires 2027-02-22. Sites:
01411000 Great Egg Harbor River at Folsom (39.5947, -74.8517) and
01411300 Tuckahoe River at Head of River (39.3069, -74.8206, in
county). 01411315 was excluded — it exists as a monitoring location
but returns zero latest-continuous features (no live telemetry), and
01411175 was excluded as stale since 2026-09-26. Verified live
2026-11-16: 01411000 discharge 67.6 ft³/s, gage height 3.76 ft at
17:00 UTC; 01411300 gage height 3.94 ft at 16:20 UTC, discharge
17.4 ft³/s at 16:05 UTC, all Provisional. **Gage height is gage
datum, not NAVD88** — labeled on every pin — and **data is
provisional** — surfaced on every pin. The API can return two features
for one site/parameter at the same timestamp (a real reading plus an
`EQUIP` quality-flagged null); the picker takes the newest non-EQUIP
reading with a real value, and EQUIP-only means missing, never 0. A
newest reading older than 2 h marks the pin stale (orange; current is
sky-blue). Data is U.S. public domain.
Credit: "Data courtesy of the U.S. Geological Survey".

### FAA NAS Status — airport ground stops, delays and closures

Airport status is **fetched live at runtime** through the same-origin
`/api/faa-status` server-side proxy, which fetches the FAA National
Airspace System Status XML feed
(`https://nasstatus.faa.gov/api/airport-status-information`), parses it
server-side, and filters to ACY/PHL/EWR plus nationwide per-category
counts, every 2 minutes, only while the layer is enabled. The feed is
**one national XML document** — there is no per-airport query and no
JSON variant — and **CORS is NOT enabled** on nasstatus.faa.gov, so the
server proxy is the only path. No key, no account, unauthenticated;
data is U.S. public domain. The old ASWS (`services.faa.gov`) is NOT
used — its live status is unconfirmed. Verified live 2026-11-16
(19:28 UTC): 2 ground stops (LGA airspace volume, AUS runway
construction), 2 ground delays (SAN airport volume 36 min avg / 1 h
12 min max; SFO low ceilings 1 h 5 min avg / 2 h 28 min max), 2
arrival/departure delays (LGA, SAN), 4 closures (SNA, LAX, SAN, LAS),
7 airports total, no ACY/PHL/EWR events — a quiet feed is the normal
steady state, not an error. Categories repeat in the feed (two separate
blocks are both named "Airport Closures"), so counts accumulate, never
overwrite. Start/Reopen carry no year ("Nov 16 at 07:30 UTC.") —
inferred from Update_Time, with Jan–Mar dates against Oct–Dec updates
rolling to the next year (e.g. SAN closure reopens Jan 01, 2027).
Ground stop / ground delay / airport closure naming ACY, PHL or EWR is
a high-priority alert; a quiet feed displays "no delays reported".
Severity: ground stop / closure major (red), ground delay moderate
(orange), arrival/departure minor (yellow). Update_Time older than 15
minutes flags the feed stalled.
Credit: "Source: FAA NAS Status".

### USCG Broadcast Notices to Mariners (Marine Warnings)

Marine Warnings are **fetched live at runtime** through the same-origin
`/api/marine-warnings` server-side proxy, which polls the Coast Guard's own
GovDelivery RSS feeds — Sector Delaware Bay
(`USDHSCG_248`, locally scoped) and District 5 (`USDHSCG_250`, filtered
client-side) — every 15 minutes, only while the layer is enabled
(GovDelivery sends no CORS headers). Free, keyless, U.S. public domain.
The proxy caches 15 minutes (memory + disk) with single-flight refresh and
serve-stale-on-failure. The layer is list-first: every in-force warning
appears in the panel, and only warnings with a parsed position get a map
pin — most ATON notices carry an aid name + LLNR and no position
(measured 2026-11-16: 60 of 200 live feed items carry a parseable
position, and the in-force kept set that day was 5 warnings, all
list-only). Severity is the layer's own heuristic (the source carries no
severity field). Credit: "Marine warnings: U.S. Coast Guard — Sector
Delaware Bay / District 5 (NAVCEN)".

**Not built — paid-only optional upgrade (William's call): SeaLagom.**
SeaLagom's maritime API would add coordinates (and more) for these
warnings, but its free tier is dead (3-day per-IP trial expired; list
endpoints die ~2026-11-19), the free tier carries no coordinates, it sends
no CORS headers, the paid Default plan is $18/mo, and its terms say a
company needs a licence to use the API inside a product. A future
LLNR→position join against the USCG Light List (free, public domain)
would raise the pin rate without a paid dependency; neither is built here.

### GDACS multi-hazard events (GDACS Hazards)

GDACS events are **fetched live at runtime** through the same-origin
`/api/gdacs` server-side proxy, which polls the GDACS RSS feed
(`https://www.gdacs.org/xml/rss.xml`) every 15 minutes, only while the
layer is enabled (GDACS sends no CORS headers). Free, keyless. The feed
itself is public domain; per-event resources are EU CC BY 4.0, and the
layer credits "GDACS — Global Disaster Alert and Coordination System".
The proxy caches 15 minutes (memory) with single-flight refresh,
60-second backoff on upstream failure (honoring `Retry-After`), and
serve-stale-on-failure; a cold cache answers 502.

The feed carries earthquakes, tropical cyclones, floods, droughts,
wildfires, volcanoes, and tsunamis, each with GDACS's own alert level
(Green / Orange / Red), country, position, severity, and affected
population. Live volumes measured 2026-11-17: 238 items — 205 wildfire,
13 drought, 13 flood, 5 earthquake, 2 tropical cyclone; 233 Green,
5 Orange, 0 Red. Wildfires dominate by count, so the layer offers a
type filter and caps map pins at 100 (Red first, then newest) while
the panel lists every event; events without a position list without a
pin. Alert levels are GDACS's own severity, never re-scored here.
Credit: "GDACS — Global Disaster Alert and Coordination System (public
domain; per-event resources EU CC BY 4.0)".

### Internet outages — IODA (Internet Outages)

Internet outages are **fetched live at runtime** through the
same-origin `/api/internet-outages` server-side proxy, which polls the
IODA v2 API (Georgia Tech, `api.ioda.inetintel.cc.gatech.edu/v2`) every
5 minutes, only while the layer is enabled. Free, keyless. Responses
carry "Copyright (c) 2021-2025 Georgia Tech Research Corporation" and
the layer credits "IODA — Internet Outage Detection and Analysis,
Georgia Tech". The proxy caches 5 minutes (memory) with single-flight
refresh, 60-second backoff on upstream failure (honoring
`Retry-After`), and serve-stale-on-failure; a cold cache answers 502.

Each refresh polls three scopes: the US country summary and the New
Jersey region summary (region code 4453, resolved live via
`/v2/entities/query` 2026-11-17) over the last 6 hours, and the global
recent alerts over the last 24 hours. The scoped summaries are usually
quiet — verified 2026-11-17: US summary over 6 h and 7 d, NJ summary
over 6 h and 7 d, and US-scoped alerts over 24 h all returned
`data:[]` — while global alerts carry the live signal (e.g. a BGP
critical alert for AS7821 ZAYO-MN, value 0 vs baseline 37, method
median; re-verified 2026-11-17 with a live BGP critical alert for
AS3094, value 61 vs baseline 65). An empty window is a real result
("no NJ outage events in the last 6 h"), never an error. Scores and
levels are IODA's own, never re-scored here; publication lags ~30 min
for BGP/probing and ~3 h for telescope data, so an empty result is not
an all-clear. The map carries a single county-seat anchor label (fuel
pattern) — outage entities have no map position of their own.
Cloudflare Radar (CC BY-NC 4.0, non-commercial) is the token-gated
upgrade only, not built here; William mints a free Radar-Read token if
that half is wanted.
Credit: "IODA — Internet Outage Detection and Analysis, Georgia Tech".

### Military installations — HIFLD Next MIRTA snapshot (HIFLD Installations)

Military installations are **not fetched live**. The layer ships a
frozen snapshot (`src/layers/hifldInstallations/mirtaSnapshot.json`,
built by `scripts/generate-hifld-snapshot.mjs` from the HIFLD Next
MIRTA DoD Sites – Points GeoJSON) because HIFLD Open shut down on
August 26, 2025 and the source data is dated August 25, 2023. The
snapshot holds 744 DoD sites (producer DoD DISDI, host HIFLD Next /
Data Rescue Project snapshot). The layer says so on every view:
"HIFLD snapshot — source data August 25, 2023; HIFLD Open shut down
August 26, 2025; not live." The snapshot's STAC license field reads
"other" (the origin is U.S. federal public domain). The generator
enforces exactly 744 features and throws on any dropped row; the
layer fails closed on a short or malformed snapshot.

The snapshot carries each site's name, state, MIRTA status code
(`act` 712, `clsd` 13, `care` 10, `excs` 4, `semi` 2, `envh` 1,
unknown 2), reporting component, joint-base flag, installation id,
and position. Installation ids repeat within a state (e.g. `34855`
covers both Fort Monmouth Main Post and Picatinny Arsenal), so row
ids pair the installation id with a name slug. New Jersey has 8
sites (Naval Weapons Station Earle, Joint Base McGuire-Dix-Lakehurst,
Picatinny Arsenal, Atlantic City IAP, NG Sea Girt NJ NGTC, NG
Lawrenceville, Waterfront, Fort Monmouth Main Post — closed 2011,
still in inventory) and Delaware has 4 (Dover AFB, New Castle
Airport, NG River Road Training Site, NG Bethany Beach Training
Site). The map pins the first 100 (NJ/DE first, then active); the
panel lists all 744 with a state filter. Coast Guard Training Center
Cape May is NOT in MIRTA (DoD-only; USCG is DHS) — the in-county CG
base is covered by the existing OSM-tile installations layer.
Credit: "HIFLD Next / MIRTA DoD Sites – Points (snapshot — not live)".

### Outbreaks — CDC ArboNET + WHO Disease Outbreak News (Outbreaks)

Outbreaks are **fetched live at runtime** through the same-origin
`/api/outbreaks` server-side proxy, which polls both halves once per
day, only while the layer is enabled. Free, keyless. The two halves
are never merged without a source label: **CDC ArboNET is the
county-relevant half** (West Nile virus is the mosquito-season angle
for Cape May County) and **WHO Disease Outbreak News is international
context only** — a US county pin is CDC, never WHO.

The CDC half reads the current-year dashboard JSON
(`cdc.gov/west-nile-virus/data-maps/current-data.json`, 32,086 B) for
the live CSV URLs under `wcms/vizdata/live/ncezid_dvbd/WNV/`, then the
CountbyState CSV (state cases) and the hum_nonhum CSV (county human +
non-human activity). Verified 2026-11-17: **New Jersey has 35 reported
West Nile cases this season** and **Cape May County (FIPS 34009) shows
non-human activity with 0 human cases** (virus detected in
mosquitoes/birds, no human cases in-county); neighbors with human cases
include Atlantic Co (2) and Camden Co (6). The county column is a FIPS
code, not a name; the provider ships NJ counties only plus the national
state table. The "current as of" date lives only on the CDC page
(November 10, 2026, split across elements) and is extracted from the
page HTML; if it cannot be found the layer says the as-of date is
unavailable rather than inventing one. CDC data are preliminary and
subject to change; counts are shown with their as-of date, never as
live. If the dashboard JSON is down, the provider falls back to the
known `wcms/vizdata` CSV paths.

The WHO half reads the OData feed
(`who.int/api/emergencies/diseaseoutbreaknews`, Sitefinity provider
`dynamicProvider372`, 50 items, newest first). Verified 2026-11-17:
latest DONs are Nov 13, 2026 MERS – Qatar (DON626), Nov 6, 2026 Ebola
disease caused by Bundibugyo virus, DRC/Kenya/Nigeria (DON625), Nov 6,
2026 Yellow fever, WHO African Region (DON624), and Nov 2, 2026
Shamonda virus in human, France (DON623). The old WHO RSS URL
(`who.int/feeds/entity/csr/don/en/rss.xml`) 404s and is never used; if
the OData provider id ever changes, the URL is re-extracted from the
DON listing page. DONs publish on event verification under IHR
protocols, not on a fixed clock.

**WHO content is CC BY-NC-SA 3.0 IGO — non-commercial only.** If Cape
Dispatch ever monetizes, the WHO half needs a license or removal. The
proxy caches 24 hours (memory) with single-flight refresh, 60-second
backoff on upstream failure (honoring `Retry-After`), and
serve-stale-on-failure; a cold cache answers 502. Each half fails
independently — one half down still serves the other, marked `ok:false`.
The map carries a single county-seat anchor label (fuel pattern) — the
CDC county table is a table, not pins, and WHO DONs have no map
position.
Credit: "CDC ArboNET (public domain) · WHO Disease Outbreak News (CC BY-NC-SA 3.0 IGO, non-commercial)".

### Fallout plume — NWS forecast winds (Fallout Plume)

The fallout plume is **computed client-side from a direct NWS fetch**:
the layer fetches the hourly forecast at the Salem/Hope Creek grid
cell (PHI/40,55) straight from `api.weather.gov` (CORS
`Access-Control-Allow-Origin: *`, verified 2026-11-17 — the tides
CO-OPS direct-fetch precedent), with no server provider. The existing
nws-wind provider serves current observations at ASOS stations, not
the 24-hour forecast the plume steps on, so it does not cover this
layer. Free, keyless. Verified live 2026-11-17: PHI/40,55 returns 200
with 156 hourly periods (`07:00–09:00 — 5 mph NW`); the Cape May cell
PHI/52,86 returns 200 with the same winds and is the county reference
only. The release grid cell was pinned via the NWS `/points/` lookup
for 39.4628,-75.5356 (gridId PHI, gridX 40, gridY 55).

The release point is the NRC Salem/Hope Creek site, **39.46278,
-75.53556** (39°27′46″N, 75°32′08″W, Lower Alloways Creek Twp, Salem
County, NJ, on Artificial Island) — the NRC FEMA exercise report
(ML082400494) and the NRC Additional Protocol filing (ML090270874)
agree; Hope Creek's own unit sits at 39.46778, -75.53806. The EPZ
reference circle is centered on the site with a **10-mile radius** (the
federal 10-mile plume EPZ standard).

**This is a simple wind plume — advection only. It is NOT a HYSPLIT
dispersion run, and it must never imply one: NOAA HYSPLIT has no
automation API** (the READY web server at `ready.noaa.gov` is an
interactive tool with no documented programmatic endpoint). The model
steps the centroid hour by hour downwind (windSpeed × 1 h along the
downwind bearing — NWS windDirection is the direction FROM which the
wind blows), inside a fixed 15° half-angle cone; a calm hour pools in
place (+1 mi cone width) and a missing wind ends the path early, never
guessed forward. There is no deposition, no chemistry/decay, no plume
rise, no terrain, no upper-air shear, no bay-breeze effect. The anchor
label carries "Advection only — not a HYSPLIT run" and "Planning aid
only — follow official guidance" on every view. **Planning aid only.
Official protective-action guidance comes from NJ OEM / Salem County
OEM and the plant's emergency plan — follow official instructions.**
The layer refreshes hourly; on an NWS failure the last good plume
stays drawn, marked stale.
Credit: "National Weather Service (api.weather.gov) · Simple wind plume — advection only, not a HYSPLIT run".

### Credibility + escalation scoring (Credibility scores)

The credibility score is **computed by the sidecar, not fetched**: the
`sidecar/app/credibility.py` scorer runs rules over stored `news_alerts`
rows and serves them at `/api/credibility` (proxied by the Node app via
`server/providers/sidecar.js`). No external source, no key, no license
question — it scores our own store.

Rules (pinned in `sidecar/app/credibility.py`; William sets the final
thresholds): tier 1 official sources (NWS, county Alert Center / news,
FAA ground-stop feeds, prosecutor / police releases) base 90; tier 2
local media (the blog writer's summarize+link set) base 70; tier 3
unvetted / unknown sources base 40; +10 per additional independent
source (cap +20); +5 when an official source confirms a media-first
story; −20 for a single unvetted source; −15 when a human flags the
cluster's sources as disagreeing. Clamped 0–100; a cluster with no
sources is unscored, never given a default 50. Trend (v1, from the alert
row only): Escalating = updated in the last 6 h, ≥ 2 sources, and (first
seen in the last 6 h or severity critical/high); Elevated = updated in
the last 6 h and (severity critical/high or ≥ 2 sources); Stabilizing =
anything else.

**Blocked at ingest, never scored, never shown:** RT, Sputnik, PressTV
(`rt.com`, `sputniknews.com`, `presstv.ir` — human-curated list in the
scorer). A cluster touching a blocked domain is excluded from the feed
and counted as `excluded_count` in the `/api/credibility` response.

The tier lists are pinned against `news_writer.AUTO_PUBLISH_SOURCE_IDS`
by `sidecar/tests/test_credibility_offline.py` so the score and the
publish gate cannot drift apart about what a source is. The disputed
−15 is implemented in the scorer but unwired in v1 (the endpoint passes
`disputed=False`) — it activates when a human dispute flag exists
(follow-on: a review-queue action). A score is never a legal or medical
determination; the panel always shows the breakdown that produced it.
Credit: "Cape Dispatch credibility scoring — rules over stored alerts".

### History / replay (History replay)

History is **our own store, served read-only**: the sidecar's
`sidecar/app/history.py` reads `aircraft_history` and `feed_history`
from the sidecar SQLite DB (opened with SQLite URI `mode=ro`) and serves
them at `/api/history/aircraft`, `/api/history/feed`, and
`/api/history/status` (proxied by the Node app via
`server/providers/sidecar.js`). No external source, no key, no license
question — it surfaces data we already collected. The endpoints never
touch `sidecar/migrate.py` (wipe-and-reload) and a replay query can
never write.

Schemas (verified against the 2026-11-15 backup, read-only):
`aircraft_history` 615,374 rows — `hex, kind, flight, lat, lon, alt,
speed, track, vrate, ac_type, cat, seen_at`, where `seen_at` is a
**millisecond epoch** and `kind` is `air` (602,103), `mil` (12,249), or
`emg` (1,022); no `ship` rows yet — ship history appears when the AIS
key lands and the recorder runs. `feed_history` 80,951 rows — `id,
source, source_label, cat, type, subtype, title, description, lat, lng,
pub_ms, created_at, raw_json`, where time is `pub_ms` (ms epoch).
Indexes exist on both time columns, so the window queries are index
scans.

Rules (pinned in `sidecar/app/history.py`): limit ≤ 500 rows per call;
time window ≤ 24 h per call (wider windows clamp to the latest 24 h);
the UI fetches 1-hour windows ending at the newest stored instant. A
seconds-epoch query is a 1970 window in ms and returns nothing, never a
wrong-century row. Rows carry positions and titles only — `raw_json`
and `description` never leave the store, so raw ACARS/dispatch text is
never republished. The replay shows, at cursor T, one pin per aircraft
at its latest stored position at or before T plus feed items from the
15 minutes before T; the row controls rewind (±15 min chips), play
(5 min of replay time per second, stops at the window end), jump to
Latest, and a 15-minute bucket list. An empty window is a real result —
"no stored positions in this window" with the window shown — never an
empty map presented as "nothing was there". Retention is undecided (the
store grows unboundedly); the status endpoint reports the honest window
so the UI never over-promises. Credit: "Cape Dispatch history — own
stored ADS-B + feed records".

### County risk score (County risk)

The county risk score is **rules-computed, never a bare LLM number**:
`src/data/countyRisk.js` scores five components from live layer states
— Weather 40% (NWS alerts + CO-OPS tides), Power 20% (Atlantic City
Electric outages), Hazards 20% (GDACS + USGS earthquakes + FIRMS fires),
Lightning 10% (GOES-19 GLM via the sidecar), Space weather 10% (NOAA
SWPC Kp / G-scale) — and the layer `src/layers/countyRisk/` reads those
inputs through lazy accessors to the already-constructed layers (the
localAdsb precedent); no layer reads another layer directly. The score
is a weighted mean over the components that have data; a missing
component is excluded and its weight renormalized, never silently
counted as zero. All inputs missing means no score at all, never a
default 0 shown as "all clear". An input older than its TTL (Weather /
Lightning 10 min, Power 15 min, Hazards / Space 60 min) marks the whole
score stale, never silently fresh. A band change is logged with the
component values that caused it.

Rules (DRAFT — William sets the final numbers): NWS warning active →
Weather ≥ 60; tide at/above the NWS minor-flood line (6.2 ft MLLW at
Cape May 8536110) → Weather ≥ 70; outages ≥ 1,000 customers → Power ≥
60, ≥ 1,000 and rising over the last hour → 80; GDACS Red near the
county → Hazards 90, Orange → 60; M≥4.0 quake within 100 km → 70,
M≥5.5 within 200 km → 90; a fire inside the county bbox → 50;
lightning 1–9 flashes / 30 min → 40, 10+ → 70, 100+ → 90, ≥ 10/min
sustained → 100; Kp 5 → 40, 6 → 60, 7 → 80, 8+ → 100 (G-scale fallback
when Kp is missing). Bands: 0–19 Low, 20–39 Guarded, 40–59 Elevated,
60–79 High, 80–100 Severe.

Honest limits, pinned in the build: river gauges are shown as context
only — neither USGS gauge in the county (01411000 Great Egg Harbor at
Folsom, 01411300 Tuckahoe at Head of River) has a published NWS flood
stage, so no threshold exists to score against. The fallout-plume layer
is NOT a score input — it is a scenario tool, and scoring it would raise
the score whenever it is opened. FIRMS fires are best-effort: the
analyst records are the top 2,000 detections by FRP, so a low-FRP county
fire could be truncated out of a busy global view. GDACS counts when the
event centroid is inside the county bbox or within 100 km of the county
center. Lightning comes from the sidecar (`GET /api/lightning/status`,
`sidecar/app/lightning_watch.lightning_status()` — county flashes in
the trailing 30/60 min, read-only on `lightning_watch.db`; 503 while the
watcher has never run, treated as a missing input). The outages trend
("rising") comes from the source's own in-memory 6-hour ring, because
the outages layer keeps no history. Credit: "Cape Dispatch county risk
— rules over live layer states".

### Daily brief (Daily brief)

The daily brief is the **blog writer pointed at the day instead of one
story**: once a day at 07:00 local (and once more within 15 minutes of a
critical alert) the sidecar synthesizes the last 24 h of stored
`news_alerts` + `news_items` into one post — What happened / Still
active / What to watch — stored as a `news_posts` row with
`topic_key='daily-brief'`, category Blog, slug `daily-brief-YYYY-MM-DD`,
and served at `GET /api/news/brief` (`sidecar/app/daily_brief.py`;
the scheduler is the `_brief_loop()` in `sidecar/main.py`, alongside
the writer loop). The layer `src/layers/dailyBrief/` only pins the
latest post at the top of the news panel with its date and confidence;
it never writes or summarizes anything itself.

The gate is the blog-writer gate, reused verbatim, never reimplemented:
auto-publish iff every source is auto-publish, no named individuals,
confidence ≥ 0.75, no EMS/patient content, and the draft passes
validation — otherwise the review queue (`/api/news/review`). A brief
older than 24 h is labeled stale with its date, never presented as
today's; a brief in review shows as in review, never as published.
With no `GEMINI_API_KEY` the loop is inert and logs once, and the panel
says the writer is not configured — no brief is ever faked or backfilled
from stale posts. A quiet day still gets a brief ("nothing new in the
last 24 hours") when the writer can say so at confidence ≥ 0.75.
Credit: "Cape Dispatch daily brief — blog writer over the last 24 h of
stored alerts and news; gated like every post".

### SatNOGS satellite observations

SatNOGS observations are **fetched live at runtime** through the
same-origin `/api/satnogs` server-side proxy, which polls the SatNOGS
Network observations API for the four Online ground stations within
200 km of Cape May County (W2MMD GCARC Clubhouse 223, KC3QNJ 2575, Alx2
4655, ka6akh-ground-station 3610 — re-discovered live 2026-11-16; the
nearest station overall, GS3 at 36 km, is Offline with 0 observations
and is excluded) every 20 minutes, only while the layer is enabled
(neither SatNOGS API sends CORS headers). Free, keyless,
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)
(confirmed on the Network About page, 2026-11-16). The proxy caches
20 minutes (memory + disk) with single-flight refresh and
serve-stale-on-failure, and resolves satellite names through the
SatNOGS DB API (observation records carry only a NORAD id), caching
names on disk by NORAD id.

Scope: trailing 7 days of completed (`status=good`) observations plus
the next 48 h of scheduled (`status=future`) observations, capped at
6 pages (150 rows) completed and 2 pages (50 rows) scheduled per
station — live volumes measured 2026-11-16 (first live refresh: 183
observations — 116 good + 29 future from the anchor station, 26 + 7
from ka6akh-ground-station, 5 future from KC3QNJ, none from Alx2) put
a refresh at ~14 observations requests (~42/hr) plus one DB lookup per
previously-unseen satellite (22 on the first refresh; names cached on
disk), inside the anonymous 60/hr observations budget. The layer is station-first: markers sit on the ground stations
(observations carry station lat/lng and no satellite position), and the
panel lists every observation under its station with waterfall PNG and
audio OGG links. Two stations (KC3QNJ, Alx2) had zero good observations
in the trailing 7 days at build time — their pins still show, with zero
counts. The layer ingests NO TLEs and predicts NO passes (the
TLE-based satellites layer already does that); the proxy drops the
observation TLE fields before they reach the client. Credit:
"Satellite observations: [SatNOGS](https://satnogs.org) (CC BY-SA 4.0)".

### UCS Satellite Database (`ucs_satellites/`)

Operator, owner country and purpose for active satellites, keyed by NORAD number, from the Union of Concerned Scientists Satellite Database release **UCS-Satellite-Database 5-1-2023** (data current through 2023-05-01; https://www.ucsusa.org/satellite_database). The satellites layer joins it to CelesTrak positions and SATCAT records to file each satellite as a station, imaging, telecom, Starlink, probe or debris object, and to name its operator and owner. Section 3 of the UCS database manual: "The Database is free and its use is unrestricted. We request that its use be acknowledged and referenced in written materials. References should include the version of the Database that was used, which is indicated by the name of the Excel file, and a link to or URL for the webpage www.ucsusa.org/satellite_database." The app acknowledges it in the Data attribution popover. UCS has paused updates since this release; Starlink rows are dropped (Starlink is classed by name). Build: `scripts/build-ucs-satellites.py`; curation in the folder README.

### Imaging sensor pack (`imaging_sensors/`)

Swath widths and ground resolutions for 46 Earth-observation platforms (Landsat, Sentinel, MODIS, VIIRS, GOES, Himawari, Gaofen, CBERS, RADARSAT, TerraSAR-X, COSMO-SkyMed, ALOS, KOMPSAT, SPOT, Pléiades, WorldView, SkySat, PlanetScope, ICEYE, Capella, Umbra and others), compiled 2026-11-04 from the operator and agency pages cited per entry. The orbital view draws each satellite's sensor swath to scale and caps its zoom at that swath. Facts only; no text or images copied. A swath is confirmed on an operator, agency (ESA's eoPortal included) or academic page; resellers are not cited. The CEOS MIM Database (CC BY 4.0) is not yet used. Sources and unverified values: the folder README.

### Natural Earth physical regions (`natural_earth/`)

Curated from the **Natural Earth 10m physical vectors** (https://www.naturalearthdata.com/ —
fetched from the canonical `nvkelso/natural-earth-vector` GitHub repo, commit
`ca96624a56bd078437bca8184e78163e5039ad19`, 2026-07-28): `ne_10m_geography_regions_polys`
(mountain ranges, deserts, plateaus, peninsulas, islands, …) → `regions.json` and
`ne_10m_geography_marine_polys` (seas, gulfs, straits, bays) → `marine.json`. They back the
voice-annotation resolver's named-natural-region lookup (`src/data/naturalEarthRegions.js`),
so "outline the Alps" draws the real range polygon offline.

Curation (provenance in each file's `meta` header): named features only, outer rings only,
Douglas-Peucker simplified at ~0.01° with coordinates rounded to 3 decimals, sub-20 km²
MultiPolygon crumbs and zero-area sliver artifacts dropped (7.3 MB source → 2.5 MB pack).

Natural Earth is **public domain** (no permission needed, no attribution legally required —
https://www.naturalearthdata.com/about/terms-of-use/). We credit anyway: "Made with Natural
Earth". Registration in the in-app `dataCredits.js` attribution list ships with the resolver
wiring (see below).

### Natural Earth populated places (`natural_earth/populated_places.json`)

Natural Earth 10m populated places (`ne_10m_populated_places_simple`, the same pinned
`nvkelso/natural-earth-vector` commit and SHA-256 as the admin-1 build reads), reduced to one
row per place: name, latitude and longitude rounded to 3 decimals, `scalerank` and `rank_max`
(7,342 places, 229 KB). From 8x the orbital view names the most prominent place within half
its width ("Sichuan, China · near Chengdu"), offline, with the states and provinces pack giving
the division. Public domain; credited "Made with Natural Earth" with the other packs. Rebuild:
`node scripts/build-admin-packs.mjs --only places`; provenance in the folder README.

### Sky background (`sky/`)

Sources, licences, the changes CC BY asks to state, hashes and build commands
are in [`sky/README.md`](src/data/local_data/sky/README.md).

### DataSF Analysis Neighborhoods (`neighborhoods/`)

`neighborhoods/san-francisco.json` bundles the City & County of San Francisco's official
**"Analysis Neighborhoods"** dataset (41 neighborhood polygons; DataSF dataset `j2bu-swwd`,
catalog map view
[`p5b7-5n3h`](https://data.sfgov.org/Geographic-Locations-and-Boundaries/Analysis-Neighborhoods-Map/p5b7-5n3h)).
It backs the voice-annotation resolver's offline neighborhood-boundary lookup
(`src/data/neighborhoodPolygons.js`), so "outline Chinatown" draws the city's real
boundary polygon with no network dependency.

The dataset is licensed **PDDL 1.0** (Open Data Commons Public Domain Dedication and
License — public domain; the DataSF metadata declares `licenseId: "PDDL"`). No attribution
is legally required; we note the source here and in the folder's `SOURCE.md`, which records
the retrieval date (2026-07-30), exact download URL, license evidence, and the
deterministic transform (`scripts/build-sf-neighborhoods.mjs`: `nhood` → `name`, ~2 m
Douglas-Peucker simplification, 6-decimal rounding).

### Local CCTV source packs (`config/`)

The server can read a local camera list from `CCTV_SOURCES_FILE` (default
`config/cctv_sources.austin.json`, which ships empty) and inline JSON from
`CCTV_SOURCES_JSON`; the two are merged, and inline entries win on a duplicate
id. A non-empty local pack replaces the live open-data camera packs unless
`CCTV_FORCE_AUSTIN=1` is set. The packs under `config/` show the schema, and a
pack's cameras keep their own source's license and attribution.

---

## Weather sources

### ECMWF IFS wind

Wind also offers ECMWF IFS 10 m forecasts from the keyless [ECMWF Open Data](https://www.ecmwf.int/en/forecasts/datasets/open-data) service. The proxy reads its JSON Lines inventory and byte-range fetches 10u/10v GRIB messages, optionally adding 2t (2 m temperature) or msl (mean sea-level pressure) from the same run and forecast time. It resamples these fields to the approximately 1° display grid. Data is licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The [ECMWF Terms of Use](https://apps.ecmwf.int/datasets/licences/general/) also apply. In-app attribution identifies this service as based on ECMWF data and products, links the CC BY 4.0 licence, identifies resampling and animation as modifications, and retains the required ECMWF liability disclaimer. Both model issue time and the selected forecast valid time appear in the WEATHER panel. These are model forecasts, not observations.

### NOAA GFS wind

The optional **Wind** layer animates the global 10 m wind field from NOAA's
Global Forecast System (GFS). The `/api/wind` server-side proxy selects the
latest available 0.25° cycle, reads its `.idx` inventory, byte-range fetches only
the `UGRD`/`VGRD` 10 m GRIB2 messages, optionally adding `TMP` at 2 m or
`PRMSL` at mean sea level from the same run and forecast time. It decodes the
selected messages with ecCodes (WASM), resamples to a compact grid (1° by
default), and serves a manifest plus Float32 U/V and optional scalar values. It is keyless, cached
per cycle for an hour, and is a **forecast, not an observation**: the particles
show model flow, not measured wind. The renderer bakes bounded curves through
the sampled field and animates their phase on the GPU, with a canvas fallback.
Any display lift is a visual aid and does not change the forecast's 10 m level.
NOAA GFS data is U.S. public domain; the credit above is a courtesy and does not
imply endorsement.

For both models, optional temperature is normalized from K to °C and pressure
from Pa to hPa before delivery. A missing, malformed or timed-out companion field
does not discard valid wind: the manifest marks that field unavailable, and the
UI retains wind without inventing scalar values. The proxy caches by model and
requested field, with bounded current/previous grids and shared in-flight loads.
Wind speed shading is computed locally from U/V and needs no companion download.
The legend and map-center reading explain units and forecast validity; the
animation is a visual flow through one forecast, not advancing forecast time.
Optional globe relief uses existing terrain vertex normals for view lighting;
without those normals it shades global globe curvature only, not local terrain
relief. Neither mode represents measured sunlight or a new elevation source.
This Wind prototype adds no cloud-volume or radar data. Mapped.earth's public
bundles were studied for rendering ideas, but
no code or assets were reused and no application licence granting reuse was
found. Its presentation is not a weather-data source for this implementation.

### Observed weather: NOAA nowCOAST

The Weather section provides keyless, observed **MRMS radar reflectivity** for the
contiguous United States and **infrared satellite imagery**. Fixed upstream WMS
services: `https://nowcoast.noaa.gov/geoserver/observations/weather_radar/ows` and
`https://nowcoast.noaa.gov/geoserver/observations/satellite/ows`.

- `conus_base_reflectivity_mosaic`: approximately 1 km, usually 4-minute updates.
  dBZ measures radar reflectivity, not rainfall rate, probability or future rain.
  Coverage gaps do not mean no precipitation. The numeric legend follows NOAA's
  `weather_radar_base_reflectivity` style.
- `goes_longwave_imagery`: GOES-19/18 Band 14, approximately 2 km, 5-minute updates,
  regional North America. **Clouds only** softly dims pixels with a linear
  brightness ramp from 0.40 to 0.70; **Full image** retains source alpha. This
  is a display filter, not a cloud mask or measured cloud volume.
- `global_longwave_imagery_mosaic`: approximately 3 km, hourly, nominal 60°S–60°N
  coverage and typically 2–3-hour latency. It is slower global context.

The UI displays the exact advertised observation time separately from acquisition;
latest means the newest available observation, not zero-delay real time. Up to 13
recent advertised frames can be replayed as history. No nowcast is synthesized.
Tiles use WMS 1.1.1 EPSG:4326 longitude/latitude bounds; Cesium's geographic 2×1
root grid is capped at level 6 for radar and regional GOES. Global infrared uses
one fixed 2048×1024 geographic image on both hosts: the source's request-dependent
contrast otherwise creates brightness seams between tiles. The browser decodes
and filters it once, then crops 256 px tiles bounded to the manifest extent at
maximum level 3. This broad context view has a coarser display resolution than
its 3 km source. No browser reprojection is used. Browser imagery owns a displayed
frame and a staging frame, retaining the outgoing layer for one render after
admission.

On Google 3D Tiles each observed product is instead a raised shell showing one
whole-extent image per frame (up to 4096×2048; global infrared 2048×1024). Every
product except global infrared also draws a 4096×2048 detail window around the
view, requested with a 2:1 `bbox` inside the product bounds, rounded to 0.25°.
The proxy has an 8-request concurrency budget and a 12-second deadline; tiles
(256, 512 or 1024 px) are capped at 1 MiB or 4 bytes per pixel plus 64 KiB,
whichever is larger, and whole-extent and detail images at 16 MiB. Its shared
cache holds up to 128 images and 16 MiB, each exact-time image for at most 24
hours.
Metadata refreshes every two minutes with explicitly stale last-good fallback.
No key, new dependency, image reprojection job, or full-disk image download is needed.

Credit: NOAA nowCOAST, NWS/OAR MRMS, NESDIS GOES and global satellite partners.
[NOAA disclaimer](https://oceanservice.noaa.gov/disclaimer.html).
Community context: [#85](https://github.com/bilawalsidhu/gods-eye-view/issues/85),
[#588 radar](https://github.com/bilawalsidhu/gods-eye-view/pull/588), and
[#457 clouds](https://github.com/bilawalsidhu/gods-eye-view/pull/457).
This implementation is original; those contributions have not been merged here.


### Weather: NHC/CPHC cyclone advisories

- **Sources:** [NHC current tropical cyclone status](https://www.nhc.noaa.gov/CurrentStorms.json) and
  [NOAA tropical weather summary GIS](https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather_summary/MapServer).
- **Rights/credit:** NOAA/NWS National Hurricane Center / Central Pacific Hurricane Center;
  [NWS public-data terms](https://www.weather.gov/disclaimer). Fetch official products at runtime;
  no bundled advisory archive and no NOAA endorsement implied.
- **Coverage/meaning:** Atlantic and eastern/central North Pacific, not global cyclone coverage.
  Status position time and advisory issue time remain separate. Forecast track, points and cone
  require matching advisory numbers across all GIS parts. Cone means uncertainty in the
  forecast center track, not storm size or a complete hazard boundary.
- **Delivery:** keyless same-origin `/api/cyclones`, five-minute singleflight cache,
  fixed upstream endpoints, bounded bodies/geometry/deadline, explicit unavailable/stale states.
  Direct status fetching is unsuitable in browsers because NHC does not advertise CORS.

### Weather: observed lightning density

- **Source:** [NOAA nowCOAST lightning detection WMS](https://nowcoast.noaa.gov/geoserver/observations/lightning_detection/ows),
  fixed `ldn_lightning_strike_density` layer and `lightning_density` style.
- **Rights/credit:** NOAA/NWS nowCOAST; derived from Vaisala NLDN/GLD360.
  [Official product description and public distribution terms](https://ocean.weather.gov/lightning/lightning_pdd.php)
  permit distribution of this NOAA Level-5 derived product, not raw Vaisala detections.
- **Meaning:** 15-minute accumulated density on an approximately 8 km grid;
  source color scale is strikes per km² per minute ×10³. Not individual GLM optical flashes,
  a live ground-strike counter, an all-clear indication, or global coverage.
- **Coverage:** 110°E across the Pacific/Americas to 0°, 25°S–80°N. Display exact advertised
  observations; ten-minute metadata refresh, source-matched colors, bounded shared imagery cache.

### Community weather prior art

The weather design builds on Gustavo Beneduzi's retained GFS/ECMWF contribution
commits ([#459](https://github.com/bilawalsidhu/gods-eye-view/pull/459),
[#464](https://github.com/bilawalsidhu/gods-eye-view/pull/464)). Related community
proposals informed the observed-weather experience: Sandiv D's on-demand radar
and imagery controls ([#588](https://github.com/bilawalsidhu/gods-eye-view/pull/588));
Gustavo Beneduzi's GOES and GLM source work
([#457](https://github.com/bilawalsidhu/gods-eye-view/pull/457),
[#458](https://github.com/bilawalsidhu/gods-eye-view/pull/458)); and HadiMuhammed's
NOAA hazard provenance and freshness work
([#414](https://github.com/bilawalsidhu/gods-eye-view/pull/414)).
The fixed nowCOAST imagery and NHC advisory implementations are original maintainer
work; this acknowledgement does not represent merging those four PRs or equate
NOAA density imagery with the raw GLM product.

---

## In-app attribution

The required Google Maps / Cesium credit renders on the on-globe credit line (`#cesium-credits`, bottom-left) and must stay visible — including in clean-view and recording modes (the whole line, logo + "Google Maps" + the "Data attribution" link, stays on screen; only the GEV panels/HUD fade). The layer-specific credits (adsb.lol, adsbdb, TeleGeography, OSM datacenters/dams/roads, NASA FIRMS, CelesTrak, USGS, City of Austin, Fintraffic, GBFS, Radio Browser, OpenSky, AISStream) are registered into the expandable **"Data attribution"** popover on that credit line via `viewer.creditDisplay.addStaticCredit(new Cesium.Credit(html, /* showOnScreen */ false))` — see `src/data/dataCredits.js`. When you add a new data source, add its license and attribution to this file **and** append an entry to `DATA_CREDITS` in `src/data/dataCredits.js` so it surfaces in the app.
