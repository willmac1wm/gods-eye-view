/**
 * Cape starter scene / reconstruct pack stubs.
 * Manifests load without error; asset lists stay empty until authors publish.
 */

export const CAPE_STARTER_PACKS = Object.freeze([
  Object.freeze({
    id: 'cape-ferry-overview',
    title: 'Cape ferry corridor (starter)',
    kind: 'scene',
    status: 'stub',
    lat: 38.968,
    lon: -74.96,
    layers: Object.freeze(['cape-cameras', 'cape-cad', 'cape-flood']),
    assets: Object.freeze([]),
    note: 'Author camera / track assets in Director — pack shell only.',
  }),
  Object.freeze({
    id: 'cape-wildwood-boardwalk',
    title: 'Wildwood boardwalk (starter)',
    kind: 'scene',
    status: 'stub',
    lat: 38.991,
    lon: -74.808,
    layers: Object.freeze(['cape-cameras', 'cape-webcams']),
    assets: Object.freeze([]),
    note: 'Placeholder splat / still slots — empty until authored.',
  }),
  Object.freeze({
    id: 'cape-incident-replay-shell',
    title: 'Incident replay shell (starter)',
    kind: 'reconstruct',
    status: 'stub',
    lat: 38.935,
    lon: -74.91,
    layers: Object.freeze(['cape-cad', 'cape-radio', 'cape-cameras']),
    assets: Object.freeze([]),
    note: 'Attach WAMI / track packs when Fire Wire publishes reconstruct assets.',
  }),
]);

export function packsByKind(kind) {
  return CAPE_STARTER_PACKS.filter((pack) => pack.kind === kind);
}
