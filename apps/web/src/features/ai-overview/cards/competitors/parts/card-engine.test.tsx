import { screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useCardEngine } from './card-engine';
import { useFrameState } from './frame-state';
import { OverviewProvider, useOverview } from '../../../overview-context';
import type { Role } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { overviewProject } from '@/test/ai-overview-harness';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

function Probe({ engine }: { engine: string }): ReactElement | null {
  const { engines } = useOverview();
  const card = useCardEngine({ engine });
  const state = useFrameState({
    subject: 'share of voice',
    read: { status: 'ready', errorId: null, stale: false, refetch: () => undefined },
    previous: null,
    previousEmpty: false,
    engine: card,
    situation: { kind: 'ready' },
  });
  // The engines of the project are read first: until then nothing is off, it is not known yet
  if (engines.status !== 'ready') return null;
  return (
    <section aria-label="probe">
      <p data-testid="availability">{card.availability}</p>
      <p data-testid="label">{card.label}</p>
      <p data-testid="code">{card.code}</p>
      {state.status === 'empty' ? (
        <div data-testid="empty">
          <p>{state.empty.title}</p>
          <p>{state.empty.reason}</p>
          {state.empty.action}
        </div>
      ) : null}
    </section>
  );
}

function renderProbe(role: Role, engine: string, searchParams = ''): void {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  renderWithProviders(
    <PermissionProvider membership={membershipFactory(role)}>
      <OverviewProvider
        workspaceId={MOCK_WORKSPACE.workspace_id}
        workspaceSlug={MOCK_WORKSPACE.slug}
        project={overviewProject('fynix')}
      >
        <Probe engine={engine} />
      </OverviewProvider>
    </PermissionProvider>,
    { searchParams },
  );
}

describe('useCardEngine', () => {
  it('asks an engine that is on and inside the filter', async () => {
    renderProbe('admin', 'gemini_web');
    await waitFor(() => {
      expect(screen.getByTestId('availability')).toHaveTextContent('asked');
    });
    expect(screen.getByTestId('code')).toHaveTextContent('gemini_web');
    expect(screen.getByTestId('label')).toHaveTextContent('Gemini');
    expect(screen.queryByTestId('empty')).not.toBeInTheDocument();
  });

  it('does not ask an engine that is off, and says why', async () => {
    renderProbe('admin', 'google_ai_mode');
    await waitFor(() => {
      expect(screen.getByTestId('availability')).toHaveTextContent('off');
    });
    expect(screen.getByTestId('empty')).toHaveTextContent('AI Mode is not asked in this scope');
    expect(screen.getByTestId('empty')).toHaveTextContent('turned off for this project');
  });

  it('does not ask an engine outside the engine filter, and says why', async () => {
    renderProbe('admin', 'gemini_web', 'engine=chatgpt_web');
    await waitFor(() => {
      expect(screen.getByTestId('availability')).toHaveTextContent('outside');
    });
    expect(screen.getByTestId('empty')).toHaveTextContent('Gemini is not asked in this scope');
    expect(screen.getByTestId('empty')).toHaveTextContent('outside the engine filter');
  });

  it('shows an editor a link to the engines of the project', async () => {
    renderProbe('admin', 'google_ai_mode');
    const link = await screen.findByRole('link', { name: 'Turn on engines' });
    expect(link).toHaveAttribute('href', `/${MOCK_WORKSPACE.slug}/fynix/settings/engines`);
  });

  it('shows a viewer the admin sentence and no link', async () => {
    renderProbe('viewer', 'google_ai_mode');
    await waitFor(() => {
      expect(screen.getByTestId('availability')).toHaveTextContent('off');
    });
    expect(screen.getByTestId('empty')).toHaveTextContent('Ask a workspace admin to turn on an engine');
    expect(screen.queryByRole('link', { name: 'Turn on engines' })).not.toBeInTheDocument();
  });
});
