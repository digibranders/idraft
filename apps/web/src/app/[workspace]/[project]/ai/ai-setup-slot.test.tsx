import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AiSetupSlot } from './ai-setup-slot';
import { dismissalKey } from './setup-dismissal';
import type { ProjectEngine } from '@/lib/api/types';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { ENGINE_FACTS } from '@/mocks/prompt-fixtures';
import { mswPath } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

/*
 * The setup checklist as the AI route mounts it: the Overview's own slot, dismissed for good per workspace and
 * project in this browser. The checklist offers Dismiss once every step is done, so these tests make a project
 * whose three steps are.
 */

const [fynix, cleanstart] = MOCK_PROJECTS;
if (fynix === undefined || cleanstart === undefined) throw new Error('The fixture projects are missing');

const scopeOf = (project: { project_id: string; slug: string }): ComponentProps<typeof AiSetupSlot> => ({
  workspaceId: MOCK_WORKSPACE.workspace_id,
  workspaceSlug: MOCK_WORKSPACE.slug,
  projectId: project.project_id,
  projectSlug: project.slug,
});
const FYNIX = scopeOf(fynix);
const CLEANSTART = scopeOf(cleanstart);

const engine = (code: keyof typeof ENGINE_FACTS): ProjectEngine => ({
  engine: ENGINE_FACTS[code],
  is_configured: true,
  is_enabled: true,
  location_ids: [2840],
  replicates: 1,
  provider_code: 'dataforseo',
  active_prompts: 5,
  estimated_monthly_cost_usd: '0.250000',
});

/** Every step done for every project: three engines on with prompts, and one answer. */
function projectIsSetUp(): void {
  server.use(
    http.get(mswPath('/api/v1/workspaces/:w/projects/:p/engines'), () =>
      HttpResponse.json({ data: (['chatgpt_web', 'gemini_web', 'google_ai_mode'] as const).map(engine) }),
    ),
    http.get(mswPath('/api/v1/workspaces/:w/projects/:p/ai/observations'), () =>
      HttpResponse.json({
        data: [{ observation_id: 'answer-1' }],
        page: { has_more: false, next_cursor: null, limit: 1 },
      }),
    ),
  );
}

const checklist = (): HTMLElement | null => document.querySelector('section[aria-label="Project setup"]');

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('AiSetupSlot', () => {
  it('shows the checklist of the project, with no storage written until it is dismissed', async () => {
    document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('admin').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
    projectIsSetUp();
    renderWithProviders(<AiSetupSlot {...FYNIX} />);
    expect(await screen.findByText('Setup complete')).toBeInTheDocument();
    expect(window.localStorage.getItem(dismissalKey(FYNIX.workspaceId, FYNIX.projectId))).toBeNull();
  });

  it('dismissal survives a remount, writes nothing to the API and leaves the other project alone', async () => {
    document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('admin').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
    projectIsSetUp();
    const writes: string[] = [];
    const listener = ({ request }: { request: Request }): void => {
      if (request.method !== 'GET') writes.push(`${request.method} ${new URL(request.url).pathname}`);
    };
    server.events.on('request:start', listener);
    const first = renderWithProviders(<AiSetupSlot {...FYNIX} />);
    const { user } = first;
    await user.click(await screen.findByRole('button', { name: 'Dismiss' }));
    await waitFor(() => {
      expect(checklist()).toBeNull();
    });
    first.unmount();

    const again = renderWithProviders(<AiSetupSlot {...FYNIX} />);
    // The reads are cached nowhere in a new tree: give a checklist that would show every chance to
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(checklist()).toBeNull();
    again.unmount();

    renderWithProviders(<AiSetupSlot {...CLEANSTART} />);
    expect(await screen.findByText('Setup complete')).toBeInTheDocument();
    server.events.removeListener('request:start', listener);
    expect(writes).toEqual([]);
  });

  it('shows the checklist and dismisses for the visit when the browser refuses storage', async () => {
    document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('admin').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
    projectIsSetUp();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    const { user } = renderWithProviders(<AiSetupSlot {...FYNIX} />);
    await user.click(await screen.findByRole('button', { name: 'Dismiss' }));
    await waitFor(() => {
      expect(checklist()).toBeNull();
    });
  });
});
