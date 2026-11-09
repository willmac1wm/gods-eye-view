/**
 * Local news headlines (title, source, time, link only — never article text),
 * from the RSS feeds Cape Dispatch's owner curated. Statewide/national feeds
 * are kept only when an item names a Cape May County place.
 */
import { createSource, fetchText } from './core.js';

const CAPE_MAY_PLACES =
  /cape may|wildwood|ocean city|sea isle|avalon|stone harbor|middle township|lower township|dennis township|upper township|woodbine|north cape may|villas|rio grande|court house|west cape may|cape may point|strathmere|marmora|tuckahoe|erma|cold spring|diamond beach/i;
const NJT_COUNTY_ROUTES = /\b(313|315|316|319|552)\b/;

const FEEDS = [
  { id: 'ocnj_daily', name: 'OCNJ Daily', kind: 'Local media', url: 'https://ocnjdaily.com/feed/' },
  { id: 'dailyvoice', name: 'Daily Voice Cape May', kind: 'Local media', url: 'https://dailyvoice.com/nj/cape-may/rss/', require: CAPE_MAY_PLACES },
  { id: 'shore_news', name: 'Shore News Network', kind: 'Regional media', url: 'https://www.shorenewsnetwork.com/feed/', require: CAPE_MAY_PLACES },
  { id: 'dvids', name: 'DVIDS (US military news)', kind: 'Official', url: 'https://www.dvidshub.net/rss/news', require: CAPE_MAY_PLACES },
  { id: 'njt_bus', name: 'NJ Transit bus advisories', kind: 'Official', url: 'https://www.njtransit.com/rss/BusAdvisories_feed.xml', require: NJT_COUNTY_ROUTES },
  {
    id: 'gnews',
    name: 'Google News: "Cape May County"',
    kind: 'News aggregator',
    url: 'https://news.google.com/rss/search?q=%22Cape%20May%20County%22%20New%20Jersey&hl=en-US&gl=US&ceid=US:en',
  },
];

function decode(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .trim();
}

function tag(block, name) {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  return m ? decode(m[1]) : '';
}

export const news = createSource({
  name: 'local-news',
  source: { name: 'Local news RSS feeds (headlines link to the publisher)', url: null, license: 'Headlines and links only' },
  ttlMs: 15 * 60e3,
  staleAfterMs: 2 * 3600e3,
  async load() {
    const items = [];
    const failed = [];
    for (const feed of FEEDS) {
      try {
        const xml = await fetchText(feed.url, { timeoutMs: 15000 });
        for (const block of xml.split(/<item[\s>]/i).slice(1, 40)) {
          const title = tag(block, 'title');
          const link = tag(block, 'link');
          const desc = tag(block, 'description');
          if (!title || !/^https?:\/\//.test(link)) continue;
          if (feed.require && !feed.require.test(`${title} ${desc}`)) continue;
          const published = Date.parse(tag(block, 'pubDate'));
          if (Number.isFinite(published) && Date.now() - published > 14 * 86400e3) continue;
          items.push({
            id: `news:${feed.id}:${link}`,
            title,
            link,
            publisher: feed.name,
            publisherKind: feed.kind,
            observedAt: Number.isFinite(published) ? new Date(published).toISOString() : null,
          });
        }
      } catch (error) {
        failed.push(`${feed.name} (${error.message})`);
      }
    }
    if (!items.length && failed.length === FEEDS.length) throw new Error('All news feeds failed');
    const seen = new Set();
    const unique = items.filter((i) => !seen.has(i.title.toLowerCase()) && seen.add(i.title.toLowerCase()));
    unique.sort((a, b) => String(b.observedAt).localeCompare(String(a.observedAt)));
    return {
      features: unique.slice(0, 80),
      note: failed.length ? `Unavailable: ${failed.join('; ')}` : null,
    };
  },
});
