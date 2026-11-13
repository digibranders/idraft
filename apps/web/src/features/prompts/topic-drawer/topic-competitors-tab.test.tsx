import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { CompetitorsTab, topicCompetitorsTab } from './topic-competitors-tab';
import { NO_TOPIC } from '@/features/prompts/prompt-model';
import type { TopicTabContext } from '@/features/prompts/seams/topic-tabs';
import {
  cell,
  competitor,
  engine,
  entityCells,
  own,
  projectEngine,
  topicRow,
  weighted,
} from '@/features/prompts/topics-by-engine/cells-fixtures';
import type { EngineSummary, SummaryEntity, TopicSummaryRow } from '@/lib/api/types';
import { mswPath } from '@/mocks/respond';
import { server } from '@/test/msw';
import { DRAWER_TOPIC_ID, READY_COUNTS, renderDrawerPart, summaryOf } from '@/test/topic-drawer-harness';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/ai/prompts',
  useSearchParams: () => new URLSearchParams(''),
}));

const SUMMARY_PATH = mswPath('/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/prompts-summary');
const TRACKED: SummaryEntity[] = [competitor('beta', 'Beta'), own('own', 'Acme'), competitor('gamma', 'Gamma')];
const BODY_BASE = {
  window: { from: '2026-10-16', to: '2026-11-12', timezone: 'UTC' },
  include_branded: false,
  engine_codes: ['chatgpt_web', 'gemini_web'],
  entity_config_versions: [],
  prompts: [],
};

/** An engine whose answers that name a brand number `answers`; the entities are `[id, mentioned k, share sum]`. */
const onEngine = (
  code: string,
  answers: number,
  rows: readonly (readonly [id: string, mentioned: number, share: number])[],
): EngineSummary =>
  engine(code, {
    mentioned: weighted(5, answers, 4),
    share_of_voice: cell(answers, answers),
    entities: rows.map(([id, mentioned, share]) =>
      entityCells(id, weighted(mentioned, answers, 4), cell(share, answers)),
    ),
  });

const CHATGPT = onEngine('chatgpt_web', 10, [
  ['own', 3, 3],
  ['beta', 6, 5],
  ['gamma', 2, 2],
]);
const GEMINI = onEngine('gemini_web', 8, [
  ['own', 4, 4],
  ['beta', 1, 1],
  ['gamma', 5, 3],
]);

const rowOf = (...engines: EngineSummary[]): TopicSummaryRow => topicRow(DRAWER_TOPIC_ID, 'Technical SEO', 4, engines);
const serve = (row: TopicSummaryRow, tracked: readonly SummaryEntity[] = TRACKED): void =>
  server.use(
    http.get(SUMMARY_PATH, () => HttpResponse.json({ data: { ...BODY_BASE, entities: tracked, topics: [row] } })),
  );

const renderTab = (
  row: TopicSummaryRow = rowOf(CHATGPT, GEMINI),
  options: Parameters<typeof renderDrawerPart>[1] = {},
) => {
  serve(row);
  return renderDrawerPart(<CompetitorsTab />, { summary: summaryOf([rowOf()], TRACKED), ...options });
};
const table = (): HTMLElement => screen.getByRole('table', { name: 'Competitors by engine' });
const rowsOf = (): HTMLElement[] => within(table()).getAllByRole('row').slice(1);

describe('CompetitorsTab: the tracked entities by engine', () => {
  it('shows entities by engine with the answers behind each value, own first', async () => {
    renderTab();
    expect(await screen.findByRole('table', { name: 'Competitors by engine' })).toBeInTheDocument();
    expect(
      within(table())
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Entity', 'ChatGPT', 'Gemini']);
    const [acme, beta, gamma] = rowsOf();
    // The API lists the competitors before the own brand; the own brand is first here, tagged
    expect(acme).toHaveTextContent('Acme');
    expect(acme).toHaveTextContent('own brand');
    expect(acme).toHaveTextContent('30%, 10 answers');
    expect(acme).toHaveTextContent('50%, 8 answers');
    expect(beta).toHaveTextContent('Beta');
    expect(beta).toHaveTextContent('50%, 10 answers');
    expect(gamma).toHaveTextContent('Gamma');
    expect(gamma).toHaveTextContent('38%, 8 answers');
    expect(screen.getByRole('heading', { name: 'Competitors by engine' })).toBeInTheDocument();
  });

  it('marks and names the leader on each engine', async () => {
    renderTab();
    await screen.findByRole('table', { name: 'Competitors by engine' });
    const [, beta, gamma] = rowsOf();
    // Beta leads ChatGPT with 50 percent, Gamma leads Gemini with 38 percent; the own brand never leads
    expect(within(beta ?? document.body).getByText('50%, 10 answers')).toHaveClass('type-body-strong');
    expect(within(gamma ?? document.body).getByText('38%, 8 answers')).toHaveClass('type-body-strong');
    // A value that does not lead keeps the plain weight
    expect(within(beta ?? document.body).getByText('13%, 8 answers')).not.toHaveClass('type-body-strong');
    expect(within(beta ?? document.body).getByText('leads on ChatGPT')).toHaveClass('sr-only');
    expect(within(beta ?? document.body).queryByText('leads on Gemini')).toBeNull();
    expect(within(gamma ?? document.body).getByText('leads on Gemini')).toBeInTheDocument();
    expect(screen.queryAllByText(/^leads on /)).toHaveLength(2);
    expect(screen.getByText(/The leading competitor on each engine is in bold\./)).toBeInTheDocument();
  });

  it('switches between Mentioned and Share of voice', async () => {
    const { user } = renderTab();
    await screen.findByRole('table', { name: 'Competitors by engine' });
    expect(screen.getByRole('radio', { name: 'Share of voice' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: 'Mentioned' }));
    const [acme, beta, gamma] = rowsOf();
    expect(acme).toHaveTextContent('30%, 3 of 10 answers');
    expect(beta).toHaveTextContent('60%, 6 of 10 answers');
    expect(gamma).toHaveTextContent('63%, 5 of 8 answers');
    // Gamma has the most mentions on Gemini, Beta on ChatGPT
    expect(within(beta ?? document.body).getByText('leads on ChatGPT')).toBeInTheDocument();
    expect(within(gamma ?? document.body).getByText('leads on Gemini')).toBeInTheDocument();
  });

  it('says no tracked competitor with the Entities hint', async () => {
    serve(rowOf(CHATGPT), [own('own', 'Acme')]);
    renderDrawerPart(<CompetitorsTab />, { summary: summaryOf([rowOf()], [own('own', 'Acme')]) });
    expect(await screen.findByText('No tracked competitor')).toBeInTheDocument();
    expect(screen.getByText('Add a competitor in Entities to compare it here.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('says a failed read, keeps the section and retries', async () => {
    let fail = true;
    server.use(
      http.get(SUMMARY_PATH, () =>
        fail
          ? HttpResponse.json({ status: 500, code: 'internal_error', title: 'x' }, { status: 500 })
          : HttpResponse.json({ data: { ...BODY_BASE, entities: TRACKED, topics: [rowOf(CHATGPT, GEMINI)] } }),
      ),
    );
    const { user } = renderDrawerPart(<CompetitorsTab />, { summary: summaryOf([rowOf()], TRACKED) });
    expect(screen.getByRole('heading', { name: 'Competitors by engine' }).closest('section')).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(await screen.findByText('Competitors could not be loaded')).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('table', { name: 'Competitors by engine' })).toBeInTheDocument();
  });

  it('an engine without cells says no answers, never 0', async () => {
    renderTab(rowOf(CHATGPT, engine('gemini_web')));
    await screen.findByRole('table', { name: 'Competitors by engine' });
    const [acme, beta] = rowsOf();
    expect(acme).toHaveTextContent('30%, 10 answers');
    expect(acme).toHaveTextContent('No answers');
    expect(beta).toHaveTextContent('No answers');
    expect(table().textContent).not.toMatch(/(^|\s)0%/);
  });

  it('says too few answers where an entity cell is under 4 answers', async () => {
    renderTab(
      rowOf(
        CHATGPT,
        onEngine('gemini_web', 3, [
          ['own', 1, 1],
          ['beta', 1, 1],
          ['gamma', 1, 1],
        ]),
      ),
    );
    await screen.findByRole('table', { name: 'Competitors by engine' });
    const [acme] = rowsOf();
    expect(acme).toHaveTextContent('too few answers (3)');
  });

  it('states the 20 entity cap in the footnote', async () => {
    renderTab();
    await screen.findByRole('table', { name: 'Competitors by engine' });
    expect(
      screen.getByText(
        'The tracked set of the answers read, at most 20 entities, the own brand first. The leading competitor on each engine is in bold.',
      ),
    ).toBeInTheDocument();
  });

  it('reads the prompts without a topic from the row of no topic', async () => {
    const none = topicRow(null, null, 2, [CHATGPT, GEMINI]);
    server.use(
      http.get(SUMMARY_PATH, () => HttpResponse.json({ data: { ...BODY_BASE, entities: TRACKED, topics: [none] } })),
    );
    renderDrawerPart(<CompetitorsTab />, { topicKey: NO_TOPIC, summary: summaryOf([none], TRACKED) });
    expect(await screen.findByRole('table', { name: 'Competitors by engine' })).toBeInTheDocument();
    expect(rowsOf()[0]).toHaveTextContent('30%, 10 answers');
  });

  it('asks the topic rows with the entity cells and nothing else', async () => {
    const asked: URLSearchParams[] = [];
    server.use(
      http.get(SUMMARY_PATH, ({ request }) => {
        asked.push(new URL(request.url).searchParams);
        return HttpResponse.json({ data: { ...BODY_BASE, entities: TRACKED, topics: [rowOf(CHATGPT, GEMINI)] } });
      }),
    );
    renderDrawerPart(<CompetitorsTab />, { summary: summaryOf([rowOf()], TRACKED) });
    await screen.findByRole('table', { name: 'Competitors by engine' });
    expect(asked[0]?.get('rows')).toBe('topics');
    expect(asked[0]?.getAll('include').join(',')).toBe('entities');
  });
});

describe('topicCompetitorsTab: the tab entry', () => {
  const context = (summary: TopicTabContext['summary']): TopicTabContext => ({
    topicKey: DRAWER_TOPIC_ID,
    summary,
    counts: READY_COUNTS,
    engines: [projectEngine('chatgpt_web')],
    descendants: new Map(),
    onOpenPrompt: () => undefined,
  });

  it('is offered while the summary loads and when a competitor is tracked, not otherwise', () => {
    expect(topicCompetitorsTab.id).toBe('competitors');
    const available = topicCompetitorsTab.available;
    if (available === undefined) throw new Error('The tab has no availability rule');
    expect(available(context(undefined))).toBe(true);
    expect(available(context(summaryOf([], TRACKED)))).toBe(true);
    expect(available(context(summaryOf([], [own('own', 'Acme')])))).toBe(false);
    expect(available(context(summaryOf([], [])))).toBe(false);
  });

  it('is named Competitors and placed after the Prompts tab', () => {
    function Label(): ReactElement {
      return <p>{topicCompetitorsTab.label(useTranslations())}</p>;
    }
    renderDrawerPart(<Label />);
    expect(screen.getByText('Competitors')).toBeInTheDocument();
    expect(topicCompetitorsTab.after).toBe('prompts');
  });

  it('renders the Competitors section as its panel', async () => {
    serve(rowOf(CHATGPT, GEMINI));
    renderDrawerPart(<>{topicCompetitorsTab.render(context(undefined))}</>, { summary: summaryOf([rowOf()], TRACKED) });
    expect(await screen.findByRole('table', { name: 'Competitors by engine' })).toBeInTheDocument();
  });
});
