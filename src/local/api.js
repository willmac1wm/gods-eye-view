/** Fetch one /api/local envelope (see server/providers/local/core.js). */
export async function fetchLocal(name, { signal } = {}) {
  const response = await fetch(`/api/local/${name}`, {
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!response.ok) throw new Error(`Local source HTTP ${response.status}`);
  return response.json();
}
