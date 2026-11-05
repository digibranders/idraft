import { screen, waitFor, within } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { Suspense, type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WEBMASTERS_SCOPE } from './gsc-model';
import { GscScreen } from './gsc-screen';
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
  withConnectionStatus,
  withIntegration,
  type IntegrationWorld,
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
  usePathname: () => '/digibranders/fynix/integrations/gsc',
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
const connect = (world: IntegrationWorld): { world: IntegrationWorld; id: string } =>
  withConnection(world, {
    status: 'active',
    connectedBy: mockUser('owner').user_id,
    connectedAt: '2026-10-20T09:30:00Z',
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
          <GscScreen
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

describe('Integrations, Google Search Console', () => {
  beforeEach(() => {
    navigation.hardNavigate.mockReset();
    document.cookie = 'mock-integrations=; Path=/; Max-Age=0';
  });

  describe('not connected', () => {
    it('says so, offers Connect Google, and lists in plain words what idraft will ask for', async () => {
      const { container } = renderWithProviders(screenAs('owner'));
      expect(await screen.findByRole('heading', { name: 'Search Console is not connected' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1, name: 'Google Search Console' })).toBeInTheDocument();
      expect(screen.getByText('Not connected. Nothing is imported from Google.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Connect Google' })).toBeInTheDocument();
      const access = screen.getByRole('list', { name: 'Access granted to idraft' });
      expect(within(access).getByText('Read search performance for the property')).toBeInTheDocument();
      expect(within(access).getByText('Cannot modify properties, sitemaps or settings')).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });

    it('shows the other sources as tabs that are not available yet, and no fake content for them', async () => {
      renderWithProviders(screenAs('owner'));
      const nav = await screen.findByRole('navigation', { name: 'Data sources' });
      expect(within(nav).getByRole('link', { name: 'Search Console' })).toHaveAttribute('aria-current', 'page');
      for (const name of ['Bing', 'GA4', 'Cloudflare', 'Imports']) {
        expect(within(nav).getByRole('link', { name })).toHaveAttribute('aria-disabled', 'true');
      }
    });

    it('sends the person to Google at the address the API gives', async () => {
      server.use(
        http.post(`${W}/projects/${fynix.project_id}/integrations/gsc/authorize`, () =>
          HttpResponse.json({ data: { authorization_url: GOOGLE, state_expires_at: '2026-10-20T10:00:00Z' } }),
        ),
      );
      const { user } = renderWithProviders(screenAs('owner'));
      await user.click(await screen.findByRole('button', { name: 'Connect Google' }));
      await waitFor(() => expect(navigation.hardNavigate).toHaveBeenCalledWith(GOOGLE));
    });

    it('does not follow an address that is not Google over https', async () => {
      server.use(
        http.post(`${W}/projects/${fynix.project_id}/integrations/gsc/authorize`, () =>
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
        http.post(`${W}/projects/${fynix.project_id}/integrations/gsc/authorize`, ({ request }) =>
          problem(request, 'integration_not_configured'),
        ),
      );
      const { user } = renderWithProviders(screenAs('owner'));
      await user.click(await screen.findByRole('button', { name: 'Connect Google' }));
      expect(await screen.findByText(/Google sign-in is not set up on this installation/)).toBeInTheDocument();
    });

    it('asks the person to confirm it is them when the session is not fresh, and goes on once they did', async () => {
      server.use(
        http.post(`${W}/projects/${fynix.project_id}/integrations/gsc/authorize`, ({ request, cookies }) => {
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
      ['scope_denied', /did not give idraft permission to read Search Console/],
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
      expect(await screen.findByRole('heading', { name: 'Choose a property' })).toBeInTheDocument();
      expect(screen.getByText('Connected as seo@fynix.digital. No property chosen yet.')).toBeInTheDocument();
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
      const connection = await screen.findByRole('region', { name: 'Connection' });
      expect(within(connection).getByText('sc-domain:fynix.digital')).toBeInTheDocument();
      expect(within(connection).getByRole('button', { name: 'Change property' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Choose a property' })).not.toBeInTheDocument();
      expect(
        screen.getByText('Connected as seo@fynix.digital. Property sc-domain:fynix.digital. No sync yet.'),
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
        http.get(`${W}/connections/:id/properties`, async () => {
          await delay(50);
          return new HttpResponse(null, { status: 500 });
        }),
      );
      const { user } = renderWithProviders(screenAs('owner'), { searchParams: backFromGoogle() });
      expect(await screen.findByRole('heading', { name: 'Choose a property' })).toBeInTheDocument();
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
      expect(await screen.findByText(/Reconnect to keep using this property/)).toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: 'Reconnect' })[0]).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Choose a property' })).not.toBeInTheDocument();
    });
  });

  describe('connected', () => {
    it('shows status, account, who connected it and since when, the property, and the access', async () => {
      remember((world) => connectedFynix(world).world);
      const { container } = renderWithProviders(screenAs('owner'));
      const connection = await screen.findByRole('region', { name: 'Connection' });
      expect(within(connection).getByText('Connected')).toBeInTheDocument();
      expect(within(connection).getByText('seo@fynix.digital')).toBeInTheDocument();
      expect(within(connection).getByText('Ana Brandt')).toBeInTheDocument();
      expect(within(connection).getByText(/Oct 20, 2026/)).toBeInTheDocument();
      expect(within(connection).getByText('sc-domain:fynix.digital')).toBeInTheDocument();
      expect(within(connection).getByText('Domain')).toBeInTheDocument();
      const access = screen.getByRole('list', { name: 'Access granted to idraft' });
      expect(within(access).getByText('Read search performance for the property')).toBeInTheDocument();
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
        'Read search performance for the property',
        'Identify the Google account that connected',
        'Read the email address of the account, to name the connection',
      ]);
      expect(within(access).getAllByRole('listitem').at(-1)).toHaveTextContent(
        'Cannot modify properties, sitemaps or settings',
      );
    });

    it('shows the raw scope in a tooltip', async () => {
      remember((world) => connectedFynix(world).world);
      const { user } = renderWithProviders(screenAs('owner'));
      await user.hover(await screen.findByText('Read search performance for the property'));
      await waitFor(() =>
        expect(document.querySelector('[data-slot="tooltip"]')).toHaveTextContent(
          'https://www.googleapis.com/auth/webmasters.readonly',
        ),
      );
    });

    it('labels the sync strip and history as not started, with no numbers', async () => {
      remember((world) => connectedFynix(world).world);
      renderWithProviders(screenAs('owner'));
      const strip = await screen.findByRole('group', { name: 'Sync status' });
      expect(within(strip).getByText('Never')).toBeInTheDocument();
      expect(within(strip).getByText('Not started')).toBeInTheDocument();
      expect(within(strip).getByText('None yet')).toBeInTheDocument();
      expect(within(strip).getByText('Not scheduled')).toBeInTheDocument();
      const history = screen.getByRole('region', { name: 'Sync history' });
      expect(within(history).getByText('No sync yet')).toBeInTheDocument();
      expect(within(history).getByText(/Importing its numbers is not available yet/)).toBeInTheDocument();
    });

    it('lets a reader see the state without any way to change it', async () => {
      remember((world) => connectedFynix(world).world);
      renderWithProviders(screenAs('viewer'));
      const connection = await screen.findByRole('region', { name: 'Connection' });
      expect(within(connection).getByText('sc-domain:fynix.digital')).toBeInTheDocument();
      expect(within(connection).getByText('seo@fynix.digital')).toBeInTheDocument();
      expect(within(connection).queryByRole('button', { name: 'Change property' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'More actions for Google Search Console' })).not.toBeInTheDocument();
      expect(screen.getByText(/Connections belong to the whole workspace/)).toBeInTheDocument();
    });

    it('switches the property off and offers the picker again', async () => {
      remember((world) => connectedFynix(world).world);
      const { user } = renderWithProviders(screenAs('owner'));
      await user.click(await screen.findByRole('button', { name: 'Change property' }));
      const dialog = await screen.findByRole('alertdialog', { name: 'Change the property?' });
      expect(within(dialog).getByText(/The numbers already stored are kept/)).toBeInTheDocument();
      await user.click(within(dialog).getByRole('button', { name: 'Switch off property' }));
      expect(await screen.findByRole('heading', { name: 'Choose a property' })).toBeInTheDocument();
      expect(screen.getByText('None chosen yet')).toBeInTheDocument();
    });

    it('disconnects from the More menu, below a separator, after a question that says stored numbers are kept', async () => {
      remember((world) => connectedFynix(world).world);
      const { user } = renderWithProviders(screenAs('owner'));
      await user.click(await screen.findByRole('button', { name: 'More actions for Google Search Console' }));
      const menu = await screen.findByRole('menu');
      const items = within(menu).getAllByRole('menuitem');
      expect(items.map((item) => item.textContent)).toEqual(['Reconnect Google', 'Disconnect Google']);
      expect(within(menu).getByRole('separator')).toBeInTheDocument();
      await user.click(within(menu).getByRole('menuitem', { name: 'Disconnect Google' }));
      const dialog = await screen.findByRole('alertdialog', { name: 'Disconnect Google?' });
      expect(within(dialog).getByText(/the numbers already stored are kept/)).toBeInTheDocument();
      await user.click(within(dialog).getByRole('button', { name: 'Disconnect' }));
      expect(await screen.findByText('Google disconnected')).toBeInTheDocument();
      expect(await screen.findByRole('heading', { name: 'Search Console is not connected' })).toBeInTheDocument();
    });

    it('says how many projects lose the connection when others use it too', async () => {
      remember((world) => {
        const made = connectedFynix(world);
        return withIntegration(made.world, {
          projectId: cleanstart?.project_id ?? '',
          connectionId: made.connectionId,
          property: 'sc-domain:cleanstart.com',
          status: 'active',
          createdAt: '2026-10-20T09:50:00Z',
        }).world;
      });
      const { user } = renderWithProviders(screenAs('owner'));
      await user.click(await screen.findByRole('button', { name: 'More actions for Google Search Console' }));
      await user.click(await screen.findByRole('menuitem', { name: 'Disconnect Google' }));
      expect(await screen.findByText(/2 projects use this connection and stop syncing/)).toBeInTheDocument();
    });

    it('keeps the dialog open and says so when disconnecting fails', async () => {
      remember((world) => connectedFynix(world).world);
      server.use(
        http.delete(`${W}/connections/:id`, ({ request }) => problem(request, 'service_unavailable' as never)),
      );
      const { user } = renderWithProviders(screenAs('owner'));
      await user.click(await screen.findByRole('button', { name: 'More actions for Google Search Console' }));
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
        /Google no longer accepts the saved sign-in for seo@fynix.digital. Reconnect to keep using this property/,
      );
      expect(banner).toBeInTheDocument();
      expect(screen.getByText('Reconnect needed:')).toBeInTheDocument();
      const reconnect = screen.getByRole('button', { name: 'Reconnect' });
      expect(reconnect.className).toContain('bg-primary');
      expect(
        within(screen.getByRole('region', { name: 'Connection' })).getByText('sc-domain:fynix.digital'),
      ).toBeInTheDocument();
      server.use(
        http.post(`${W}/projects/${fynix.project_id}/integrations/gsc/authorize`, () =>
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
      expect(await screen.findByText(/Reconnect to keep using this property/)).toBeInTheDocument();
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
      expect(screen.getByRole('heading', { level: 1, name: 'Google Search Console' })).toBeInTheDocument();
      expect(screen.getByText('Loading')).toBeInTheDocument();
      expect(await screen.findByRole('heading', { name: 'Search Console is not connected' })).toBeInTheDocument();
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
      expect(await screen.findByText('Could not load Search Console')).toBeInTheDocument();
      failing = false;
      await user.click(screen.getByRole('button', { name: 'Try again' }));
      expect(await screen.findByRole('heading', { name: 'Search Console is not connected' })).toBeInTheDocument();
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
