export function esc(value) {
  return String(value ?? '').replace(
    /[&<>"]/g,
    (ch) => `&#${ch.charCodeAt(0)};`,
  );
}

export function kv(rows) {
  if (!rows?.length) return '<p class="ops-note">No data</p>';
  return `<dl class="ops-kv ops-grid">${rows
    .map(
      ([k, v]) =>
        `<div><dt>${esc(k)}</dt><dd>${v == null || v === '' ? '—' : esc(v)}</dd></div>`,
    )
    .join('')}</dl>`;
}

export function listHtml(items) {
  if (!items?.length) return '<p class="ops-note">Quiet / empty</p>';
  return `<ul class="ops-list">${items.map((item) => `<li>${item}</li>`).join('')}</ul>`;
}

export function note(text) {
  return `<p class="ops-note">${esc(text)}</p>`;
}

// An ISO date-time with no zone: Fire Wire and the sidecar write UTC this way
// (Python's utcnow().isoformat()), but JavaScript reads it as local time.
const ZONELESS_ISO = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

export function fmtWhen(value) {
  if (value == null || value === '') return null;
  const text = typeof value === 'string' ? value.trim() : value;
  const date = new Date(
    typeof text === 'string' && ZONELESS_ISO.test(text)
      ? `${text.replace(' ', 'T')}Z`
      : text,
  );
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}
