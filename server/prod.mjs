/**
 * Production entry. Sets public mode before any server module reads the
 * environment, then starts the preview server.
 *
 * NSSM should run this instead of `vite`:
 *   node server/prod.mjs
 * after `npm run build`. See docs/PUBLIC-LAUNCH-SECURITY.md.
 */
process.env.GEV_PUBLIC = '1';
await import('./prod-run.mjs');
