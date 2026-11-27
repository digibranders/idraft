import { beforeEach, describe, expect, it, vi } from 'vitest';

import CannibalizationPage, { generateMetadata } from './page';
import SwitchingPage from './switching/page';
import { CannScreen } from '@/features/cannibalization';
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

const [fynixSeed] = MOCK_PROJECTS;
if (fynixSeed === undefined) throw new Error('The fixture projects are missing');
const fynix = projectFactory(fynixSeed);

const props = (project: string) =>
  ({ params: Promise.resolve({ workspace: 'digibranders', project }), searchParams: Promise.resolve({}) }) as const;

beforeEach(() => {
  state.open = [fynix];
});

describe('Cannibalization of a project', () => {
  it('renders the Cannibalization tab for a project the member can open', async () => {
    expect(await CannibalizationPage(props('fynix'))).toMatchObject({
      type: CannScreen,
      props: {
        workspaceId: 'w1',
        workspaceSlug: 'digibranders',
        project: { id: fynix.project_id, slug: 'fynix', name: 'Fynix' },
        tab: 'cannibalization',
      },
    });
  });

  it('renders the Switching tab on its own route', async () => {
    expect(await SwitchingPage(props('fynix'))).toMatchObject({ type: CannScreen, props: { tab: 'switching' } });
  });

  it('404s for a project the member cannot open', async () => {
    await expect(CannibalizationPage(props('nowhere'))).rejects.toBeInstanceOf(missing.NotFound);
  });

  it('sets the title', async () => {
    expect(await generateMetadata()).toEqual({ title: 'cannibalization.title' });
  });
});
