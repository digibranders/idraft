import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CitationsStrip } from './citations-strip';
import type { CitationRead } from './citation-reads';
import { parseScope } from './citation-scope';
import type { StripReads } from './strip-model';
import type {
  EngineCode,
  SourceChangePage,
  SourceDiversity,
  SourceDomainPage,
  SourcesMeta,
} from '@/lib/citations/types';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const WINDOW = { from: '2026-10-16', to: '2026-11-12', timezone: 'UTC' };
const BEFORE = { from: '2026-09-18', to: '2026-10-15', timezone: 'UTC' };
const LABELS: Record<EngineCode, string> = { chatgpt_web: 'ChatGPT', gemini_web: 'Gemini', google_ai_mode: 'AI Mode' };

const read = <TPage,>(data: TPage | undefined, over: Partial<CitationRead<TPage>> = {}): CitationRead<TPage> => ({
  status: data === undefined ? 'loading' : 'ready',
  data,
  errorId: null,
  retry: () => undefined,
  retrying: false,
  ...over,
});

const metaOf = (over: Partial<SourcesMeta> = {}): SourcesMeta => ({
  answers: 4812,
  answers_citing: 4000,
  by_role: [
    { domain_role: 'own', citation_units: 1676, observations: 900 },
    { domain_role: 'competitor', citation_units: 5000, observations: 2000 },
    { domain_role: 'third_party', citation_units: 11744, observations: 3000 },
  ],
  citation_units: 18420,
  engine_codes: ['chatgpt_web', 'gemini_web'],
  include_branded: false,
  previous_answers: 4500,
  compare_window: BEFORE,
  window: WINDOW,
  ...over,
});
const domains = (meta: SourcesMeta): SourceDomainPage => ({ data: [], meta, page: { limit: 1, offset: 0, total: 0 } });
const diversity: SourceDiversity = {
  data: [
    {
      engine_code: 'chatgpt_web',
      answers: 2000,
      answers_citing: 1800,
      citation_units: 9000,
      distinct_domains: 700,
      effective_sources: { numerator: 9000, denominator: 9000, n_observations: 2000, value: 90 },
    },
  ],
  meta: {
    distinct_domains: 1204,
    effective_sources_engine_average: 90,
    engine_codes: ['chatgpt_web'],
    include_branded: false,
    window: WINDOW,
  },
};
const changes = (kind: 'new' | 'lost', total: number): SourceChangePage => ({
  data: [],
  meta: { kind, min_support: 2, engine_codes: [], include_branded: false, window: WINDOW, compare_window: BEFORE },
  page: { limit: 1, offset: 0, total },
});
const previousMeta = metaOf({
  citation_units: 13280,
  by_role: [
    { domain_role: 'own', citation_units: 1102, observations: 700 },
    { domain_role: 'competitor', citation_units: 4000, observations: 1500 },
    { domain_role: 'third_party', citation_units: 8178, observations: 2500 },
  ],
});

const readsOf = (over: Partial<StripReads> = {}): StripReads => ({
  scope: read(domains(metaOf())),
  previous: read(domains(previousMeta)),
  diversity: read(diversity),
  newSources: read(changes('new', 37)),
  lostSources: read(changes('lost', 12)),
  ...over,
});

const labelOf = (code: EngineCode): string => LABELS[code];
/** The open tooltip: the popup the strip's cell opens. */
const tooltip = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-slot="tooltip"]');
const scope = parseScope({}, ['chatgpt_web', 'gemini_web', 'google_ai_mode']);

describe('CitationsStrip', () => {
  it('renders the strip as a labelled list with six items', async () => {
    const { container } = renderWithProviders(<CitationsStrip reads={readsOf()} scope={scope} labelOf={labelOf} />);
    const strip = screen.getByRole('group', { name: 'Citation summary' });
    expect(
      within(strip)
        .getAllByRole('term')
        .map((term) => term.textContent),
    ).toEqual([
      'Citation units',
      'Distinct domains',
      'Effective sources',
      'Own citation share',
      'New sources',
      'Lost sources',
    ]);
    expect(within(strip).getAllByRole('definition')).toHaveLength(6);
    expect(strip).not.toHaveAttribute('aria-busy');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows every percent with its units', async () => {
    const { user } = renderWithProviders(<CitationsStrip reads={readsOf()} scope={scope} labelOf={labelOf} />);
    const own = screen.getByText('Own citation share').closest('div');
    if (own === null) throw new Error('The own share cell is missing');
    expect(own).toHaveTextContent('9.1%');
    expect(own).toHaveTextContent('1,676 of 18,420 units');
    await user.hover(within(own).getByRole('definition'));
    await waitFor(() => expect(tooltip()).toHaveTextContent('1,676 of 18,420 citation units'));
  });

  it('shows the own share change without a colour and says there is no test', async () => {
    const { user } = renderWithProviders(<CitationsStrip reads={readsOf()} scope={scope} labelOf={labelOf} />);
    const own = screen.getByText('Own citation share').closest('div');
    if (own === null) throw new Error('The own share cell is missing');
    expect(own).toHaveTextContent('+0.8 pts');
    expect(own.innerHTML).not.toMatch(/positive|negative/);
    await user.hover(within(own).getByRole('definition'));
    await waitFor(() =>
      expect(tooltip()).toHaveTextContent(
        'Previous 8.3% (1,102 of 13,280 units). No test of this change exists, so it is not coloured.',
      ),
    );
  });

  it('leaves the own share and its units whole when a role is chosen', () => {
    renderWithProviders(
      <CitationsStrip reads={readsOf()} scope={parseScope({ role: 'competitor' }, [])} labelOf={labelOf} />,
    );
    const own = screen.getByText('Own citation share').closest('div');
    expect(own).toHaveTextContent('9.1%');
    expect(own).toHaveTextContent('1,676 of 18,420 units');
  });

  it('shows skeleton values while loading and keeps values while refetching', () => {
    const { unmount } = renderWithProviders(
      <CitationsStrip reads={readsOf({ scope: read<SourceDomainPage>(undefined) })} scope={scope} labelOf={labelOf} />,
    );
    const loading = screen.getByRole('group', { name: 'Citation summary' });
    expect(loading).toHaveAttribute('aria-busy', 'true');
    expect(loading).not.toHaveTextContent('18,420');
    expect(within(loading).getAllByRole('term')).toHaveLength(6);
    unmount();
    renderWithProviders(
      <CitationsStrip
        reads={readsOf({ lostSources: read(changes('lost', 12), { retrying: true }) })}
        scope={scope}
        labelOf={labelOf}
      />,
    );
    const refetching = screen.getByRole('group', { name: 'Citation summary' });
    expect(refetching).toHaveAttribute('aria-busy', 'true');
    expect(refetching).toHaveTextContent('18,420');
    expect(refetching).toHaveTextContent('37');
  });

  it('has a tab stop on an item with a tip', () => {
    renderWithProviders(<CitationsStrip reads={readsOf()} scope={scope} labelOf={labelOf} />);
    const stops = screen
      .getAllByRole('definition')
      .filter((item) => item.getAttribute('tabindex') === '0')
      .map((item) => item.closest('div')?.querySelector('dt')?.textContent);
    expect(stops).toEqual(['Effective sources', 'Own citation share']);
  });

  it('says n/a with its reason for a read that failed, and keeps the rest', () => {
    renderWithProviders(
      <CitationsStrip
        reads={readsOf({ diversity: read<SourceDiversity>(undefined, { status: 'error' }) })}
        scope={scope}
        labelOf={labelOf}
      />,
    );
    const distinct = screen.getByText('Distinct domains').closest('div');
    expect(distinct).toHaveTextContent('n/a');
    expect(screen.getByText('Citation units').closest('div')).toHaveTextContent('18,420');
  });
});
