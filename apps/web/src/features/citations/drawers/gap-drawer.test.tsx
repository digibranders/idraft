import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { z } from 'zod';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { GapDrawer, type GapDrawerProps } from './gap-drawer';
import type { TrackedCompetitor } from '../board-reads';
import { InspectorLayout } from '@/components/app/inspector/inspector-layout';
import type { CitationGapDetail } from '@/lib/citations/board-queries';
import { CITATIONS_FIXTURE } from '@/mocks/citations-v2-fixture';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { mswPath, problem } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { mockBrowser } from '@/test/mock-api';
import { server } from '@/test/msw';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The fixture projects are missing');
const P = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}/projects/${fynix.project_id}`;
const FIRST = CITATIONS_FIXTURE.expected.chatgpt.gaps.first;
const PROMPT_ID = CITATIONS_FIXTURE.prompts.find((prompt) => prompt.text === FIRST)?.id ?? '';
const GAP = mswPath('/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/citation-gaps/{prompt_id}');

const ENTITIES = z.array(
  z.object({
    entity: z.object({ entity_id: z.string(), canonical_name: z.string() }),
    role: z.string(),
    color_index: z.number().nullable(),
    removed_at: z.string().nullable(),
  }),
);
let tracked: readonly TrackedCompetitor[] = [];

beforeAll(async () => {
  const answer = await mockBrowser('viewer').call('GET', `${P}/entities`);
  tracked = ENTITIES.parse(answer.body.data)
    .filter((row) => row.role === 'competitor' && row.removed_at === null)
    .map((row) => ({
      id: row.entity.entity_id,
      name: row.entity.canonical_name,
      colorIndex: row.color_index,
      domain: null,
    }));
});

beforeEach(() => {
  stubWideScreen();
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('editor').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
});

afterEach(() => restoreWideScreen());

function setup(overrides: Partial<GapDrawerProps> = {}) {
  const props: GapDrawerProps = {
    project: { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: fynix?.project_id ?? '' },
    scope: { runs: 4, engines: ['chatgpt_web'], term: null },
    competitors: tracked.slice(0, 3),
    ownName: 'Fynix',
    promptId: PROMPT_ID,
    engines: [{ code: 'chatgpt_web', label: 'ChatGPT' }],
    scopeParts: ['ChatGPT', 'All groups', 'Last 4 runs'],
    scopeText: 'ChatGPT, All groups, Last 4 runs',
    stepping: { positionText: '1 of 61', navigation: null, onStep: undefined },
    tab: 'overview',
    onTabChange: vi.fn(),
    onClose: vi.fn(),
    onOpenAnswers: vi.fn(),
    ...overrides,
  };
  return {
    props,
    ...renderWithProviders(
      <InspectorLayout inspector={<GapDrawer {...props} />}>
        <main />
      </InspectorLayout>,
    ),
  };
}

const cell = (answers: number, cited: number) => ({
  answers,
  cited,
  mentioned: cited,
  state: cited > 0 ? ('cited' as const) : ('not' as const),
});
const brand = (answers: number, cited: number) => ({
  total: cell(answers, cited),
  engines: [{ ...cell(answers, cited), engine_code: 'chatgpt_web' as const }],
  platforms: 1,
  cited_on: cited > 0 ? 1 : 0,
});
const page = (urlId: number, entityId: string | null = null) => ({
  url_id: urlId,
  url: `https://example.com/page-${String(urlId)}`,
  citations: 2,
  engines: ['chatgpt_web' as const],
  entity_id: entityId,
});

/** A gap detail the tests shape: no page in any list and a prompt in the group Pricing, unless said otherwise. */
function detailOf(overrides: Partial<CitationGapDetail> & { topic?: { term_id: string; name: string } | null } = {}) {
  const { topic = { term_id: 't1', name: 'Pricing' }, ...lists } = overrides;
  const detail: CitationGapDetail = {
    answers: 4,
    own_pages: [],
    competitor_pages: [],
    closest_pages: [],
    third_party_pages: [],
    row: {
      prompt_id: PROMPT_ID,
      text: 'Best CRM?',
      topic,
      you: brand(4, 0),
      competitors: tracked.slice(0, 3).map((competitor) => ({ ...brand(4, 2), entity_id: competitor.id })),
      gap: 1,
      lost_on: ['chatgpt_web'],
      lost_to: tracked.slice(0, 3).map((competitor) => competitor.id),
      competitor_answers: 2,
    },
    window: {
      runs: 4,
      timezone: 'Europe/Berlin',
      current: [],
      previous: [],
      trend: [],
      answers: 4,
      prompts: 1,
      latest_answer_at: '2026-09-28T00:10:00.000Z',
      latest_run_number: 48,
    },
    ...lists,
  };
  return detail;
}
const answerWith = (detail: CitationGapDetail): void => server.use(http.get(GAP, () => HttpResponse.json(detail)));
/** The card a heading titles. */
const cardOf = (drawer: HTMLElement, title: string): HTMLElement => {
  const section = within(drawer).getByRole('heading', { name: title }).closest('section');
  if (section === null) throw new Error(`No card is titled ${title}`);
  return section;
};

describe('the gap drawer (I 209 to 331)', () => {
  it('heads the prompt with its group, the scope and where it is lost, on the Gap tab', async () => {
    const { container } = setup();
    const drawer = await screen.findByRole('complementary');
    expect(await within(drawer).findByText('lost on ChatGPT')).toBeVisible();
    for (const part of ['ChatGPT', 'All groups', 'Last 4 runs']) {
      expect(within(drawer).getAllByText(part).length).toBeGreaterThan(0);
    }
    expect(within(drawer).getByText('Prompt')).toBeVisible();
    expect(within(drawer).getByText('1 of 61')).toBeVisible();
    expect(within(drawer).getByRole('tab', { name: 'Gap' })).toHaveAttribute('aria-selected', 'true');
    for (const title of [
      'Who is cited',
      'Pages competitors win with',
      'Your closest page',
      'Third-party pages in these answers',
    ]) {
      expect(within(drawer).getByRole('heading', { name: title })).toBeVisible();
    }
    expect(await axe(container)).toHaveNoViolations();
  });

  it('lists you first, then each selected competitor, with the answers that cite them', async () => {
    setup();
    const drawer = await screen.findByRole('complementary');
    const table = await within(drawer).findByRole('table', { name: 'Who is cited' });
    const rows = within(table).getAllByRole('row');
    // The header, you, and the three competitors
    expect(rows).toHaveLength(5);
    expect(within(rows[1] as HTMLElement).getByText('Fynix')).toBeVisible();
    for (const [index, competitor] of tracked.slice(0, 3).entries()) {
      expect(within(rows[index + 2] as HTMLElement).getByText(competitor.name)).toBeVisible();
    }
  });

  it('stacks Open answers under the title only in a narrow sheet, and has no More actions menu', async () => {
    setup();
    const drawer = await screen.findByRole('complementary');
    const button = await within(drawer).findByRole('button', { name: 'Open answers' });
    expect(button.parentElement).toHaveClass('basis-full', '@sm:basis-auto');
    expect(button.closest('section')).toHaveClass('@container');
    expect(within(drawer).queryByRole('button', { name: /^More actions for/ })).not.toBeInTheDocument();
    const table = await within(drawer).findByRole('table', { name: 'Who is cited' });
    expect(within(table).getAllByRole('columnheader')[0]).toHaveClass('type-table-header');
  });

  it('opens the answers in the prompt inspector', async () => {
    const { user, props } = setup();
    const drawer = await screen.findByRole('complementary');
    await user.click(await within(drawer).findByRole('button', { name: 'Open answers' }));
    expect(props.onOpenAnswers).toHaveBeenCalledWith(PROMPT_ID);
  });

  it('shows one row per platform in scope on By platform, and writes the tab to the address', async () => {
    const { user, props } = setup({ tab: 'platforms' });
    const drawer = await screen.findByRole('complementary');
    const table = await within(drawer).findByRole('table', { name: 'By platform' });
    // The header and ChatGPT
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    await user.click(within(drawer).getByRole('tab', { name: 'Gap' }));
    expect(props.onTabChange).toHaveBeenCalledWith('overview');
  });

  it('says a prompt with no answer in the scope has none, on both tabs', async () => {
    const { unmount } = setup({ promptId: '00000000-0000-4000-8000-000000000000' });
    expect(await screen.findByText('No answer in this scope')).toBeVisible();
    expect(screen.getByText('This prompt has no answer in ChatGPT, All groups, Last 4 runs.')).toBeVisible();
    unmount();
    setup({ promptId: '00000000-0000-4000-8000-000000000000', tab: 'platforms' });
    expect(await screen.findByText('No answer in this scope')).toBeVisible();
  });

  it('says why each page list is empty, with the group named', async () => {
    answerWith(detailOf());
    setup();
    const drawer = await screen.findByRole('complementary');
    const rivals = await within(drawer).findByRole('heading', { name: 'No competitor page is cited' });
    expect(rivals).toBeVisible();
    expect(
      within(drawer).getByText('None of the selected competitors is cited for this prompt in this scope.'),
    ).toBeVisible();
    expect(within(drawer).getByRole('heading', { name: 'No page of yours is cited for Pricing' })).toBeVisible();
    expect(
      within(drawer).getByText('This prompt needs a page of its own. Start from the competitor pages above.'),
    ).toBeVisible();
    expect(within(drawer).getByRole('heading', { name: 'No third-party page' })).toBeVisible();
    expect(within(drawer).getByText('The answers cite no third-party page.')).toBeVisible();
  });

  it('says "this group" when the prompt has no group, and shows no group badge', async () => {
    answerWith(detailOf({ topic: null }));
    setup();
    const drawer = await screen.findByRole('complementary');
    expect(
      await within(drawer).findByRole('heading', { name: 'No page of yours is cited for this group' }),
    ).toBeVisible();
    expect(within(drawer).queryByText('Pricing')).toBeNull();
  });

  it('shows the group as a badge when the prompt has one', async () => {
    answerWith(detailOf());
    setup();
    const drawer = await screen.findByRole('complementary');
    expect(await within(drawer).findByText('Pricing')).toBeVisible();
  });

  it('notes each competitor page with the competitor that owns it', async () => {
    const [first, second] = tracked;
    if (first === undefined || second === undefined) throw new Error('The fixture needs two competitors');
    answerWith(detailOf({ competitor_pages: [page(1, first.id), page(2, second.id)] }));
    setup();
    const drawer = await screen.findByRole('complementary');
    await within(drawer).findByText('example.com/page-1', { exact: false });
    const card = cardOf(drawer, 'Pages competitors win with');
    const items = within(card).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0] as HTMLElement).getByText(first.name)).toBeVisible();
    expect(within(items[1] as HTMLElement).getByText(second.name)).toBeVisible();
  });

  it('notes the closest pages "Cited for other Pricing prompts" when the prompt has no page of yours here', async () => {
    answerWith(detailOf({ closest_pages: [page(3)] }));
    setup();
    const drawer = await screen.findByRole('complementary');
    const card = await waitFor(() => cardOf(drawer, 'Your closest page'));
    expect(await within(card).findByText('Cited for other Pricing prompts')).toBeVisible();
  });

  it('notes your pages "Cited in some answers to this prompt" when the prompt has some here', async () => {
    answerWith(detailOf({ own_pages: [page(4)], closest_pages: [page(3)] }));
    setup();
    const drawer = await screen.findByRole('complementary');
    const card = await waitFor(() => cardOf(drawer, 'Your closest page'));
    expect(await within(card).findByText('Cited in some answers to this prompt')).toBeVisible();
    expect(within(card).getAllByRole('listitem')).toHaveLength(1);
    expect(within(card).queryByText(/Cited for other/)).toBeNull();
  });

  it('never notes a closest page with an empty group', async () => {
    answerWith(detailOf({ topic: null, closest_pages: [page(3)] }));
    setup();
    const drawer = await screen.findByRole('complementary');
    const card = await waitFor(() => cardOf(drawer, 'Your closest page'));
    expect(await within(card).findByText('example.com/page-3', { exact: false })).toBeVisible();
    expect(within(card).queryByText(/Cited for other/)).toBeNull();
  });

  it('says the prompt could not be loaded, with one Try again', async () => {
    server.use(http.get(GAP, ({ request }) => problem(request, 'internal_error')));
    setup();
    const drawer = await screen.findByRole('complementary');
    expect(await within(drawer).findByText('Could not load this prompt')).toBeVisible();
    expect(within(drawer).getAllByRole('button', { name: 'Try again' })).toHaveLength(1);
  });
});
