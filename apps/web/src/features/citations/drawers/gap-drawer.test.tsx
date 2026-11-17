import { screen, within } from '@testing-library/react';
import { http } from 'msw';
import { z } from 'zod';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { GapDrawer, type GapDrawerProps } from './gap-drawer';
import type { TrackedCompetitor } from '../board-reads';
import { InspectorLayout } from '@/components/app/inspector/inspector-layout';
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

  it('says the prompt could not be loaded, with one Try again', async () => {
    server.use(http.get(GAP, ({ request }) => problem(request, 'internal_error')));
    setup();
    const drawer = await screen.findByRole('complementary');
    expect(await within(drawer).findByText('Could not load this prompt')).toBeVisible();
    expect(within(drawer).getAllByRole('button', { name: 'Try again' })).toHaveLength(1);
  });
});
