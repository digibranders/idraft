import { beforeEach, describe, expect, it, vi } from 'vitest';

import CitationsGapsPage, { generateMetadata } from './page';
import { CitationsScreen } from '@/features/citations';
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
vi.mock('next-intl/server', () => ({
  getTranslations: (namespace: string) => Promise.resolve((key: string) => `${namespace}.${key}`),
}));
vi.mock('@/lib/session/server', () => ({
  requireMembership: () =>
    Promise.resolve({
      membership: { workspace: { slug: 'digibranders', name: 'Digibranders', workspace_id: 'w1' } },
    }),
}));
vi.mock('@/lib/projects/server', () => ({ projectsOfMembership: () => Promise.resolve(state.open) }));
vi.mock('@/features/prompts', () => ({ PromptDrawerHost: () => null }));

const [fynixSeed, cleanstartSeed] = MOCK_PROJECTS;
if (fynixSeed === undefined || cleanstartSeed === undefined) throw new Error('The fixture projects are missing');
const fynix = projectFactory(fynixSeed);
const cleanstart = projectFactory(cleanstartSeed);

const page = (project: string): Promise<unknown> =>
  CitationsGapsPage({
    params: Promise.resolve({ workspace: 'digibranders', project }),
    searchParams: Promise.resolve({}),
  });

beforeEach(() => {
  state.open = [fynix, cleanstart];
});

describe('Citations gap analysis of a project', () => {
  it('renders the Gap analysis tab for a project the member can open', async () => {
    expect(await page('fynix')).toMatchObject({
      type: CitationsScreen,
      props: {
        workspaceId: 'w1',
        workspaceSlug: 'digibranders',
        project: { id: fynix.project_id, slug: 'fynix', ownDomain: fynix.primary_domain?.registrable_domain },
        tab: 'gaps',
      },
    });
  });

  it('404s for an unknown project, and for one the member cannot open', async () => {
    await expect(page('nowhere')).rejects.toBeInstanceOf(missing.NotFound);
    state.open = [cleanstart];
    await expect(page('fynix')).rejects.toBeInstanceOf(missing.NotFound);
  });

  it('sets the title', async () => {
    expect(await generateMetadata()).toEqual({ title: 'citations.title' });
  });
});
