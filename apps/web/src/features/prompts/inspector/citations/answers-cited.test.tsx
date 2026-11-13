import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AnswersCited, type AnswersCitedProps } from './answers-cited';
import type { CitationRead } from './citations-reads';
import type { ObservationSummary, Schemas } from '@/lib/api/types';
import type { CitationPage, CitationRow, DomainRole } from '@/lib/citations/types';
import { axe } from '@/test/axe';
import { renderWithProviders, type ProvidedRender } from '@/test/render';

const LABELS: Record<string, string> = { chatgpt_web: 'ChatGPT', gemini_web: 'Gemini' };

const readOf = <TPage,>(data: TPage | undefined, over: Partial<CitationRead<TPage>> = {}): CitationRead<TPage> => ({
  status: data === undefined ? 'loading' : 'ready',
  data,
  errorId: null,
  retry: () => undefined,
  retrying: false,
  refreshing: false,
  ...over,
});

const observation = (
  id: string,
  over: { engine?: string; at?: string; valid?: boolean; total?: number } = {},
): ObservationSummary =>
  ({
    observation_id: id,
    engine_code: over.engine ?? 'chatgpt_web',
    observed_at: over.at ?? '2026-11-11T09:05:00Z',
    status: 'complete',
    facts: { is_valid: over.valid ?? true, total_citation_count: over.total ?? 3 },
  }) as unknown as ObservationSummary;

const observationPage = (rows: ObservationSummary[], hasMore = false): Schemas['ObservationPage'] => ({
  data: rows,
  page: { has_more: hasMore, limit: 200, next_cursor: null },
});

const citation = (
  observationId: string,
  index: number,
  domain: string,
  role: DomainRole,
  over: Partial<CitationRow> = {},
): CitationRow => ({
  citation_index: index,
  citation_kind: 'inline',
  domain_role: role,
  engine_code: 'chatgpt_web',
  host: `www.${domain}`,
  observation_id: observationId,
  observed_at: '2026-11-11T09:05:00Z',
  occurrences: 1,
  prompt_id: '0192d1a8-e000-7a10-8e00-000000000001',
  raw_url: `https://www.${domain}/p${String(index)}`,
  registrable_domain: domain,
  role_entity_id: null,
  title: null,
  url: `https://www.${domain}/p${String(index)}`,
  url_id: index,
  ...over,
});

const citationPage = (rows: CitationRow[], hasMore = false): CitationPage => ({
  data: rows,
  page: { has_more: hasMore, limit: 200, next_cursor: null },
});

const renderSection = (over: Partial<AnswersCitedProps> = {}): ProvidedRender =>
  renderWithProviders(
    <AnswersCited
      answers={readOf(observationPage([observation('o1')]))}
      citations={readOf(citationPage([citation('o1', 1, 'g2.com', 'third_party')]))}
      labelOf={(code) => LABELS[code] ?? code}
      timeZone="UTC"
      onOpenAnswer={undefined}
      {...over}
    />,
  );

const tableOf = (): HTMLElement => screen.getByRole('table', { name: 'Own page cited in each answer' });
const rowOf = (name: RegExp | string): HTMLElement => {
  const row = within(tableOf())
    .getAllByRole('row')
    .find((entry) => within(entry).queryByText(name) !== null);
  if (row === undefined) throw new Error(`No row has ${String(name)}`);
  return row;
};

describe('the answers section', () => {
  it('lists the latest valid answers with the engine and the date', () => {
    renderSection({
      answers: readOf(
        observationPage([
          observation('o1', { engine: 'chatgpt_web', at: '2026-11-11T09:05:00Z' }),
          observation('o2', { engine: 'gemini_web', at: '2026-11-09T09:05:00Z' }),
          observation('o3', { valid: false }),
        ]),
      ),
      citations: readOf(citationPage([])),
    });
    expect(screen.getByRole('heading', { name: 'Cited in each answer' })).toBeInTheDocument();
    const rows = within(tableOf()).getAllByRole('row');
    // The header row and one row for each valid answer
    expect(rows).toHaveLength(3);
    expect(within(rows[1] as HTMLElement).getByText('ChatGPT')).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText('Nov 11, 09:05')).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).getByText('Gemini')).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).getByText('Nov 9, 09:05')).toBeInTheDocument();
  });

  it('has the Answer, Cited page and Other domains columns', () => {
    renderSection();
    for (const name of ['Answer', 'Cited page', 'Other domains']) {
      expect(within(tableOf()).getByRole('columnheader', { name })).toBeInTheDocument();
    }
  });

  it('opens the answer from its date through onOpenAnswer', async () => {
    const onOpenAnswer = vi.fn();
    const { user } = renderSection({ onOpenAnswer });
    await user.click(screen.getByRole('button', { name: 'Open the ChatGPT answer of Nov 11, 09:05' }));
    expect(onOpenAnswer).toHaveBeenCalledWith('o1', '2026-11-11T09:05:00Z');
  });

  it('shows the date as plain text without onOpenAnswer', () => {
    renderSection({ onOpenAnswer: undefined });
    expect(screen.queryByRole('button', { name: /Open the/ })).toBeNull();
    expect(screen.getByText('Nov 11, 09:05')).toBeInTheDocument();
  });

  it('shows the own page cited with its path and Source 2 of 9', () => {
    const rows = [
      citation('o1', 1, 'g2.com', 'third_party'),
      citation('o1', 2, 'fynix.io', 'own', { url: 'https://www.fynix.io/blog/seo-tools', title: 'SEO tools' }),
      ...[3, 4, 5, 6, 7, 8, 9].map((index) => citation('o1', index, `site${String(index)}.com`, 'third_party')),
    ];
    renderSection({ citations: readOf(citationPage(rows)) });
    const row = rowOf('Source 2 of 9');
    expect(within(row).getByText('Source 2 of 9')).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: /seo-tools/ })).toHaveAttribute(
      'href',
      'https://www.fynix.io/blog/seo-tools',
    );
  });

  it('says how many more own pages the answer cites', () => {
    const rows = [
      citation('o1', 1, 'fynix.io', 'own'),
      citation('o1', 2, 'fynix.io', 'own'),
      citation('o1', 3, 'fynix.io', 'own'),
    ];
    renderSection({ citations: readOf(citationPage(rows)) });
    expect(screen.getByText('and 2 more own pages')).toBeInTheDocument();
  });

  it('says Not cited when the answer cites sources and none is own', () => {
    renderSection({
      citations: readOf(
        citationPage([citation('o1', 1, 'g2.com', 'third_party'), citation('o1', 2, 'rival.io', 'competitor')]),
      ),
    });
    expect(within(rowOf('Nov 11, 09:05')).getByText('Not cited')).toBeInTheDocument();
  });

  it('says No source in this answer for an answer that cites none', () => {
    renderSection({
      answers: readOf(observationPage([observation('o1', { total: 0 })])),
      citations: readOf(citationPage([])),
    });
    expect(screen.getByText('No source in this answer')).toBeInTheDocument();
    expect(screen.queryByText('Not cited')).toBeNull();
  });

  it('opens the other domains from their count, at most 5 with their pages, in a popover', async () => {
    const rows = [
      citation('o1', 1, 'fynix.io', 'own'),
      ...['a.com', 'b.com', 'c.com', 'd.com', 'e.com', 'f.com', 'g.com'].map((domain, at) =>
        citation('o1', at + 2, domain, 'third_party'),
      ),
      citation('o1', 9, 'a.com', 'third_party', { url_id: 99 }),
    ];
    const { user } = renderSection({ citations: readOf(citationPage(rows)) });
    await user.click(screen.getByRole('button', { name: '7 domains cited in this answer, show them' }));
    const popup = await screen.findByRole('dialog', { name: 'Also cited' });
    expect(within(popup).getAllByRole('listitem')).toHaveLength(5);
    // The domain with two pages is first, and the count of pages is said in words
    expect(within(within(popup).getAllByRole('listitem')[0] as HTMLElement).getByText('2 pages')).toBeInTheDocument();
    expect(within(popup).getByText('and 2 more')).toBeInTheDocument();
  });

  it('says Cited instead when no own page is cited and Also cited when one is', async () => {
    const instead = renderSection({
      citations: readOf(citationPage([citation('o1', 1, 'g2.com', 'third_party')])),
    });
    await instead.user.click(screen.getByRole('button', { name: '1 domain cited in this answer, show them' }));
    expect(await screen.findByRole('dialog', { name: 'Cited instead' })).toBeInTheDocument();
    instead.unmount();
    const also = renderSection({
      citations: readOf(
        citationPage([citation('o1', 1, 'fynix.io', 'own'), citation('o1', 2, 'g2.com', 'third_party')]),
      ),
    });
    await also.user.click(screen.getByRole('button', { name: '1 domain cited in this answer, show them' }));
    expect(await screen.findByRole('dialog', { name: 'Also cited' })).toBeInTheDocument();
  });

  it('marks the role of a domain in the popover', async () => {
    const { user } = renderSection({
      citations: readOf(citationPage([citation('o1', 1, 'rival.io', 'competitor')])),
    });
    await user.click(screen.getByRole('button', { name: '1 domain cited in this answer, show them' }));
    const popup = await screen.findByRole('dialog', { name: 'Cited instead' });
    expect(within(popup).getByText('Competitor')).toBeInTheDocument();
  });

  it('says the section is based on the latest answers when the citation list has more rows', () => {
    // The list is cut by rows: the last answer may be incomplete, so it is left out and the section says so
    const rows = [citation('o1', 1, 'g2.com', 'third_party'), citation('o2', 1, 'g2.com', 'third_party')];
    renderSection({
      answers: readOf(observationPage([observation('o1'), observation('o2')])),
      citations: readOf(citationPage(rows, true)),
    });
    expect(screen.getByText('Based on the latest 1 answer.')).toBeInTheDocument();
  });

  it('does not say it when the list holds every row', () => {
    renderSection();
    expect(screen.queryByText(/Based on the latest/)).toBeNull();
  });

  it('never writes the word rank', () => {
    const { container } = renderSection({
      citations: readOf(
        citationPage([citation('o1', 1, 'fynix.io', 'own'), citation('o1', 2, 'g2.com', 'third_party')]),
      ),
    });
    expect(container.textContent).not.toMatch(/rank/i);
    expect(container.textContent).not.toMatch(/#\d/);
  });
});

describe('the states of the answers section', () => {
  it('uses n/a, not 0, for an answer whose citations are not loaded, and says why with Retry', async () => {
    const retry = vi.fn();
    const { user } = renderSection({
      citations: readOf<CitationPage>(undefined, { status: 'error', retry }),
    });
    const row = rowOf('Nov 11, 09:05');
    expect(within(row).getAllByText('n/a')).toHaveLength(2);
    expect(within(row).queryByText('0')).toBeNull();
    expect(screen.getByText('The citations of the answers could not be loaded.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('keeps no source for an answer with no citations while the list is not loaded', () => {
    renderSection({
      answers: readOf(observationPage([observation('o1', { total: 0 })])),
      citations: readOf<CitationPage>(undefined, { status: 'error' }),
    });
    expect(screen.getByText('No source in this answer')).toBeInTheDocument();
  });

  it('shows skeleton rows while the answers load', () => {
    const { container } = renderSection({ answers: readOf<Schemas['ObservationPage']>(undefined) });
    expect(screen.getByRole('heading', { name: 'Cited in each answer' })).toBeInTheDocument();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByRole('table', { name: 'Own page cited in each answer' })).toBeNull();
  });

  it('shows the cells of the citations as loading while only they load', () => {
    const { container } = renderSection({ citations: readOf<CitationPage>(undefined) });
    expect(within(rowOf('Nov 11, 09:05')).queryByText('n/a')).toBeNull();
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
  });

  it('says there are no answers to read, with the reason', () => {
    renderSection({ answers: readOf(observationPage([])), citations: readOf(citationPage([])) });
    expect(screen.getByText('No answers to read')).toBeInTheDocument();
    expect(screen.getByText(/Each prompt is asked twice a week/)).toBeInTheDocument();
  });

  it('says the same for a window with answers that are none valid', () => {
    renderSection({
      answers: readOf(observationPage([observation('o1', { valid: false })])),
      citations: readOf(citationPage([])),
    });
    expect(screen.getByText('No answers to read')).toBeInTheDocument();
  });

  it('shows an inline error with Retry when the answers fail', async () => {
    const retry = vi.fn();
    const { user } = renderSection({
      answers: readOf<Schemas['ObservationPage']>(undefined, { status: 'error', retry }),
    });
    expect(screen.getByText('The answers could not be loaded.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('keeps the rows and marks the section busy while it refreshes', () => {
    const { container } = renderSection({
      answers: readOf(observationPage([observation('o1')]), { refreshing: true }),
    });
    expect(tableOf()).toBeInTheDocument();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });
});

describe('accessibility', () => {
  it('is axe clean', async () => {
    const { container } = renderSection({
      onOpenAnswer: vi.fn(),
      citations: readOf(
        citationPage([citation('o1', 1, 'fynix.io', 'own'), citation('o1', 2, 'g2.com', 'third_party')]),
      ),
    });
    expect(await axe(container)).toHaveNoViolations();
  });

  it('is axe clean with the popover open', async () => {
    const { user } = renderSection({
      citations: readOf(citationPage([citation('o1', 1, 'g2.com', 'third_party')])),
    });
    await user.click(screen.getByRole('button', { name: '1 domain cited in this answer, show them' }));
    await screen.findByRole('dialog', { name: 'Cited instead' });
    expect(await axe(document.body)).toHaveNoViolations();
  });
});
