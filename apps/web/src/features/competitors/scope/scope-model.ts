import type { EngineCode } from '@/lib/api/types';
import { parseCompare } from '@/lib/compare/compare-model';
import { ENGINES } from '@/lib/layouts/catalog';
import { parseCountry } from '@/lib/locations/country-scope';
import { parseDensity, type Density } from '@/lib/tables/table-state';

/**
 * What the Competitors page keeps in its address (WP-39 plan section 3.2): the tab, the scope every read takes, the
 * metric of the by topic table and the table's own state. The date range is the picker's (`win`, `from`, `to`).
 * `parseScope` is pure and reads every key as plain text it never trusts: a value that does not read falls back to
 * its default, which writes nothing to the address.
 *
 * The scope, the Branded and the topic rules repeat those of the Overview and the Citations page, which a feature may
 * not import; the Overview's own links are read back in `inbound-links.test.ts`.
 */

export type CompetitorTab = 'comparison' | 'seo' | 'ai' | 'candidates';

/** The tabs in the order the page lists them. */
export const COMPETITOR_TAB_IDS: readonly CompetitorTab[] = ['comparison', 'seo', 'ai', 'candidates'];

/** Branded prompts: left out (default), counted with the rest, or counted alone. */
export type Branded = 'excluded' | 'included' | 'only';

/** The metric of the by topic table: only these two exist per entity. */
export type TopicMetric = 'mention' | 'sov';

/** The most engines one read takes. */
export const MAX_ENGINES = 3;

/**
 * Every key of the page besides the date range's and the country's: the saved views govern these. The country is
 * scope, as the date range is, so a view never sets it and a view's reset never clears it.
 */
export const COMPETITOR_KEYS = [
  'tab',
  'engine',
  'eng',
  'metric',
  'topic',
  'branded',
  'cmp',
  'lost',
  'sort',
  'cols',
  'density',
  'q',
] as const;

/** Every key the page writes: the view keys and the country. */
export const ADDRESS_KEYS = [...COMPETITOR_KEYS, 'country'] as const;

export type CompetitorKey = (typeof ADDRESS_KEYS)[number];

/** The address as nuqs gives it: each key's text, or absent. */
export type CompetitorsSearch = Readonly<Partial<Record<CompetitorKey, string | null | undefined>>>;

export interface CompetitorsScope {
  tab: CompetitorTab;
  /** Whether the previous period is read and shown (`cmp=off` turns it off). */
  compare: boolean;
  /** The market the prompts are set in (two capitals), or `null` for every country. */
  country: string | null;
  /** The engines a link or a person chose, among those that are on, at most 3; empty means every engine that is on. */
  engines: readonly EngineCode[];
  /** The engines in scope: the chosen ones, or every one that is on, in the fixed engine order. Empty while they are not known. */
  engineScope: readonly EngineCode[];
  /** The one engine of the single engine surfaces: `eng` when it is in scope, else the first engine in scope. */
  eng: EngineCode | null;
  metric: TopicMetric;
  /** One topic term id: the prompts given it or one below it. */
  topic: string | null;
  branded: Branded;
  /** The competitor "Prompts we lose" shows; `null` is the top competitor of `eng`. */
  lost: string | null;
  density: Density;
  /** The table's sort, visible columns and search, as the address writes them. */
  sort: string | null;
  columns: string | null;
  query: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CATALOG_ORDER: readonly EngineCode[] = ENGINES.map((engine) => engine.code);

/** A UUID lowercased, so equal ids share a query key; anything else is `null`. */
const uuidOf = (value: string | null | undefined): string | null =>
  value !== null && value !== undefined && UUID.test(value) ? value.toLowerCase() : null;

const textOf = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
};

/** The members of `a,b` that `allowed` holds, each once, in the order given. */
function listOf(value: string | null | undefined, allowed: readonly EngineCode[]): EngineCode[] {
  const members = (value ?? '').split(',').map((member) => member.trim());
  return allowed.filter((code) => members.includes(code)).sort((a, b) => members.indexOf(a) - members.indexOf(b));
}

/** The scope the address names. `enabled` are the engines that are on: an engine of a link that is off is left out. */
export function parseScope(search: CompetitorsSearch, enabled: readonly EngineCode[]): CompetitorsScope {
  const engines = listOf(search.engine, enabled).slice(0, MAX_ENGINES);
  const wanted = engines.length === 0 ? enabled : engines;
  const engineScope = CATALOG_ORDER.filter((code) => wanted.includes(code));
  const chosen = engineScope.find((code) => code === search.eng);
  return {
    tab: COMPETITOR_TAB_IDS.find((tab) => tab === search.tab) ?? 'comparison',
    compare: parseCompare(search.cmp),
    country: parseCountry(search.country ?? null),
    engines,
    engineScope,
    eng: chosen ?? engineScope[0] ?? null,
    metric: search.metric === 'sov' ? 'sov' : 'mention',
    topic: uuidOf(search.topic),
    // The Prompts page writes `include` for the same choice as `included`
    branded:
      search.branded === 'only'
        ? 'only'
        : search.branded === 'include' || search.branded === 'included'
          ? 'included'
          : 'excluded',
    lost: uuidOf(search.lost),
    density: parseDensity(search.density),
    sort: textOf(search.sort),
    columns: textOf(search.cols),
    query: textOf(search.q),
  };
}
