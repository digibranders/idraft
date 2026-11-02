import { beforeEach, describe, expect, it, vi } from 'vitest';

import KeywordDetailPage, { generateMetadata } from './page';
import { KeywordDetailScreen } from '@/features/rankings';
import type { components } from '@/lib/api/schema';
import { projectFactory } from '@/mocks/factories/project';
import { MOCK_PROJECTS } from '@/mocks/fixtures';

type Project = components['schemas']['Project'];

/** What `notFound()` throws in the app: here a plain error. */
const missing = vi.hoisted(() => {
  class NotFound extends Error {}
  return { NotFound };
});
const state = vi.hoisted((): { open: Project[]; sessionReads: number } => ({ open: [], sessionReads: 0 }));

vi.mock('next/navigation', () => ({
  notFound: (): never => {
    throw new missing.NotFound('not found');
  },
}));
vi.mock('next-intl/server', () => ({ getTranslations: () => Promise.resolve((key: string) => `t:${key}`) }));
vi.mock('@/lib/session/server', () => ({
  requireMembership: () => {
    state.sessionReads += 1;
    return Promise.resolve({
      membership: { workspace: { slug: 'digibranders', name: 'Digibranders', workspace_id: 'w1' } },
    });
  },
}));
vi.mock('@/lib/projects/server', () => ({ projectsOfMembership: () => Promise.resolve(state.open) }));

const [fynixSeed, cleanstartSeed] = MOCK_PROJECTS;
if (fynixSeed === undefined || cleanstartSeed === undefined) throw new Error('The fixture projects are missing');
const fynix = projectFactory(fynixSeed);
const cleanstart = projectFactory(cleanstartSeed);

const TRACKED = '0192f0a1-3c44-7e10-9b1d-1f2a3b4c5d6e';
const page = (project: string, tkId: string = TRACKED): Promise<unknown> =>
  KeywordDetailPage({
    params: Promise.resolve({ workspace: 'digibranders', project, tkId }),
    searchParams: Promise.resolve({}),
  });

beforeEach(() => {
  state.open = [fynix, cleanstart];
  state.sessionReads = 0;
});

describe('The page of one tracked keyword', () => {
  it('renders the screen with the ids of the workspace, the project and the keyword, and the project time zone', async () => {
    expect(await page('fynix')).toMatchObject({
      type: KeywordDetailScreen,
      props: {
        workspaceId: 'w1',
        projectId: fynix.project_id,
        workspaceSlug: 'digibranders',
        projectSlug: 'fynix',
        trackedKeywordId: TRACKED,
        timeZone: fynix.timezone,
      },
    });
  });

  it('is the 404 page for an address that cannot be a keyword id, before it reads the session', async () => {
    await expect(page('fynix', 'not-a-uuid')).rejects.toBeInstanceOf(missing.NotFound);
    await expect(page('fynix', '0192f0a1-3c44-7e10-9b1d')).rejects.toBeInstanceOf(missing.NotFound);
    expect(state.sessionReads).toBe(0);
  });

  it('is the 404 page for a project the member cannot open, whether it exists or not', async () => {
    await expect(page('nowhere')).rejects.toBeInstanceOf(missing.NotFound);
    state.open = [cleanstart];
    await expect(page('fynix')).rejects.toBeInstanceOf(missing.NotFound);
    expect(state.sessionReads).toBe(2);
  });

  it('is titled Keywords, like the list it belongs to', async () => {
    expect(await generateMetadata()).toEqual({ title: 't:rankings' });
  });
});
