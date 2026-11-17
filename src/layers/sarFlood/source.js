/** Status + image through this server's /api/sar-flood proxy. */
export function createSarFloodSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
  base = '/api/sar-flood',
} = {}) {
  return {
    async getSnapshot({ signal } = {}) {
      const response = await fetchImpl(`${base}/status`, {
        headers: { Accept: 'application/json' },
        signal,
      });
      if (!response.ok) throw new Error(`Radar flood HTTP ${response.status}`);
      const status = await response.json();
      return {
        ...status,
        imageUrl: status?.available
          ? `${base}/new-water.png?pass=${encodeURIComponent(status.latestPass || '')}`
          : null,
      };
    },
  };
}
