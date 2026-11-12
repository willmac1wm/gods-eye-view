/** Largest length this app will assign to a render-loop array. */
export const MAX_RENDER_ARRAY_LENGTH = 1_000_000;

/**
 * A length JavaScript will accept. NaN, Infinity, negatives, and non-integers
 * become 0; values above `max` are clamped. Assigning any of those to
 * `array.length` throws RangeError: Invalid array length.
 * @param {unknown} value
 * @param {number} [max]
 * @returns {number}
 */
export function boundedCount(value, max = MAX_RENDER_ARRAY_LENGTH) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const length = Math.floor(numeric);
  if (length <= 0) return 0;
  const cap = Number.isFinite(max) && max > 0 ? Math.floor(max) : MAX_RENDER_ARRAY_LENGTH;
  return Math.min(length, cap);
}
