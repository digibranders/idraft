import { screen, waitFor } from '@testing-library/react';
import { Suspense, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { OverviewProvider } from '../overview-context';
import { NoEngineState } from './no-engine-state';
import { NoCountryPromptsState, NoPromptsState } from './no-prompts-state';
import type { Role } from '@/lib/api/types';
import { PermissionProvider, type Permission } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { overviewProject } from '@/test/ai-overview-harness';
import { renderWithProviders } from '@/test/render';

// The scope writes the address through the router the test adapter stands in for
vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);

function inProvider(role: Role, children: ReactElement, withoutPermissions: readonly Permission[] = []): ReactElement {
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
          {children}
        </OverviewProvider>
      </Suspense>
    </PermissionProvider>
  );
}

describe('NoEngineState', () => {
  it('with projects:write the action goes to Settings > Engines', () => {
    renderWithProviders(inProvider('admin', <NoEngineState />));
    expect(screen.getByRole('heading', { level: 2, name: 'No AI engine is on' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Turn on engines' })).toHaveAttribute(
      'href',
      '/digibranders/fynix/settings/engines',
    );
  });

  it('without it the sentence asks a workspace admin, with no link', () => {
    renderWithProviders(inProvider('viewer', <NoEngineState />, ['projects:write']));
    expect(screen.getByText('Ask a workspace admin to turn on an engine')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});

describe('NoPromptsState', () => {
  it('says no prompts are asked and opens Topics and prompts', () => {
    renderWithProviders(inProvider('admin', <NoPromptsState />));
    expect(screen.getByRole('heading', { level: 2, name: 'No prompts are asked yet' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Topics and prompts' })).toHaveAttribute(
      'href',
      '/digibranders/fynix/ai/prompts',
    );
  });
});

describe('NoCountryPromptsState', () => {
  it('names the country and offers Clear location, which clears only the country', async () => {
    const urls: string[] = [];
    const { user } = renderWithProviders(inProvider('admin', <NoCountryPromptsState country="DE" />), {
      searchParams: '?country=DE&engine=gemini_web',
      onUrlUpdate: (event) => urls.push(event.queryString),
    });
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: /^No prompts ask in .+\.$/ })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: 'Clear location' }));
    await waitFor(() => {
      expect(urls.at(-1)).toBe('?engine=gemini_web');
    });
    expect(screen.getByRole('link', { name: 'Open Topics and prompts' })).toBeInTheDocument();
  });
});
