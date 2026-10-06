import { beforeEach, describe, expect, it, vi } from 'vitest';

import RunsPage from './page';
import { RunsScreen } from '@/features/operations';
import type { components } from '@/lib/api/schema';
import { projectFactory } from '@/mocks/factories/project';
import { MOCK_PROJECTS } from '@/mocks/fixtures';

type Project = components['schemas']['Project'];

/** What `redirect()` throws in the app: here a plain error that carries the target. */
const redirected = vi.hoisted(() => {
  class Redirected extends Error {
    constructor(readonly target: string) {
      super(`redirect to ${target}`);
    }
  }
  return { Redirected };
});
const state = vi.hoisted((): { open: Project[] } => ({ open: [] }));

vi.mock('next/navigation', () => ({
  redirect: (target: string): never => {
    throw new redirected.Redirected(target);
  },
}));
vi.mock('next-intl/server', () => ({ getTranslations: () => Promise.resolve((key: string) => key) }));
vi.mock('@/lib/session/server', () => ({
  requireMembership: () =>
    Promise.resolve({
      membership: { workspace: { slug: 'digibranders', name: 'Digibranders', workspace_id: 'w1' } },
    }),
}));
vi.mock('@/lib/projects/server', () => ({ projectsOfMembership: () => Promise.resolve(state.open) }));

const [fynixSeed, cleanstartSeed] = MOCK_PROJECTS;
if (fynixSeed === undefined || cleanstartSeed === undefined) throw new Error('The fixture projects are missing');
const fynix = projectFactory(fynixSeed);
const cleanstart = projectFactory(cleanstartSeed);

type Query = Record<string, string | string[] | undefined>;
const page = (searchParams: Query = {}): Promise<unknown> =>
  RunsPage({ params: Promise.resolve({ workspace: 'digibranders' }), searchParams: Promise.resolve(searchParams) });

/** Where the page sends a request, or `null` when it answers with a screen. */
async function target(searchParams: Query = {}): Promise<string | null> {
  try {
    await page(searchParams);
    return null;
  } catch (error) {
    if (error instanceof redirected.Redirected) return error.target;
    throw error;
  }
}

beforeEach(() => {
  state.open = [fynix, cleanstart];
});

describe('the old workspace route of Runs', () => {
  it('goes to Runs of the first project the member can open', async () => {
    expect(await target()).toBe('/digibranders/fynix/ops/runs');
  });

  it('keeps the month and the other keys of the link, in their order', async () => {
    expect(await target({ month: '2026-09', status: 'failed,cancelled', q: 'keyword metrics', inspect: 'run:1' })).toBe(
      '/digibranders/fynix/ops/runs?month=2026-09&status=failed%2Ccancelled&q=keyword+metrics&inspect=run%3A1',
    );
  });

  it('honours the project a link names by its slug, and drops that key', async () => {
    expect(await target({ project: 'cleanstart', month: '2026-08' })).toBe(
      '/digibranders/cleanstart/ops/runs?month=2026-08',
    );
    expect(await target({ project: 'cleanstart' })).toBe('/digibranders/cleanstart/ops/runs');
  });

  it('falls back to the first project for a slug that is not one the member can open, still dropping the key', async () => {
    expect(await target({ project: 'nowhere', month: '2026-08' })).toBe('/digibranders/fynix/ops/runs?month=2026-08');
    expect(await target({ project: ['cleanstart', 'fynix'] })).toBe('/digibranders/fynix/ops/runs');
    // A member limited to Cleanstart is not sent to Fynix, which they cannot open
    state.open = [cleanstart];
    expect(await target({ project: 'fynix' })).toBe('/digibranders/cleanstart/ops/runs');
  });

  it('stays in the workspace shell for a member who can open no project, and shows Runs with none', async () => {
    state.open = [];
    expect(await page({ project: 'fynix' })).toMatchObject({
      type: RunsScreen,
      props: { workspaceId: 'w1', workspaceSlug: 'digibranders', project: null },
    });
  });
});
