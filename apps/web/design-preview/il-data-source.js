/* global window, URLSearchParams */
/**
 * Internal links mock: where its data comes from. By default the real crawl of eventussecurity.com
 * (`il-data-real.js`, built by tools/build-il-data-real.mjs from a DataForSEO crawl). Add `?data=sample` to the
 * address to get the illustrative set of `il-data.js` instead, which also shows crawl history, rank, citations and
 * mentions (a real set has one crawl and no rank data).
 */
import * as sample from './il-data.js';

const useSample = new URLSearchParams(window.location.search).get('data') === 'sample';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');

async function realSet() {
  const { REAL } = await import('./il-data-real.js');
  const day = new Date(REAL.crawledOn);
  const short = `${day.getDate()} ${MONTHS[day.getMonth()]}`;
  const rank = { content: 0, auto_generated: 1 };
  const links = REAL.links
    .map(([from, to, anchor, placement, rel], index) => ({ id: `l${index + 1}`, from, to, anchor, placement, rel, since: 1, lastSeen: 1 }))
    // Links out of a page count once per target by placement order (content, auto-generated, template)
    .sort((a, b) => (rank[a.placement] ?? 2) - (rank[b.placement] ?? 2));
  return {
    HOST: REAL.host,
    tiers: REAL.tiers,
    pages: REAL.pages,
    rules: [],
    tagNames: [],
    links,
    crawls: [
      { id: 'c1', n: 1, when: `${short} ${day.getFullYear()}, ${pad(day.getHours())}:${pad(day.getMinutes())}`, short, trigger: 'Manual', state: 'ready', pages: REAL.crawl.pages, cost: REAL.crawl.cost },
    ],
    crawlSettings: sample.crawlSettings,
    keywords: [],
    citations: [],
    mentions: [],
  };
}

const source = useSample ? sample : await realSet();

export const { HOST, tiers, pages, rules, tagNames, links, crawls, crawlSettings, keywords, citations, mentions } = source;
