import { screen, waitFor, within } from '@testing-library/react';
import { http } from 'msw';
import { Suspense, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PromptsScreen } from './prompts-screen';
import type { Role } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { promptId, versionId } from '@/mocks/prompt-fixtures';
import { promptsOf } from '@/mocks/prompts-state';
import { mswPath } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { server } from '@/test/msw';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/ai/prompts',
}));

/** Thursday 12 November 2026, noon UTC: the 02:00 run has answered. */
const NOW = new Date('2026-11-12T12:00:00Z');
const PROMPT = mswPath('/api/v1/workspaces/{workspace_id}/projects/{project_id}/prompts/{prompt_id}');

const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The Fynix project fixture is missing');

beforeEach(() => {
  vi.setSystemTime(NOW);
  stubWideScreen();
});
afterEach(() => {
  vi.useRealTimers();
  restoreWideScreen();
  server.events.removeAllListeners();
});

function promptsAs(role: Role): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return (
    <PermissionProvider membership={membershipFactory(role)}>
      <Suspense fallback={null}>
        <PromptsScreen
          workspaceId={MOCK_WORKSPACE.workspace_id}
          workspaceSlug={MOCK_WORKSPACE.slug}
          project={{
            id: fynix?.project_id ?? '',
            slug: 'fynix',
            name: 'Fynix',
            timeZone: 'Europe/Berlin',
            defaultLanguage: 'en',
            defaultCountryIso: 'DE',
          }}
        />
      </Suspense>
    </PermissionProvider>
  );
}

describe('Archive above 100 prompts', () => {
  it('asks first with the count, sends nothing before the confirm, and archives them all after it', async () => {
    // 23 prompts of the fixtures and 100 more: 123 are chosen, over the 100 that archive at once
    const state = promptsOf(fynix?.project_id ?? '');
    const [base] = state.prompts;
    if (base === undefined) throw new Error('The fixture prompts are missing');
    for (let at = 0; at < 100; at += 1) {
      state.prompts.push({
        ...base,
        prompt_id: promptId(500 + at),
        version_id: versionId(500 + at),
        index: 500 + at,
        text: `Extra prompt number ${String(at)}?`,
        term_ids: [],
        is_branded: false,
      });
    }
    let deleted = 0;
    server.use(
      http.delete(PROMPT, () => {
        deleted += 1;
        return new Response(null, { status: 204 });
      }),
    );
    const { user } = renderWithProviders(promptsAs('editor'), { searchParams: '?tab=prompts' });
    const table = await screen.findByRole('grid', { name: 'Prompts' });
    await user.click(await within(table).findByRole('checkbox', { name: 'Select all 123 prompts loaded' }));
    const bar = screen.getByRole('group', { name: /^Bulk actions/ });
    await user.click(within(bar).getByRole('button', { name: 'Archive' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Archive 123 prompts?' });
    expect(within(dialog).getByText(/Undo brings them back/)).toBeInTheDocument();
    expect(deleted).toBe(0);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(deleted).toBe(0);
    await user.click(
      within(screen.getByRole('group', { name: /^Bulk actions/ })).getByRole('button', { name: 'Archive' }),
    );
    await user.click(await screen.findByRole('button', { name: 'Archive 123 prompts' }));
    expect((await screen.findAllByText('123 prompts archived', undefined, { timeout: 20_000 })).length).toBeGreaterThan(
      0,
    );
    expect(deleted).toBe(123);
  }, 60_000);
});
