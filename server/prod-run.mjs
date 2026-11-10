import { createServer } from 'node:http';
import { preview } from 'vite';
import { adminListenerConfig, envFlag } from '../src/publicFlags.mjs';
import { keySetupEndpoint } from './standalone/key-setup.js';

const host = String(process.env.HOST || '127.0.0.1').trim() || '127.0.0.1';
process.env.HOST = host;
const port = Number(process.env.PORT || 4173);

if (host === '0.0.0.0' || host === '::') {
  console.warn(
    '[public] HOST is every network interface. Use 127.0.0.1 and let cloudflared connect to this machine so the LAN cannot bypass the tunnel.',
  );
}

const server = await preview({
  preview: {
    host,
    port,
    strictPort: true,
  },
});
server.printUrls?.();
console.log(`[public] GEV_PUBLIC=1. No Vite dev server, no HMR, no /@fs.`);

const admin = adminListenerConfig();
if (envFlag(process.env.GEV_ADMIN_ENABLED) && !admin.enabled) {
  console.warn(
    `[admin] GEV_ADMIN_ENABLED is set but the admin listener did not start (${admin.reason}). Use a token of at least 24 characters.`,
  );
}
if (admin.enabled) {
  const layers = [];
  keySetupEndpoint({ adminListener: true }).configureServer({
    middlewares: {
      use(route, handler) {
        layers.push({ route, handler });
      },
    },
    restart: async () => {
      console.log(
        '[admin] Keys were saved. Restart the NSSM service so the public process reloads them.',
      );
    },
  });
  const adminServer = createServer((req, res) => {
    const path = String(req.url || '/').split('?')[0];
    const layer = layers.find((item) => path === item.route || path.startsWith(`${item.route}/`));
    if (!layer) {
      res.writeHead(404, { 'Content-Type': 'text/plain', 'X-Content-Type-Options': 'nosniff' });
      res.end('Not found');
      return;
    }
    layer.handler(req, res);
  });
  adminServer.listen(admin.port, '127.0.0.1', () => {
    console.log(
      `[admin] Provider Settings at http://127.0.0.1:${admin.port} — do not publish this port in the tunnel.`,
    );
  });
}
