import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { Suspense, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { enginesKey } from './prompt-queries';
import { PromptsScreen, type PromptsProject } from './prompts-screen';
import { TopBarSlotProvider, TopBarSlotTarget } from '@/components/app/shell/top-bar-slot';
import type { Prompt, Role } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { mswPath } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/ai/prompts',
}));

/** Thursday 12 November 2026, noon UTC: the 02:00 run has answered. */
const NOW = new Date('2026-11-12T12:00:00Z');
const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';

const [fynix, cleanstart] = MOCK_PROJECTS;
if (fynix === undefined || cleanstart === undefined) throw new Error('The fixture projects are missing');
const asProject = (project: (typeof MOCK_PROJECTS)[number], country: string): PromptsProject => ({
  id: project.project_id,
  slug: project.slug,
  name: project.name,
  timeZone: project.timezone,
  defaultLanguage: 'en',
  defaultCountryIso: country,
});

beforeEach(() => {
  vi.setSystemTime(NOW);
  stubWideScreen();
});
afterEach(() => {
  vi.useRealTimers();
  restoreWideScreen();
});

const fynixProject = asProject(fynix, 'DE');

function promptsAs(role: Role, project: PromptsProject = fynixProject): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return (
    <PermissionProvider membership={membershipFactory(role)}>
      <Suspense fallback={null}>
        <PromptsScreen
          workspaceId={MOCK_WORKSPACE.workspace_id}
          workspaceSlug={MOCK_WORKSPACE.slug}
          project={project}
        />
      </Suspense>
    </PermissionProvider>
  );
}

const grid = (): Promise<HTMLElement> => screen.findByRole('grid', { name: 'Prompts' });

describe('Topics & Prompts', () => {
  it('lists the active prompts with their topic and country, and the window in the top bar', async () => {
    const { container } = renderWithProviders(promptsAs('viewer'), { searchParams: '?tab=prompts' });
    const table = await grid();
    expect(
      await within(table).findByText('Which SEO agency is best for a SaaS startup in Germany?'),
    ).toBeInTheDocument();
    expect(within(table).getAllByText('Technical SEO').length).toBeGreaterThan(0);
    expect(within(table).getAllByText('Germany').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { level: 1, name: 'Topics & Prompts' })).toBeInTheDocument();
    expect(screen.getByText('Answers from Oct 16 to Nov 12, 2026')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('says no engine is on, and where to turn one on, for a project without one', async () => {
    renderWithProviders(promptsAs('editor', asProject(cleanstart, 'US')));
    expect(await screen.findByRole('heading', { name: 'No AI engine is on' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the Engines settings' })).toHaveAttribute(
      'href',
      '/digibranders/cleanstart/settings/engines',
    );
  });

  it('says when the first answers arrive while no prompt has one, so an empty table is not read as a failure', async () => {
    server.use(
      http.get(mswPath(`${P}/ai/prompts-summary`), () =>
        HttpResponse.json({
          data: {
            window: { from: '2026-10-16', to: '2026-11-12', timezone: 'Europe/Berlin' },
            include_branded: false,
            engine_codes: ['chatgpt_web'],
            prompts: [],
            topics: [],
          },
        }),
      ),
    );
    renderWithProviders(promptsAs('viewer'));
    expect(
      await screen.findByText(
        'No data yet. Each prompt is asked twice a week, on Monday and Thursday, and its first answers arrive after the next run.',
      ),
    ).toBeInTheDocument();
  });

  it('offers a retry when the prompts do not load', async () => {
    server.use(http.get(mswPath(`${P}/prompts`), () => HttpResponse.json({ code: 'boom' }, { status: 500 })));
    renderWithProviders(promptsAs('viewer'), { searchParams: '?tab=prompts' });
    expect(await screen.findByText('The prompts could not be loaded.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('says so to a member who cannot read the data', async () => {
    renderWithProviders(promptsAs('billing'));
    expect(
      await screen.findByRole('heading', { name: 'You cannot see the prompts of this project' }),
    ).toBeInTheDocument();
  });

  it('gives an editor Add prompts, which opens the dialog', async () => {
    const { user } = renderWithProviders(promptsAs('editor'), { searchParams: '?tab=prompts' });
    await grid();
    await user.click(await screen.findByRole('button', { name: 'Add prompts' }));
    expect(await screen.findByRole('dialog', { name: 'Add prompts' })).toBeInTheDocument();
  });

  it('gives an editor Add prompts in the empty state of a project without a prompt', async () => {
    server.use(
      http.get(mswPath(`${P}/prompts`), () =>
        HttpResponse.json({ data: [], page: { has_more: false, next_cursor: null } }),
      ),
    );
    const { user } = renderWithProviders(promptsAs('editor'));
    expect(await screen.findByRole('heading', { name: 'No prompts yet' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add prompts' }));
    expect(await screen.findByRole('dialog', { name: 'Add prompts' })).toBeInTheDocument();
  });

  it('does not offer Add prompts to a viewer', async () => {
    renderWithProviders(promptsAs('viewer'), { searchParams: '?tab=prompts' });
    await grid();
    expect(screen.queryByRole('button', { name: 'Add prompts' })).toBeNull();
  });
});

const NO_ANSWERS_TEXT =
  'No data yet. Each prompt is asked twice a week, on Monday and Thursday, and its first answers arrive after the next run.';
const NO_MATCH_TITLE = 'No prompts match';
const NO_PROMPTS_TITLE = 'No prompts yet';
const SUMMARY_PATH = mswPath(`${P}/ai/prompts-summary`);
const LIST_PATH = mswPath(`${P}/prompts`);
const ENGINES_PATH = mswPath(`${P}/engines`);
const EMPTY_SUMMARY = {
  data: {
    window: { from: '2026-10-16', to: '2026-11-12', timezone: 'Europe/Berlin' },
    include_branded: false,
    engine_codes: ['chatgpt_web'],
    prompts: [],
    topics: [],
  },
};

const idOf = (kind: number, index: number): string =>
  `${String(kind).repeat(8)}-0000-4000-8000-${String(index).padStart(12, '0')}`;
const promptOf = (index: number, branded = false): Prompt => ({
  prompt_id: idOf(1, index),
  country_iso: 'DE',
  created_at: NOW.toISOString(),
  created_by: null,
  creation_method: 'human',
  current_version: {
    change_kind: 'initial',
    created_at: NOW.toISOString(),
    prompt_version_id: idOf(2, index),
    text: `Question number ${String(index)}?`,
    text_hash: 'a'.repeat(64),
    version_no: 1,
  },
  funnel_stage: 'unknown',
  importance: 3,
  intent: 'unknown',
  is_active: true,
  is_branded: branded,
  language_code: 'en',
  prompt_type: 'question',
  source: 'manual',
  terms: [],
  updated_at: NOW.toISOString(),
});
const pageOf = (data: Prompt[], next: string | null): { data: Prompt[]; page: object } => ({
  data,
  page: { has_more: next !== null, next_cursor: next },
});

/** A promise a test settles itself, to hold an answer back. */
function gate(): { opened: Promise<void>; open: () => void } {
  let open = (): void => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 60));

const withTopBar = (ui: ReactElement): ReactElement => (
  <TopBarSlotProvider>
    <TopBarSlotTarget />
    {ui}
  </TopBarSlotProvider>
);

describe('Topics & Prompts: what the list and the counts do while they load or fail', () => {
  it('leaves a branded prompt out of the table', async () => {
    renderWithProviders(promptsAs('viewer'));
    const table = await grid();
    await within(table).findByText('Which SEO agency is best for a SaaS startup in Germany?');
    expect(within(table).queryByText('Is Fynix a good SEO agency for software companies?')).toBeNull();
  });

  it('says the counts did not load, keeps the list, and reads them again on Try again', async () => {
    let calls = 0;
    server.use(
      http.get(SUMMARY_PATH, () => {
        calls += 1;
        return calls === 1 ? HttpResponse.json({ code: 'boom' }, { status: 500 }) : HttpResponse.json(EMPTY_SUMMARY);
      }),
    );
    const { user } = renderWithProviders(promptsAs('viewer'));
    expect(
      await screen.findByText('The answer counts could not be loaded. The prompts are listed without them.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(NO_ANSWERS_TEXT)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(NO_ANSWERS_TEXT)).toBeInTheDocument();
    expect(
      screen.queryByText('The answer counts could not be loaded. The prompts are listed without them.'),
    ).toBeNull();
  });

  it('offers a retry when the engines do not load', async () => {
    server.use(http.get(ENGINES_PATH, () => HttpResponse.json({ code: 'boom' }, { status: 500 })));
    renderWithProviders(promptsAs('viewer'));
    expect(await screen.findByText('The engines of this project could not be loaded.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('keeps the page when a later read of the engines fails', async () => {
    const { queryClient } = renderWithProviders(promptsAs('viewer'));
    await grid();
    server.use(http.get(ENGINES_PATH, () => HttpResponse.json({ code: 'boom' }, { status: 500 })));
    await queryClient.refetchQueries({
      queryKey: enginesKey({ workspaceId: MOCK_WORKSPACE.workspace_id, projectId: fynixProject.id }),
    });
    expect(screen.queryByText('The engines of this project could not be loaded.')).toBeNull();
    expect(await grid()).toBeInTheDocument();
  });

  it('says no prompt matches a search that finds none', async () => {
    renderWithProviders(promptsAs('viewer'), { searchParams: '?q=zzzznothing' });
    expect(await screen.findByRole('heading', { name: NO_MATCH_TITLE })).toBeInTheDocument();
  });

  it('says there are no prompts yet when every prompt of the project is branded', async () => {
    server.use(
      http.get(LIST_PATH, () => HttpResponse.json(pageOf([promptOf(1, true), promptOf(2, true)], null))),
      http.get(SUMMARY_PATH, () => HttpResponse.json(EMPTY_SUMMARY)),
    );
    renderWithProviders(promptsAs('editor'));
    expect(await screen.findByRole('heading', { name: NO_PROMPTS_TITLE })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: NO_MATCH_TITLE })).toBeNull();
    expect(screen.queryByText(NO_ANSWERS_TEXT)).toBeNull();
  });

  it('asks the summary for the window in the address', async () => {
    const asked: URL[] = [];
    server.use(
      http.get(SUMMARY_PATH, ({ request }) => {
        asked.push(new URL(request.url));
        return HttpResponse.json(EMPTY_SUMMARY);
      }),
    );
    renderWithProviders(promptsAs('viewer'), { searchParams: '?window=7' });
    expect(await screen.findByText('Answers from Nov 6 to Nov 12, 2026')).toBeInTheDocument();
    await grid();
    expect(asked.map((url) => [url.searchParams.get('from'), url.searchParams.get('to')])).toContainEqual([
      '2026-11-06',
      '2026-11-12',
    ]);
  });

  it('keeps the table on screen while a new window is read', async () => {
    const second = gate();
    let calls = 0;
    server.use(
      http.get(SUMMARY_PATH, async () => {
        calls += 1;
        if (calls > 1) await second.opened;
        return HttpResponse.json(EMPTY_SUMMARY);
      }),
    );
    const { user } = renderWithProviders(withTopBar(promptsAs('viewer')));
    const table = await grid();
    await within(table).findByText('Which SEO agency is best for a SaaS startup in Germany?');
    await user.click(await screen.findByRole('combobox', { name: 'Window' }));
    await user.click(await screen.findByRole('option', { name: 'Last 7 days' }));
    expect(await screen.findByText('Answers from Nov 6 to Nov 12, 2026')).toBeInTheDocument();
    await settle();
    expect(calls).toBe(2);
    expect(
      within(await grid()).getByText('Which SEO agency is best for a SaaS startup in Germany?'),
    ).toBeInTheDocument();
    second.open();
  });

  it('does not say there are no prompts, nor offer Add prompts, before the engines have answered', async () => {
    const engines = gate();
    server.use(
      http.get(ENGINES_PATH, async () => {
        await engines.opened;
        return HttpResponse.json({ code: 'boom' }, { status: 500 });
      }),
      http.get(LIST_PATH, () => HttpResponse.json(pageOf([], null))),
    );
    renderWithProviders(promptsAs('editor'));
    await settle();
    expect(screen.queryByRole('heading', { name: NO_PROMPTS_TITLE })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add prompts' })).toBeNull();
    engines.open();
  });

  it('does not offer Add prompts over a list before the engines have answered', async () => {
    const engines = gate();
    server.use(
      http.get(ENGINES_PATH, async () => {
        await engines.opened;
        return HttpResponse.json({ data: [] });
      }),
    );
    renderWithProviders(promptsAs('editor'));
    await settle();
    expect(screen.queryByRole('button', { name: 'Add prompts' })).toBeNull();
    engines.open();
  });

  it('reads every page of a long list', async () => {
    const cursors: (string | null)[] = [];
    server.use(
      http.get(LIST_PATH, ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor');
        cursors.push(cursor);
        return HttpResponse.json(
          cursor === null
            ? pageOf([promptOf(1), promptOf(2), promptOf(3)], 'page-2')
            : pageOf([promptOf(4), promptOf(5)], null),
        );
      }),
    );
    renderWithProviders(promptsAs('viewer'));
    const table = await grid();
    expect(await within(table).findByText('Question number 5?')).toBeInTheDocument();
    expect(within(table).getByText('Question number 1?')).toBeInTheDocument();
    expect(cursors).toEqual([null, 'page-2']);
  });

  it('says the list may be incomplete when a later page fails, and reads it again on Try again', async () => {
    let failing = true;
    server.use(
      http.get(LIST_PATH, ({ request }) => {
        if (new URL(request.url).searchParams.get('cursor') === null) {
          return HttpResponse.json(pageOf([promptOf(1), promptOf(2)], 'page-2'));
        }
        return failing
          ? HttpResponse.json({ code: 'boom' }, { status: 500 })
          : HttpResponse.json(pageOf([promptOf(3)], null));
      }),
    );
    const { user } = renderWithProviders(promptsAs('viewer'));
    expect(
      await screen.findByText('Some prompts could not be loaded, so the list may be incomplete.'),
    ).toBeInTheDocument();
    expect(within(await grid()).getByText('Question number 1?')).toBeInTheDocument();
    failing = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await within(await grid()).findByText('Question number 3?')).toBeInTheDocument();
    expect(screen.queryByText('Some prompts could not be loaded, so the list may be incomplete.')).toBeNull();
  });
});
