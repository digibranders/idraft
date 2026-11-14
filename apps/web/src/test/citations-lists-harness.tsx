import { createTranslator } from 'next-intl';
import { http, HttpResponse } from 'msw';
import type { Route } from 'next';
import { useMemo, type ReactElement } from 'react';
import { vi, type Mock } from 'vitest';

import messages from '../../messages/en.json';
import { LIST_MEDIA, TOUCH_MEDIA } from '@/components/app/data-table/data-table-list';
import type { FilterValues } from '@/components/app/filters/types';
import type { CitationRead } from '@/features/citations/citation-reads';
import { toFilters, useCitationScope, type CitationTab } from '@/features/citations/citation-scope';
import type { CitationTabContext } from '@/features/citations/citation-tabs';
import { citationFilterFields } from '@/features/citations/citations-filters';
import { DomainsTab } from '@/features/citations/domains-tab';
import { TABLE_MEDIA } from '@/features/citations/mobile-rows/list-shell';
import { PagesTab } from '@/features/citations/pages-tab';
import type {
  EngineCode,
  EngineRoleUnits,
  MetricCell,
  SourceDomainPage,
  SourceDomainRow,
  SourcePagePage,
  SourcePageRow,
  SourcesMeta,
} from '@/lib/citations/types';
import { MOCK_WORKSPACE } from '@/mocks/fixtures';
import { mswPath } from '@/mocks/respond';
import { server } from '@/test/msw';
import { stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders, type ProvidedRenderOptions } from '@/test/render';

/**
 * What the tests of the Citations lists on a phone share: the screens a test can stub, the Domains and Pages tabs
 * fed by fixtures, and the inspector the page hands a tab. The New and lost tab reads the mock world, so its test
 * has its own harness.
 */

export const NOW = new Date('2026-11-12T12:00:00Z');
const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
export const DOMAINS = mswPath(`${P}/ai/sources/domains`);
export const PAGES = mswPath(`${P}/ai/sources/pages`);
const PROMPTS = mswPath(`${P}/ai/sources/prompts`);
export const ENABLED: readonly EngineCode[] = ['chatgpt_web', 'gemini_web', 'google_ai_mode'];
const LABELS = new Map<EngineCode, string>([
  ['chatgpt_web', 'ChatGPT'],
  ['gemini_web', 'Gemini'],
  ['google_ai_mode', 'AI Mode'],
]);
export const labelOf = (code: EngineCode): string => LABELS.get(code) ?? code;
const SOURCE = { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: 'p-fynix' };

/** Only the media in `matching` answer true: a phone is the list layout, a touch phone adds the touch query. */
function stubMedia(matching: readonly string[]): void {
  stubWideScreen();
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: matching.includes(query),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}
/** A narrow window with a mouse: the list, and the List and Table switch. */
export const stubPhone = (): void => stubMedia([LIST_MEDIA]);
/** A narrow window on a touch screen: the list, and no switch. */
export const stubTouchPhone = (): void => stubMedia([LIST_MEDIA, TOUCH_MEDIA]);
/** From 768 px: the table layout. */
export const stubTablet = (): void => stubMedia([TABLE_MEDIA]);

export const share = (units: number, total = 18420): MetricCell => ({
  value: total === 0 ? null : units / total,
  numerator: units,
  denominator: total,
  n_observations: 4812,
});
const block = (code: EngineCode, thirdParty: number): EngineRoleUnits => ({
  engine_code: code,
  own: { citation_units: 0, answers_citing: 0 },
  competitor: { citation_units: 0, answers_citing: 0 },
  third_party: { citation_units: thirdParty, answers_citing: 0 },
});
export const META: SourcesMeta = {
  window: { from: '2026-10-16', to: '2026-11-12', timezone: 'UTC' },
  include_branded: false,
  engine_codes: [...ENABLED],
  answers: 4812,
  answers_citing: 4000,
  citation_units: 18420,
  by_role: [{ domain_role: 'third_party', citation_units: 18420, observations: 4000 }],
  by_role_by_engine: [block('chatgpt_web', 7000), block('gemini_web', 6000), block('google_ai_mode', 5420)],
  compare_window: { from: '2026-09-18', to: '2026-10-15', timezone: 'UTC' },
  previous_answers: 4500,
  series: [{ week_start: '2026-10-19', answers: 1200, citation_units: 4000, distinct_domains: 300 }],
};
/** A scope with no answer read: the empty state says there are no citations yet. */
export const EMPTY_META: SourcesMeta = {
  ...META,
  answers: 0,
  answers_citing: 0,
  citation_units: 0,
  by_role: [],
};

export const domainOf = (overrides: Partial<SourceDomainRow> = {}): SourceDomainRow => ({
  registrable_domain: 'g2.com',
  domain_role: 'third_party',
  role_entity_id: null,
  citation_units: 1912,
  observations: 640,
  prompts: 48,
  engines: [
    { engine_code: 'chatgpt_web', citation_units: 700 },
    { engine_code: 'gemini_web', citation_units: 540 },
    { engine_code: 'google_ai_mode', citation_units: 672 },
  ],
  source_share: share(1912),
  previous: { citation_units: 1102, observations: 400 },
  first_seen_at: '2026-10-20T08:00:00Z',
  last_seen_at: '2026-11-10T08:00:00Z',
  series: [{ week_start: '2026-10-19', citation_units: 400, observations: 100 }],
  ...overrides,
});
export const G2 = domainOf();
export const HUBSPOT = domainOf({
  registrable_domain: 'hubspot.com',
  domain_role: 'competitor',
  role_entity_id: 'ent-hubspot',
  citation_units: 800,
  source_share: share(800),
  previous: { citation_units: 900, observations: 300 },
});
export const OWN = domainOf({
  registrable_domain: 'fynix.com',
  domain_role: 'own',
  role_entity_id: 'ent-own',
  citation_units: 4,
  source_share: share(4),
});

export const pageOf = (id: number, overrides: Partial<SourcePageRow> = {}): SourcePageRow => ({
  url_id: id,
  url: `https://g2.com/products/p${String(id)}`,
  title: `Page ${String(id)}`,
  host: 'g2.com',
  registrable_domain: 'g2.com',
  domain_role: 'third_party',
  role_entity_id: null,
  citation_units: 300,
  observations: 120,
  prompts: 20,
  engines: [{ engine_code: 'chatgpt_web', citation_units: 300 }],
  source_share: share(300),
  previous: { citation_units: 150, observations: 60 },
  first_seen_at: '2026-10-20T08:00:00Z',
  last_seen_at: '2026-11-10T08:00:00Z',
  series: [{ week_start: '2026-10-19', citation_units: 100, observations: 40 }],
  ...overrides,
});

export const domainPage = (
  rows: readonly SourceDomainRow[],
  meta: SourcesMeta = META,
  total = rows.length,
): SourceDomainPage => ({ data: [...rows], page: { limit: 200, offset: 0, total }, meta });
export const pagePage = (rows: readonly SourcePageRow[]): SourcePagePage => ({
  data: [...rows],
  page: { limit: 200, offset: 0, total: rows.length },
  meta: META,
});

/** Answers the domains route with `rows`; a row below `min_support` is left out, as the API does. */
export function serveDomains(rows: readonly SourceDomainRow[], { meta = META }: { meta?: SourcesMeta } = {}): void {
  server.use(
    http.get(DOMAINS, ({ request }) => {
      const min = Number(new URL(request.url).searchParams.get('min_support') ?? '1');
      return HttpResponse.json(
        domainPage(
          rows.filter((row) => row.citation_units >= min),
          meta,
        ),
      );
    }),
  );
}
export function servePages(rows: readonly SourcePageRow[], { meta = META }: { meta?: SourcesMeta } = {}): void {
  server.use(
    http.get(PAGES, ({ request }) => {
      const min = Number(new URL(request.url).searchParams.get('min_support') ?? '1');
      return HttpResponse.json({ ...pagePage(rows.filter((row) => row.citation_units >= min)), meta });
    }),
    // The no own page card above the Pages table reads two lists: every prompt has an own page here
    http.get(PROMPTS, () =>
      HttpResponse.json({
        data: [],
        page: { has_more: false, limit: 10, next_cursor: null },
        meta: { window: META.window, include_branded: false, engine_codes: [...ENABLED] },
      }),
    ),
  );
}

/** Every request the mock server saw for a route, as URLs. */
export function watch(route: string): URL[] {
  const seen: URL[] = [];
  server.events.on('request:start', ({ request }) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith(route)) seen.push(url);
  });
  return seen;
}

/** A promise a test settles itself, to hold an answer back. */
export function gate(): { opened: Promise<void>; open: () => void } {
  let open = (): void => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

type Inspect = NonNullable<CitationTabContext['inspect']>;
/** What the page hands a tab: the open record, the way to open one, to report the order and to link. */
export function inspecting(target: Inspect['target'] = null): { inspect: Inspect; open: Mock; setOrder: Mock } {
  const open = vi.fn();
  const setOrder = vi.fn();
  return {
    open,
    setOrder,
    inspect: {
      target,
      open,
      setOrder,
      hrefOf: (next) => `/digibranders/fynix/ai/citations?inspect=${next.type}:${next.id}` as Route,
    },
  };
}

const read = <TPage,>(data: TPage): CitationRead<TPage> => ({
  status: 'ready',
  data,
  errorId: null,
  retry: () => undefined,
  retrying: false,
});

export interface HarnessProps {
  tab: Extract<CitationTab, 'domains' | 'pages'>;
  values?: FilterValues;
  onClear?: () => void;
  inspect?: CitationTabContext['inspect'];
}

/** The Domains or Pages tab as the page gives it its context: the real scope from the address, the strip's reads fixed. */
function Harness({ tab, values = {}, onClear = () => undefined, inspect }: HarnessProps): ReactElement {
  const { scope, range, setSearch } = useCitationScope('UTC', ENABLED);
  const filters = useMemo(() => toFilters(scope, range), [scope, range]);
  const strip = useMemo(() => read(domainPage([], META)), []);
  const previous = useMemo(() => read(domainPage([], { ...META, citation_units: 13280 })), []);
  const fields = useMemo(
    () =>
      citationFilterFields({
        t: createTranslator({ locale: 'en', messages, namespace: 'citations.filters' }),
        tab,
        engines: ENABLED.map((code) => ({ code, label: labelOf(code) })),
        enginesLoading: false,
        roleUnits: null,
        topics: [],
        topicsLoading: false,
      }),
    [tab],
  );
  const context: CitationTabContext = {
    source: SOURCE,
    workspaceSlug: 'digibranders',
    projectSlug: 'fynix',
    timeZone: 'UTC',
    scope: { ...scope, tab },
    filters,
    range,
    enabledEngines: ENABLED,
    labelOf,
    meta: strip,
    previousMeta: previous,
    setSearch,
    inspect,
    filterBar: { fields, values, onClear },
  };
  return (
    <div className="flex h-96 flex-col">
      {tab === 'domains' ? <DomainsTab context={context} /> : <PagesTab context={context} />}
    </div>
  );
}

export function renderTab(
  props: HarnessProps,
  searchParams = '',
  options: ProvidedRenderOptions = {},
): ReturnType<typeof renderWithProviders> {
  return renderWithProviders(<Harness {...props} />, { searchParams, ...options });
}
