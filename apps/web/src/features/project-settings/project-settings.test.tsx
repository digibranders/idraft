import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { Suspense, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectGeneralScreen } from './general-screen';
import { FreshSessionProvider } from '@/features/session';
import { LIVE_REGION_ID } from '@/lib/a11y/announcer';
import type { Role } from '@/lib/api/types';
import { LeaveGuardProvider, useGuardedPush } from '@/lib/navigation/use-leave-guard';
import { PermissionProvider } from '@/lib/permissions';
import { projectPath } from '@/lib/routes/paths';
import { membershipFactory } from '@/mocks/factories/identity';
import { projectFactory } from '@/mocks/factories/project';
import { MOCK_PROJECTS, mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/digibranders/fynix/settings/general',
}));

const [fynixSeed] = MOCK_PROJECTS;
if (!fynixSeed) throw new Error('no fixture project');
const FYNIX = projectFactory(fynixSeed);
const PROJECT_ROUTE = `*/api/v1/workspaces/${FYNIX.workspace_id}/projects/${FYNIX.project_id}`;

const PROFILE = projectPath('digibranders', 'fynix', '/settings/profile');

/** What the settings frame does for the section select of a narrow screen: a push that asks first. */
function SectionSelect(): ReactNode {
  const push = useGuardedPush();
  return (
    <button type="button" onClick={() => push(PROFILE)}>
      Go to profile
    </button>
  );
}

function screenAs(role: Role, beside: ReactNode = null): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return (
    <PermissionProvider membership={membershipFactory(role)}>
      <FreshSessionProvider>
        <LeaveGuardProvider>
          {beside}
          <Suspense fallback={null}>
            <ProjectGeneralScreen project={FYNIX} workspaceSlug="digibranders" />
          </Suspense>
        </LeaveGuardProvider>
      </FreshSessionProvider>
    </PermissionProvider>
  );
}

const politeRegion = (): HTMLElement | null => document.getElementById(LIVE_REGION_ID.polite);

describe('Project settings > General', () => {
  beforeEach(() => {
    router.push.mockReset();
    router.replace.mockReset();
    router.refresh.mockReset();
  });

  it('saves a new name through the save bar, says so, and renders the shell again', async () => {
    const { user, container } = renderWithProviders(screenAs('editor'));
    const name = await screen.findByLabelText('Name');
    expect(await axe(container)).toHaveNoViolations();
    await user.clear(name);
    await user.type(name, 'Fynix Digital');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(politeRegion()).toHaveTextContent('Project settings saved'));
    expect(router.refresh).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
  });

  it('moves the page to a new address after the save', async () => {
    const { user } = renderWithProviders(screenAs('editor'));
    const slug = await screen.findByLabelText('Address');
    await user.clear(slug);
    await user.type(slug, 'fynix-digital');
    expect(screen.getByText('Used in links: /digibranders/fynix-digital')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/digibranders/fynix-digital/settings/general'));
  });

  it('checks an address before sending it, and puts a taken one on its field', async () => {
    const { user } = renderWithProviders(screenAs('editor'));
    const slug = await screen.findByLabelText('Address');
    await user.clear(slug);
    await user.type(slug, 'settings');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('This word is used by the app. Choose another.')).toBeInTheDocument();
    await user.clear(slug);
    await user.type(slug, 'cleanstart');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Another project in this workspace uses this address.')).toBeInTheDocument();
  });

  it('says that a new time zone applies to new dates only', async () => {
    const { user } = renderWithProviders(screenAs('editor'));
    const zone = await screen.findByRole('combobox', { name: 'Time zone' });
    await user.clear(zone);
    await user.type(zone, 'Asia/Tok');
    await user.click(await screen.findByRole('option', { name: /Asia\/Tokyo/ }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(
      await screen.findByText(
        'New business dates use Asia/Tokyo. Dates already recorded keep the time zone they were counted in.',
      ),
    ).toBeInTheDocument();
  });

  it('says when the save failed, and keeps the changes', async () => {
    server.use(
      http.patch(PROJECT_ROUTE, () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Error', status: 500, code: 'internal', request_id: 'r' },
          { status: 500, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    const { user } = renderWithProviders(screenAs('editor'));
    const name = await screen.findByLabelText('Name');
    await user.type(name, ' 2');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('The settings were not saved. Try again in a moment.')).toBeInTheDocument();
    expect(name).toHaveValue('Fynix 2');
  });

  it('sends only the fields that changed', async () => {
    const bodies: unknown[] = [];
    server.events.on('request:start', ({ request }) => {
      if (request.method === 'PATCH')
        void request
          .clone()
          .json()
          .then((body: unknown) => bodies.push(body));
    });
    const { user } = renderWithProviders(screenAs('editor'));
    await user.type(await screen.findByLabelText('Name'), ' 2');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(politeRegion()).toHaveTextContent('Project settings saved'));
    expect(bodies).toEqual([{ name: 'Fynix 2' }]);
    server.events.removeAllListeners();
  });

  it('puts a time zone the API does not know on its field', async () => {
    server.use(
      http.patch(PROJECT_ROUTE, () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Invalid',
            status: 422,
            code: 'validation_failed',
            request_id: 'r',
            errors: [{ location: 'body', path: 'timezone', code: 'timezone_unknown', message: 'Unknown time zone.' }],
          },
          { status: 422, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    const { user } = renderWithProviders(screenAs('editor'));
    const zone = await screen.findByRole('combobox', { name: 'Time zone' });
    await user.clear(zone);
    await user.type(zone, 'Asia/Tok');
    await user.click(await screen.findByRole('option', { name: /Asia\/Tokyo/ }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Choose a time zone from the list.')).toBeInTheDocument();
  });

  it('asks before leaving with unsaved changes', async () => {
    const { user } = renderWithProviders(
      <>
        {screenAs('editor')}
        <a href="/digibranders/fynix/settings/profile">Profile</a>
      </>,
    );
    await user.type(await screen.findByLabelText('Name'), ' 2');
    await user.click(screen.getByRole('link', { name: 'Profile' }));
    expect(
      await screen.findByRole('alertdialog', { name: 'Discard your unsaved changes on this page?' }),
    ).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
  });

  describe('with changes in the details and in the keyword defaults', () => {
    /** The page with both forms changed: the name, and the default check frequency. */
    async function changeBoth(user: ReturnType<typeof renderWithProviders>['user']): Promise<HTMLElement> {
      const name = await screen.findByLabelText('Name');
      await user.type(name, ' 2');
      const defaults = await screen.findByRole('region', { name: 'Keyword defaults' });
      await waitFor(() =>
        expect(within(defaults).getByRole('combobox', { name: 'Default check frequency' })).toHaveTextContent('Daily'),
      );
      await user.click(within(defaults).getByRole('combobox', { name: 'Default check frequency' }));
      await user.click(await screen.findByRole('option', { name: 'Weekly' }));
      return defaults;
    }

    it('asks one question for the page when a link is followed, and keeps both on request', async () => {
      const { user } = renderWithProviders(
        screenAs('editor', <a href="/digibranders/fynix/settings/profile">Profile</a>),
      );
      const defaults = await changeBoth(user);
      await user.click(screen.getByRole('link', { name: 'Profile' }));
      const question = await screen.findByRole('alertdialog', { name: 'Discard your unsaved changes on this page?' });
      expect(screen.getAllByRole('alertdialog')).toHaveLength(1);
      await user.click(within(question).getByRole('button', { name: 'Keep editing' }));
      await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
      expect(router.push).not.toHaveBeenCalled();
      expect(screen.getByLabelText('Name')).toHaveValue('Fynix 2');
      expect(within(defaults).getByRole('combobox', { name: 'Default check frequency' })).toHaveTextContent('Weekly');
    });

    it('drops both when the question is answered with discard, and goes where the link led', async () => {
      const { user } = renderWithProviders(
        screenAs('editor', <a href="/digibranders/fynix/settings/profile">Profile</a>),
      );
      const defaults = await changeBoth(user);
      await user.click(screen.getByRole('link', { name: 'Profile' }));
      const question = await screen.findByRole('alertdialog', { name: 'Discard your unsaved changes on this page?' });
      await user.click(within(question).getByRole('button', { name: 'Discard changes' }));
      expect(router.push).toHaveBeenCalledExactlyOnceWith(PROFILE);
      expect(screen.getByLabelText('Name')).toHaveValue('Fynix');
      expect(within(defaults).getByRole('combobox', { name: 'Default check frequency' })).toHaveTextContent('Daily');
    });

    it('asks the same single question of the section select of a narrow screen', async () => {
      const { user } = renderWithProviders(screenAs('editor', <SectionSelect />));
      const defaults = await changeBoth(user);
      await user.click(screen.getByRole('button', { name: 'Go to profile' }));
      const question = await screen.findByRole('alertdialog', { name: 'Discard your unsaved changes on this page?' });
      expect(screen.getAllByRole('alertdialog')).toHaveLength(1);
      expect(router.push).not.toHaveBeenCalled();
      await user.click(within(question).getByRole('button', { name: 'Discard changes' }));
      expect(router.push).toHaveBeenCalledExactlyOnceWith(PROFILE);
      expect(screen.getByLabelText('Name')).toHaveValue('Fynix');
      expect(within(defaults).getByRole('combobox', { name: 'Default check frequency' })).toHaveTextContent('Daily');
    });

    it('asks for the keyword defaults alone as well', async () => {
      const { user } = renderWithProviders(screenAs('editor', <SectionSelect />));
      const defaults = await screen.findByRole('region', { name: 'Keyword defaults' });
      await waitFor(() =>
        expect(within(defaults).getByRole('combobox', { name: 'Default check frequency' })).toHaveTextContent('Daily'),
      );
      await user.click(within(defaults).getByRole('combobox', { name: 'Default check frequency' }));
      await user.click(await screen.findByRole('option', { name: 'Weekly' }));
      await user.click(screen.getByRole('button', { name: 'Go to profile' }));
      expect(
        await screen.findByRole('alertdialog', { name: 'Discard your unsaved changes on this page?' }),
      ).toBeInTheDocument();
    });
  });

  it('says when pausing failed, and resumes a paused project', async () => {
    server.use(
      http.patch(
        PROJECT_ROUTE,
        () =>
          HttpResponse.json(
            { type: 'about:blank', title: 'Error', status: 500, code: 'internal', request_id: 'r' },
            { status: 500, headers: { 'content-type': 'application/problem+json' } },
          ),
        { once: true },
      ),
    );
    const { user } = renderWithProviders(screenAs('editor'));
    await user.click(await screen.findByRole('button', { name: 'Pause tracking' }));
    expect(await screen.findAllByText('Tracking was not paused. Try again in a moment.')).not.toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Pause tracking' }));
    await user.click(await screen.findByRole('button', { name: 'Resume tracking' }));
    await waitFor(() => expect(politeRegion()).toHaveTextContent('Tracking resumed'));
  });

  it('keeps the archive question open with the reason when it fails', async () => {
    server.use(
      http.patch(PROJECT_ROUTE, () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Error', status: 500, code: 'internal', request_id: 'r' },
          { status: 500, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    const { user } = renderWithProviders(screenAs('editor'));
    await user.click(await screen.findByRole('button', { name: 'Archive project' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Archive Fynix?' });
    await user.click(within(dialog).getByRole('button', { name: 'Archive project' }));
    expect(await within(dialog).findByText('The project was not archived. Try again in a moment.')).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('shows the values read-only, with the reason, to a member who may not change them', async () => {
    const { container } = renderWithProviders(screenAs('viewer'));
    expect(await screen.findByText('Owners, admins and editors can change project settings.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Archive project' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Pause tracking' })).toBeNull();
    expect(screen.getByText('Checks run on their schedule.')).toBeInTheDocument();
    expect(screen.getByText('/digibranders/fynix')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('pauses tracking and says so', async () => {
    const { user } = renderWithProviders(screenAs('editor'));
    await user.click(await screen.findByRole('button', { name: 'Pause tracking' }));
    await waitFor(() => expect(politeRegion()).toHaveTextContent('Tracking paused'));
    expect(await screen.findByRole('button', { name: 'Resume tracking' })).toBeInTheDocument();
  });

  it('archives the project after asking, and goes to the workspace', async () => {
    const { user } = renderWithProviders(screenAs('editor'));
    await user.click(await screen.findByRole('button', { name: 'Archive project' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Archive Fynix?' });
    // The dialog moves focus in the frame after it opens
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus());
    await user.click(within(dialog).getByRole('button', { name: 'Archive project' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/digibranders'));
  });
});
