import { screen, waitFor } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  OverviewProvider,
  useOverview,
  useOverviewFanout,
  useOverviewPeriods,
  useOverviewSchedule,
  useOverviewSources,
  useOverviewSummary,
} from './overview-context';
import type { Role } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { overviewProject } from '@/test/ai-overview-harness';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';
// A card imports these from the feature's entry, so the entry must export them (plan section 5, items 4 and 5)
import type {
  OverviewEngines,
  OverviewFanoutMeta,
  OverviewPeriods,
  OverviewSchedule,
  OverviewSourcesMeta,
  Read,
  ReadOptions,
  ReadStatus,
  SourcesOptions,
  SourcesReadOptions,
  SummaryOptions,
  SummaryReadOptions,
  ExportBlock,
  GetExportBlock,
  OverviewFreshness,
} from '.';
import * as entry from '.';

/** Type level only: it fails the typecheck when the entry stops exporting a type a card needs. */
export type EntryTypes = [
  ExportBlock,
  GetExportBlock,
  OverviewFreshness,
  OverviewEngines,
  OverviewFanoutMeta,
  OverviewPeriods,
  OverviewSchedule,
  OverviewSourcesMeta,
  Read<string>,
  ReadOptions,
  ReadStatus,
  SourcesOptions,
  SourcesReadOptions,
  SummaryOptions,
  SummaryReadOptions,
];

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

describe('the entry', () => {
  it('exports what a card imports: the export registry and the freshness read', () => {
    expect(entry.useExportBlock).toBeTypeOf('function');
    expect(entry.ExportProvider).toBeTypeOf('function');
    expect(entry.useOverviewFreshness).toBeTypeOf('function');
  });
});

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

/** The reads a card makes with the `subscribed` prop of its props: all five, with one switch. */
function CardProbe(): ReactElement {
  const [subscribed, setSubscribed] = useState(false);
  const { engines } = useOverview();
  const summary = useOverviewSummary({ subscribed });
  const periods = useOverviewPeriods({ subscribed });
  const sources = useOverviewSources({ subscribed });
  const fanout = useOverviewFanout({ subscribed });
  const schedule = useOverviewSchedule({ subscribed });
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setSubscribed(true);
        }}
      >
        subscribe
      </button>
      <output data-testid="engines-state">{engines.status}</output>
      <output data-testid="statuses">
        {[summary, periods.current, sources, fanout, schedule].map((read) => read.status).join(' ')}
      </output>
    </>
  );
}

describe('the subscribed option of the bound reads', () => {
  it('pauses all five reads of a card and reads each once when it subscribes', async () => {
    document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('admin').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
    const seen: URL[] = [];
    const listener = ({ request }: { request: Request }): void => {
      seen.push(new URL(request.url));
    };
    server.events.on('request:start', listener);
    try {
      const { user } = renderWithProviders(
        <PermissionProvider membership={membershipFactory('admin')}>
          <OverviewProvider
            workspaceId={MOCK_WORKSPACE.workspace_id}
            workspaceSlug={MOCK_WORKSPACE.slug}
            project={overviewProject('fynix')}
          >
            <CardProbe />
          </OverviewProvider>
        </PermissionProvider>,
        { searchParams: 'from=2026-10-16&to=2026-11-12&cmp=off' },
      );
      // With the engines known the reads could run: that they do not is the pause
      await waitFor(() => {
        expect(screen.getByTestId('engines-state')).toHaveTextContent('ready');
      });
      await waitFor(() => {
        expect(screen.getByTestId('statuses')).toHaveTextContent('idle idle idle idle idle');
      });
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 30);
      });
      const asked = (suffix: string): number => seen.filter((url) => url.pathname.endsWith(suffix)).length;
      for (const suffix of ['/ai/prompts-summary', '/ai/sources/domains', '/ai/fanout-queries', '/schedules']) {
        expect(asked(suffix)).toBe(0);
      }
      await user.click(screen.getByRole('button', { name: 'subscribe' }));
      await waitFor(() => {
        expect(screen.getByTestId('statuses')).toHaveTextContent('ready ready ready ready ready');
      });
      expect(asked('/ai/prompts-summary')).toBe(1);
      expect(asked('/ai/sources/domains')).toBe(1);
      expect(asked('/ai/fanout-queries')).toBe(1);
      expect(asked('/schedules')).toBe(1);
    } finally {
      server.events.removeListener('request:start', listener);
    }
  });
});
