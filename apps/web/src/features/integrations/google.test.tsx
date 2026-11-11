import { screen, waitFor, within } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { Suspense, type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WEBMASTERS_SCOPE } from './google-model';
import { GoogleScreen } from './google-screen';
import { FreshSessionProvider } from '@/features/session';
import type { Role } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { connectionFactory, integrationFactory } from '@/mocks/factories/integrations';
import { MOCK_PASSWORD, MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import {
  integrationsCookie,
  integrationWorld,
  withConnection,
  withConnectionGrant,
  withConnectionStatus,
  withIntegration,
  type IntegrationWorld,
  type MockGrant,
} from '@/mocks/integrations-state';
import { freshSessionRequired, problem } from '@/mocks/respond';
import { isFresh, readSession, SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

const navigation = vi.hoisted(() => ({ hardNavigate: vi.fn() }));
vi.mock('@/lib/navigation/hard-navigate', () => ({ hardNavigate: navigation.hardNavigate }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/integrations/google',
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const [fynix, cleanstart] = MOCK_PROJECTS;
if (fynix === undefined || cleanstart === undefined) throw new Error('no fixture project');
const W = `*/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}`;
const GOOGLE = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=test&state=abc';

/** What the mocks hold for this browser: set before the screen renders, as a visit would find it. */
function remember(build: (world: IntegrationWorld) => IntegrationWorld): void {
  const cookie = integrationsCookie(build(integrationWorld({})));
  if (cookie === null) throw new Error('The mock state does not fit in a cookie');
  document.cookie = cookie;
}

/** A connection by the owner, as the mocks make one; its id is the first they mint. */
const connect = (world: IntegrationWorld, grant: MockGrant = 'both'): { world: IntegrationWorld; id: string } =>
  withConnection(world, {
    status: 'active',
    connectedBy: mockUser('owner').user_id,
    connectedAt: '2026-10-20T09:30:00Z',
    grant,
  });

/** A connection with the property of Fynix chosen. */
function connectedFynix(
  world: IntegrationWorld,
  { property = 'sc-domain:fynix.digital' }: { property?: string } = {},
): { world: IntegrationWorld; connectionId: string } {
  const made = connect(world);
  return {
    connectionId: made.id,
    world: withIntegration(made.world, {
      projectId: fynix?.project_id ?? '',
      connectionId: made.id,
      kind: 'gsc',
      property,
      status: 'active',
      createdAt: '2026-10-20T09:40:00Z',
    }).world,
  };
}

function screenAs(
  role: Role,
  { fresh = true, limited = false }: { fresh?: boolean; limited?: boolean } = {},
): ReactElement {
  const until = fresh ? Date.now() + 600_000 : 0;
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(until)}; Path=/; Secure`;
  return (
    <PermissionProvider
      membership={membershipFactory(role, { projectIds: limited ? [fynix?.project_id ?? ''] : null })}
    >
      <FreshSessionProvider>
        <Suspense fallback={null}>
          <GoogleScreen
            workspaceId={MOCK_WORKSPACE.workspace_id}
            workspaceSlug="digibranders"
            projectId={fynix?.project_id ?? ''}
            projectSlug="fynix"
            timeZone="Europe/Berlin"
          />
        </Suspense>
      </FreshSessionProvider>
    </PermissionProvider>
  );
}

const rowOf = async (name: string): Promise<HTMLElement> => {
  const table = await screen.findByRole('table', { name: 'Search Console properties of the connected account' });
  const row = (await within(table).findByText(name)).closest('tr');
  if (row === null) throw new Error(`No row for ${name}`);
  return row;
};

describe('Integrations, Google', () => {
  beforeEach(() => {
    navigation.hardNavigate.mockReset();
    document.cookie = 'mock-integrations=; Path=/; Max-Age=0';
  });

  describe('not connected', () => {
    it('says so, offers Connect Google, and lists in plain words what idraft will ask for', async () => {
      const { container } = renderWithProviders(screenAs('owner'));
      expect(await screen.findByRole('heading', { name: 'Google is not connected' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1, name: 'Google' })).toBeInTheDocument();
      expect(screen.getByText('Not connected. Nothing is imported from Google.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Connect Google' })).toBeInTheDocument();
      const access = screen.getByRole('list', { name: 'Access granted to idraft' });
      expect(within(access).getByText('Read search performance for Search Console properties')).toBeInTheDocument();
      expect(within(access).getByText('Cannot modify properties, sitemaps or settings')).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });

    it('shows the other sources as tabs that are not available yet, and no fake content for them', async () => {
      renderWithProviders(screenAs('owner'));
      const nav = await screen.findByRole('navigation', { name: 'Data sources' });
      expect(within(nav).getByRole('link', { name: 'Google' })).toHaveAttribute('aria-current', 'page');
      for (const name of ['Bing', 'Cloudflare', 'Imports']) {
        expect(within(nav).getByRole('link', { name })).toHaveAttribute('aria-disabled', 'true');
      }
    });

    it('sends the person to Google at the address the API gives', async () => {
      server.use(
        http.post(`${W}/projects/${fynix.project_id}/integrations/google/authorize`, () =>
          HttpResponse.json({ data: { authorization_url: GOOGLE, state_expires_at: '2026-10-20T10:00:00Z' } }),
        ),
      );
      const { user } = renderWithProviders(screenAs('owner'));
      await user.click(await screen.findByRole('button', { name: 'Connect Google' }));
      await waitFor(() => expect(navigation.hardNavigate).toHaveBeenCalledWith(GOOGLE));
    });

    it('does not follow an address that is not Google over https', async () => {
      server.use(
        http.post(`${W}/projects/${fynix.project_id}/integrations/google/authorize`, () =>
          HttpResponse.json({
            data: { authorization_url: 'http://evil.example/steal', state_expires_at: '2026-10-20T10:00:00Z' },
          }),
        ),
      );
      const { user } = renderWithProviders(screenAs('owner'));
      await user.click(await screen.findByRole('button', { name: 'Connect Google' }));
      expect(await screen.findByText(/Could not start the connection/)).toBeInTheDocument();
      expect(navigation.hardNavigate).not.toHaveBeenCalled();
    });

    it('says when Google sign-in is not set up on this installation', async () => {
      server.use(
        http.post(`${W}/projects/${fynix.project_id}/integrations/google/authorize`, ({ request }) =>
          problem(request, 'integration_not_configured'),
        ),
      );
      const { user } = renderWithProviders(screenAs('owner'));
      await user.click(await screen.findByRole('button', { name: 'Connect Google' }));
      expect(await screen.findByText(/Google sign-in is not set up on this installation/)).toBeInTheDocument();
    });

    it('asks the person to confirm it is them when the session is not fresh, and goes on once they did', async () => {
      server.use(
        http.post(`${W}/projects/${fynix.project_id}/integrations/google/authorize`, ({ request, cookies }) => {
          const session = readSession(cookies);
          return session !== null && isFresh(session)
            ? HttpResponse.json({ data: { authorization_url: GOOGLE, state_expires_at: '2026-10-20T10:00:00Z' } })
            : freshSessionRequired(request);
        }),
      );
      const { user } = renderWithProviders(screenAs('admin', { fresh: false }));
      await user.click(await screen.findByRole('button', { name: 'Connect Google' }));
      const dialog = await screen.findByRole('dialog', { name: 'Confirm it is you' });
      expect(navigation.hardNavigate).not.toHaveBeenCalled();
      await user.type(within(dialog).getByLabelText('Password'), MOCK_PASSWORD);
      await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));
      await waitFor(() => expect(navigation.hardNavigate).toHaveBeenCalledWith(GOOGLE));
    });

    it('does nothing, and says nothing, when the person cancels the check', async () => {
      const { user } = renderWithProviders(screenAs('admin', { fresh: false }));
      await user.click(await screen.findByRole('button', { name: 'Connect Google' }));
      const dialog = await screen.findByRole('dialog', { name: 'Confirm it is you' });
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(navigation.hardNavigate).not.toHaveBeenCalled();
      expect(screen.queryByText(/Could not start the connection/)).not.toBeInTheDocument();
    });

    it('is read only for a role that cannot manage integrations, and for an admin limited to some projects', async () => {
      const first = renderWithProviders(screenAs('editor'));
      expect(await screen.findByText(/Connections belong to the whole workspace/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Connect Google' })).not.toBeInTheDocument();
      expect(screen.getByText(/Ask an owner or admin to connect/)).toBeInTheDocument();
      first.unmount();
      renderWithProviders(screenAs('admin', { limited: true }));
      expect(await screen.findByText(/Connections belong to the whole workspace/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Connect Google' })).not.toBeInTheDocument();
    });
  });

  describe('back from Google with an error', () => {
    it.each([
      ['scope_denied', /did not give idraft permission to read Search Console or Google Analytics/],
      ['invalid_state', /expired, was already used, or was opened in another session/],
      ['no_refresh_token', /did not return the sign-in idraft needs/],
      ['exchange_failed', /could not finish the sign-in/],
      ['google_unavailable', /Google did not answer/],
      ['integration_not_configured', /not set up on this installation/],
      ['something_new', /The connection did not finish/],
    ])('says what %s means', async (code, message) => {
      renderWithProviders(screenAs('owner'), { searchParams: `error=${code}` });
      expect(await screen.findByText(message)).toBeInTheDocument();
      expect(screen.getByText('Google was not connected.')).toBeInTheDocument();
    });

    it('offers to connect again, and to dismiss the message, which clears it from the address', async () => {
      const onUrlUpdate = vi.fn<(update: { queryString: string }) => void>();
      const { user } = renderWithProviders(screenAs('owner'), { searchParams: 'error=exchange_failed', onUrlUpdate });
      expect(await screen.findByRole('button', { name: 'Connect again' })).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Dismiss' }));
      await waitFor(() => expect(screen.queryByText('Google was not connected.')).not.toBeInTheDocument());
      expect(onUrlUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ queryString: '' }));
    });

    it('offers no retry where trying again cannot help', async () => {
      renderWithProviders(screenAs('owner'), { searchParams: 'error=integration_not_configured' });
      await screen.findByText(/not set up on this installation/);
      expect(screen.queryByRole('button', { name: 'Connect again' })).not.toBeInTheDocument();
    });
  });

  describe('choosing a property', () => {
    function backFromGoogle(): string {
      let id = '';
      remember((world) => {
        const made = connect(world);
        id = made.id;
        return made.world;
      });
      return `connection_id=${id}`;
    }

    it('lists the properties with type and permission, the one matching the project first with the primary button', async () => {
      const { container } = renderWithProviders(screenAs('owner'), { searchParams: backFromGoogle() });
      expect(await screen.findByRole('heading', { name: 'Choose a Search Console property' })).toBeInTheDocument();
      expect(
        screen.getByText(
          'Connected as seo@fynix.digital. Search Console: no property chosen. GA4: no property chosen.',
        ),
      ).toBeInTheDocument();
      const table = await screen.findByRole('table', { name: 'Search Console properties of the connected account' });
      const first = within(table).getAllByRole('row')[1];
      if (first === undefined) throw new Error('no first row');
      expect(within(first).getByText('fynix.digital')).toBeInTheDocument();
      expect(within(first).getByText('Suggested')).toBeInTheDocument();
      expect(within(first).getByText('Domain')).toBeInTheDocument();
      expect(within(first).getByText('Owner')).toBeInTheDocument();
      expect(within(first).getByText("Matches this project's domain.")).toBeInTheDocument();
      expect(within(first).getByRole('button', { name: 'Choose fynix.digital' })).toBeEnabled();
      const blog = await rowOf('https://blog.fynix.digital/');
      expect(within(blog).getByText('URL prefix')).toBeInTheDocument();
      expect(within(blog).getByText('Full user')).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });

    it('disables an unverified property and says why', async () => {
      renderWithProviders(screenAs('owner'), { searchParams: backFromGoogle() });
      const row = await rowOf('https://old-shop.example.org/');
      expect(within(row).getByRole('button', { name: 'Choose https://old-shop.example.org/' })).toBeDisabled();
      expect(within(row).getByText(/does not let an unverified user read numbers/)).toBeInTheDocument();
      expect(within(row).getByText('Unverified user')).toBeInTheDocument();
    });

    it('warns about overlap and disables a property another project already uses', async () => {
      let id = '';
      remember((world) => {
        const made = connect(world);
        id = made.id;
        return withIntegration(made.world, {
          projectId: cleanstart?.project_id ?? '',
          connectionId: made.id,
          kind: 'gsc',
          property: 'https://fynix.digital/',
          status: 'active',
          createdAt: '2026-10-20T09:40:00Z',
        }).world;
      });
      renderWithProviders(screenAs('owner'), { searchParams: `connection_id=${id}` });
      const domain = await rowOf('fynix.digital');
      expect(
        within(domain).getByText(/Overlaps https:\/\/fynix.digital\/, which is linked to a project/),
      ).toBeInTheDocument();
      const taken = (await screen.findAllByText('https://fynix.digital/'))[0]?.closest('tr');
      if (taken === null || taken === undefined) throw new Error('no row');
      expect(within(taken).getByText('Already linked to another project.')).toBeInTheDocument();
      expect(within(taken).getByRole('button', { name: /Choose/ })).toBeDisabled();
    });

    it('saves the choice, and then shows the property in the connection with a way to change it', async () => {
      const onUrlUpdate = vi.fn<(update: { queryString: string }) => void>();
      const { user } = renderWithProviders(screenAs('owner'), { searchParams: backFromGoogle(), onUrlUpdate });
      await user.click(await screen.findByRole('button', { name: 'Choose fynix.digital' }));
      expect(await screen.findByText('Property chosen')).toBeInTheDocument();
      const section = await screen.findByRole('region', { name: 'Search Console property' });
      expect(within(section).getByText('sc-domain:fynix.digital')).toBeInTheDocument();
      expect(within(section).getByRole('button', { name: 'Change' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Choose a Search Console property' })).not.toBeInTheDocument();
      // GA4 has no property yet, and its picker is still there
      expect(screen.getByRole('heading', { name: 'Choose a GA4 property' })).toBeInTheDocument();
      expect(
        screen.getByText(
          'Connected as seo@fynix.digital. Search Console: sc-domain:fynix.digital. GA4: no property chosen.',
        ),
      ).toBeInTheDocument();
      // The address no longer carries the connection Google returned
      await waitFor(() => expect(onUrlUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ queryString: '' })));
    });

    it('says when the account cannot read the property any more, and reads the list again', async () => {
      server.use(
        http.post(`${W}/projects/${fynix.project_id}/integrations`, ({ request }) =>
          problem(request, 'property_not_accessible'),
        ),
      );
      const { user } = renderWithProviders(screenAs('owner'), { searchParams: backFromGoogle() });
      await user.click(await screen.findByRole('button', { name: 'Choose fynix.digital' }));
      expect(
        (await screen.findAllByText('This account cannot read that property. The list was reloaded.')).length,
      ).toBeGreaterThan(0);
    });

    it('shows a skeleton while Google answers, and a retry when it does not', async () => {
      server.use(
        http.get(`${W}/connections/:id/properties/gsc`, async () => {
          await delay(50);
          return new HttpResponse(null, { status: 500 });
        }),
      );
      const { user } = renderWithProviders(screenAs('owner'), { searchParams: backFromGoogle() });
      expect(await screen.findByRole('heading', { name: 'Choose a Search Console property' })).toBeInTheDocument();
      expect(await screen.findByText('Could not load the properties')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Try again' }));
    });

    it('moves to the reconnect state when the connection needs renewing', async () => {
      let id = '';
      remember((world) => {
        const made = connect(world);
        id = made.id;
        return withConnectionStatus(made.world, made.id, 'reauth_required');
      });
      renderWithProviders(screenAs('owner'), { searchParams: `connection_id=${id}` });
      expect(await screen.findByText(/Reconnect to keep using Search Console and GA4/)).toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: 'Reconnect' })[0]).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Choose a Search Console property' })).not.toBeInTheDocument();
    });
  });

  describe('connected', () => {
    it('shows status, account, who connected it and since when, the property of each product, and the access', async () => {
      remember((world) => connectedFynix(world).world);
      const { container } = renderWithProviders(screenAs('owner'));
      const connection = await screen.findByRole('region', { name: 'Connection' });
      expect(within(connection).getByText('Connected')).toBeInTheDocument();
      expect(within(connection).getByText('seo@fynix.digital')).toBeInTheDocument();
      expect(within(connection).getByText('Ana Brandt')).toBeInTheDocument();
      expect(within(connection).getByText(/Oct 20, 2026/)).toBeInTheDocument();
      const section = screen.getByRole('region', { name: 'Search Console property' });
      expect(within(section).getByText('sc-domain:fynix.digital')).toBeInTheDocument();
      expect(within(section).getByText('Domain')).toBeInTheDocument();
      const access = screen.getByRole('list', { name: 'Access granted to idraft' });
      expect(within(access).getByText('Read search performance for Search Console properties')).toBeInTheDocument();
      expect(within(access).getByText('Identify the Google account that connected')).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });

    it('lists the access in one order, whatever order the API names the scopes in', async () => {
      server.use(
        http.get(`${W}/projects/${fynix.project_id}/integrations`, () =>
          HttpResponse.json({ data: [integrationFactory()], page: { offset: 0, limit: 100, total: 1 } }),
        ),
        http.get(`${W}/connections`, () =>
          HttpResponse.json({
            data: [
              connectionFactory({
                scopes: ['https://www.googleapis.com/auth/userinfo.email', 'openid', WEBMASTERS_SCOPE],
                access: { gsc: true, ga4: false },
              }),
            ],
            page: { offset: 0, limit: 100, total: 1 },
          }),
        ),
      );
      renderWithProviders(screenAs('owner'));
      const access = await screen.findByRole('list', { name: 'Access granted to idraft' });
      expect(
        within(access)
          .getAllByRole('button')
          .map((item) => item.textContent),
      ).toEqual([
        'Read search performance for Search Console properties',
        'Read reports and the property list of Google Analytics',
        'Identify the Google account that connected',
        'Read the email address of the account, to name the connection',
      ]);
      // The permission that was not granted says so, next to its line
      expect(within(access).getByText('Not granted')).toBeInTheDocument();
      expect(within(access).getAllByRole('listitem').at(-1)).toHaveTextContent(
        'Cannot modify properties, sitemaps or settings',
      );
    });

    it('shows the raw scope in a tooltip', async () => {
      remember((world) => connectedFynix(world).world);
      const { user } = renderWithProviders(screenAs('owner'));
      await user.hover(await screen.findByText('Read search performance for Search Console properties'));
      await waitFor(() =>
        expect(document.querySelector('[data-slot="tooltip"]')).toHaveTextContent(
          'https://www.googleapis.com/auth/webmasters.readonly',
        ),
      );
    });

    it('labels the sync strip and history as not started, with no numbers', async () => {
      remember((world) => connectedFynix(world).world);
      renderWithProviders(screenAs('owner'));
      const strip = await screen.findByRole('group', { name: 'Search Console sync status' });
      expect(within(strip).getByText('Never')).toBeInTheDocument();
      expect(within(strip).getByText('Not started')).toBeInTheDocument();
      expect(within(strip).getByText('None yet')).toBeInTheDocument();
      expect(within(strip).getByText('Not scheduled')).toBeInTheDocument();
      const history = screen.getByRole('region', { name: 'Search Console sync history' });
      expect(within(history).getByText('No sync yet')).toBeInTheDocument();
      expect(within(history).getByText(/Importing its numbers is not available yet/)).toBeInTheDocument();
    });

    it('lets a reader see the state without any way to change it', async () => {
      remember((world) => connectedFynix(world).world);
      renderWithProviders(screenAs('viewer'));
      const connection = await screen.findByRole('region', { name: 'Connection' });
      const section = screen.getByRole('region', { name: 'Search Console property' });
      expect(within(section).getByText('sc-domain:fynix.digital')).toBeInTheDocument();
      expect(within(connection).getByText('seo@fynix.digital')).toBeInTheDocument();
      expect(within(section).queryByRole('button', { name: 'Change' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'More actions for Google' })).not.toBeInTheDocument();
      expect(screen.getByText(/Connections belong to the whole workspace/)).toBeInTheDocument();
    });

    it('switches the property off and offers the picker again', async () => {
      remember((world) => connectedFynix(world).world);
      const { user } = renderWithProviders(screenAs('owner'));
      const section = await screen.findByRole('region', { name: 'Search Console property' });
      await user.click(await within(section).findByRole('button', { name: 'Change' }));
      const dialog = await screen.findByRole('alertdialog', { name: 'Change the Search Console property?' });
      expect(within(dialog).getByText(/The numbers already stored are kept/)).toBeInTheDocument();
      await user.click(within(dialog).getByRole('button', { name: 'Switch off property' }));
      expect(await screen.findByRole('heading', { name: 'Choose a Search Console property' })).toBeInTheDocument();
    });

    it('disconnects from the More menu, below a separator, after a question that says stored numbers are kept', async () => {
      remember((world) => connectedFynix(world).world);
      const { user } = renderWithProviders(screenAs('owner'));
      await user.click(await screen.findByRole('button', { name: 'More actions for Google' }));
      const menu = await screen.findByRole('menu');
      const items = within(menu).getAllByRole('menuitem');
      expect(items.map((item) => item.textContent)).toEqual(['Reconnect Google', 'Disconnect Google']);
      expect(within(menu).getByRole('separator')).toBeInTheDocument();
      await user.click(within(menu).getByRole('menuitem', { name: 'Disconnect Google' }));
      const dialog = await screen.findByRole('alertdialog', { name: 'Disconnect Google?' });
      expect(within(dialog).getByText(/the numbers already stored are kept/)).toBeInTheDocument();
      await user.click(within(dialog).getByRole('button', { name: 'Disconnect' }));
      expect(await screen.findByText('Google disconnected')).toBeInTheDocument();
      expect(await screen.findByRole('heading', { name: 'Google is not connected' })).toBeInTheDocument();
    });

    it('says how many projects lose the connection when others use it too', async () => {
      remember((world) => {
        const made = connectedFynix(world);
        return withIntegration(made.world, {
          projectId: cleanstart?.project_id ?? '',
          connectionId: made.connectionId,
          kind: 'gsc',
          property: 'sc-domain:cleanstart.com',
          status: 'active',
          createdAt: '2026-10-20T09:50:00Z',
        }).world;
      });
      const { user } = renderWithProviders(screenAs('owner'));
      await user.click(await screen.findByRole('button', { name: 'More actions for Google' }));
      await user.click(await screen.findByRole('menuitem', { name: 'Disconnect Google' }));
      expect(await screen.findByText(/2 properties linked to projects use this connection/)).toBeInTheDocument();
    });

    it('keeps the dialog open and says so when disconnecting fails', async () => {
      remember((world) => connectedFynix(world).world);
      server.use(
        http.delete(`${W}/connections/:id`, ({ request }) => problem(request, 'service_unavailable' as never)),
      );
      const { user } = renderWithProviders(screenAs('owner'));
      await user.click(await screen.findByRole('button', { name: 'More actions for Google' }));
      await user.click(await screen.findByRole('menuitem', { name: 'Disconnect Google' }));
      await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Disconnect' }));
      expect(await screen.findByText('Could not disconnect. Nothing was changed. Try again.')).toBeInTheDocument();
    });
  });

  describe('Google no longer accepts the sign-in', () => {
    it('warns, makes Reconnect the primary action, and keeps the property', async () => {
      remember((world) => {
        const made = connectedFynix(world);
        return withConnectionStatus(made.world, made.connectionId, 'reauth_required');
      });
      const { user } = renderWithProviders(screenAs('owner'));
      const banner = await screen.findByText(
        /Google no longer accepts the saved sign-in for seo@fynix.digital. Reconnect to keep using Search Console and GA4/,
      );
      expect(banner).toBeInTheDocument();
      expect(screen.getByText('Reconnect needed:')).toBeInTheDocument();
      const reconnect = screen.getByRole('button', { name: 'Reconnect' });
      expect(reconnect.className).toContain('bg-primary');
      expect(
        within(screen.getByRole('region', { name: 'Search Console property' })).getByText('sc-domain:fynix.digital'),
      ).toBeInTheDocument();
      server.use(
        http.post(`${W}/projects/${fynix.project_id}/integrations/google/authorize`, () =>
          HttpResponse.json({ data: { authorization_url: GOOGLE, state_expires_at: '2026-10-20T10:00:00Z' } }),
        ),
      );
      await user.click(reconnect);
      await waitFor(() => expect(navigation.hardNavigate).toHaveBeenCalledWith(GOOGLE));
    });

    it('shows the state to a reader from what the project says, without reading connections', async () => {
      remember((world) => {
        const made = connectedFynix(world);
        return withConnectionStatus(made.world, made.connectionId, 'reauth_required');
      });
      renderWithProviders(screenAs('viewer'));
      expect(await screen.findByText(/Reconnect to keep using Search Console and GA4/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Reconnect' })).not.toBeInTheDocument();
    });
  });

  describe('loading and failing', () => {
    it('shows placeholders under the real header while it loads', async () => {
      server.use(
        http.get(`${W}/projects/${fynix.project_id}/integrations`, async () => {
          await delay(100);
          return HttpResponse.json({ data: [], page: { offset: 0, limit: 100, total: 0 } });
        }),
      );
      renderWithProviders(screenAs('owner'));
      expect(screen.getByRole('heading', { level: 1, name: 'Google' })).toBeInTheDocument();
      expect(screen.getByText('Loading')).toBeInTheDocument();
      expect(await screen.findByRole('heading', { name: 'Google is not connected' })).toBeInTheDocument();
    });

    it('says it could not load and retries', async () => {
      let failing = true;
      server.use(
        http.get(`${W}/projects/${fynix.project_id}/integrations`, () =>
          failing
            ? new HttpResponse(null, { status: 500 })
            : HttpResponse.json({ data: [], page: { offset: 0, limit: 100, total: 0 } }),
        ),
      );
      const { user } = renderWithProviders(screenAs('owner'));
      expect(await screen.findByText('Could not load Google')).toBeInTheDocument();
      failing = false;
      await user.click(screen.getByRole('button', { name: 'Try again' }));
      expect(await screen.findByRole('heading', { name: 'Google is not connected' })).toBeInTheDocument();
    });

    it('says a role without access cannot see integrations, instead of offering a retry', async () => {
      server.use(
        http.get(`${W}/projects/${fynix.project_id}/integrations`, ({ request }) => problem(request, 'forbidden')),
      );
      renderWithProviders(screenAs('owner'));
      expect(await screen.findByText('Your role cannot see integrations.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    });
  });
});

/** A connection by the owner, ticking `grant`, with a Search Console and a GA4 property of Fynix when asked. */
function linked(
  world: IntegrationWorld,
  { grant = 'both', gsc = false, ga4 = false }: { grant?: MockGrant; gsc?: boolean; ga4?: boolean } = {},
): { world: IntegrationWorld; connectionId: string } {
  const made = connect(world, grant);
  let next = made.world;
  const link = (kind: 'gsc' | 'ga4', property: string): void => {
    next = withIntegration(next, {
      projectId: fynix?.project_id ?? '',
      connectionId: made.id,
      kind,
      property,
      status: 'active',
      createdAt: '2026-10-20T09:40:00Z',
    }).world;
  };
  if (gsc) link('gsc', 'sc-domain:fynix.digital');
  if (ga4) link('ga4', 'properties/398844007');
  return { world: next, connectionId: made.id };
}

const sectionOf = (name: 'Search Console property' | 'GA4 property'): Promise<HTMLElement> =>
  screen.findByRole('region', { name });

describe('Integrations, one Google connection for Search Console and GA4', () => {
  beforeEach(() => {
    navigation.hardNavigate.mockReset();
    document.cookie = 'mock-integrations=; Path=/; Max-Age=0';
  });

  describe('not connected', () => {
    it('asks for both products in one consent and says so, with one Connect Google button', async () => {
      renderWithProviders(screenAs('owner'));
      expect(await screen.findAllByRole('button', { name: 'Connect Google' })).toHaveLength(1);
      expect(screen.getByText(/One sign-in covers both/)).toBeInTheDocument();
      const access = screen.getByRole('list', { name: 'Access granted to idraft' });
      expect(within(access).getByText('Read search performance for Search Console properties')).toBeInTheDocument();
      expect(within(access).getByText('Read reports and the property list of Google Analytics')).toBeInTheDocument();
      expect(within(access).getByText('Identify the Google account that connected')).toBeInTheDocument();
      expect(within(access).queryByText('Not granted')).not.toBeInTheDocument();
      // No GA4 tab, and no section for either product before there is a connection
      const nav = screen.getByRole('navigation', { name: 'Data sources' });
      expect(within(nav).queryByRole('link', { name: 'GA4' })).not.toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'GA4 property' })).not.toBeInTheDocument();
    });
  });

  describe('back from Google with both products', () => {
    const back = (): string => {
      let id = '';
      remember((world) => {
        const made = connect(world);
        id = made.id;
        return made.world;
      });
      return `connection_id=${id}`;
    };

    it('shows a section for each product with its own picker, and the access with nothing missing', async () => {
      const { container } = renderWithProviders(screenAs('owner'), { searchParams: back() });
      const gsc = await sectionOf('Search Console property');
      const ga4 = await sectionOf('GA4 property');
      expect(await within(gsc).findByRole('heading', { name: 'Choose a Search Console property' })).toBeInTheDocument();
      expect(await within(ga4).findByRole('heading', { name: 'Choose a GA4 property' })).toBeInTheDocument();
      expect(within(ga4).getByText(/Importing GA4 numbers is not available yet/)).toBeInTheDocument();
      expect(screen.queryByText('Not granted')).not.toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });

    it('lists the GA4 properties by account, with the type, and nothing suggested', async () => {
      renderWithProviders(screenAs('owner'), { searchParams: back() });
      const table = await screen.findByRole('table', { name: 'GA4 properties of the connected account' });
      await within(table).findByText('Fynix, all sites');
      const rows = within(table).getAllByRole('row').slice(1);
      expect(rows).toHaveLength(4);
      expect(rows[0]).toHaveTextContent('Cleanstart Inc');
      for (const row of rows.slice(1)) expect(row).toHaveTextContent('Fynix Digital');
      const roll = (await within(table).findByText('Fynix, all sites')).closest('tr');
      if (roll === null) throw new Error('no row');
      expect(within(roll).getByText('Roll-up')).toBeInTheDocument();
      expect(within(roll).getByText('properties/398845333')).toBeInTheDocument();
      expect(within(table).queryByText('Suggested')).not.toBeInTheDocument();
    });

    it('saves a GA4 property, and the Search Console picker stays for its own choice', async () => {
      const { user } = renderWithProviders(screenAs('owner'), { searchParams: back() });
      await user.click(await screen.findByRole('button', { name: 'Choose Fynix website of Fynix Digital' }));
      expect(await screen.findByText('Property chosen')).toBeInTheDocument();
      const ga4 = await sectionOf('GA4 property');
      expect(await within(ga4).findByText('properties/398844007')).toBeInTheDocument();
      expect(within(ga4).getByRole('button', { name: 'Change' })).toBeInTheDocument();
      const gsc = await sectionOf('Search Console property');
      expect(within(gsc).getByRole('heading', { name: 'Choose a Search Console property' })).toBeInTheDocument();
      expect(
        screen.getByText(
          'Connected as seo@fynix.digital. Search Console: no property chosen. GA4: properties/398844007.',
        ),
      ).toBeInTheDocument();
    });

    it('disables a GA4 property that another project already uses', async () => {
      let id = '';
      remember((world) => {
        const made = connect(world);
        id = made.id;
        return withIntegration(made.world, {
          projectId: cleanstart?.project_id ?? '',
          connectionId: made.id,
          kind: 'ga4',
          property: 'properties/398844007',
          status: 'active',
          createdAt: '2026-10-20T09:40:00Z',
        }).world;
      });
      renderWithProviders(screenAs('owner'), { searchParams: `connection_id=${id}` });
      const button = await screen.findByRole('button', { name: 'Choose Fynix website of Fynix Digital' });
      expect(button).toBeDisabled();
      const row = button.closest('tr');
      if (row === null) throw new Error('no row');
      expect(within(row).getByText('Already linked to another project.')).toBeInTheDocument();
    });

    it('says when the account cannot read the GA4 property any more, and reads the list again', async () => {
      server.use(
        http.post(`${W}/projects/${fynix.project_id}/integrations`, ({ request }) =>
          problem(request, 'property_not_accessible'),
        ),
      );
      const { user } = renderWithProviders(screenAs('owner'), { searchParams: back() });
      await user.click(await screen.findByRole('button', { name: 'Choose Fynix website of Fynix Digital' }));
      expect(
        (await screen.findAllByText('This account cannot read that property. The list was reloaded.')).length,
      ).toBeGreaterThan(0);
    });

    it('shows a retry when Google does not answer for GA4, without touching the Search Console list', async () => {
      server.use(http.get(`${W}/connections/:id/properties/ga4`, () => new HttpResponse(null, { status: 500 })));
      renderWithProviders(screenAs('owner'), { searchParams: back() });
      expect(await screen.findByText('Could not load the GA4 properties')).toBeInTheDocument();
      expect(
        await screen.findByRole('table', { name: 'Search Console properties of the connected account' }),
      ).toBeInTheDocument();
    });

    it('says the account has no GA4 property', async () => {
      server.use(http.get(`${W}/connections/:id/properties/ga4`, () => HttpResponse.json({ data: [] })));
      renderWithProviders(screenAs('owner'), { searchParams: back() });
      expect(await screen.findByText('This account sees no GA4 properties')).toBeInTheDocument();
    });
  });

  describe('granular consent', () => {
    it('Search Console only: GA4 says access was not granted and offers Reconnect, and the access list shows it', async () => {
      let id = '';
      remember((world) => {
        const made = connect(world, 'gsc');
        id = made.id;
        return made.world;
      });
      const { user } = renderWithProviders(screenAs('owner'), { searchParams: `connection_id=${id}` });
      const ga4 = await sectionOf('GA4 property');
      expect(within(ga4).getByText(/Google Analytics access was not granted/)).toBeInTheDocument();
      expect(within(ga4).queryByRole('table')).not.toBeInTheDocument();
      const gsc = await sectionOf('Search Console property');
      expect(await within(gsc).findByRole('heading', { name: 'Choose a Search Console property' })).toBeInTheDocument();
      const access = screen.getByRole('list', { name: 'Access granted to idraft' });
      expect(within(access).getByText('Not granted')).toBeInTheDocument();
      server.use(
        http.post(`${W}/projects/${fynix.project_id}/integrations/google/authorize`, () =>
          HttpResponse.json({ data: { authorization_url: GOOGLE, state_expires_at: '2026-10-20T10:00:00Z' } }),
        ),
      );
      await user.click(within(ga4).getByRole('button', { name: 'Reconnect' }));
      await waitFor(() => expect(navigation.hardNavigate).toHaveBeenCalledWith(GOOGLE));
    });

    it('GA4 only: Search Console says access was not granted, and GA4 can still be chosen', async () => {
      let id = '';
      remember((world) => {
        const made = connect(world, 'ga4');
        id = made.id;
        return made.world;
      });
      renderWithProviders(screenAs('owner'), { searchParams: `connection_id=${id}` });
      const gsc = await sectionOf('Search Console property');
      expect(within(gsc).getByText(/Search Console access was not granted/)).toBeInTheDocument();
      expect(within(gsc).queryByRole('table')).not.toBeInTheDocument();
      const ga4 = await sectionOf('GA4 property');
      expect(await within(ga4).findByRole('heading', { name: 'Choose a GA4 property' })).toBeInTheDocument();
      expect(screen.getByRole('list', { name: 'Access granted to idraft' })).toHaveTextContent('Not granted');
    });

    it('names a property kept from before when its product was unticked at the last connection', async () => {
      remember((world) => {
        const made = linked(world, { gsc: true, ga4: true });
        return withConnectionGrant(made.world, made.connectionId, 'ga4');
      });
      renderWithProviders(screenAs('owner'));
      const gsc = await sectionOf('Search Console property');
      expect(await within(gsc).findByText(/Search Console access was not granted/)).toBeInTheDocument();
      expect(within(gsc).getByText(/Kept from before: sc-domain:fynix.digital/)).toBeInTheDocument();
      const ga4 = await sectionOf('GA4 property');
      expect(within(ga4).getByText('properties/398844007')).toBeInTheDocument();
    });

    it('a connection made before GA4 existed shows GA4 as not granted and Search Console as working', async () => {
      remember((world) => linked(world, { grant: 'gsc', gsc: true }).world);
      renderWithProviders(screenAs('owner'));
      const gsc = await sectionOf('Search Console property');
      expect(await within(gsc).findByText('sc-domain:fynix.digital')).toBeInTheDocument();
      expect(
        within(await sectionOf('GA4 property')).getByText(/Google Analytics access was not granted/),
      ).toBeInTheDocument();
    });

    it('readers see the state of a product from the project, without reading connections', async () => {
      remember((world) => linked(world, { gsc: true, ga4: true }).world);
      renderWithProviders(screenAs('viewer'));
      expect(await within(await sectionOf('GA4 property')).findByText('properties/398844007')).toBeInTheDocument();
      expect(within(await sectionOf('Search Console property')).queryByRole('button')).not.toBeInTheDocument();
    });
  });

  describe('both products connected', () => {
    it('shows both properties, the Search Console sync, and the GA4 import note', async () => {
      remember((world) => linked(world, { gsc: true, ga4: true }).world);
      renderWithProviders(screenAs('owner'));
      const ga4 = await sectionOf('GA4 property');
      expect(await within(ga4).findByText('properties/398844007')).toBeInTheDocument();
      expect(within(ga4).getByText(/Importing GA4 numbers is not available yet/)).toBeInTheDocument();
      expect(within(ga4).queryByText('Domain')).not.toBeInTheDocument();
      expect(
        within(await sectionOf('Search Console property')).getByText('sc-domain:fynix.digital'),
      ).toBeInTheDocument();
      expect(screen.getByRole('group', { name: 'Search Console sync status' })).toBeInTheDocument();
    });

    it('changes one property without touching the other', async () => {
      remember((world) => linked(world, { gsc: true, ga4: true }).world);
      const { user } = renderWithProviders(screenAs('owner'));
      const ga4 = await sectionOf('GA4 property');
      await user.click(await within(ga4).findByRole('button', { name: 'Change' }));
      const dialog = await screen.findByRole('alertdialog', { name: 'Change the GA4 property?' });
      expect(within(dialog).getByText(/properties\/398844007 is switched off/)).toBeInTheDocument();
      await user.click(within(dialog).getByRole('button', { name: 'Switch off property' }));
      expect(await screen.findByRole('heading', { name: 'Choose a GA4 property' })).toBeInTheDocument();
      expect(
        within(await sectionOf('Search Console property')).getByText('sc-domain:fynix.digital'),
      ).toBeInTheDocument();
    });

    it('asks to reconnect once for both products', async () => {
      remember((world) => {
        const made = linked(world, { gsc: true, ga4: true });
        return withConnectionStatus(made.world, made.connectionId, 'reauth_required');
      });
      renderWithProviders(screenAs('owner'));
      expect(await screen.findAllByText(/Reconnect to keep using Search Console and GA4/)).toHaveLength(1);
      expect(screen.getAllByRole('button', { name: 'Reconnect' })).toHaveLength(1);
      // Both properties are kept, and neither can be changed until the sign-in works
      expect(
        within(await sectionOf('Search Console property')).getByText('sc-domain:fynix.digital'),
      ).toBeInTheDocument();
      expect(within(await sectionOf('GA4 property')).getByText('properties/398844007')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Change' })).not.toBeInTheDocument();
    });

    it('names both products when disconnecting, and switches both off', async () => {
      remember((world) => linked(world, { gsc: true, ga4: true }).world);
      const { user } = renderWithProviders(screenAs('owner'));
      await user.click(await screen.findByRole('button', { name: 'More actions for Google' }));
      await user.click(await screen.findByRole('menuitem', { name: 'Disconnect Google' }));
      const dialog = await screen.findByRole('alertdialog', { name: 'Disconnect Google?' });
      expect(within(dialog).getByText(/for Search Console and GA4, and stop syncing/)).toBeInTheDocument();
      await user.click(within(dialog).getByRole('button', { name: 'Disconnect' }));
      expect(await screen.findByRole('heading', { name: 'Google is not connected' })).toBeInTheDocument();
    });
  });
});
