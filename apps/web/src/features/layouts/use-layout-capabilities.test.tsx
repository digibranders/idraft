import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { useEffect, type ReactElement } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useLayoutCapabilities, type LayoutCapabilities } from './use-layout-capabilities';
import type { EngineCode, MeMembership, ProjectEngine } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { ENGINE_FACTS } from '@/mocks/prompt-fixtures';
import { mswPath } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The fixture projects are missing');
const SCOPE = { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: fynix.project_id };
const ENGINES_PATH = mswPath(`/api/v1/workspaces/${SCOPE.workspaceId}/projects/${SCOPE.projectId}/engines`);

const engine = (code: EngineCode, isEnabled: boolean): ProjectEngine => ({
  engine: ENGINE_FACTS[code],
  is_configured: isEnabled,
  is_enabled: isEnabled,
  location_ids: [],
  replicates: 1,
  provider_code: 'dataforseo',
  active_prompts: 1,
  estimated_monthly_cost_usd: null,
});

const serveEngines = (...engines: ProjectEngine[]): void => {
  server.use(http.get(ENGINES_PATH, () => HttpResponse.json({ data: engines })));
};

let latest: LayoutCapabilities | null = null;
const current = (): LayoutCapabilities => {
  if (latest === null) throw new Error('The probe has not rendered');
  return latest;
};

function Probe(): null {
  const result = useLayoutCapabilities(SCOPE);
  useEffect(() => {
    latest = result;
  }, [result]);
  return null;
}

function mount(membership: MeMembership = membershipFactory('admin')): ReactElement {
  return (
    <PermissionProvider membership={membership}>
      <Probe />
    </PermissionProvider>
  );
}

beforeEach(() => {
  latest = null;
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('admin').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
});

describe('useLayoutCapabilities', () => {
  it('offers the AI channel and names the engines once one engine is enabled', async () => {
    serveEngines(engine('chatgpt_web', true), engine('gemini_web', false), engine('google_ai_mode', false));
    renderWithProviders(mount());
    await waitFor(() => {
      expect(current().status).toBe('ready');
    });
    expect(current().capabilities.channels).toEqual(['seo', 'ai']);
    expect(current().enabledEngines).toEqual(['chatgpt_web']);
  });

  it('lists every enabled engine', async () => {
    serveEngines(engine('chatgpt_web', true), engine('gemini_web', true), engine('google_ai_mode', false));
    renderWithProviders(mount());
    await waitFor(() => {
      expect(current().status).toBe('ready');
    });
    expect(current().enabledEngines).toEqual(['chatgpt_web', 'gemini_web']);
  });

  it('offers SEO only when no engine is enabled', async () => {
    serveEngines(engine('chatgpt_web', false), engine('gemini_web', false));
    renderWithProviders(mount());
    await waitFor(() => {
      expect(current().status).toBe('ready');
    });
    expect(current().capabilities.channels).toEqual(['seo']);
    expect(current().enabledEngines).toEqual([]);
  });

  it('offers SEO only while the engines load, so an AI card is never shown as available too early', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(ENGINES_PATH, async () => {
        await gate;
        return HttpResponse.json({ data: [engine('chatgpt_web', true)] });
      }),
    );
    renderWithProviders(mount());
    expect(current().status).toBe('loading');
    expect(current().capabilities.channels).toEqual(['seo']);
    expect(current().enabledEngines).toEqual([]);
    release();
    await waitFor(() => {
      expect(current().capabilities.channels).toEqual(['seo', 'ai']);
    });
  });

  it('offers SEO only when the engines cannot be read', async () => {
    server.use(
      http.get(ENGINES_PATH, () =>
        HttpResponse.json({ type: 'about:blank', title: 'Error', status: 500, code: 'internal' }, { status: 500 }),
      ),
    );
    renderWithProviders(mount());
    await waitFor(() => {
      expect(current().status).toBe('error');
    });
    expect(current().capabilities.channels).toEqual(['seo']);
    expect(current().enabledEngines).toEqual([]);
  });

  it('takes the permissions from the membership and offers no integration', async () => {
    serveEngines(engine('chatgpt_web', true));
    const membership = membershipFactory('admin');
    renderWithProviders(mount(membership));
    await waitFor(() => {
      expect(current().status).toBe('ready');
    });
    expect(current().capabilities.permissions).toEqual(membership.permissions);
    expect(current().capabilities.permissions).toContain('layouts:manage');
    expect(current().capabilities.integrations).toEqual([]);
  });

  it('does not give layouts:manage to a role without it', async () => {
    serveEngines(engine('chatgpt_web', true));
    renderWithProviders(mount(membershipFactory('viewer')));
    await waitFor(() => {
      expect(current().status).toBe('ready');
    });
    expect(current().capabilities.permissions).not.toContain('layouts:manage');
  });

  it('keeps the same capabilities object while nothing changed', async () => {
    serveEngines(engine('chatgpt_web', true));
    const membership = membershipFactory('admin');
    const { rerender } = renderWithProviders(mount(membership));
    await waitFor(() => {
      expect(current().status).toBe('ready');
    });
    const before = current().capabilities;
    rerender(mount(membership));
    expect(current().capabilities).toBe(before);
  });
});
