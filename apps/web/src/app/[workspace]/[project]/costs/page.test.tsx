import { describe, expect, it, vi } from 'vitest';

import CostsPage from './page';
import { CostsScreen } from '@/features/costs';
import type { components } from '@/lib/api/schema';
import { projectFactory } from '@/mocks/factories/project';
import { MOCK_PROJECTS } from '@/mocks/fixtures';

type Project = components['schemas']['Project'];

const state = vi.hoisted((): { withArchived: Project[] } => ({ withArchived: [] }));

vi.mock('next-intl/server', () => ({ getTranslations: () => Promise.resolve((key: string) => key) }));
vi.mock('@/lib/session/server', () => ({
  requireMembership: () =>
    Promise.resolve({
      membership: { workspace: { slug: 'digibranders', name: 'Digibranders', workspace_id: 'w1' } },
    }),
}));
vi.mock('@/lib/projects/server', () => ({
  projectsWithArchivedOfMembership: () => Promise.resolve(state.withArchived),
}));

const [fynixSeed, cleanstartSeed] = MOCK_PROJECTS;
if (fynixSeed === undefined || cleanstartSeed === undefined) throw new Error('The fixture projects are missing');

describe('Costs inside a project', () => {
  it('shows the whole workspace: every project the member can open, the archived ones named as such, none chosen', async () => {
    state.withArchived = [projectFactory(fynixSeed), projectFactory(cleanstartSeed, { status: 'archived' })];
    const element = await CostsPage({
      params: Promise.resolve({ workspace: 'digibranders', project: 'fynix' }),
      searchParams: Promise.resolve({}),
    });
    expect(element).toMatchObject({
      type: CostsScreen,
      props: {
        workspaceId: 'w1',
        workspaceSlug: 'digibranders',
        workspaceName: 'Digibranders',
        projectSlug: 'fynix',
        projects: [
          { id: fynixSeed.project_id, slug: 'fynix', name: 'Fynix', archived: false },
          { id: cleanstartSeed.project_id, slug: 'cleanstart', name: 'Cleanstart', archived: true },
        ],
      },
    });
  });
});
