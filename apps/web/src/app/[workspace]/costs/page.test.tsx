import { beforeEach, describe, expect, it, vi } from 'vitest';

import CostsPage from './page';
import { CostsScreen } from '@/features/costs';
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
const state = vi.hoisted((): { open: Project[]; withArchived: Project[] } => ({ open: [], withArchived: [] }));

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
vi.mock('@/lib/projects/server', () => ({
  projectsOfMembership: () => Promise.resolve(state.open),
  projectsWithArchivedOfMembership: () => Promise.resolve(state.withArchived),
}));

const [fynixSeed, cleanstartSeed] = MOCK_PROJECTS;
if (fynixSeed === undefined || cleanstartSeed === undefined) throw new Error('The fixture projects are missing');
const fynix = projectFactory(fynixSeed);
const cleanstart = projectFactory(cleanstartSeed);
const archived = projectFactory(cleanstartSeed, {
  project_id: '0192d1a8-9a01-7b44-8c2d-1f0e9d8c7b09',
  slug: 'old-site',
  name: 'Old site',
  status: 'archived',
});

type Query = Record<string, string | string[] | undefined>;
const page = (searchParams: Query = {}): Promise<unknown> =>
  CostsPage({ params: Promise.resolve({ workspace: 'digibranders' }), searchParams: Promise.resolve(searchParams) });

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
  state.withArchived = [fynix, cleanstart, archived];
});

describe('the old workspace route of Costs', () => {
  it('goes to Costs of the first project the member can open', async () => {
    expect(await target()).toBe('/digibranders/fynix/costs');
  });

  it('keeps the month, the tab and the filters of the link, the Project filter (an id) among them', async () => {
    expect(await target({ month: '2026-09', tab: 'project', project: fynix.project_id, workload: 'seo_rank' })).toBe(
      `/digibranders/fynix/costs?month=2026-09&tab=project&project=${fynix.project_id}&workload=seo_rank`,
    );
  });

  it('is sent to the first project the member can open, not to one they are limited out of', async () => {
    state.open = [cleanstart];
    expect(await target({ month: '2026-09' })).toBe('/digibranders/cleanstart/costs?month=2026-09');
  });

  it('stays in the workspace shell for a member who can open no project, naming the archived ones too', async () => {
    state.open = [];
    state.withArchived = [archived];
    expect(await page({ month: '2026-09' })).toMatchObject({
      type: CostsScreen,
      props: {
        workspaceId: 'w1',
        workspaceSlug: 'digibranders',
        projects: [{ id: archived.project_id, slug: archived.slug, name: 'Old site', archived: true }],
      },
    });
  });
});
