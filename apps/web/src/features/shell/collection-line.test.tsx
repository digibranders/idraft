import { screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CollectionLine } from './collection-line';
import type { Role } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { PROJECT_TIME_ZONE, RUNS_SCOPE, runFixture, serveRuns } from '@/test/ai-runs-harness';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

/** Saturday 14 November 2026, 10:00 UTC. */
const NOW = new Date('2026-11-14T10:00:00Z');
const ANSWERS = 'Last run 06:12, 141 of 150 answers';
const LINE = '[data-slot="collection-line"]';
const ICON = `${LINE} [data-slot="icon"]`;
const popup = (): Element | null => document.querySelector('[data-slot="tooltip"]');

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, now: NOW });
});
afterEach(() => {
  vi.useRealTimers();
});

function lineAs(role: Role, rail = false): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return (
    <PermissionProvider membership={membershipFactory(role)}>
      <CollectionLine scope={RUNS_SCOPE} timeZone={PROJECT_TIME_ZONE} rail={rail} />
    </PermissionProvider>
  );
}

describe('CollectionLine', () => {
  it('CollectionLine shows nothing for a member without data:read', async () => {
    const served = serveRuns(() => [runFixture()]);
    const { container } = renderWithProviders(lineAs('billing'));
    // The line asks for nothing the member cannot read, and leaves no empty box in the sidebar
    await vi.advanceTimersByTimeAsync(1_000);
    expect(served.queries).toHaveLength(0);
    expect(container.querySelector(LINE)).toBeNull();
  });

  it('CollectionLine polls once a minute and shows the status icon with the text', async () => {
    const served = serveRuns(() => [runFixture()]);
    const { container } = renderWithProviders(lineAs('viewer'));
    expect(await screen.findByText(ANSWERS)).toBeVisible();
    // The status icon of a completed run, hidden from assistive technology: the text says it
    const icon = container.querySelector(ICON);
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(icon).toHaveClass('text-positive-text');
    // The newest run of any workload: one run, and no filter in the request
    expect(served.queries).toHaveLength(1);
    expect([...(served.queries[0]?.entries() ?? [])]).toEqual([['limit', '1']]);

    await vi.advanceTimersByTimeAsync(59_000);
    expect(served.queries).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);
    await waitFor(() => expect(served.queries).toHaveLength(2));
    expect(await axe(container)).toHaveNoViolations();
  });

  it('reads Running now with the spinning icon while a run is open, and the new text once it ends', async () => {
    let run = runFixture({ status: 'running', completed_at: null });
    const served = serveRuns(() => [run]);
    const { container } = renderWithProviders(lineAs('analyst'));
    expect(await screen.findByText('Running now')).toBeVisible();
    expect(container.querySelector(ICON)).toHaveClass('motion-safe:animate-spin');

    run = runFixture();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await screen.findByText(ANSWERS)).toBeVisible();
    expect(served.queries).toHaveLength(2);
  });

  it('reads Running now with the same spinning icon for a run that is only planned', async () => {
    serveRuns(() => [runFixture({ status: 'planned', completed_at: null })]);
    const { container } = renderWithProviders(lineAs('viewer'));
    expect(await screen.findByText('Running now')).toBeVisible();
    expect(container.querySelector(ICON)).toHaveClass('motion-safe:animate-spin');
  });

  it('says No runs yet for a project that never ran, and Run status unavailable when the read failed', async () => {
    serveRuns(() => []);
    const none = renderWithProviders(lineAs('viewer'));
    expect(await screen.findByText('No runs yet')).toBeVisible();
    none.unmount();

    serveRuns(() => null);
    renderWithProviders(lineAs('viewer'));
    expect(await screen.findByText('Run status unavailable')).toBeVisible();
    expect(screen.queryByText(/Last run/)).toBeNull();
  });

  it('keeps the last good line when a later poll fails', async () => {
    let failing = false;
    serveRuns(() => (failing ? null : [runFixture()]));
    renderWithProviders(lineAs('viewer'));
    expect(await screen.findByText(ANSWERS)).toBeVisible();
    failing = true;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(screen.getByText(ANSWERS)).toBeVisible();
    expect(screen.queryByText('Run status unavailable')).toBeNull();
  });

  it('in the rail only the icon shows and a tooltip carries the text', async () => {
    serveRuns(() => [runFixture()]);
    const { user, container } = renderWithProviders(lineAs('viewer', true));
    const region = await screen.findByRole('region', { name: ANSWERS });
    // No words in the 56 px column: the icon, which is the region's whole content
    expect(screen.queryByText(ANSWERS)).toBeNull();
    expect(region.querySelector('[data-slot="icon"]')).toBeVisible();

    // Reachable by keyboard and by pointer, and the tooltip says what the line would
    await user.tab();
    expect(region).toHaveFocus();
    await waitFor(() => expect(popup()).not.toBeNull());
    expect(popup()).toHaveTextContent(ANSWERS);
    expect(await axe(container)).toHaveNoViolations();
  });
});
