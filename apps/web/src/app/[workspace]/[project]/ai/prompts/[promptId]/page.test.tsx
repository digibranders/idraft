import { beforeEach, describe, expect, it, vi } from 'vitest';

import PromptPage from './page';
import { DayCompareScreen } from '@/features/prompts';
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

const [fynixSeed] = MOCK_PROJECTS;
if (fynixSeed === undefined) throw new Error('The fixture projects are missing');
const fynix = projectFactory(fynixSeed);
const PROMPT_ID = '0c2f6f3e-5b7a-4f0e-9a41-2d6f1f5f7a10';

const page = (project: string, promptId: string): Promise<unknown> =>
  PromptPage({
    params: Promise.resolve({ workspace: 'digibranders', project, promptId }),
    searchParams: Promise.resolve({}),
  });

beforeEach(() => {
  state.open = [fynix];
});

describe('One prompt of a project', () => {
  it('opens Compare days for the prompt in the route, with the project time zone', async () => {
    expect(await page('fynix', PROMPT_ID)).toMatchObject({
      type: DayCompareScreen,
      props: {
        workspaceId: 'w1',
        projectId: fynix.project_id,
        workspaceSlug: 'digibranders',
        projectSlug: 'fynix',
        promptId: PROMPT_ID,
        timeZone: fynix.timezone,
      },
    });
  });

  it('is the 404 page for an address that cannot be a prompt id, without asking for the project', async () => {
    await expect(page('fynix', 'not-an-id')).rejects.toBeInstanceOf(missing.NotFound);
  });

  it('is the 404 page for a project the member cannot open', async () => {
    await expect(page('nowhere', PROMPT_ID)).rejects.toBeInstanceOf(missing.NotFound);
  });
});
