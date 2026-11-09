/**
 * NJ Transit GTFS "G2" bus feed access (server only).
 *
 * NJ Transit has no API key: the developer-portal username and password are
 * POSTed to authenticateUser for a token valid 24 h, and every data call is a
 * multipart POST carrying that token. Token minting is rate-limited, so one
 * token is cached per process and re-minted only near expiry or when a data
 * call is refused. Credentials come from NJ_TRANSIT_USERNAME and
 * NJ_TRANSIT_PASSWORD and never leave the server.
 */

export const NJT_G2_BASE_URL = 'https://pcsdata.njtransit.com/api/GTFSG2';
const TOKEN_TTL_MS = 23 * 60 * 60 * 1000; // valid 24 h; renew an hour early

let cachedToken = { value: '', mintedAt: 0 };

/** authenticateUser answers JSON ({"UserToken": ...}) or bare text. */
export function parseNjtToken(body) {
  const text = String(body || '').trim();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return text.replace(/^"|"$/g, '');
  }
  if (typeof data === 'string') return data.trim();
  if (data && typeof data === 'object') {
    if (String(data.Authenticated ?? 'true').toLowerCase() === 'false') return '';
    for (const key of ['UserToken', 'userToken', 'token', 'Token']) {
      if (data[key]) return String(data[key]).trim();
    }
  }
  return '';
}

function credentials() {
  const env = globalThis.process?.env || {};
  return {
    username: String(env.NJ_TRANSIT_USERNAME || '').trim(),
    password: String(env.NJ_TRANSIT_PASSWORD || '').trim(),
  };
}

export function njtConfigured() {
  const { username, password } = credentials();
  return Boolean(username && password);
}

async function mintToken(signal, fetchImpl) {
  const { username, password } = credentials();
  if (!username || !password)
    throw new Error('NJ Transit credentials not configured');
  const form = new FormData();
  form.append('username', username);
  form.append('password', password);
  const response = await fetchImpl(`${NJT_G2_BASE_URL}/authenticateUser`, {
    method: 'POST',
    body: form,
    signal,
    headers: { Accept: 'text/plain' },
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`NJ Transit auth ${response.status}`);
  const token = parseNjtToken(await response.text());
  if (!token) throw new Error('NJ Transit auth returned no token');
  cachedToken = { value: token, mintedAt: Date.now() };
  return token;
}

/**
 * POST the feed URL with a valid token; re-mint once on 401/403.
 * @param {{url: string}} feed Registry entry.
 * @returns {Promise<Response>}
 */
export async function fetchNjtG2(feed, signal, fetchImpl = fetch) {
  const fresh =
    cachedToken.value && Date.now() - cachedToken.mintedAt < TOKEN_TTL_MS;
  let token = fresh ? cachedToken.value : await mintToken(signal, fetchImpl);
  const post = (value) => {
    const form = new FormData();
    form.append('token', value);
    return fetchImpl(feed.url, {
      method: 'POST',
      body: form,
      signal,
      headers: { Accept: 'application/octet-stream' },
      redirect: 'error',
    });
  };
  let response = await post(token);
  if (response.status === 401 || response.status === 403) {
    try {
      await response.body?.cancel();
    } catch {
      /* no-op */
    }
    token = await mintToken(signal, fetchImpl);
    response = await post(token);
  }
  return response;
}
