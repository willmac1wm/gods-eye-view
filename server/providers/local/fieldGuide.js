/**
 * The field guide at /guide: every layer and tool on the map, how to read
 * its colors, where its data comes from, and which layers to combine in a
 * given situation. Linked from the ☰ menu.
 *
 * The page lives in fieldGuide.html so it can be read and edited as a page.
 * It is static on purpose: no live statuses, no server settings and no
 * links to the unlinked ops desk, so nothing on it goes stale or leaks how
 * the server is set up. It carries no scripts, so the site's
 * script-src 'self' policy needs no exception; its styles are inline and
 * its fonts come from Google Fonts, both of which BROWSER_CSP allows.
 */
import { readFileSync } from 'node:fs';

let cached = null;

/** The guide document, read once from fieldGuide.html. */
export function renderGuideHtml() {
  cached ??= readFileSync(
    new URL('./fieldGuide.html', import.meta.url),
    'utf8',
  );
  return cached;
}
