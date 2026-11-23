import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { NuqsTestingAdapter } from 'nuqs/adapters/testing';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useWeeklyReads } from './use-competitor-read';
import { OverviewProvider, useOverview } from '../../overview-context';
import { makeQueryClient } from '@/lib/api/query-client';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { overviewProject } from '@/test/ai-overview-harness';

const WINDOW = 'from=2026-10-16&to=2026-11-12';

function hookOf(
  search: string,
): ReturnType<typeof renderHook<{ weekly: ReturnType<typeof useWeeklyReads>; enabled: number }, unknown>> {
  const client = makeQueryClient({ retry: false });
  const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
    <QueryClientProvider client={client}>
      <NuqsTestingAdapter searchParams={search} hasMemory>
        <PermissionProvider membership={membershipFactory('admin')}>
          <OverviewProvider
            workspaceId={MOCK_WORKSPACE.workspace_id}
            workspaceSlug={MOCK_WORKSPACE.slug}
            project={overviewProject('fynix')}
          >
            {children}
          </OverviewProvider>
        </PermissionProvider>
      </NuqsTestingAdapter>
    </QueryClientProvider>
  );
  return renderHook(() => ({ weekly: useWeeklyReads(true), enabled: useOverview().enabledEngines.length }), {
    wrapper,
  });
}

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('admin').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the weekly reads of the competitor drawer', () => {
  it('hands over the window before for the previous period, whose weeks come first on the trend', async () => {
    const { result } = hookOf(WINDOW);
    await waitFor(() => {
      expect(result.current.weekly.previous).not.toBeNull();
    });
  });

  it('never hands over the same dates a year earlier: its weeks would join this year as if adjacent', async () => {
    const { result } = hookOf(`${WINDOW}&cmp=year`);
    await waitFor(() => {
      expect(result.current.weekly.current.data).toBeDefined();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(result.current.weekly.previous).toBeNull();
  });
});
