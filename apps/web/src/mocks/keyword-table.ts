/**
 * The keywords Fynix tracks in the mocks, as one table: what the tracked keyword fixtures, their Labs
 * metrics and their group and topic links are made from (./keyword-fixtures.ts). Fynix is a digital agency
 * in Germany, so most keywords are English at the German location, some are German, and a few are tracked in
 * the United States. Metrics are the kind Labs gives: a monthly volume, difficulty 0 to 100, CPC in USD, a
 * main intent. A row without metrics stands for a keyword added minutes ago, still waiting for Labs.
 */

export type TableIntent = 'informational' | 'navigational' | 'commercial' | 'transactional';
export type TableGroup = 'audits' | 'content' | 'local' | 'brand' | null;
export type TableTopic = 'seo' | 'technical' | 'local' | 'content' | 'blog' | 'paid' | null;

export interface KeywordRow {
  text: string;
  language: 'en' | 'de';
  /** 2276 Germany (the project's default) or 2840 United States. */
  location: 2276 | 2840;
  device: 'desktop' | 'mobile';
  /** Labs metrics, or `null` while Labs has not answered yet. */
  metrics: { volume: number; difficulty: number; cpc: string; intent: TableIntent } | null;
  priority: 1 | 2 | 3 | 4 | 5;
  group: TableGroup;
  topic: TableTopic;
  /** Archived: kept with its history, not checked. */
  archived?: boolean;
}

const row = (
  text: string,
  metrics: KeywordRow['metrics'],
  priority: KeywordRow['priority'],
  group: TableGroup,
  topic: TableTopic,
  extra: Partial<Pick<KeywordRow, 'language' | 'location' | 'device' | 'archived'>> = {},
): KeywordRow => ({
  text,
  language: extra.language ?? 'en',
  location: extra.location ?? 2276,
  device: extra.device ?? 'desktop',
  metrics,
  priority,
  group,
  topic,
  ...(extra.archived === true ? { archived: true } : {}),
});

const m = (volume: number, difficulty: number, cpc: string, intent: TableIntent): KeywordRow['metrics'] => ({
  volume,
  difficulty,
  cpc,
  intent,
});

export const KEYWORD_TABLE: readonly KeywordRow[] = [
  row('seo agency berlin', m(1900, 54, '18.40', 'commercial'), 1, 'local', 'local'),
  row('seo agency germany', m(880, 49, '15.10', 'commercial'), 1, 'local', 'local'),
  row('seo agentur berlin', m(2400, 58, '16.90', 'commercial'), 1, 'local', 'local', { language: 'de' }),
  row('seo agentur', m(14800, 71, '14.20', 'commercial'), 2, 'local', 'seo', { language: 'de' }),
  row('seo audit', m(6600, 62, '9.80', 'commercial'), 1, 'audits', 'technical'),
  row('technical seo audit', m(1600, 47, '11.30', 'commercial'), 1, 'audits', 'technical'),
  row('seo audit checklist', m(2900, 41, '4.20', 'informational'), 2, 'audits', 'technical'),
  row('website seo audit', m(1300, 44, '8.70', 'commercial'), 2, 'audits', 'technical'),
  row('free seo audit', m(4400, 52, '6.10', 'transactional'), 3, 'audits', 'technical'),
  row('seo audit tool', m(3600, 66, '12.80', 'commercial'), 3, 'audits', 'technical'),
  row('core web vitals', m(9900, 57, '3.40', 'informational'), 3, 'audits', 'technical'),
  row('crawl budget', m(1000, 38, '2.10', 'informational'), 4, 'audits', 'technical'),
  row('log file analysis seo', m(390, 29, '5.60', 'informational'), 4, 'audits', 'technical'),
  row('javascript seo', m(1300, 45, '4.90', 'informational'), 3, 'audits', 'technical'),
  row('hreflang tags', m(1900, 36, '2.80', 'informational'), 4, 'audits', 'technical'),
  row('schema markup generator', m(2400, 48, '3.10', 'transactional'), 4, 'audits', 'technical'),
  row('content marketing agency', m(1600, 55, '13.70', 'commercial'), 1, 'content', 'content'),
  row('content strategy', m(5400, 61, '7.20', 'informational'), 2, 'content', 'content'),
  row('content audit', m(1000, 39, '6.40', 'commercial'), 2, 'content', 'content'),
  row('blog content strategy', m(720, 33, '5.20', 'informational'), 3, 'content', 'blog'),
  row('how to write a blog post', m(8100, 64, '1.90', 'informational'), 5, 'content', 'blog'),
  row('blog post ideas', m(6600, 52, '1.40', 'informational'), 5, 'content', 'blog'),
  row('editorial calendar template', m(2900, 35, '2.30', 'transactional'), 4, 'content', 'blog'),
  row('content brief template', m(880, 27, '3.70', 'transactional'), 4, 'content', 'content'),
  row('topic clusters', m(1300, 42, '4.10', 'informational'), 3, 'content', 'content'),
  row('pillar page', m(1000, 40, '3.90', 'informational'), 4, 'content', 'content'),
  row('local seo', m(12100, 68, '10.40', 'informational'), 2, 'local', 'local'),
  row('google business profile optimization', m(2400, 46, '7.80', 'commercial'), 2, 'local', 'local'),
  row('local citations', m(1600, 37, '5.30', 'informational'), 3, 'local', 'local'),
  row('local seo checklist', m(1000, 34, '4.60', 'informational'), 3, 'local', 'local'),
  row('fynix', m(320, 8, '0.90', 'navigational'), 1, 'brand', null),
  row('fynix digital', m(140, 5, '0.60', 'navigational'), 1, 'brand', null),
  row('fynix seo', m(90, 4, '1.20', 'navigational'), 1, 'brand', null),
  row('fynix reviews', m(50, 6, '0.40', 'navigational'), 2, 'brand', null),
  row('ppc agency', m(3600, 59, '22.60', 'commercial'), 2, null, 'paid'),
  row('google ads management', m(2900, 63, '19.40', 'commercial'), 2, null, 'paid'),
  row('ppc vs seo', m(1300, 31, '6.80', 'informational'), 4, null, 'paid'),
  row('search engine marketing', m(9900, 70, '11.20', 'informational'), 3, null, 'paid'),
  row('keyword research', m(18100, 74, '5.90', 'informational'), 2, null, 'seo'),
  row('keyword research tool', m(14800, 78, '9.60', 'commercial'), 3, null, 'seo'),
  row('long tail keywords', m(4400, 45, '2.70', 'informational'), 4, null, 'seo'),
  row('seo strategy', m(6600, 67, '8.40', 'informational'), 2, null, 'seo'),
  row('on page seo', m(9900, 65, '4.30', 'informational'), 3, null, 'seo'),
  row('off page seo', m(5400, 60, '3.80', 'informational'), 3, null, 'seo'),
  row('link building services', m(2900, 69, '16.50', 'commercial'), 2, null, 'seo'),
  row('backlink checker', m(22200, 81, '6.90', 'transactional'), 4, null, 'seo'),
  row('seo reporting', m(1300, 43, '9.10', 'commercial'), 3, null, 'seo'),
  row('seo consultant', m(4400, 58, '17.80', 'commercial'), 2, null, 'seo'),
  row('seo pricing', m(2400, 50, '12.30', 'commercial'), 2, null, 'seo'),
  row('ai overviews seo', m(1600, 39, '7.40', 'informational'), 2, null, 'seo'),
  row('seo agency', m(33100, 79, '24.10', 'commercial'), 1, null, 'seo', { location: 2840 }),
  row('technical seo agency', m(1300, 56, '21.40', 'commercial'), 1, 'audits', 'technical', { location: 2840 }),
  row('content marketing agency', m(4400, 62, '18.90', 'commercial'), 2, 'content', 'content', { location: 2840 }),
  row('local seo services', m(6600, 64, '20.30', 'commercial'), 2, 'local', 'local', { location: 2840 }),
  row('seo audit', m(14800, 69, '12.60', 'commercial'), 1, 'audits', 'technical', { location: 2840, device: 'mobile' }),
  row('seo agency berlin', m(1300, 51, '17.20', 'commercial'), 1, 'local', 'local', { device: 'mobile' }),
  row('generative engine optimization', null, 2, null, 'seo'),
  row('llm seo', null, 2, null, 'seo'),
  row('chatgpt seo agency', null, 3, 'local', 'seo'),
  row('seo newsletter', m(590, 23, '1.10', 'informational'), 5, 'content', 'blog', { archived: true }),
  row('seo meme', m(1000, 12, '0.20', 'informational'), 5, null, null, { archived: true }),
  row('wordpress seo plugin', m(6600, 72, '2.60', 'commercial'), 5, null, 'technical', { archived: true }),
];
