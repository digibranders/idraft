import { screen, within } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import RunsError from './error';
import RunsLayout from './layout';
import RunsLoading from './loading';
import { ApiProblem } from '@/lib/api/problem';
import { mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { renderWithProviders } from '@/test/render';

vi.mock('@/lib/navigation/hard-navigate', () => ({ hardNavigate: vi.fn() }));
vi.mock('next/navigation', () => ({ useParams: () => ({ workspace: 'digibranders' }) }));
// The server's translator, for the layout's breadcrumb
vi.mock('next-intl/server', () => ({
  getTranslations: () => Promise.resolve((key: string) => (key === 'title' ? 'Runs' : key)),
}));
vi.mock('@/lib/session/server', () => ({
  requireMembership: vi.fn(() =>
    Promise.resolve({ membership: { workspace: { slug: 'digibranders', name: 'Digibranders' } } }),
  ),
}));

const problem = new ApiProblem({
  status: 503,
  code: 'service_unavailable',
  title: 'Unavailable',
  detail: null,
  requestId: 'req_01RUNS',
  errors: [],
  retryAfterSeconds: null,
  body: {},
});

beforeEach(() => {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('admin').user_id}.0; Path=/; Secure`;
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => vi.unstubAllGlobals());

/** The layout is the shell the page, its loading state and its error all render inside. */
async function inLayout(child: ReactNode): Promise<ReactElement> {
  return <>{await RunsLayout({ children: child, params: Promise.resolve({ workspace: 'digibranders' }) })}</>;
}

describe('Runs: the shell, the loading state and the error', () => {
  it('keeps the workspace shell with Runs as the page while the page loads', async () => {
    renderWithProviders(await inLayout(<RunsLoading />));
    const crumbs = within(await screen.findByRole('banner')).getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByRole('link', { name: 'Digibranders' })).toHaveAttribute('href', '/digibranders');
    expect(within(crumbs).getByText('Runs')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('main')).toBeInTheDocument();
  });

  it('shows the error inside the shell, with the error id and Try again', async () => {
    const reset = vi.fn();
    const { user } = renderWithProviders(await inLayout(<RunsError error={problem} reset={reset} />));
    expect(await screen.findByText('Error ID req_01RUNS')).toBeInTheDocument();
    expect(within(screen.getByRole('banner')).getByText('Runs')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
