/**
 * @module cityPois
 * @description Cape May County, NJ town quick-jumps - plain data with no
 * Cesium, so modules that only need the names (voice cards) can import it.
 */
/**
 * Points of Interest per city.
 * Each city has at least 1 POI; the first is the default fly-to landmark.
 *
 * Field reference:
 *   alt     - RANGE (distance from target in meters), NOT absolute altitude
 *   heading - optimal camera heading in degrees (0=N, 90=E, 180=S, 270=W)
 *   pitch   - camera tilt in degrees (negative = looking down)
 *   buildingHeight - estimated height of landmark center above ground (meters)
 */
export const CITY_POIS = {
  capemay: {
    name: 'Cape May City',
    groundElevation: 2,
    viewBounds: {
      southwest: { lat: 38.92, lng: -74.93 },
      northeast: { lat: 38.95, lng: -74.89 },
    },
    pois: [
      {
        name: 'Cape May City',
        lat: 38.935,
        lon: -74.906,
        alt: 8000,
        pitch: -60,
        heading: 0,
        buildingHeight: 10,
      },
    ],
  },
  wildwood: {
    name: 'Wildwood',
    groundElevation: 2,
    viewBounds: {
      southwest: { lat: 38.97, lng: -74.84 },
      northeast: { lat: 39.01, lng: -74.79 },
    },
    pois: [
      {
        name: 'Wildwood',
        lat: 38.992,
        lon: -74.812,
        alt: 8000,
        pitch: -60,
        heading: 0,
        buildingHeight: 10,
      },
    ],
  },
  oceancity: {
    name: 'Ocean City',
    groundElevation: 2,
    viewBounds: {
      southwest: { lat: 39.26, lng: -74.60 },
      northeast: { lat: 39.30, lng: -74.56 },
    },
    pois: [
      {
        name: 'Ocean City',
        lat: 39.278,
        lon: -74.577,
        alt: 8000,
        pitch: -60,
        heading: 0,
        buildingHeight: 10,
      },
    ],
  },
  avalon: {
    name: 'Avalon / Stone Harbor',
    groundElevation: 2,
    viewBounds: {
      southwest: { lat: 39.05, lng: -74.77 },
      northeast: { lat: 39.12, lng: -74.70 },
    },
    pois: [
      {
        name: 'Avalon / Stone Harbor',
        lat: 39.077,
        lon: -74.737,
        alt: 10000,
        pitch: -60,
        heading: 0,
        buildingHeight: 10,
      },
    ],
  },
  stoneharbor: {
    name: 'Stone Harbor',
    groundElevation: 2,
    viewBounds: {
      southwest: { lat: 39.03, lng: -74.78 },
      northeast: { lat: 39.07, lng: -74.74 },
    },
    pois: [
      {
        name: 'Stone Harbor',
        lat: 39.054,
        lon: -74.761,
        alt: 8000,
        pitch: -60,
        heading: 0,
        buildingHeight: 10,
      },
    ],
  },
  seaislecity: {
    name: 'Sea Isle City',
    groundElevation: 2,
    viewBounds: {
      southwest: { lat: 39.13, lng: -74.71 },
      northeast: { lat: 39.17, lng: -74.67 },
    },
    pois: [
      {
        name: 'Sea Isle City',
        lat: 39.154,
        lon: -74.692,
        alt: 8000,
        pitch: -60,
        heading: 0,
        buildingHeight: 10,
      },
    ],
  },
  capecourthouise: {
    name: 'Cape May Court House',
    groundElevation: 10,
    viewBounds: {
      southwest: { lat: 39.06, lng: -74.86 },
      northeast: { lat: 39.11, lng: -74.80 },
    },
    pois: [
      {
        name: 'Cape May Court House',
        lat: 39.084,
        lon: -74.831,
        alt: 15000,
        pitch: -60,
        heading: 0,
        buildingHeight: 10,
      },
    ],
  },
  wildwoodcrest: {
    name: 'Wildwood Crest',
    groundElevation: 2,
    viewBounds: {
      southwest: { lat: 38.96, lng: -74.85 },
      northeast: { lat: 38.99, lng: -74.81 },
    },
    pois: [
      {
        name: 'Wildwood Crest',
        lat: 38.979,
        lon: -74.828,
        alt: 8000,
        pitch: -60,
        heading: 0,
        buildingHeight: 10,
      },
    ],
  },
  northwildwood: {
    name: 'North Wildwood',
    groundElevation: 2,
    viewBounds: {
      southwest: { lat: 38.99, lng: -74.81 },
      northeast: { lat: 39.02, lng: -74.78 },
    },
    pois: [
      {
        name: 'North Wildwood',
        lat: 39.004,
        lon: -74.796,
        alt: 8000,
        pitch: -60,
        heading: 0,
        buildingHeight: 10,
      },
    ],
  },
  villas: {
    name: 'Villas',
    groundElevation: 2,
    viewBounds: {
      southwest: { lat: 38.93, lng: -74.96 },
      northeast: { lat: 38.96, lng: -74.92 },
    },
    pois: [
      {
        name: 'Villas',
        lat: 38.942,
        lon: -74.942,
        alt: 8000,
        pitch: -60,
        heading: 0,
        buildingHeight: 10,
      },
    ],
  },
  countyoverview: {
    name: 'County Overview',
    groundElevation: 10,
    viewBounds: {
      southwest: { lat: 38.85, lng: -75.0 },
      northeast: { lat: 39.4, lng: -74.5 },
    },
    pois: [
      {
        name: 'County Overview',
        lat: 39.1,
        lon: -74.75,
        alt: 55000,
        pitch: -90,
        heading: 0,
        buildingHeight: 10,
      },
    ],
  },
};