import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { Suspense, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InternalLinksSettingsScreen } from './internal-links-screen';
import type { Role } from '@/lib/api/types';
import type { CrawlRun } from '@/lib/internal-links/types';
import { LeaveGuardProvider } from '@/lib/navigation/use-leave-guard';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { EVENTUS } from '@/mocks/internal-links-world';
import { mswPath } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { mockBrowser } from '@/test/mock-api';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/eventus-security/settings/links',
  useSearchParams: () => new URLSearchParams(),
}));

const P = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}/projects/${EVENTUS.project_id}`;
const CRAWLS = mswPath('/api/v1/workspaces/{workspace_id}/projects/{project_id}/link-crawls');

afterEach(() => {
  server.events.removeAllListeners();
  document.documentElement.classList.remove('dark');
});

function screenAs(role: Role, host = 'eventussecurity.com'): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return (
    <PermissionProvider membership={membershipFactory(role)}>
      <LeaveGuardProvider>
        <Suspense fallback={null}>
          <InternalLinksSettingsScreen
            workspaceId={MOCK_WORKSPACE.workspace_id}
            workspaceSlug={MOCK_WORKSPACE.slug}
            projectId={EVENTUS.project_id}
            projectSlug={EVENTUS.slug}
            host={host}
            timeZone={EVENTUS.timezone}
          />
        </Suspense>
      </LeaveGuardProvider>
    </PermissionProvider>
  );
}

/** The bodies of the PATCH requests to the project settings, with the mock still answering. */
function patches(): unknown[] {
  const seen: unknown[] = [];
  server.events.on('request:start', ({ request }) => {
    if (request.method === 'PATCH' && request.url.endsWith('/settings')) {
      void request
        .clone()
        .json()
        .then((body: unknown) => seen.push(body));
    }
  });
  return seen;
}

describe('Project settings > Internal links', () => {
  it('holds a change in a save bar, warns about the cost, and saves only the changed setting', async () => {
    const seen = patches();
    const { user } = renderWithProviders(screenAs('editor'));
    const toggle = await screen.findByRole('switch', { name: 'Render JavaScript' });
    expect(toggle).not.toBeChecked();
    expect(screen.queryByText(/10 times as much\. Turn it on only/)).toBeNull();
    await user.click(toggle);
    expect(toggle).toBeChecked();
    expect(screen.getByText(/10 times as much\. Turn it on only/)).toBeInTheDocument();
    expect(screen.getByText('1 unsaved change')).toBeInTheDocument();
    expect(seen).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(seen).toEqual([{ internal_links: { render_javascript: true } }]));
    await waitFor(() => expect(screen.queryByText('1 unsaved change')).toBeNull());
    expect(screen.getByRole('switch', { name: 'Render JavaScript' })).toBeChecked();
  });

  it('puts the schedule back with Discard and sends nothing', async () => {
    const seen = patches();
    const { user } = renderWithProviders(screenAs('editor'));
    const schedule = await screen.findByRole('combobox', { name: 'Schedule' });
    expect(schedule).toHaveTextContent('Weekly');
    await user.click(schedule);
    await user.click(await screen.findByRole('option', { name: 'Monthly' }));
    expect(screen.getByRole('combobox', { name: 'Schedule' })).toHaveTextContent('Monthly');
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.getByRole('combobox', { name: 'Schedule' })).toHaveTextContent('Weekly');
    expect(seen).toHaveLength(0);
  });

  it('shows the server reason under the subdomains when a host is not the site', async () => {
    const { user } = renderWithProviders(screenAs('editor'));
    const field = await screen.findByRole('textbox', { name: 'Allowed subdomains' });
    await user.type(field, 'shop.elsewhere.com');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(
      await screen.findByText(
        /Each host must be the project.s website or a subdomain of it \(eventussecurity\.com\): shop\.elsewhere\.com/,
      ),
    ).toBeInTheDocument();
    // The settings are unchanged and the bar stays, so the person can correct the hosts
    expect(screen.getByText('1 unsaved change')).toBeInTheDocument();
  });

  it('refuses more than 10 hosts before sending', async () => {
    const seen = patches();
    const { user } = renderWithProviders(screenAs('editor'));
    const field = await screen.findByRole('textbox', { name: 'Allowed subdomains' });
    const hosts = Array.from({ length: 11 }, (_, index) => `s${String(index)}.eventussecurity.com`).join(', ');
    await user.click(field);
    await user.paste(hosts);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Give at most 10 hosts, separated by commas.')).toBeInTheDocument();
    expect(seen).toHaveLength(0);
  });

  it('saves valid subdomains of the site as a list', async () => {
    const seen = patches();
    const { user } = renderWithProviders(screenAs('editor'));
    await user.type(
      await screen.findByRole('textbox', { name: 'Allowed subdomains' }),
      'blog.eventussecurity.com, docs.eventussecurity.com',
    );
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(seen).toEqual([
        { internal_links: { allowed_subdomains: ['blog.eventussecurity.com', 'docs.eventussecurity.com'] } },
      ]),
    );
  });

  it('shows the settings read-only to a viewer, with no save bar', async () => {
    renderWithProviders(screenAs('viewer'));
    expect(await screen.findByRole('switch', { name: 'Render JavaScript' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('textbox', { name: 'Allowed subdomains' })).toBeDisabled();
    expect(
      screen.getByText('Only members who can change this project can change its crawl settings.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
  });

  it('lists the crawls with state, trigger, pages, cost and date', async () => {
    renderWithProviders(screenAs('editor'));
    const table = await screen.findByRole('table', { name: 'Latest 10 crawls' });
    expect(await within(table).findByText('Ready')).toBeInTheDocument();
    for (const header of ['When', 'Started by', 'State', 'Pages', 'Cost']) {
      expect(within(table).getByRole('columnheader', { name: header })).toBeInTheDocument();
    }
  });

  it('words a failed crawl from the catalog and never prints the run error message', async () => {
    const base = (await mockBrowser('viewer').call('GET', `${P}/link-crawls`)).body as {
      data: CrawlRun[];
      page: unknown;
    };
    const first = base.data[0];
    if (first === undefined) throw new Error('The mock has no crawl');
    const failed: CrawlRun = {
      ...first,
      state: 'failed',
      is_latest: false,
      error_code: 'site_blocked',
      error_message: 'RAW PROVIDER TEXT',
    };
    server.use(http.get(CRAWLS, () => HttpResponse.json({ ...base, data: [failed] })));
    renderWithProviders(screenAs('editor'));
    const table = await screen.findByRole('table', { name: 'Latest 10 crawls' });
    expect(await within(table).findByText('Failed')).toBeInTheDocument();
    expect(within(table).getByText(/refuses our crawler/)).toBeInTheDocument();
    expect(screen.queryByText(/RAW PROVIDER TEXT/)).toBeNull();
  });

  it('lists a crawl the system cancelled as Cancelled, blaming no one and never printing its message', async () => {
    const base = (await mockBrowser('viewer').call('GET', `${P}/link-crawls`)).body as {
      data: CrawlRun[];
      page: unknown;
    };
    const first = base.data[0];
    if (first === undefined) throw new Error('The mock has no crawl');
    const cancelled: CrawlRun = {
      ...first,
      state: 'cancelled',
      is_latest: false,
      error_code: null,
      error_message: 'Cancelled by the system: the project was paused',
    };
    server.use(http.get(CRAWLS, () => HttpResponse.json({ ...base, data: [cancelled] })));
    const { container } = renderWithProviders(screenAs('editor'));
    const table = await screen.findByRole('table', { name: 'Latest 10 crawls' });
    expect(await within(table).findByText('Cancelled')).toBeInTheDocument();
    expect(container.textContent).not.toContain('by the system');
    expect(container.textContent).not.toMatch(/cancelled by|you cancelled/i);
  });

  it('shows the estimate of a crawl that is under way', async () => {
    const base = (await mockBrowser('viewer').call('GET', `${P}/link-crawls`)).body as {
      data: CrawlRun[];
      page: unknown;
    };
    const first = base.data[0];
    if (first === undefined) throw new Error('The mock has no crawl');
    const running: CrawlRun = {
      ...first,
      state: 'crawling',
      cost_usd: null,
      estimated_cost_usd: '0.15',
      is_latest: false,
    };
    server.use(http.get(CRAWLS, () => HttpResponse.json({ ...base, data: [running] })));
    renderWithProviders(screenAs('editor'));
    const table = await screen.findByRole('table', { name: 'Latest 10 crawls' });
    expect(await within(table).findByText('about $0.15')).toBeInTheDocument();
  });

  it('shows a cost under a cent with its digits, never as $0.00', async () => {
    const base = (await mockBrowser('viewer').call('GET', `${P}/link-crawls`)).body as {
      data: CrawlRun[];
      page: unknown;
    };
    const first = base.data[0];
    if (first === undefined) throw new Error('The mock has no crawl');
    server.use(http.get(CRAWLS, () => HttpResponse.json({ ...base, data: [{ ...first, cost_usd: '0.003' }] })));
    renderWithProviders(screenAs('editor'));
    const table = await screen.findByRole('table', { name: 'Latest 10 crawls' });
    expect(await within(table).findByText('$0.0030')).toBeInTheDocument();
  });

  it('never names equity', async () => {
    const { container } = renderWithProviders(screenAs('editor'));
    await screen.findByRole('table', { name: 'Latest 10 crawls' });
    expect(container.textContent?.toLowerCase()).not.toContain('equity');
  });

  it('links to the Internal links page', async () => {
    renderWithProviders(screenAs('editor'));
    expect(await screen.findByRole('link', { name: 'Open Internal links' })).toHaveAttribute(
      'href',
      '/digibranders/eventus-security/seo/internal-links',
    );
  });

  it.each(['light', 'dark'])('has no axe violations in the %s theme', async (theme) => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const { container } = renderWithProviders(screenAs('editor'));
    await within(await screen.findByRole('table', { name: 'Latest 10 crawls' })).findByText('Ready');
    expect(await axe(container)).toHaveNoViolations();
  });
});
