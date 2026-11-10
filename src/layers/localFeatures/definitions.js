/**
 * The local-awareness map layers: one entry per /api/local source, with the
 * details record each map item opens. Records only carry what the source
 * provided; the details window drops empty fields.
 */
import { easternTime } from '../../local/format.js';

const ft = (v) => (v == null ? null : `${Number(v).toFixed(1)} ft`);
const deg = (v) => (v == null ? null : `${v}°`);
const src = (env) => ({
  source: env.source?.name || null,
  sourceUrl: env.source?.url || null,
});
const at = (iso) => (iso ? easternTime(iso) : null);
const titleCase = (s) => String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export const LOCAL_LAYER_DEFINITIONS = [
  {
    id: 'nws-alerts',
    name: 'NWS Alerts',
    icon: '⚠️',
    sourceLabel: 'National Weather Service',
    endpoint: 'nws-alerts',
    filterable: false, // never hide an official warning
    updateInterval: 120000,
    labelLimit: 6,
    fillAlpha: 0.1,
    toRecord: (f, env) => ({
      kindLabel: 'NWS ALERT',
      title: f.title,
      subtitle: f.headline,
      status: 'official',
      timeLabel: 'Issued',
      observedAt: f.observedAt,
      ...src(env),
      link: f.link,
      instruction: f.instruction,
      description: f.description,
      fields: [
        ['Severity', f.severity],
        ['Urgency', f.urgency],
        ['Certainty', f.certainty],
        ['Areas', f.areaDesc],
        ['In effect from', at(f.effective)],
        ['Expires', at(f.expires)],
        ['Issued by', f.sender],
        ['Message', f.messageType],
      ],
      note: 'Official NWS text. Follow the issuing office and Cape May County OEM for protective actions.',
    }),
  },
  {
    id: 'tide-gauges',
    name: 'Tide & Flood Gauges',
    icon: '🌊',
    sourceLabel: 'NOAA / NWS NWPS · CO-OPS',
    endpoint: 'tide-gauges',
    updateInterval: 360000,
    labelLimit: 24,
    toRecord: (f, env) =>
      f.kind === 'tide-station'
        ? {
            kindLabel: 'TIDE STATION',
            title: f.title,
            status: f.status,
            timeLabel: 'Observed',
            observedAt: f.observedAt,
            ...src(env),
            link: f.link,
            fields: [
              ['Observed water level', f.observed ? `${ft(f.observed.value)} above MLLW` : 'No recent observation'],
              ['Data quality', f.observed?.quality],
              ...f.predictions.map((p) => [`Predicted ${p.type} tide`, `${ft(p.ft)} · ${at(p.time)}`]),
              ['NOAA station', f.stationId],
            ],
            note: 'Predicted tides are astronomical only and do not include storm surge. Observed level is a measurement.',
          }
        : {
            kindLabel: f.tidal ? 'TIDAL FLOOD GAUGE' : 'RIVER GAUGE',
            title: f.title,
            status: f.status,
            timeLabel: 'Observed',
            observedAt: f.observedAt,
            ...src(env),
            link: f.link,
            fields: [
              ['Observed', f.observed ? `${ft(f.observed.value)} (${f.datum})` : 'Not reporting in the last 3 h'],
              ['Observed category', f.observed?.category ? titleCase(f.observed.category) : null],
              ['Forecast peak (FORECAST)', f.forecast ? `${ft(f.forecast.value)} · ${at(f.forecast.time)}` : null],
              ['Forecast category', f.forecast?.category ? titleCase(f.forecast.category) : null],
              [
                'Official flood stages',
                f.floodStages
                  ? ['action', 'minor', 'moderate', 'major']
                      .filter((k) => f.floodStages[k] != null)
                      .map((k) => `${titleCase(k)} ${f.floodStages[k]} ft`)
                      .join(' · ')
                  : null,
              ],
              ['Gauge id', f.lid],
            ],
            note: f.tidal
              ? 'Tidal gauge: feet above MLLW. Compare only with this gauge’s own flood stages.'
              : 'River gauge: feet of stage. Compare only with this gauge’s own flood stages.',
          },
  },
  {
    id: 'power-outages',
    name: 'Power Outages',
    icon: '💡',
    sourceLabel: 'Atlantic City Electric',
    endpoint: 'power-outages',
    updateInterval: 300000,
    toRecord: (f, env) => ({
      kindLabel: 'POWER OUTAGE',
      title: f.title,
      subtitle: `${f.county} County`,
      status: 'reported',
      ...src(env),
      sourceUrl: 'https://outagemap.atlanticcityelectric.com/',
      fields: [
        ['Customers out', f.customersOut?.toLocaleString('en-US')],
        ['Customers served', f.customersServed?.toLocaleString('en-US')],
        ['Percent out', f.percentOut != null ? `${f.percentOut}%` : null],
        ['Outage incidents', f.outageCount],
        ['Estimated restoration', f.etr],
      ],
      note: 'Customer counts as reported by Atlantic City Electric’s public outage map (town totals, not exact locations). Map point = town center.',
    }),
  },
  {
    id: 'traffic-incidents',
    name: 'Traffic Incidents',
    icon: '🚧',
    sourceLabel: 'TomTom',
    endpoint: 'traffic-incidents',
    updateInterval: 180000,
    labelLimit: 20,
    toRecord: (f, env) => ({
      kindLabel: 'TRAFFIC INCIDENT',
      title: f.title,
      subtitle: f.road || f.from || null,
      status: 'reported',
      timeLabel: 'Last reported',
      observedAt: f.observedAt,
      ...src(env),
      description: f.description,
      fields: [
        ['Road', f.road],
        ['From', f.from],
        ['To', f.to],
        ['Delay', f.delaySeconds ? `${Math.round(f.delaySeconds / 60)} min` : null],
        ['Started', at(f.startTime)],
        ['Expected end', at(f.endTime)],
      ],
      note: 'Reported by TomTom. Traffic flow (speeds) is the separate Street Traffic layer.',
    }),
  },
  {
    id: 'emergency-facilities',
    name: 'Emergency Facilities',
    icon: '🏥',
    sourceLabel: 'OpenStreetMap',
    endpoint: 'emergency-facilities',
    updateInterval: 6 * 3600e3,
    labelLimit: 30,
    toRecord: (f, env) => ({
      kindLabel: String(f.facilityType || 'Facility').toUpperCase(),
      title: f.title,
      status: 'reference',
      ...src(env),
      link: f.link,
      fields: [
        ['Type', f.facilityType],
        ['Address', f.address],
        ['Phone', f.phone],
        ['Operator', f.operator],
        ['Emergency department', f.emergencyDepartment],
        ['Website', f.website],
      ],
      note: 'Location from OpenStreetMap (volunteer-mapped). Confirm before relying on it. This is not a list of open shelters — check Cape May County OEM. In an emergency call 911.',
    }),
  },
  {
    id: 'marine-buoys',
    name: 'Marine Buoys',
    icon: '🛟',
    sourceLabel: 'NOAA NDBC',
    endpoint: 'marine-buoys',
    updateInterval: 900000,
    toRecord: (f, env) => ({
      kindLabel: 'MARINE BUOY / STATION',
      title: f.title,
      status: f.status,
      timeLabel: 'Observed',
      observedAt: f.observedAt,
      ...src(env),
      link: f.link,
      fields: [
        ['Wave height', f.reading?.waveHeightFt != null ? `${f.reading.waveHeightFt} ft` : null],
        ['Dominant wave period', f.reading?.dominantPeriodS != null ? `${f.reading.dominantPeriodS} s` : null],
        ['Water temperature', f.reading?.waterTempF != null ? `${f.reading.waterTempF} °F` : null],
        ['Air temperature', f.reading?.airTempF != null ? `${f.reading.airTempF} °F` : null],
        ['Wind', f.reading?.windSpeedKt != null ? `${deg(f.reading.windDirDeg) || ''} ${f.reading.windSpeedKt} kt${f.reading.gustKt ? `, gusts ${f.reading.gustKt} kt` : ''}`.trim() : null],
        ['Pressure', f.reading?.pressureMb != null ? `${f.reading.pressureMb} mb` : null],
        ['Station type', f.stationType],
        ['Error', f.error],
      ],
      note: f.status === 'not-reporting' ? 'No observation in the last 3 hours.' : 'Measured values; sensors a station lacks are not shown.',
    }),
  },
  {
    id: 'airport-weather',
    name: 'Airport Weather',
    icon: '🛬',
    sourceLabel: 'NOAA Aviation Weather Center',
    endpoint: 'airport-weather',
    updateInterval: 600000,
    labelLimit: 18,
    toRecord: (f, env) => ({
      kindLabel: 'AIRPORT WEATHER (METAR)',
      title: f.title,
      status: f.status,
      timeLabel: 'Observed',
      observedAt: f.observedAt,
      ...src(env),
      link: f.link,
      fields: [
        ['Flight category', f.flightCategory],
        ['Wind', f.windKt != null ? `${deg(f.windDirDeg) || f.windDirDeg || ''} ${f.windKt} kt${f.gustKt ? `, gusts ${f.gustKt} kt` : ''}`.trim() : null],
        ['Visibility', f.visibility != null ? `${f.visibility} statute mi` : null],
        ['Temperature', f.tempF != null ? `${f.tempF} °F` : null],
        ['Altimeter', f.altimeterInHg != null ? `${f.altimeterInHg} inHg` : null],
        ['Raw METAR', f.rawMetar],
      ],
    }),
  },
  {
    id: 'whale-zones',
    name: 'Right Whale Speed Zones',
    icon: '🐋',
    sourceLabel: 'NOAA Fisheries',
    endpoint: 'whale-zones',
    filterable: false,
    updateInterval: 6 * 3600e3,
    fillAlpha: 0.08,
    toRecord: (f, env) => ({
      kindLabel: 'RIGHT WHALE SEASONAL MANAGEMENT AREA',
      title: f.title,
      status: 'regulatory',
      ...src(env),
      fields: [
        ['In effect today', f.inEffect === true ? 'Yes' : f.inEffect === false ? 'No' : 'Check NOAA'],
        ['Season', f.period],
        ['Restriction', f.restriction],
        ['Regulation', f.regulation],
      ],
      note: 'During the season, vessels 65 ft (19.8 m) or longer must travel 10 knots or less in this area (50 CFR 224.105). Dynamic or temporary zones are not shown — check NOAA Fisheries.',
    }),
  },
  {
    id: 'military-areas',
    name: 'Military / USCG Areas',
    icon: '🎖️',
    sourceLabel: 'OpenStreetMap',
    endpoint: 'military-areas',
    filterable: false,
    updateInterval: 6 * 3600e3,
    fillAlpha: 0.06,
    labelLimit: 10,
    toRecord: (f, env) => ({
      kindLabel: 'MILITARY / USCG AREA',
      title: f.title,
      status: 'reference',
      ...src(env),
      link: f.link,
      fields: [
        ['Branch', f.branch],
        ['Operator', f.operator],
      ],
      note: 'Boundary from OpenStreetMap (volunteer-mapped, not authoritative). Not an airspace or navigation chart.',
    }),
  },
  {
    id: 'airport-radio',
    name: 'Airport Radio (ATC)',
    icon: '🛫',
    sourceLabel: 'LiveATC KACY · transcribed locally',
    endpoint: 'airport-radio',
    filterable: false,
    updateInterval: 30000,
    labelLimit: 1,
    // Every transmission is at the same tower; the map shows the newest one
    // and the Calls board lists the rest.
    include: (f, index) => index === 0,
    toRecord: (f, env) => atcRecord(f, env),
  },
  {
    id: 'scanner-calls',
    name: 'Police, Fire & EMS Calls',
    icon: '🚨',
    sourceLabel: 'Fire Wire scanner',
    endpoint: 'public-safety-calls',
    updateInterval: 30000,
    labelLimit: 30,
    toRecord: (f, env) => callRecord(f, env),
  },
  {
    id: 'predicted-flooding',
    name: 'Predicted Flooding (estimate)',
    icon: '🌧️',
    sourceLabel: 'NOAA SLR Viewer + NWS forecasts',
    endpoint: 'predicted-flooding',
    filterable: false,
    updateInterval: 600000,
    toRecord: (f, env) => ({
      kindLabel: 'FLOOD ESTIMATE',
      title: f.title,
      status: 'estimated',
      ...src(env),
      fields: [
        ['Estimated water level', `about ${f.levelFt} ft above normal high tide (MHHW)`],
        ['Based on', `${f.gauge} gauge — ${f.basis}`],
        ['Gauge category', f.category ? titleCase(f.category) : null],
        ['Forecast peak time', at(f.time)],
      ],
      note: env.note,
    }),
  },
  {
    id: 'community-reports',
    name: 'Community Reports',
    icon: '📣',
    sourceLabel: 'Residents (reviewed, unverified)',
    endpoint: 'reports',
    updateInterval: 300000,
    toRecord: (f, env) => ({
      kindLabel: 'COMMUNITY REPORT',
      title: f.title,
      status: f.status,
      timeLabel: 'Reported',
      observedAt: f.observedAt,
      ...src(env),
      link: f.id ? `/incidents/${encodeURIComponent(f.id)}` : null,
      description: f.text,
      note: 'Shared by a resident and reviewed for publication. Not a confirmed fact unless marked VERIFIED.',
    }),
  },
];

export function callRecord(f, env) {
  const cleanId = f?.id ? String(f.id).replace(/^call:/i, '') : null;
  return {
    kindLabel: 'POLICE / FIRE / EMS CALL',
    title: f.title,
    subtitle: [f.location, f.municipality].filter(Boolean).join(' · ') || null,
    status: 'transcribed',
    timeLabel: 'Heard',
    observedAt: f.observedAt,
    source: env?.source?.name || 'Fire Wire scanner',
    link: cleanId ? `/incidents/${encodeURIComponent(cleanId)}` : null,
    audioUrl: f.audio,
    description: f.summary,
    fields: [
      ['Priority', f.priority ? titleCase(f.priority) : null],
      ['Units heard', f.units],
    ],
    note: 'Automatically transcribed from public scanner audio. Unconfirmed — not an official dispatch record. Sensitive calls are withheld.',
  };
}

export function atcRecord(f, env) {
  return {
    kindLabel: 'AIRPORT RADIO · ATLANTIC CITY (KACY)',
    title: f.title,
    status: 'transcribed',
    timeLabel: 'Transmitted',
    observedAt: f.observedAt,
    source: env?.source?.name || 'LiveATC KACY (transcribed locally)',
    sourceUrl: env?.source?.url || null,
    transcript: f.transcript,
    transcriptNote: f.transcriptNote,
    audioUrl: f.audio,
    fields: [
      ['Callsigns heard', f.callsigns],
      ['Runway', f.runway],
      ['Facility', f.facility],
      ['Emergency flagged', f.emergency ? 'Yes (automatic keyword match — unconfirmed)' : null],
    ],
    note: 'Machine transcript of public air-traffic radio; it may mishear callsigns and numbers.',
  };
}
