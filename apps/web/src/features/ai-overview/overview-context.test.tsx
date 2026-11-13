import { screen, waitFor } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OverviewProvider, useOverview, useOverviewSummary } from './overview-context';
import type { Role } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { overviewProject } from '@/test/ai-overview-harness';
import { renderWithProviders } from '@/test/render';

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

function Probe(): ReactElement {
  const overview = useOverview();
  const summary = useOverviewSummary();
  return (
    <dl>
      <dt>project</dt>
      <dd data-testid="project">{overview.project.slug}</dd>
      <dt>workspace</dt>
      <dd data-testid="workspace">{overview.workspaceSlug}</dd>
      <dt>window</dt>
      <dd data-testid="window">{`${overview.scope.range.from} ${overview.scope.range.to}`}</dd>
      <dt>compare</dt>
      <dd data-testid="compare">{String(overview.scope.compare)}</dd>
      <dt>engines status</dt>
      <dd data-testid="engines-status">{overview.engines.status}</dd>
      <dt>engines</dt>
      <dd data-testid="engines">{overview.enabledEngines.join(',')}</dd>
      <dt>can manage</dt>
      <dd data-testid="manage">{String(overview.canManageEngines)}</dd>
      <dt>can view runs</dt>
      <dd data-testid="runs">{String(overview.canViewRuns)}</dd>
      <dt>summary</dt>
      <dd data-testid="summary">{`${summary.status} ${String(summary.data?.prompts.length ?? 0)}`}</dd>
    </dl>
  );
}

function renderProbe(role: Role, world: 'fynix' | 'cleanstart', searchParams = ''): void {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  renderWithProviders(
    <PermissionProvider membership={membershipFactory(role)}>
      <OverviewProvider
        workspaceId={MOCK_WORKSPACE.workspace_id}
        workspaceSlug={MOCK_WORKSPACE.slug}
        project={overviewProject(world)}
      >
        <Probe />
      </OverviewProvider>
    </PermissionProvider>,
    { searchParams },
  );
}

describe('useOverview', () => {
  it('throws a named error outside the provider', () => {
    expect(() => renderHook(() => useOverview())).toThrow('useOverview is used outside an OverviewProvider');
  });

  it('gives the project, the scope, the engines that are on and what the member may do', async () => {
    renderProbe('admin', 'fynix', 'from=2026-10-16&to=2026-11-12&cmp=off');
    expect(screen.getByTestId('project')).toHaveTextContent('fynix');
    expect(screen.getByTestId('workspace')).toHaveTextContent(MOCK_WORKSPACE.slug);
    expect(screen.getByTestId('window')).toHaveTextContent('2026-10-16 2026-11-12');
    expect(screen.getByTestId('compare')).toHaveTextContent('false');
    expect(screen.getByTestId('engines-status')).toHaveTextContent('loading');
    await waitFor(() => {
      expect(screen.getByTestId('engines-status')).toHaveTextContent('ready');
    });
    expect(screen.getByTestId('engines')).toHaveTextContent('chatgpt_web,gemini_web');
    expect(screen.getByTestId('manage')).toHaveTextContent('true');
    expect(screen.getByTestId('runs')).toHaveTextContent('true');
  });

  it('says a viewer cannot turn engines on, and that a project with AI off has none on', async () => {
    renderProbe('viewer', 'cleanstart');
    await waitFor(() => {
      expect(screen.getByTestId('engines-status')).toHaveTextContent('ready');
    });
    expect(screen.getByTestId('engines')).toBeEmptyDOMElement();
    expect(screen.getByTestId('manage')).toHaveTextContent('false');
  });

  it('binds the reads to the scope and the engines of the context', async () => {
    renderProbe('admin', 'fynix', 'from=2026-10-16&to=2026-11-12');
    await waitFor(() => {
      expect(screen.getByTestId('summary').textContent).toMatch(/^(ready|refetching) [1-9]/);
    });
  });
});
