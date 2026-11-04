/**
 * @module cityPois
 * @description Preset places and their landmarks — plain data with no Cesium,
 * so modules that only need the names (voice cards) can import it.
 *
 * This Cape May fork keeps the tri-state set only: Cape May, South Jersey,
 * and Delaware. Startup still flies to Cape May County.
 */

/**
 * Points of Interest per place.
 * Each place has 5 POIs; the first is the default fly-to landmark.
 *
 * Field reference:
 *   alt     — RANGE (distance from target in meters), NOT absolute altitude
 *   heading — optimal camera heading in degrees (0=N, 90=E, 180=S, 270=W)
 *   pitch   — camera tilt in degrees (negative = looking down)
 *   buildingHeight — estimated height of landmark center above ground (meters)
 */
export const CITY_POIS = {
  capemay: {
    name: 'Cape May',
    groundElevation: -30,
    viewBounds: {
      southwest: { lat: 38.9, lng: -75.1 },
      northeast: { lat: 39.35, lng: -74.55 },
    },
    pois: [
      {
        name: 'Cape May Lighthouse',
        lat: 38.9332,
        lon: -74.9602,
        alt: 900,
        pitch: -30,
        heading: 20,
        buildingHeight: 50,
      },
      {
        name: 'Wildwood Boardwalk',
        lat: 38.9918,
        lon: -74.8149,
        alt: 900,
        pitch: -28,
        heading: 270,
        buildingHeight: 20,
      },
      {
        name: 'Cape May Court House',
        lat: 39.0826,
        lon: -74.8238,
        alt: 1200,
        pitch: -35,
        heading: 0,
        buildingHeight: 20,
      },
      {
        name: 'Ocean City Boardwalk',
        lat: 39.2776,
        lon: -74.5746,
        alt: 1000,
        pitch: -28,
        heading: 300,
        buildingHeight: 20,
      },
      {
        name: 'Cape May-Lewes Ferry (NJ)',
        lat: 38.9686,
        lon: -74.9631,
        alt: 900,
        pitch: -30,
        heading: 240,
        buildingHeight: 15,
      },
    ],
  },
  southjersey: {
    name: 'South Jersey',
    groundElevation: -25,
    viewBounds: {
      southwest: { lat: 39.2, lng: -75.5 },
      northeast: { lat: 39.8, lng: -74.35 },
    },
    pois: [
      {
        name: 'Atlantic City Boardwalk',
        lat: 39.3557,
        lon: -74.438,
        alt: 1200,
        pitch: -25,
        heading: 300,
        buildingHeight: 120,
      },
      {
        name: 'Atlantic City Intl Airport',
        lat: 39.4576,
        lon: -74.5772,
        alt: 2000,
        pitch: -35,
        heading: 0,
        buildingHeight: 15,
      },
      {
        name: 'Vineland',
        lat: 39.4864,
        lon: -75.026,
        alt: 1500,
        pitch: -35,
        heading: 0,
        buildingHeight: 20,
      },
      {
        name: 'Millville',
        lat: 39.4021,
        lon: -75.0393,
        alt: 1500,
        pitch: -35,
        heading: 0,
        buildingHeight: 20,
      },
      {
        name: 'Bridgeton',
        lat: 39.4273,
        lon: -75.2341,
        alt: 1500,
        pitch: -35,
        heading: 0,
        buildingHeight: 20,
      },
    ],
  },
  delaware: {
    name: 'Delaware',
    groundElevation: -30,
    viewBounds: {
      southwest: { lat: 38.45, lng: -75.8 },
      northeast: { lat: 39.3, lng: -75.0 },
    },
    pois: [
      {
        name: 'Cape May-Lewes Ferry (DE)',
        lat: 38.7826,
        lon: -75.158,
        alt: 900,
        pitch: -30,
        heading: 60,
        buildingHeight: 15,
      },
      {
        name: 'Cape Henlopen',
        lat: 38.8007,
        lon: -75.0963,
        alt: 1500,
        pitch: -30,
        heading: 90,
        buildingHeight: 20,
      },
      {
        name: 'Rehoboth Beach',
        lat: 38.7209,
        lon: -75.076,
        alt: 1000,
        pitch: -28,
        heading: 90,
        buildingHeight: 20,
      },
      {
        name: 'Dover',
        lat: 39.1582,
        lon: -75.5244,
        alt: 1500,
        pitch: -35,
        heading: 0,
        buildingHeight: 30,
      },
      {
        name: 'Dover AFB',
        lat: 39.1295,
        lon: -75.466,
        alt: 2500,
        pitch: -40,
        heading: 0,
        buildingHeight: 20,
      },
    ],
  },
};
