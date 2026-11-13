import { beforeEach, describe, expect, it, vi } from 'vitest';

import AiOverviewPage, { generateMetadata } from './page';
import { AiOverviewScreen } from '@/features/ai-overview';
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
  AiOverviewPage({
    params: Promise.resolve({ workspace: 'digibranders', project }),
    searchParams: Promise.resolve({}),
  });

beforeEach(() => {
  state.open = [fynix, cleanstart];
});

describe('AI visibility of a project', () => {
  it('finds the project among those the member can open and passes its zone and defaults', async () => {
    expect(await page('cleanstart')).toMatchObject({
      type: AiOverviewScreen,
      props: {
        workspaceId: 'w1',
        workspaceSlug: 'digibranders',
        project: {
          id: cleanstart.project_id,
          slug: 'cleanstart',
          name: 'Cleanstart',
          timeZone: cleanstart.timezone,
          defaultLanguage: cleanstart.default_language_code,
          defaultCountryIso: cleanstart.default_location?.country_iso ?? null,
        },
      },
    });
  });

  it('is the 404 page for a project the member cannot open', async () => {
    await expect(page('nowhere')).rejects.toBeInstanceOf(missing.NotFound);
    state.open = [cleanstart];
    await expect(page('fynix')).rejects.toBeInstanceOf(missing.NotFound);
  });

  it('gives the title of the page', async () => {
    await expect(generateMetadata()).resolves.toEqual({ title: 'title' });
  });
});
