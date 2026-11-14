import { screen } from '@testing-library/react';
import { Suspense, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { OverviewProvider } from '../overview-context';
import type { Notice } from './notice-model';
import { OverviewNotices } from './overview-notices';
import type { Role } from '@/lib/api/types';
import { PermissionProvider, type Permission } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { overviewProject } from '@/test/ai-overview-harness';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);

const INVALID: Notice = {
  kind: 'invalid',
  engineCode: 'gemini_web',
  label: 'Gemini',
  invalid: 38,
  total: 750,
  days: 28,
};

function page(
  notice: Notice | null,
  settled: boolean,
  role: Role = 'admin',
  withoutPermissions: readonly Permission[] = [],
): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  const membership = membershipFactory(role);
  const without = new Set<string>(withoutPermissions);
  return (
    <PermissionProvider
      membership={{ ...membership, permissions: membership.permissions.filter((key) => !without.has(key)) }}
    >
      <Suspense fallback={null}>
        <OverviewProvider
          workspaceId={MOCK_WORKSPACE.workspace_id}
          workspaceSlug={MOCK_WORKSPACE.slug}
          project={overviewProject('fynix')}
        >
          <OverviewNotices notice={notice} settled={settled} />
        </OverviewProvider>
      </Suspense>
    </PermissionProvider>
  );
}

const banners = (container: HTMLElement): NodeListOf<HTMLElement> =>
  container.querySelectorAll<HTMLElement>('[data-slot="banner"]');

describe('OverviewNotices', () => {
  it('renders nothing for no notice and for the states that replace the body', () => {
    const none = renderWithProviders(page(null, true));
    expect(banners(none.container)).toHaveLength(0);
    none.unmount();
    const empty = renderWithProviders(page({ kind: 'noEngine' }, true));
    expect(banners(empty.container)).toHaveLength(0);
  });

  it('renders one Banner per notice with its tone: warning for invalid answers and stale, info for the rest', () => {
    const invalid = renderWithProviders(page(INVALID, true));
    expect(banners(invalid.container)).toHaveLength(1);
    expect(banners(invalid.container)[0]).toHaveClass('bg-warning-subtle');
    expect(screen.getByText('38 of 750 answers were not valid on Gemini in these 28 days')).toBeInTheDocument();
    invalid.unmount();

    const stale = renderWithProviders(page({ kind: 'stale', days: 6 }, true));
    expect(banners(stale.container)[0]).toHaveClass('bg-warning-subtle');
    expect(screen.getByText('The newest valid answer is 6 days old')).toBeInTheDocument();
    stale.unmount();

    const paused = renderWithProviders(page({ kind: 'paused' }, true));
    expect(banners(paused.container)[0]).toHaveClass('bg-info-subtle');
    expect(screen.getByText('Scheduled AI runs are paused for this project')).toBeInTheDocument();
    paused.unmount();

    const first = renderWithProviders(page({ kind: 'firstAnswers', nextRunAt: '2026-11-13T02:00:00Z' }, true));
    expect(banners(first.container)[0]).toHaveClass('bg-info-subtle');
    // In the project's zone (Berlin)
    expect(screen.getByText('First answers arrive after Nov 13, 03:00')).toBeInTheDocument();
    first.unmount();

    const generic = renderWithProviders(page({ kind: 'firstAnswers', nextRunAt: null }, true));
    expect(
      screen.getByText('No AI answers have been collected yet. The first ones arrive after the next scheduled run.'),
    ).toBeInTheDocument();
    expect(banners(generic.container)).toHaveLength(1);
  });

  it('a banner present when the page has loaded has no role, and one that appears later is announced', () => {
    const { container, rerender } = renderWithProviders(page(null, false));
    rerender(page(INVALID, true));
    // The banner of a page that has just loaded is read with the page
    expect(banners(container)[0]).not.toHaveAttribute('role');
    rerender(page({ kind: 'stale', days: 6 }, true));
    expect(banners(container)[0]).toHaveAttribute('role', 'status');
  });

  it('a banner that appears after a loaded page without one is live', () => {
    const { container, rerender } = renderWithProviders(page(null, true));
    rerender(page(INVALID, true));
    expect(banners(container)[0]).toHaveAttribute('role', 'status');
  });

  it('says nothing before the reads have settled', () => {
    const { container, rerender } = renderWithProviders(page(null, false));
    rerender(page(INVALID, false));
    expect(banners(container)[0]).not.toHaveAttribute('role');
  });

  it('offers View runs on invalid answers to a member who may see runs, and not to one who may not', () => {
    const allowed = renderWithProviders(page(INVALID, true));
    expect(screen.getByRole('link', { name: 'View runs' })).toHaveAttribute('href', '/digibranders/fynix/ops/runs');
    allowed.unmount();
    renderWithProviders(page(INVALID, true, 'viewer', ['data:read', 'runs:trigger']));
    expect(screen.queryByRole('link', { name: 'View runs' })).not.toBeInTheDocument();
  });

  it('has no action on the stale and paused notices', () => {
    const { container } = renderWithProviders(page({ kind: 'stale', days: 6 }, true));
    expect(container.querySelector('a, button')).toBeNull();
  });

  it("shows the dropped range notice with the Prompts page's words, before any other notice", () => {
    const { container } = renderWithProviders(page(INVALID, true), { searchParams: '?from=1999-12-01&to=2000-01-31' });
    expect(banners(container)).toHaveLength(1);
    expect(banners(container)[0]).toHaveClass('bg-info-subtle');
    expect(
      screen.getByText('The link asked for dates before Jan 1, 2000, so the last 28 days are shown.'),
    ).toBeInTheDocument();
  });
});
