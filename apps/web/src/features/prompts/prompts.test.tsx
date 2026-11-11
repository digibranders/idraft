import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { Suspense, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PromptsScreen, type PromptsProject } from './prompts-screen';
import type { Role } from '@/lib/api/types';
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
