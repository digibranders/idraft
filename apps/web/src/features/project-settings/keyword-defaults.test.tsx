import { screen, waitFor, within } from '@testing-library/react';
import { http } from 'msw';
import { Suspense, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProjectGeneralScreen } from './general-screen';
import { FreshSessionProvider } from '@/features/session';
import { LIVE_REGION_ID } from '@/lib/a11y/announcer';
import type { Role } from '@/lib/api/types';
import { LeaveGuardProvider } from '@/lib/navigation/use-leave-guard';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { projectFactory } from '@/mocks/factories/project';
import { MOCK_PROJECTS, mockUser } from '@/mocks/fixtures';
import { invalid, mswPath, problem } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/settings/general',
}));

const [fynixSeed] = MOCK_PROJECTS;
if (!fynixSeed) throw new Error('no fixture project');
const FYNIX = projectFactory(fynixSeed);
const SETTINGS = `/api/v1/workspaces/${FYNIX.workspace_id}/projects/${FYNIX.project_id}/settings`;

afterEach(() => {
  server.events.removeAllListeners();
});

function screenAs(role: Role): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return (
    <PermissionProvider membership={membershipFactory(role)}>
      <FreshSessionProvider>
        <LeaveGuardProvider>
          <Suspense fallback={null}>
            <ProjectGeneralScreen project={FYNIX} workspaceSlug="digibranders" />
          </Suspense>
        </LeaveGuardProvider>
      </FreshSessionProvider>
    </PermissionProvider>
  );
}

const politeRegion = (): HTMLElement | null => document.getElementById(LIVE_REGION_ID.polite);

/** The requests the section sends to the settings route, as `METHOD` and body. */
function recordSettings(): { method: string; body: unknown }[] {
  const seen: { method: string; body: unknown }[] = [];
  server.events.on('request:start', ({ request }) => {
    if (!new URL(request.url).pathname.endsWith('/settings')) return;
    const entry = { method: request.method, body: undefined as unknown };
    seen.push(entry);
    if (request.method === 'PATCH') {
      void request
        .clone()
        .json()
        .then((body: unknown) => {
          entry.body = body;
        });
    }
  });
  return seen;
}

const defaults = async (): Promise<HTMLElement> => {
  const heading = await screen.findByRole('heading', { name: 'Keyword defaults' });
  const section = heading.closest('section');
  if (section === null) throw new Error('The keyword defaults have no section');
  return section;
};

/** The section once its controls have loaded, for a member who may change it. */
const editableDefaults = async (): Promise<HTMLElement> => {
  const section = await defaults();
  await within(section).findByRole('combobox', { name: 'Default device' });
  return section;
};

describe('Project settings > General > Keyword defaults', () => {
  it('shows the project’s defaults beside the rest of General, and saves only the ones that changed', async () => {
    const seen = recordSettings();
    const { user, container } = renderWithProviders(screenAs('editor'));
    const section = await defaults();
    await waitFor(() =>
      expect(within(section).getByRole('combobox', { name: 'Default device' })).toHaveTextContent('Desktop'),
    );
    expect(within(section).getByRole('combobox', { name: 'Default depth profile' })).toHaveTextContent('Standard');
    expect(within(section).getByRole('combobox', { name: 'Default check frequency' })).toHaveTextContent('Daily');
    expect(within(section).queryByRole('button', { name: 'Save defaults' })).toBeNull();
    expect(await axe(container)).toHaveNoViolations();

    await user.click(within(section).getByRole('combobox', { name: 'Default device' }));
    await user.click(await screen.findByRole('option', { name: 'Desktop and mobile' }));
    await user.click(within(section).getByRole('combobox', { name: 'Default depth profile' }));
    await user.click(await screen.findByRole('option', { name: /^Deep/ }));
    await user.click(within(section).getByRole('button', { name: 'Save defaults' }));
    await waitFor(() => expect(politeRegion()).toHaveTextContent('Keyword defaults saved'));
    expect(seen.find((request) => request.method === 'PATCH')?.body).toEqual({
      seo: { default_device: 'both', default_depth_profile: 'deep' },
    });
    expect(within(section).getByRole('combobox', { name: 'Default device' })).toHaveTextContent('Desktop and mobile');
    expect(within(section).queryByRole('button', { name: 'Save defaults' })).toBeNull();
    // Add keywords reads the same settings: they are read again, so the dialog opens on the new default
    await waitFor(() => expect(seen.map((request) => request.method)).toEqual(['GET', 'PATCH', 'GET']));
  });

  it('holds the controls still while the save is on its way, so a change made then is not overwritten', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.patch(mswPath(SETTINGS), async () => {
        await gate;
        return undefined;
      }),
    );
    const { user } = renderWithProviders(screenAs('editor'));
    const section = await editableDefaults();
    await user.click(within(section).getByRole('combobox', { name: 'Default device' }));
    await user.click(await screen.findByRole('option', { name: 'Mobile' }));
    await user.click(within(section).getByRole('button', { name: 'Save defaults' }));
    for (const name of ['Default device', 'Default depth profile', 'Default check frequency']) {
      await waitFor(() => expect(within(section).getByRole('combobox', { name })).toBeDisabled());
    }
    release();
    await waitFor(() => expect(within(section).getByRole('combobox', { name: 'Default device' })).toBeEnabled());
    expect(within(section).getByRole('combobox', { name: 'Default device' })).toHaveTextContent('Mobile');
    expect(within(section).queryByRole('button', { name: 'Save defaults' })).toBeNull();
  });

  it('keeps the other settings of the section while one is changed, and discards on request', async () => {
    const { user } = renderWithProviders(screenAs('editor'));
    const section = await editableDefaults();
    await waitFor(() =>
      expect(within(section).getByRole('combobox', { name: 'Default check frequency' })).toHaveTextContent('Daily'),
    );
    await user.click(within(section).getByRole('combobox', { name: 'Default check frequency' }));
    await user.click(await screen.findByRole('option', { name: 'Weekly' }));
    expect(within(section).getByRole('combobox', { name: 'Default check frequency' })).toHaveTextContent('Weekly');
    await user.click(within(section).getByRole('button', { name: 'Discard' }));
    expect(within(section).getByRole('combobox', { name: 'Default check frequency' })).toHaveTextContent('Daily');
    expect(within(section).queryByRole('button', { name: 'Save defaults' })).toBeNull();
  });

  it('does not offer the depth profile the API refuses for now', async () => {
    const { user } = renderWithProviders(screenAs('editor'));
    const section = await editableDefaults();
    await user.click(within(section).getByRole('combobox', { name: 'Default depth profile' }));
    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'LightDaily check to the top 10, deep check to the top 100 each week',
      'StandardDaily check to the top 20, deep check to the top 100 each week',
      'DeepDaily check to the top 50, deep check to the top 100 each week',
      'FullDaily check to the top 100',
      'WeeklyOne check to the top 100 each week, none on other days',
      'Weekly lightOne check to the top 20 each week, none on other days',
    ]);
  });

  it('keeps its own save apart from the save bar of the project’s details', async () => {
    const { user } = renderWithProviders(screenAs('editor'));
    const section = await defaults();
    await user.type(await screen.findByLabelText('Name'), ' 2');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
    expect(within(section).queryByRole('button', { name: 'Save defaults' })).toBeNull();
  });

  it('puts the refusal of a depth profile on its field, and keeps the change', async () => {
    server.use(
      http.patch(mswPath(SETTINGS), ({ request }) =>
        invalid(request, [
          {
            location: 'body',
            path: 'seo.default_depth_profile',
            code: 'depth_profile_not_available',
            message: 'Not available.',
          },
        ]),
      ),
    );
    const { user } = renderWithProviders(screenAs('editor'));
    const section = await editableDefaults();
    await user.click(within(section).getByRole('combobox', { name: 'Default depth profile' }));
    await user.click(await screen.findByRole('option', { name: /^Full/ }));
    await user.click(within(section).getByRole('button', { name: 'Save defaults' }));
    expect(
      await within(section).findByText('This depth profile is not available yet. Choose another.'),
    ).toBeInTheDocument();
    expect(within(section).getByRole('combobox', { name: 'Default depth profile' })).toHaveTextContent('Full');
  });

  it('says when the save failed, and keeps the changes', async () => {
    server.use(http.patch(mswPath(SETTINGS), ({ request }) => problem(request, 'rate_limited')));
    const { user } = renderWithProviders(screenAs('editor'));
    const section = await editableDefaults();
    await user.click(within(section).getByRole('combobox', { name: 'Default device' }));
    await user.click(await screen.findByRole('option', { name: 'Mobile' }));
    await user.click(within(section).getByRole('button', { name: 'Save defaults' }));
    expect(await within(section).findByText('The defaults were not saved. Try again in a moment.')).toBeInTheDocument();
    expect(within(section).getByRole('combobox', { name: 'Default device' })).toHaveTextContent('Mobile');
  });

  it('offers a retry when the defaults do not load', async () => {
    server.use(http.get(mswPath(SETTINGS), ({ request }) => problem(request, 'rate_limited')));
    renderWithProviders(screenAs('editor'));
    const section = await defaults();
    expect(await within(section).findByText('The keyword defaults could not be loaded.')).toBeInTheDocument();
    expect(within(section).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('leaves the section out for a role that reads no project data', async () => {
    renderWithProviders(screenAs('billing'));
    expect(await screen.findByText('Owners, admins and editors can change project settings.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Keyword defaults' })).toBeNull());
    expect(screen.queryByText('The keyword defaults could not be loaded.')).toBeNull();
  });

  it('shows the defaults read-only to a member who may not change the project', async () => {
    const { container } = renderWithProviders(screenAs('viewer'));
    const section = await defaults();
    expect(await within(section).findByText('Desktop')).toBeInTheDocument();
    expect(within(section).getByText('Standard')).toBeInTheDocument();
    expect(within(section).getByText('Daily')).toBeInTheDocument();
    expect(within(section).queryByRole('combobox')).toBeNull();
    expect(within(section).queryByRole('button')).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });
});
