// Same-origin Cape proxy. Cape owns provider keys, including TomTom.

export async function capeJson(path, { signal } = {}) {
  const response = await fetch(`/api/cape/${path}`, {
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!response.ok) {
    const error = new Error(`cape-${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

/** Null when a path is down; other failures still reject. */
export async function capeJsonOptional(path, options) {
  try {
    return await capeJson(path, options);
  } catch (error) {
    if (error?.status) return null;
    throw error;
  }
}
