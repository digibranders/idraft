import { beforeEach, describe, expect, it, vi } from 'vitest';

import GscPage from './page';
import { GscScreen } from '@/features/integrations';
import type { components } from '@/lib/api/schema';
import { projectFactory } from '@/mocks/factories/project';
import { MOCK_PROJECTS } from '@/mocks/fixtures';

type Project = components['schemas']['Project'];

/** What `notFound()` throws in the app: here a plain error. */
const missing = vi.hoisted(() => {
  class NotFound extends Error {}
  return { NotFound };
});
const state = vi.hoisted((): { open: Project[] } => ({ open: [] }));

vi.mock('next/navigation', () => ({
  notFound: (): never => {
    throw new missing.NotFound('not found');
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

const page = (project: string): Promise<unknown> =>
  GscPage({ params: Promise.resolve({ workspace: 'digibranders', project }), searchParams: Promise.resolve({}) });

beforeEach(() => {
  state.open = [fynix, cleanstart];
});

describe('Integrations, Google Search Console of a project', () => {
  it('opens the screen for the project in the route, with its time zone', async () => {
    expect(await page('cleanstart')).toMatchObject({
      type: GscScreen,
      props: {
        workspaceId: 'w1',
        workspaceSlug: 'digibranders',
        projectId: cleanstart.project_id,
        projectSlug: 'cleanstart',
        timeZone: 'America/New_York',
      },
    });
  });

  it('is the 404 page for a project the member cannot open', async () => {
    state.open = [fynix];
    await expect(page('cleanstart')).rejects.toBeInstanceOf(missing.NotFound);
  });
});
