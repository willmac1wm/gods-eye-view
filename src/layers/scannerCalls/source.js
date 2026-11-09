/** Scanner calls through this server's /api/scanner/calls proxy. */
export function createScannerCallsSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
  url = '/api/scanner/calls?hours=48',
} = {}) {
  return {
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl(url, {
        headers: { Accept: 'application/json' },
        signal,
      });
      if (!response.ok) throw new Error(`Scanner HTTP ${response.status}`);
      const payload = await response.json();
      if (!Array.isArray(payload?.calls))
        throw new Error('Malformed scanner response');
      return payload.calls.filter(
        (call) => Number.isFinite(call?.lat) && Number.isFinite(call?.lon),
      );
    },
  };
}
