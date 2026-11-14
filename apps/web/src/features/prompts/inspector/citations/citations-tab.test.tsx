import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { useState, type ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { CitationsTab, citationsTab } from './citations-tab';
import type { PromptCounts } from '../../inspector-reads';
import type { PromptTabContext } from '../../seams/inspector-tabs';
import type { Translate } from '../../seams/shared';
import type { MetricCell, ProjectEngine, Prompt, PromptSummaryRow } from '@/lib/api/types';
import type { SourceDomainRow, SourcePageRow, SourcesMeta } from '@/lib/citations/types';
import { MOCK_PROJECTS, MOCK_WORKSPACE } from '@/mocks/fixtures';
import { ENGINE_FACTS } from '@/mocks/prompt-fixtures';
import { mswPath } from '@/mocks/respond';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { renderWithProviders, type ProvidedRender } from '@/test/render';

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai';
const DOMAINS = mswPath(`${P}/sources/domains`);
const PAGES = mswPath(`${P}/sources/pages`);
const CHANGES = mswPath(`${P}/sources/changes`);
const OBSERVATIONS = mswPath(`${P}/observations`);
const CITATIONS = mswPath(`${P}/citations`);

const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The Fynix project fixture is missing');

const WINDOW = { from: '2026-10-16', to: '2026-11-12', timezone: 'UTC' };
const TOTAL = 48;

const engine = (code: keyof typeof ENGINE_FACTS): ProjectEngine => ({
  active_prompts: 1,
  engine: ENGINE_FACTS[code],
  estimated_monthly_cost_usd: null,
  is_configured: true,
  is_enabled: true,
  location_ids: [2276],
  provider_code: 'openai',
  replicates: 1,
});

const cell = (units: number, total = TOTAL): MetricCell => ({
  numerator: units,
  denominator: total,
  n_observations: 8,
  value: units / total,
});

const metaOf = (over: Partial<SourcesMeta> = {}): SourcesMeta => ({
  answers: 8,
  answers_citing: 6,
  by_role: [
    { domain_role: 'own', citation_units: 10, observations: 4 },
    { domain_role: 'competitor', citation_units: 12, observations: 5 },
    { domain_role: 'third_party', citation_units: 26, observations: 6 },
  ],
  citation_units: TOTAL,
  engine_codes: ['chatgpt_web', 'gemini_web'],
  include_branded: false,
  previous_answers: 8,
  window: WINDOW,
  ...over,
});

const domain = (name: string, units: number): SourceDomainRow => ({
  citation_units: units,
  domain_role: 'third_party',
  engines: [
    { engine_code: 'chatgpt_web', citation_units: units },
    { engine_code: 'gemini_web', citation_units: 0 },
  ],
  first_seen_at: '2026-10-20T02:00:00Z',
  last_seen_at: '2026-11-10T02:00:00Z',
  observations: 3,
  previous: { citation_units: 2, observations: 2 },
  prompts: 1,
  registrable_domain: name,
  role_entity_id: null,
  source_share: cell(units),
});

const page = (url: string, units: number): SourcePageRow => ({
  citation_units: units,
  domain_role: 'third_party',
  engines: [{ engine_code: 'chatgpt_web', citation_units: units }],
  first_seen_at: '2026-10-20T02:00:00Z',
  last_seen_at: '2026-11-10T02:00:00Z',
  host: 'g2.com',
  observations: 3,
  previous: { citation_units: 2, observations: 2 },
  prompts: 1,
  registrable_domain: 'g2.com',
  role_entity_id: null,
  source_share: cell(units),
  title: 'A page',
  url,
  url_id: units,
});

const list = <TRow,>(data: TRow[], meta: SourcesMeta, total = data.length): object => ({
  data,
  meta,
  page: { limit: 5, offset: 0, total },
});

interface Served {
  domains: URL[];
  pages: URL[];
  changes: URL[];
  observations: URL[];
  citations: URL[];
}

const answer = (id: string, at = '2026-11-11T09:05:00Z'): object => ({
  observation_id: id,
  engine_code: 'chatgpt_web',
  observed_at: at,
  status: 'complete',
  facts: { is_valid: true, total_citation_count: 2 },
});

const citationRow = (observationId: string, index: number, domain: string, role: string): object => ({
  citation_index: index,
  citation_kind: 'inline',
  domain_role: role,
  engine_code: 'chatgpt_web',
  host: `www.${domain}`,
  observation_id: observationId,
  observed_at: '2026-11-11T09:05:00Z',
  occurrences: 1,
  prompt_id: '0192d1a8-e000-7a10-8e00-000000000001',
  raw_url: `https://www.${domain}/a`,
  registrable_domain: domain,
  role_entity_id: null,
  title: null,
  url: `https://www.${domain}/a`,
  url_id: index,
});

/** Serves the reads; `ownTotal` is the total the own-page read answers, `failCitations` fails the citation list. */
function serve({
  meta = metaOf(),
  failDomains = false,
  ownTotal = 0,
  failCitations = false,
}: { meta?: SourcesMeta; failDomains?: boolean; ownTotal?: number; failCitations?: boolean } = {}): Served {
  const served: Served = { domains: [], pages: [], changes: [], observations: [], citations: [] };
  server.use(
    http.get(DOMAINS, ({ request }) => {
      served.domains.push(new URL(request.url));
      if (failDomains) return HttpResponse.json({ title: 'Server error' }, { status: 500 });
      return HttpResponse.json(list([domain('g2.com', 12), domain('reddit.com', 6)], meta));
    }),
    http.get(PAGES, ({ request }) => {
      const url = new URL(request.url);
      served.pages.push(url);
      const own = url.searchParams.get('filter[domain_role_in]') === 'own';
      return HttpResponse.json(own ? list([], meta, ownTotal) : list([page('https://g2.com/categories/seo', 9)], meta));
    }),
    http.get(OBSERVATIONS, ({ request }) => {
      served.observations.push(new URL(request.url));
      return HttpResponse.json({
        data: [answer('o1')],
        page: { has_more: false, limit: 200, next_cursor: null },
      });
    }),
    http.get(CITATIONS, ({ request }) => {
      served.citations.push(new URL(request.url));
      if (failCitations) return HttpResponse.json({ title: 'Server error' }, { status: 500 });
      return HttpResponse.json({
        data: [citationRow('o1', 1, 'g2.com', 'third_party'), citationRow('o1', 2, 'fynix.io', 'own')],
        page: { has_more: false, limit: 200, next_cursor: null },
      });
    }),
    http.get(CHANGES, ({ request }) => {
      served.changes.push(new URL(request.url));
      return HttpResponse.json({
        data: [],
        meta: {
          compare_window: WINDOW,
          engine_codes: [],
          include_branded: false,
          kind: 'lost',
          min_support: 1,
          window: WINDOW,
        },
        page: { limit: 5, offset: 0, total: 0 },
      });
    }),
  );
  return served;
}

const countsOf = (lastValidAt: string | null = '2026-11-12T02:00:00Z'): PromptCounts => ({
  status: 'ready',
  row: {
    last_observed_at: '2026-11-11T09:05:00Z',
    last_valid_at: lastValidAt,
    engines: [
      { engine_code: 'chatgpt_web', cited: cell(2, 4) },
      { engine_code: 'gemini_web', cited: cell(0, 4) },
    ],
  } as unknown as PromptSummaryRow,
  entities: [],
  brandedIncluded: false,
  errorId: null,
  retry: () => undefined,
  retrying: false,
});

const ENGINES = [engine('chatgpt_web'), engine('gemini_web')];

const contextOf = (over: Partial<PromptTabContext> = {}): PromptTabContext => ({
  scope: { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: fynix.project_id },
  promptId: '2000001',
  prompt: null,
  exists: true,
  range: { from: WINDOW.from, to: WINDOW.to },
  timeZone: 'UTC',
  engines: ENGINES,
  labelOf: (code) => ENGINE_FACTS[code as keyof typeof ENGINE_FACTS].label,
  counts: countsOf(),
  answers: { status: 'ready', rows: [], hasMore: false, errorId: null, retry: () => undefined, retrying: false },
  noCountsReason: 'No counts',
  onOpenAnswer: undefined,
  ...over,
});

const renderTab = (over: Partial<PromptTabContext> = {}): ProvidedRender =>
  renderWithProviders(<CitationsTab context={contextOf(over)} />);

const bannerOf = (container: HTMLElement): HTMLElement => {
  const banner = container.querySelector<HTMLElement>('[data-slot="banner"]');
  if (banner === null) throw new Error('No banner is drawn');
  return banner;
};

const domainsTable = (): Promise<HTMLElement> =>
  screen.findByRole('table', { name: 'Most cited domains for this prompt' });

describe('the Citations tab entry', () => {
  it('is placed after History with the tab label', () => {
    expect(citationsTab.id).toBe('citations');
    expect(citationsTab.after).toBe('history');
    // A translator that answers the key it is asked, so the test names the key the entry uses
    expect(citationsTab.label(((key: string) => key) as unknown as Translate)).toBe('prompts.citationsTab.tab');
  });
});

describe('what the tab reads', () => {
  it('reads nothing until the tab is shown', async () => {
    const served = serve();
    function Harness(): ReactElement {
      const [shown, setShown] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setShown(true)}>
            Show
          </button>
          {shown ? <CitationsTab context={contextOf()} /> : null}
        </>
      );
    }
    const { user } = renderWithProviders(<Harness />);
    expect(served.domains).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Show' }));
    await domainsTable();
    expect(served.domains).toHaveLength(1);
    expect(served.pages.length).toBeGreaterThan(0);
    expect(served.changes).toHaveLength(1);
  });

  it('reads nothing for a prompt that does not exist', async () => {
    const served = serve();
    renderTab({ exists: false });
    await screen.findByRole('heading', { name: 'Top domains' });
    expect(served.domains).toHaveLength(0);
    expect(served.pages).toHaveLength(0);
  });

  it('reads this prompt over the window of the inspector, with the period before', async () => {
    const served = serve();
    renderTab();
    await domainsTable();
    const [request] = served.domains as [URL];
    expect(request.searchParams.get('filter[prompt_id]')).toBe('2000001');
    expect(request.searchParams.get('from')).toBe(WINDOW.from);
    expect(request.searchParams.get('to')).toBe(WINDOW.to);
    expect(request.searchParams.get('compare')).toBe('previous_period');
    expect(request.searchParams.get('limit')).toBe('5');
    expect(request.searchParams.get('filter[engine_code_in]')).toBeNull();
    expect(request.searchParams.get('include_branded')).toBeNull();
  });

  it('passes include_branded for a branded prompt', async () => {
    const served = serve();
    renderTab({ prompt: { is_branded: true } as unknown as Prompt });
    await domainsTable();
    for (const request of [...served.domains, ...served.pages, ...served.changes]) {
      expect(request.searchParams.get('include_branded')).toBe('true');
    }
  });
});

describe('the choices of the tab', () => {
  it('reads one engine and names it in the scope line when one is chosen', async () => {
    const served = serve();
    const { user } = renderTab();
    await domainsTable();
    expect(screen.queryByText(/^Only Gemini is read/)).toBeNull();
    await user.click(screen.getByRole('radio', { name: 'Gemini' }));
    // The last answer in the banner is of any engine, and the line says so
    expect(
      await screen.findByText('Only Gemini is read. The last answer date above covers all engines.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Shares are of 48 citation units in 8 answers.')).toBeInTheDocument();
    await waitFor(() => {
      expect(served.domains.at(-1)?.searchParams.get('filter[engine_code_in]')).toBe('gemini_web');
    });
    expect(served.pages.at(-1)?.searchParams.get('filter[engine_code_in]')).toBe('gemini_web');
  });

  it('shows a count column for each engine under All engines and none for one engine', async () => {
    serve();
    const { user } = renderTab();
    const table = await domainsTable();
    expect(within(table).getByRole('columnheader', { name: /ChatGPT/ })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: /Gemini/ })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'ChatGPT' }));
    await waitFor(() => {
      expect(
        within(screen.getByRole('table', { name: 'Most cited domains for this prompt' })).queryByRole('columnheader', {
          name: /Gemini/,
        }),
      ).toBeNull();
    });
  });

  it('asks for at least 1 unit and reads again for 2', async () => {
    const served = serve();
    const { user } = renderTab();
    await domainsTable();
    expect(served.domains[0]?.searchParams.get('min_support')).toBe('1');
    await user.click(screen.getByRole('combobox', { name: 'Fewest units per row' }));
    await user.click(await screen.findByRole('option', { name: 'At least 2 units' }));
    await waitFor(() => {
      expect(served.domains.at(-1)?.searchParams.get('min_support')).toBe('2');
    });
    expect(served.pages.at(-1)?.searchParams.get('min_support')).toBe('2');
    expect(served.changes.at(-1)?.searchParams.get('min_support')).toBe('2');
  });
});

describe('the scope line', () => {
  it('says the shares are of N units in N answers', async () => {
    serve();
    renderTab();
    await domainsTable();
    expect(
      screen.getByText('Shares are of 48 citation units in 8 answers, counted over all engines.'),
    ).toBeInTheDocument();
  });

  it('says the previous period has no answers, so nothing is marked', async () => {
    serve({ meta: metaOf({ previous_answers: 0 }) });
    renderTab();
    await domainsTable();
    expect(
      screen.getByText('The previous period has no answers, so nothing is marked New or Lost.'),
    ).toBeInTheDocument();
  });

  it('does not say it when the previous period has answers', async () => {
    serve();
    renderTab();
    await domainsTable();
    expect(screen.queryByText(/nothing is marked/)).toBeNull();
  });

  it('shows the stale note when the last valid answer is old', async () => {
    serve();
    renderTab({ counts: countsOf('2026-09-01T02:00:00Z') });
    await domainsTable();
    // The year shows only when it is not the current one
    expect(screen.getByText(/^No valid answer since Sep 1,.*02:00\.$/)).toBeInTheDocument();
  });

  it('leaves the stale note out for a recent answer', async () => {
    serve();
    renderTab({ counts: countsOf(new Date().toISOString()) });
    await domainsTable();
    expect(screen.queryByText(/No valid answer since/)).toBeNull();
  });
});

describe('a read that fails', () => {
  it('fails alone: the domains show an error and the pages stay', async () => {
    serve({ failDomains: true });
    renderTab();
    expect(await screen.findByText('The cited domains could not be loaded.')).toBeInTheDocument();
    expect(await screen.findByRole('table', { name: 'Most cited pages for this prompt' })).toBeInTheDocument();
  });
});

describe('the banner, the lists and the answers in one tab', () => {
  it('shows the banner, Top domains, Top pages and the answers', async () => {
    serve({ ownTotal: 4 });
    renderTab();
    await domainsTable();
    expect(
      await screen.findByText('Cited in 4 of 8 answers; last answer Nov 11, 09:05; 4 own pages cited'),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Top domains' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Top pages' })).toBeInTheDocument();
    expect(await screen.findByRole('table', { name: 'Own page cited in each answer' })).toBeInTheDocument();
  });

  it('puts the banner first in the tab, in the info tone when the own domain is cited', async () => {
    serve({ ownTotal: 4 });
    const { container } = renderTab();
    await domainsTable();
    const banner = await waitFor(() => bannerOf(container));
    expect(banner).toHaveAttribute('role', 'status');
    expect(banner.className).toContain('bg-info-subtle');
    expect(container.firstElementChild).toBe(banner);
  });

  it('says Cited in 0 of 8 answers in the neutral tone, and that the domain is not cited, for a prompt cited by no own page', async () => {
    serve({
      meta: metaOf({
        by_role: [
          { domain_role: 'own', citation_units: 0, observations: 0 },
          { domain_role: 'competitor', citation_units: 12, observations: 5 },
          { domain_role: 'third_party', citation_units: 36, observations: 6 },
        ],
      }),
    });
    const { container } = renderTab();
    await domainsTable();
    const banner = await waitFor(() => bannerOf(container));
    expect(banner).toHaveTextContent('Cited in 0 of 8 answers; last answer Nov 11, 09:05');
    expect(banner.className).toContain('bg-surface-subtle');
    expect(
      screen.getByText('Your domain is not cited in any of the 8 answers read. These sources are cited instead.'),
    ).toBeInTheDocument();
    expect(screen.getByText('No page of yours is cited by this prompt.')).toBeInTheDocument();
  });

  it('says there is nothing to count, with no banner, when the window has no answers', async () => {
    serve({ meta: metaOf({ answers: 0, answers_citing: 0, citation_units: 0, by_role: [] }) });
    const { container } = renderTab();
    expect(await screen.findByText('No answers in this window, so there is nothing to count.')).toBeInTheDocument();
    expect(container.querySelector('[data-slot="banner"]')).toBeNull();
  });

  it('reads the answers and their citations only while the tab is shown, for this prompt and window', async () => {
    const served = serve();
    function Harness(): ReactElement {
      const [shown, setShown] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setShown(true)}>
            Show
          </button>
          {shown ? <CitationsTab context={contextOf()} /> : null}
        </>
      );
    }
    const { user } = renderWithProviders(<Harness />);
    expect(served.observations).toHaveLength(0);
    expect(served.citations).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Show' }));
    await screen.findByRole('table', { name: 'Own page cited in each answer' });
    expect(served.observations[0]?.searchParams.get('filter[prompt_id]')).toBe('2000001');
    expect(served.citations[0]?.searchParams.get('filter[prompt_id]')).toBe('2000001');
    expect(served.citations[0]?.searchParams.get('from')).toBe(WINDOW.from);
    expect(served.citations[0]?.searchParams.get('limit')).toBe('200');
  });

  it('passes include_branded to the citation list for a branded prompt, and no engine to it', async () => {
    const served = serve();
    const { user } = renderTab({ prompt: { is_branded: true } as unknown as Prompt });
    await screen.findByRole('table', { name: 'Own page cited in each answer' });
    expect(served.citations[0]?.searchParams.get('include_branded')).toBe('true');
    await user.click(screen.getByRole('radio', { name: 'Gemini' }));
    await waitFor(() => {
      expect(served.domains.at(-1)?.searchParams.get('filter[engine_code_in]')).toBe('gemini_web');
    });
    expect(served.citations.every((request) => request.searchParams.get('filter[engine_code_in]') === null)).toBe(true);
  });

  it('shows the position of the own page in each answer', async () => {
    serve();
    renderTab();
    expect(await screen.findByText('Source 2 of 2')).toBeInTheDocument();
  });

  it('keeps the answers and says n/a for their citations when the citation list fails', async () => {
    serve({ failCitations: true });
    renderTab();
    expect(await screen.findByText('The citations of the answers could not be loaded.')).toBeInTheDocument();
    const table = await screen.findByRole('table', { name: 'Own page cited in each answer' });
    expect(within(table).getAllByText('n/a')).toHaveLength(2);
  });

  it('opens an answer from its date', async () => {
    serve();
    const calls: string[] = [];
    const { user } = renderTab({ onOpenAnswer: (id) => calls.push(id) });
    await user.click(await screen.findByRole('button', { name: 'Open the ChatGPT answer of Nov 11, 09:05' }));
    expect(calls).toEqual(['o1']);
  });
});

describe('accessibility', () => {
  it('is axe clean', async () => {
    serve({ ownTotal: 4 });
    const { container } = renderTab();
    await domainsTable();
    await screen.findByRole('table', { name: 'Own page cited in each answer' });
    expect(await axe(container)).toHaveNoViolations();
  });
});
