/**
 * Public-launch guards. Pure aside from the in-memory LLM budget.
 *
 * A Cloudflare Tunnel delivers every visitor from 127.0.0.1. Loopback is
 * therefore not proof that the caller is the operator. Forwarding headers are
 * never a privilege: CF-Connecting-IP is an identity for rate limits only when
 * the socket is loopback (the tunnel) and the value is a public IP.
 * X-Forwarded-For is ignored so a client cannot mint quota or look local.
 */
import { isIP } from 'node:net';
import {
  adminListenerConfig,
  envFlag,
  isPublicExposure,
  tokensEqual,
} from './publicFlags.mjs';

export { adminListenerConfig, envFlag, isPublicExposure, tokensEqual };

const IPV4_MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

export function isLoopbackAddress(address) {
  const raw = String(address || '');
  const v4 = IPV4_MAPPED.exec(raw)?.[1] ?? raw;
  return v4.startsWith('127.') || raw === '::1';
}

function ipv4Private(host) {
  if (host.startsWith('10.') || host.startsWith('192.168.') || host.startsWith('127.'))
    return true;
  const second = /^172\.(\d+)\./.exec(host);
  return Boolean(second && Number(second[1]) >= 16 && Number(second[1]) <= 31);
}

/** Public unicast address. Loopback, private, link-local and multicast are not. */
export function isPublicIp(value) {
  const ip = String(value || '')
    .trim()
    .replace(IPV4_MAPPED, '$1');
  const kind = isIP(ip);
  if (kind === 4) {
    const second = /^100\.(\d+)\./.exec(ip);
    const cgnat = Boolean(second && Number(second[1]) >= 64 && Number(second[1]) <= 127);
    if (ipv4Private(ip) || cgnat || ip.startsWith('169.254.') || ip.startsWith('0.'))
      return false;
    if (/^(22[4-9]|23\d)\./.test(ip) || ip === '255.255.255.255') return false;
    return true;
  }
  if (kind === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('ff'))
      return false;
    return true;
  }
  return false;
}

/**
 * Hostname the server may call for an operator-configured local upstream
 * (the old Cape Dispatch app, Fire Wire). Not the public site, not link-local.
 */
export function isLocalUpstreamHost(hostname) {
  const host = String(hostname || '')
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  if (!host || host.includes('%')) return false;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local'))
    return true;
  const kind = isIP(host);
  if (kind === 4) return ipv4Private(host);
  if (kind === 6) {
    const lower = host.toLowerCase();
    return lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd');
  }
  return false;
}

/**
 * Resolve a local http(s) origin. Rejects the public hostname so a tunnel
 * pointed at this app cannot loop, and rejects any non-local host.
 * @returns {{ok: true, origin: string} | {ok: false, error: string}}
 */
export function resolveLocalUpstream(raw, env = process.env) {
  const text = String(raw ?? '').trim();
  if (!text) return { ok: false, error: 'Upstream URL is empty' };
  let url;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, error: 'Upstream URL is not a URL' };
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash)
    return { ok: false, error: 'Upstream URL must be http(s) without credentials' };
  if (!isLocalUpstreamHost(url.hostname))
    return { ok: false, error: 'Upstream URL must be a local origin such as http://127.0.0.1:8100' };
  const pub = String(env?.GEV_PUBLIC_HOST || 'capemaydispatch.com')
    .trim()
    .toLowerCase()
    .replace(/\.$/, '');
  const host = url.hostname.toLowerCase();
  if (pub && (host === pub || host === `www.${pub}`))
    return { ok: false, error: 'Upstream URL points at the public site and would loop' };
  return { ok: true, origin: url.origin };
}

export function capeDispatchOrigin(env = process.env) {
  return resolveLocalUpstream(env?.CAPE_DISPATCH_URL || 'http://127.0.0.1:8100', env);
}

/** Read-only Cape Dispatch paths. Writes, including Fire Wire ingest, are absent. */
export const CAPE_READ_PREFIXES = Object.freeze([
  '/api/cad/incidents',
  '/api/buoys',
  '/api/aviation/tfrs',
  '/api/airport_wx',
  '/api/power_outages',
  '/api/radio/live',
  '/api/tomtom/traffic',
  '/api/webcams',
  '/api/wx/wind',
  '/api/flood_map',
]);

/**
 * Map a request path onto an allowlisted upstream path, or null.
 * Accepts either `/api/cape/...` or the path connect leaves after that mount.
 */
export function capeUpstreamPath(method, rawPath) {
  const verb = String(method || 'GET').toUpperCase();
  if (verb !== 'GET') return null;
  let path = String(rawPath || '');
  try {
    path = decodeURIComponent(path);
  } catch {
    return null;
  }
  if (path.includes('%') || path.includes('\\') || path.includes('\0')) return null;
  if (path === '/api/cape') return null;
  if (path.startsWith('/api/cape/')) path = path.slice('/api/cape'.length);
  if (!path.startsWith('/')) path = `/${path}`;
  const parts = path.split('/');
  if (parts.some((part) => part === '' ? false : part === '.' || part === '..')) return null;
  // Collapse duplicate slashes after the split check so `/api//ingest` cannot hide.
  path = `/${parts.filter((part) => part !== '').join('/')}`;
  const lower = path.toLowerCase();
  if (lower.includes('ingest')) return null;
  if (/^\/fw-audio\/[A-Za-z0-9._-]{1,180}$/.test(path)) return path;
  for (const prefix of CAPE_READ_PREFIXES) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return path;
  }
  return null;
}

export function capeQueryAllowed(search) {
  const text = String(search || '');
  if (text.length > 512) return false;
  if (!text) return true;
  if (!text.startsWith('?')) return false;
  return /^[A-Za-z0-9._~=&%+-]*$/.test(text.slice(1)) && !text.includes('..');
}

function headerValue(req, name) {
  const value = req?.headers?.[name];
  const first = Array.isArray(value) ? value[0] : value;
  return String(first || '').split(',')[0].trim();
}

/**
 * Rate-limit identity. Socket address, except a public tunnel on loopback,
 * which uses CF-Connecting-IP when that header is one public IP.
 */
export function clientAddress(req, env = process.env) {
  const socket = String(req?.socket?.remoteAddress || 'local');
  if (!isPublicExposure(env) || !isLoopbackAddress(socket)) return socket;
  const cf = headerValue(req, 'cf-connecting-ip');
  if (isPublicIp(cf)) return cf.replace(IPV4_MAPPED, '$1');
  return 'tunnel';
}

/** https only when the tunnel says so with a single scheme token. */
export function publicRequestProtocol(req) {
  if (req?.socket?.encrypted) return 'https:';
  return headerValue(req, 'x-forwarded-proto').toLowerCase() === 'https' ? 'https:' : 'http:';
}

export function presentedAdminToken(req) {
  const bearer = /^Bearer\s+(\S+)$/i.exec(headerValue(req, 'authorization'));
  if (bearer) return bearer[1];
  return headerValue(req, 'x-gev-admin-token');
}

const llmBudget = { day: '', requests: 0, tokens: 0, usd: 0 };
const runtimeLlmOverrides = {
  aiChatEnabled: null,
  dailyRequestCap: null,
  dailyUsdCap: null,
};

function capNumber(raw, fallback) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

export function setRuntimeLlmOverrides({
  aiChatEnabled,
  dailyRequestCap,
  dailyUsdCap,
} = {}) {
  if (typeof aiChatEnabled === 'boolean' || aiChatEnabled === null) {
    runtimeLlmOverrides.aiChatEnabled = aiChatEnabled;
  }
  if (dailyRequestCap === null || Number.isFinite(Number(dailyRequestCap))) {
    runtimeLlmOverrides.dailyRequestCap =
      dailyRequestCap === null ? null : Math.max(0, Number(dailyRequestCap));
  }
  if (dailyUsdCap === null || Number.isFinite(Number(dailyUsdCap))) {
    runtimeLlmOverrides.dailyUsdCap =
      dailyUsdCap === null ? null : Math.max(0, Number(dailyUsdCap));
  }
}

export function getLlmBudgetSnapshot(now = Date.now()) {
  rollLlmDay(now);
  return {
    day: llmBudget.day,
    requests: llmBudget.requests,
    tokens: llmBudget.tokens,
    usd: Number(llmBudget.usd.toFixed(4)),
    aiChatEnabled: runtimeLlmOverrides.aiChatEnabled,
    dailyRequestCap: runtimeLlmOverrides.dailyRequestCap,
    dailyUsdCap: runtimeLlmOverrides.dailyUsdCap,
  };
}

export function resetLlmBudget() {
  llmBudget.day = '';
  llmBudget.requests = 0;
  llmBudget.tokens = 0;
  llmBudget.usd = 0;
  runtimeLlmOverrides.aiChatEnabled = null;
  runtimeLlmOverrides.dailyRequestCap = null;
  runtimeLlmOverrides.dailyUsdCap = null;
}

function rollLlmDay(now) {
  const day = new Date(now).toISOString().slice(0, 10);
  if (llmBudget.day !== day) {
    llmBudget.day = day;
    llmBudget.requests = 0;
    llmBudget.tokens = 0;
    llmBudget.usd = 0;
  }
}

/**
 * Admit one LLM or voice call. Unset caps are off for a private dev server
 * and on for GEV_PUBLIC=1. GEV_LLM_DISABLED or manager aiChatEnabled=false
 * refuses every call.
 */
export function admitLlmRequest(env = process.env, now = Date.now()) {
  if (runtimeLlmOverrides.aiChatEnabled === false || envFlag(env?.GEV_LLM_DISABLED))
    return { ok: false, status: 503, code: 'LLM_DISABLED' };
  const publicMode = isPublicExposure(env);
  const requestCap =
    runtimeLlmOverrides.dailyRequestCap !== null
      ? runtimeLlmOverrides.dailyRequestCap
      : capNumber(env?.GEV_LLM_DAILY_REQUEST_CAP, publicMode ? 800 : 0);
  const tokenCap = capNumber(env?.GEV_LLM_DAILY_TOKEN_CAP, publicMode ? 1_500_000 : 0);
  const usdCap =
    runtimeLlmOverrides.dailyUsdCap !== null
      ? runtimeLlmOverrides.dailyUsdCap
      : capNumber(env?.GEV_LLM_DAILY_USD_CAP, publicMode ? 5 : 0);
  if (requestCap === 0 && tokenCap === 0 && usdCap === 0) return { ok: true };
  rollLlmDay(now);
  if (requestCap && llmBudget.requests >= requestCap)
    return { ok: false, status: 429, code: 'DAILY_REQUEST_CAP' };
  if (tokenCap && llmBudget.tokens >= tokenCap)
    return { ok: false, status: 429, code: 'DAILY_TOKEN_CAP' };
  if (usdCap && llmBudget.usd >= usdCap)
    return { ok: false, status: 429, code: 'DAILY_USD_CAP' };
  llmBudget.requests += 1;
  llmBudget.usd += capNumber(env?.GEV_LLM_USD_PER_REQUEST, 0.002);
  return { ok: true };
}

export function noteLlmUsage(tokens, env = process.env) {
  const count = Math.max(0, Math.floor(Number(tokens) || 0));
  if (!count) return;
  llmBudget.tokens += count;
  llmBudget.usd += (count / 1_000_000) * capNumber(env?.GEV_LLM_USD_PER_MILLION_TOKENS, 1);
}

export function sanitizeReportText(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function reportHoneypotTripped(body) {
  return ['gev_hp', 'company', 'website'].some((name) => String(body?.[name] ?? '').trim() !== '');
}
