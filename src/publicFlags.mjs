/** Browser-safe public-mode flags. No Node built-ins. */

export function envFlag(value) {
  return /^(1|true|yes|on)$/i.test(String(value ?? '').trim());
}

export function isPublicExposure(env = globalThis.process?.env) {
  return envFlag(env?.GEV_PUBLIC);
}

/** Constant-time enough for a local admin token. Empty tokens never match. */
export function tokensEqual(presented, expected) {
  const left = String(presented ?? '');
  const right = String(expected ?? '');
  let mismatch = left.length === right.length ? 0 : 1;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1)
    mismatch |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  return mismatch === 0 && left.length > 0;
}

export function adminListenerConfig(env = globalThis.process?.env) {
  const enabled = envFlag(env?.GEV_ADMIN_ENABLED);
  const token = String(env?.GEV_ADMIN_TOKEN || '');
  const port = Number(env?.GEV_ADMIN_PORT || 4174);
  const portOk = Number.isInteger(port) && port > 0 && port < 65536;
  return {
    enabled: enabled && token.length >= 24 && portOk,
    port: portOk ? port : 4174,
    token,
    reason: !enabled ? 'disabled' : token.length < 24 ? 'token-too-short' : portOk ? 'ok' : 'bad-port',
  };
}
