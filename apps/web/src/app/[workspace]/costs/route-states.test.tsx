import { screen, within } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import CostsError from './error';
import CostsLayout from './layout';
import { ApiProblem } from '@/lib/api/problem';
import { mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { renderWithProviders } from '@/test/render';

vi.mock('@/lib/navigation/hard-navigate', () => ({ hardNavigate: vi.fn() }));
vi.mock('next/navigation', () => ({ useParams: () => ({ workspace: 'digibranders' }) }));
// The server's translator, for the layout's breadcrumb
vi.mock('next-intl/server', () => ({
  getTranslations: () => Promise.resolve((key: string) => (key === 'title' ? 'Costs' : key)),
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
  requestId: 'req_01COSTS',
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

/** The layout is the shell the page and its error render inside. */
async function inLayout(child: ReactNode): Promise<ReactElement> {
  return <>{await CostsLayout({ children: child, params: Promise.resolve({ workspace: 'digibranders' }) })}</>;
}

// The route has no `loading.tsx`: its page redirects, and a loading state would stream that redirect
describe('Costs: the shell and the error', () => {
  it('keeps the workspace shell with Costs as the page around what the route renders', async () => {
    renderWithProviders(await inLayout(<h1>Costs of the workspace</h1>));
    const crumbs = within(await screen.findByRole('banner')).getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByRole('link', { name: 'Digibranders' })).toHaveAttribute('href', '/digibranders');
    expect(within(crumbs).getByText('Costs')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('main')).toContainElement(screen.getByRole('heading', { name: 'Costs of the workspace' }));
  });

  it('shows the error inside the shell, with the error id and Try again', async () => {
    const reset = vi.fn();
    const { user } = renderWithProviders(await inLayout(<CostsError error={problem} reset={reset} />));
    expect(await screen.findByText('Error ID req_01COSTS')).toBeInTheDocument();
    expect(within(screen.getByRole('banner')).getByText('Costs')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
