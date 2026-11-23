import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { Suspense, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PromptsScreen } from './prompts-screen';
import type { Role } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { mswPath } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { server } from '@/test/msw';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';
import { rewriteSummary } from '@/test/summary-rewrite';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/ai/prompts',
  useSearchParams: () => new URLSearchParams(''),
}));

/** Thursday 12 November 2026, noon UTC: the 02:00 run has answered. */
const NOW = new Date('2026-11-12T12:00:00Z');
const CAPTURE_PATH =
  '/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/observations/{observation_id}/screenshot';
const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The Fynix project fixture is missing');
const SHOT_PATH = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}/projects/${fynix.project_id}/ai/observations`;

type State = 'available' | 'capturable' | 'expired' | 'unsupported';
/** The prompt texts the summary was given each state for, by state: the first prompt rows the page asked for. */
const given = new Map<State, string>();
interface LatestRow {
  observation_id: string;
  screenshot_url: string | null;
  screenshot_state: State;
}

/**
 * Makes the first four prompts that have a ChatGPT answer say each screenshot state, whatever the mock says: the mock
 * only knows an answer that can still be captured, and one that is stored after a capture.
 */
function giveEachState(): void {
  rewriteSummary((body) => {
    const states: State[] = ['available', 'capturable', 'expired', 'unsupported'];
    let next = 0;
    for (const row of body.data.prompts) {
      const engine = row.engines.find((candidate) => candidate.engine_code === 'chatgpt_web');
      const latest = engine?.latest as LatestRow | null | undefined;
      const state = states[next];
      if (latest === undefined || latest === null || state === undefined) continue;
      next += 1;
      given.set(state, row.text);
      latest.screenshot_state = state;
      latest.screenshot_url = state === 'available' ? `${SHOT_PATH}/${latest.observation_id}/screenshot` : null;
    }
  });
}

beforeEach(() => {
  vi.setSystemTime(NOW);
  stubWideScreen();
  given.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  server.events.removeAllListeners();
  vi.useRealTimers();
  restoreWideScreen();
});

function promptsAs(role: Role): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return (
    <PermissionProvider membership={membershipFactory(role)}>
      <Suspense fallback={null}>
        <PromptsScreen
          workspaceId={MOCK_WORKSPACE.workspace_id}
          workspaceSlug={MOCK_WORKSPACE.slug}
          project={{
            id: fynix?.project_id ?? '',
            slug: fynix?.slug ?? '',
            name: fynix?.name ?? '',
            timeZone: fynix?.timezone ?? 'UTC',
            defaultLanguage: 'en',
            defaultCountryIso: 'DE',
          }}
        />
      </Suspense>
    </PermissionProvider>
  );
}

/** The Prompts tab with ChatGPT alone in view, which is when the Screenshot column exists. */
async function renderChatgpt(role: Role): Promise<{ user: ReturnType<typeof renderWithProviders>['user'] }> {
  giveEachState();
  const { user } = renderWithProviders(promptsAs(role), { searchParams: '?tab=prompts&engine=chatgpt_web' });
  const table = await screen.findByRole('grid', { name: 'Prompts' });
  await waitFor(() => expect(given.size).toBe(4));
  await within(table).findAllByRole('row');
  return { user };
}

/** The row of a prompt, by its text. */
const rowOf = async (state: State): Promise<HTMLElement> => {
  const text = given.get(state) ?? '';
  const table = screen.getByRole('grid', { name: 'Prompts' });
  const cell = await within(table).findByText(text);
  return cell.closest<HTMLElement>('[role="row"]') as HTMLElement;
};

describe('the Screenshot column of the Prompts page', () => {
  it('draws each state in its row for a person who may spend: the image, Get screenshot, Expired and n/a', async () => {
    await renderChatgpt('editor');
    const stored = within(await rowOf('available')).getByRole('button', {
      name: /^Open the latest ChatGPT answer screenshot for /,
    });
    expect(stored).toHaveTextContent('Nov 12');
    const get = within(await rowOf('capturable')).getByRole('button', {
      name: /^Get a screenshot of the latest ChatGPT answer for /,
    });
    expect(get).toHaveTextContent('Get screenshot');
    const expired = await rowOf('expired');
    expect(within(expired).getByText('Expired')).toBeInTheDocument();
    expect(within(expired).queryByRole('button', { name: /screenshot/i })).not.toBeInTheDocument();
    const unsupported = await rowOf('unsupported');
    expect(within(unsupported).queryByRole('button', { name: /screenshot/i })).not.toBeInTheDocument();
    expect(within(unsupported).queryByText('Expired')).not.toBeInTheDocument();
  });

  it('opens a stored image in the dialog from its path', async () => {
    const { user } = await renderChatgpt('editor');
    await user.click(
      within(await rowOf('available')).getByRole('button', { name: /^Open the latest ChatGPT answer screenshot for / }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Answer screenshot' });
    expect(within(dialog).getByRole('img')).toHaveAttribute(
      'src',
      expect.stringMatching(new RegExp(`^${SHOT_PATH}/\\d+/screenshot$`)),
    );
  });

  it('gets the screenshot on a press: one POST for the answer, then the image shown in the dialog', async () => {
    const posts: string[] = [];
    server.events.on('request:start', ({ request }) => {
      if (request.method === 'POST' && new URL(request.url).pathname.endsWith('/screenshot')) {
        posts.push(new URL(request.url).pathname);
      }
    });
    const { user } = await renderChatgpt('editor');
    await user.click(
      within(await rowOf('capturable')).getByRole('button', {
        name: /^Get a screenshot of the latest ChatGPT answer for /,
      }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Answer screenshot' });
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatch(new RegExp(`^${SHOT_PATH}/\\d+/screenshot$`));
    expect(within(dialog).getByRole('img')).toHaveAttribute('src', posts[0]);
  });

  it('says it failed in the row and offers Try again', async () => {
    server.use(
      http.post(mswPath(CAPTURE_PATH), () =>
        HttpResponse.json({ code: 'screenshot_failed', status: 502 }, { status: 502 }),
      ),
    );
    const { user } = await renderChatgpt('editor');
    const row = await rowOf('capturable');
    await user.click(within(row).getByRole('button', { name: /^Get a screenshot of the latest ChatGPT answer for / }));
    expect(
      await within(row).findByRole('button', {
        name: /^Try again to get a screenshot of the latest ChatGPT answer for /,
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows a reader the stored image but no way to spend', async () => {
    await renderChatgpt('viewer');
    expect(
      within(await rowOf('available')).getByRole('button', { name: /^Open the latest ChatGPT answer screenshot for / }),
    ).toBeInTheDocument();
    const capturable = await rowOf('capturable');
    expect(within(capturable).queryByRole('button', { name: /screenshot/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Get a screenshot/ })).not.toBeInTheDocument();
  });
});
