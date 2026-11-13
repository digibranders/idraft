import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { CitationRead } from './citations-reads';
import { TopDomains, TopPages } from './top-lists';
import type { PromptCounts } from '../../inspector-reads';
import type { MetricCell, PromptSummaryRow } from '@/lib/api/types';
import type {
  DomainRole,
  SourceChangePage,
  SourceDomainPage,
  SourceDomainRow,
  SourcePagePage,
  SourcePageRow,
  SourcesMeta,
} from '@/lib/citations/types';
import { axe } from '@/test/axe';
import { renderWithProviders, type ProvidedRender } from '@/test/render';

const WINDOW = { from: '2026-10-16', to: '2026-11-12', timezone: 'UTC' };
const TOTAL = 48;

const cell = (units: number, total = TOTAL): MetricCell => ({
  numerator: units,
  denominator: total,
  n_observations: 8,
  value: total === 0 ? null : units / total,
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

const domainRow = (
  domain: string,
  role: DomainRole,
  units: number,
  over: Partial<SourceDomainRow> = {},
): SourceDomainRow => ({
  citation_units: units,
  domain_role: role,
  engines: [
    { engine_code: 'chatgpt_web', citation_units: units },
    { engine_code: 'gemini_web', citation_units: 0 },
  ],
  first_seen_at: '2026-10-20T02:00:00Z',
  last_seen_at: '2026-11-10T02:00:00Z',
  observations: 3,
  previous: { citation_units: 2, observations: 2 },
  prompts: 1,
  registrable_domain: domain,
  role_entity_id: null,
  source_share: cell(units),
  ...over,
});

const pageRow = (url: string, units: number, over: Partial<SourcePageRow> = {}): SourcePageRow => ({
  citation_units: units,
  domain_role: 'third_party',
  engines: [{ engine_code: 'chatgpt_web', citation_units: units }],
  first_seen_at: '2026-10-20T02:00:00Z',
  last_seen_at: '2026-11-10T02:00:00Z',
  host: new URL(url, 'https://x.invalid').host,
  observations: 3,
  previous: { citation_units: 2, observations: 2 },
  prompts: 1,
  registrable_domain: 'example.com',
  role_entity_id: null,
  source_share: cell(units),
  title: null,
  url,
  url_id: units,
  ...over,
});

const pageOf = <TRow,>(
  data: TRow[],
  meta = metaOf(),
): { data: TRow[]; meta: SourcesMeta; page: { limit: number; offset: number; total: number } } => ({
  data,
  meta,
  page: { limit: 5, offset: 0, total: data.length },
});

function read<TPage>(data: TPage | undefined, over: Partial<CitationRead<TPage>> = {}): CitationRead<TPage> {
  return {
    status: data === undefined ? 'loading' : 'ready',
    data,
    errorId: null,
    retry: vi.fn(),
    retrying: false,
    refreshing: false,
    ...over,
  };
}

const counts: PromptCounts = {
  status: 'ready',
  row: {
    engines: [
      { engine_code: 'chatgpt_web', cited: cell(2, 4) },
      // No valid answer on Gemini in the window: its counts are n/a
      { engine_code: 'gemini_web', cited: cell(0, 0) },
    ],
  } as unknown as PromptSummaryRow,
  entities: [],
  brandedIncluded: false,
  errorId: null,
  retry: () => undefined,
  retrying: false,
};

const noLost = read<SourceChangePage>({
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

const SIX_DOMAINS = [
  domainRow('fynix.digital', 'own', 12),
  domainRow('g2.com', 'third_party', 9),
  domainRow('rival.io', 'competitor', 8),
  domainRow('reddit.com', 'third_party', 6),
  domainRow('wikipedia.org', 'third_party', 5),
  domainRow('example.org', 'third_party', 4),
];

interface DomainsOver {
  domains?: CitationRead<SourceDomainPage>;
  lost?: CitationRead<SourceChangePage>;
  columns?: readonly { code: string; label: string }[];
}

function renderDomains({ domains, lost, columns = [] }: DomainsOver = {}): ProvidedRender {
  return renderWithProviders(
    <TopDomains
      read={domains ?? read(pageOf(SIX_DOMAINS))}
      lost={lost ?? noLost}
      columns={columns}
      counts={counts}
      minSupport={1}
    />,
  );
}

const sectionOf = (title: string): HTMLElement => {
  const section = screen.getByRole('heading', { name: title }).closest('section');
  if (section === null) throw new Error(`The ${title} section is missing`);
  return section;
};

const bodyRows = (table: HTMLElement): HTMLElement[] => within(table).getAllByRole('row').slice(1);

describe('Top domains', () => {
  it('lists at most 5 domains with role, units and the share with its units', () => {
    renderDomains();
    const rows = bodyRows(screen.getByRole('table', { name: 'Most cited domains for this prompt' }));
    expect(rows).toHaveLength(5);
    const [first, second, third] = rows as [HTMLElement, HTMLElement, HTMLElement];
    expect(first).toHaveTextContent('fynix.digital');
    expect(first).toHaveTextContent('Own');
    expect(first).toHaveTextContent('12');
    expect(first).toHaveTextContent('25.0% of 48 units');
    expect(second).toHaveTextContent('g2.com');
    expect(second).not.toHaveTextContent('Third party');
    expect(third).toHaveTextContent('rival.io');
    expect(third).toHaveTextContent('Competitor');
    expect(screen.queryByText('example.org')).toBeNull();
  });

  it('puts the role badge under the domain, so the domain keeps the width of its line', () => {
    renderDomains();
    const rows = bodyRows(screen.getByRole('table', { name: 'Most cited domains for this prompt' }));
    const [own, , competitor] = rows as [HTMLElement, HTMLElement, HTMLElement];
    for (const [row, domain, role] of [
      [own, 'fynix.digital', 'Own'],
      [competitor, 'rival.io', 'Competitor'],
    ] as const) {
      const line = within(row).getByText(domain).closest('[data-slot="domain-line"]');
      if (line === null) throw new Error(`The line of ${domain} is missing`);
      expect(within(line as HTMLElement).queryByText(role)).toBeNull();
      expect(within(row).getByText(role)).toBeInTheDocument();
    }
  });

  it('says the unit in the singular for a share of one unit', () => {
    renderDomains({
      domains: read(pageOf([domainRow('g2.com', 'third_party', 1, { source_share: cell(1, 1) })], metaOf())),
    });
    const [first] = bodyRows(screen.getByRole('table')) as [HTMLElement];
    expect(first).toHaveTextContent('100.0% of 1 unit');
    expect(first).not.toHaveTextContent('1 units');
  });

  it('names the own row with the Own badge and primary text', () => {
    renderDomains();
    expect(screen.getByText('fynix.digital')).toHaveClass('text-primary-text');
    expect(screen.getByText('g2.com')).not.toHaveClass('text-primary-text');
  });

  it('marks a New domain with a badge that is a tab stop and says why', () => {
    renderDomains({
      domains: read(
        pageOf([
          domainRow('g2.com', 'third_party', 9, { previous: { citation_units: 0, observations: 0 } }),
          domainRow('rival.io', 'competitor', 8),
        ]),
      ),
    });
    const [first, second] = bodyRows(screen.getByRole('table')) as [HTMLElement, HTMLElement];
    const badge = within(first).getByText('New');
    expect(badge).toHaveAttribute('tabindex', '0');
    expect(screen.getByText('Not cited in the previous period, when 8 answers were read.')).toBeInTheDocument();
    expect(within(second).queryByText('New')).toBeNull();
  });

  it('marks nothing New when the previous period has no answers', () => {
    renderDomains({
      domains: read(
        pageOf(
          [domainRow('g2.com', 'third_party', 9, { previous: { citation_units: 0, observations: 0 } })],
          metaOf({ previous_answers: 0 }),
        ),
      ),
    });
    expect(screen.queryByText('New')).toBeNull();
  });

  it('shows one count column for each engine and n/a for an engine with no valid answer', () => {
    renderDomains({
      columns: [
        { code: 'chatgpt_web', label: 'ChatGPT' },
        { code: 'gemini_web', label: 'Gemini' },
      ],
    });
    const table = screen.getByRole('table');
    expect(within(table).getByRole('columnheader', { name: /ChatGPT/ })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: /Gemini/ })).toBeInTheDocument();
    const [first] = bodyRows(table) as [HTMLElement];
    const cells = within(first).getAllByRole('cell');
    // Units, ChatGPT, Gemini
    expect(cells[1]).toHaveTextContent('12');
    expect(within(cells[2] as HTMLElement).getByText('n/a')).toBeInTheDocument();
    expect(cells[2]).not.toHaveTextContent(/^0/);
    // The reason is the cell's description, one for each row
    expect(screen.getAllByText('No valid answer on Gemini in this window.').length).toBeGreaterThan(0);
  });

  it('says Cited instead when no own domain is cited', () => {
    renderDomains({
      domains: read(
        pageOf(
          [domainRow('g2.com', 'third_party', 9)],
          metaOf({
            by_role: [
              { domain_role: 'own', citation_units: 0, observations: 0 },
              { domain_role: 'competitor', citation_units: 0, observations: 0 },
              { domain_role: 'third_party', citation_units: 9, observations: 3 },
            ],
          }),
        ),
      ),
    });
    expect(
      screen.getByText('Your domain is not cited in any of the 8 answers read. These sources are cited instead.'),
    ).toBeInTheDocument();
  });

  it('does not say it when the own domain is cited', () => {
    renderDomains();
    expect(screen.queryByText(/is not cited in any of/)).toBeNull();
  });

  it('shows skeletons while loading', () => {
    renderDomains({ domains: read<SourceDomainPage>(undefined) });
    const section = sectionOf('Top domains');
    expect(section).toHaveAttribute('aria-busy', 'true');
    expect(within(section).queryByRole('table')).toBeNull();
    expect(section.querySelector('[data-slot="skeleton"]')).not.toBeNull();
  });

  it('shows an inline error with Retry', async () => {
    const retry = vi.fn();
    const { user } = renderDomains({ domains: read<SourceDomainPage>(undefined, { status: 'error', retry }) });
    const section = sectionOf('Top domains');
    expect(within(section).getByText('The cited domains could not be loaded.')).toBeInTheDocument();
    await user.click(within(section).getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('says why when no domain is cited and how to change it', () => {
    renderDomains({ domains: read(pageOf<SourceDomainRow>([])) });
    const section = sectionOf('Top domains');
    expect(within(section).getByText('No citations in this window')).toBeInTheDocument();
    expect(within(section).getByText(/choose a longer window/)).toBeInTheDocument();
  });

  it('uses the answers pair for a window with no answer at all', () => {
    renderDomains({
      domains: read(pageOf<SourceDomainRow>([], metaOf({ answers: 0, answers_citing: 0, citation_units: 0 }))),
    });
    expect(within(sectionOf('Top domains')).getByText('No answers in this window')).toBeInTheDocument();
  });

  it('keeps the rows while a new choice is read', () => {
    renderDomains({ domains: read(pageOf(SIX_DOMAINS), { refreshing: true }) });
    const table = screen.getByRole('table');
    expect(bodyRows(table)).toHaveLength(5);
    expect(table.closest('[aria-busy="true"]')).not.toBeNull();
  });

  it('is axe clean', async () => {
    const { container } = renderDomains({
      columns: [
        { code: 'chatgpt_web', label: 'ChatGPT' },
        { code: 'gemini_web', label: 'Gemini' },
      ],
    });
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('the Lost line', () => {
  const lostPage = (): SourceChangePage => ({
    data: [
      {
        registrable_domain: 'g2.com',
        domain_role: 'third_party',
        previous_units: 3,
        current_units: 0,
        first_seen_at: null,
        last_seen_at: null,
        role_entity_id: null,
      },
      {
        registrable_domain: 'rival.io',
        domain_role: 'competitor',
        previous_units: 1,
        current_units: 0,
        first_seen_at: null,
        last_seen_at: null,
        role_entity_id: 'e-1',
      },
    ],
    meta: {
      compare_window: WINDOW,
      engine_codes: [],
      include_branded: false,
      kind: 'lost',
      min_support: 1,
      window: WINDOW,
    },
    page: { limit: 5, offset: 0, total: 2 },
  });

  it('names the domains and the units they had before', () => {
    renderDomains({ lost: read(lostPage()) });
    const section = sectionOf('Top domains');
    expect(within(section).getByText('Lost since the previous period')).toBeInTheDocument();
    expect(within(section).getByText('g2.com, 3 units before and rival.io, 1 unit before')).toBeInTheDocument();
  });

  it('is left out with nothing lost, and while it loads', () => {
    const { unmount } = renderDomains();
    expect(screen.queryByText('Lost since the previous period')).toBeNull();
    unmount();
    renderDomains({ lost: read<SourceChangePage>(undefined) });
    expect(screen.queryByText('Lost since the previous period')).toBeNull();
  });

  it('says it could not be loaded, with Retry, and keeps the table', async () => {
    const retry = vi.fn();
    const { user } = renderDomains({ lost: read<SourceChangePage>(undefined, { status: 'error', retry }) });
    const section = sectionOf('Top domains');
    expect(within(section).getByText('Lost sources could not be loaded.')).toBeInTheDocument();
    expect(within(section).getByRole('table')).toBeInTheDocument();
    await user.click(within(section).getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});

describe('Top pages', () => {
  const SIX_PAGES = [
    pageRow('https://docs.fynix.digital/guides/seo', 12, { domain_role: 'own', title: 'The SEO guide' }),
    pageRow('https://g2.com/categories/seo', 9),
    pageRow('https://rival.io/blog/audit', 8),
    pageRow('https://reddit.com/r/seo/comments/1', 6),
    pageRow('https://wikipedia.org/wiki/SEO', 5),
    pageRow('https://example.org/extra', 4),
  ];

  function renderPages(
    pages = read(pageOf(SIX_PAGES)),
    ownPages = read(pageOf([pageRow('https://fynix.digital/a', 1)])),
  ): ProvidedRender {
    return renderWithProviders(<TopPages read={pages} ownPages={ownPages} minSupport={1} />);
  }

  it('lists at most 5 pages with host, escaped title and units', () => {
    renderPages();
    const rows = bodyRows(screen.getByRole('table', { name: 'Most cited pages for this prompt' }));
    expect(rows).toHaveLength(5);
    const [first] = rows as [HTMLElement];
    expect(first).toHaveTextContent('docs.fynix.digital');
    expect(first).toHaveTextContent('/guides/seo');
    expect(first).toHaveTextContent('The SEO guide');
    expect(first).toHaveTextContent('12');
    expect(first).toHaveTextContent('25.0% of 48 units');
    expect(screen.queryByText(/example.org/)).toBeNull();
  });

  it('shows a title with markup as text', () => {
    const title = '<img src="x" onerror="alert(1)"> big';
    const { container } = renderPages(read(pageOf([pageRow('https://g2.com/a', 3, { title })])));
    expect(screen.getByText(title)).toBeInTheDocument();
    expect(container.querySelector('img[onerror]')).toBeNull();
  });

  it('shows a javascript address as text with a warning, never as a link', () => {
    renderPages(read(pageOf([pageRow('javascript:alert(1)', 3)])));
    const table = screen.getByRole('table');
    expect(within(table).queryByRole('link')).toBeNull();
    expect(within(table).getByLabelText('Invalid URL')).toBeInTheDocument();
  });

  it('marks a New page like a New domain', () => {
    renderPages(read(pageOf([pageRow('https://g2.com/a', 3, { previous: { citation_units: 0, observations: 0 } })])));
    expect(screen.getByText('New')).toHaveAttribute('tabindex', '0');
  });

  it('says in words that no page of the own domain is cited', () => {
    renderPages(
      read(pageOf(SIX_PAGES)),
      read({ ...pageOf<SourcePageRow>([]), page: { limit: 1, offset: 0, total: 0 } }),
    );
    expect(screen.getByText('No page of yours is cited by this prompt.')).toBeInTheDocument();
  });

  it('does not say it when an own page is cited or the count is not known', () => {
    const { unmount } = renderPages();
    expect(screen.queryByText('No page of yours is cited by this prompt.')).toBeNull();
    unmount();
    renderPages(read(pageOf(SIX_PAGES)), read<SourcePagePage>(undefined));
    expect(screen.queryByText('No page of yours is cited by this prompt.')).toBeNull();
  });

  it('says why when no page is cited', () => {
    renderPages(read(pageOf<SourcePageRow>([])));
    expect(within(sectionOf('Top pages')).getByText('No cited pages in this window')).toBeInTheDocument();
  });

  it('shows an inline error with Retry for the pages and no table', async () => {
    const retry = vi.fn();
    const { user } = renderPages(read<SourcePagePage>(undefined, { status: 'error', retry }));
    const section = sectionOf('Top pages');
    expect(within(section).getByText('The cited pages could not be loaded.')).toBeInTheDocument();
    await user.click(within(section).getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('is axe clean', async () => {
    const { container } = renderPages();
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('the lists never say rank', () => {
  it('uses no ranking word or hash number', () => {
    const { container } = renderDomains();
    expect(container.textContent).not.toMatch(/rank|#\d/i);
  });
});
