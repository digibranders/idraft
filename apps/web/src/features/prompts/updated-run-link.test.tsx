import { act, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { UpdatedRunLink } from './updated-run-link';
import type { Role, Run } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { PROJECT_SLUG, RUNS_SCOPE, WORKSPACE_SLUG, runFixture, serveRuns } from '@/test/ai-runs-harness';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const RUN_ID = '0192d1a8-bbbb-7b44-8c2d-1f0e9d8c7b02';
const TEXT = 'Updated 5m ago';

function linkAs(role: Role): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return (
    <PermissionProvider membership={membershipFactory(role)}>
      <UpdatedRunLink scope={RUNS_SCOPE} workspaceSlug={WORKSPACE_SLUG} projectSlug={PROJECT_SLUG} text={TEXT} />
    </PermissionProvider>
  );
}

/**
 * Renders the text as `role` while the route answers `runs` (`null`: an error), and waits until the read has
 * been answered and shown, so a link that would appear late is not missed.
 */
async function renderAnswered(
  role: Role,
  runs: readonly Run[] | null,
): Promise<{ requests: number; unmount: () => void }> {
  const served = serveRuns(() => runs);
  const view = renderWithProviders(linkAs(role));
  expect(await screen.findByText(TEXT)).toBeVisible();
  if (role !== 'billing') await waitFor(() => expect(served.queries.length).toBeGreaterThan(0));
  await waitFor(() => expect(view.queryClient.isFetching()).toBe(0));
  await act(async () => {
    await Promise.resolve();
  });
  return { requests: served.queries.length, unmount: view.unmount };
}

describe('UpdatedRunLink', () => {
  it('UpdatedRunLink is a link to the run with inspect=run:<id> for a reader', async () => {
    const served = serveRuns(() => [runFixture({ run_id: RUN_ID })]);
    const { container } = renderWithProviders(linkAs('viewer'));
    const link = await screen.findByRole('link', { name: `${TEXT}. Open the run that collected these answers.` });
    // The text stays what it was; the link goes to the Runs page of the project with that run open
    expect(link).toHaveTextContent(TEXT);
    expect(link).toHaveAttribute('href', `/${WORKSPACE_SLUG}/${PROJECT_SLUG}/ops/runs?inspect=run%3A${RUN_ID}`);
    // It asks for the newest AI run that finished with answers, and nothing else
    expect(served.queries).toHaveLength(1);
    expect(served.queries[0]?.get('filter[workload_in]')).toBe('ai_prompt');
    expect(served.queries[0]?.get('filter[status_in]')).toBe('completed,completed_with_errors');
    expect(served.queries[0]?.get('limit')).toBe('1');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('is a link to a run that finished with errors too', async () => {
    serveRuns(() => [runFixture({ run_id: RUN_ID, status: 'completed_with_errors' })]);
    renderWithProviders(linkAs('analyst'));
    expect(await screen.findByRole('link', { name: /Updated 5m ago/ })).toHaveAttribute(
      'href',
      expect.stringContaining(`inspect=run%3A${RUN_ID}`),
    );
  });

  it('UpdatedRunLink is plain text without a finished AI run or without data:read', async () => {
    const cases: readonly { role: Role; runs: readonly Run[] | null; why: string }[] = [
      { role: 'viewer', runs: [], why: 'no run' },
      { role: 'viewer', runs: [runFixture({ run_id: RUN_ID, workload: 'keyword_metrics' })], why: 'a keyword run' },
      {
        role: 'viewer',
        runs: [runFixture({ run_id: RUN_ID, status: 'running', completed_at: null })],
        why: 'a run still open',
      },
      { role: 'viewer', runs: [runFixture({ run_id: RUN_ID, status: 'failed' })], why: 'a run that failed' },
      { role: 'viewer', runs: null, why: 'a failed read' },
      { role: 'billing', runs: [runFixture({ run_id: RUN_ID })], why: 'a member without data:read' },
    ];
    for (const { role, runs, why } of cases) {
      const shown = await renderAnswered(role, runs);
      expect(screen.queryByRole('link'), why).toBeNull();
      // A member who cannot read the data asks for nothing
      if (role === 'billing') expect(shown.requests, why).toBe(0);
      shown.unmount();
    }
  });
});
