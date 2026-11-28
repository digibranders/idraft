import { beforeEach, describe, expect, it, vi } from 'vitest';

import InternalLinksPage, { generateMetadata } from './page';
import { InternalLinksScreen } from '@/features/internal-links';
import { PromptDrawerHost } from '@/features/prompts';
import type { components } from '@/lib/api/schema';
import { projectFactory } from '@/mocks/factories/project';
import { MOCK_PROJECTS } from '@/mocks/fixtures';

type Project = components['schemas']['Project'];

/** What `notFound()` throws in the app: here a plain error. */
const missing = vi.hoisted(() => {
  class NotFound extends Error {}
  return { NotFound };
});
/** What `redirect()` throws in the app: here an error that carries its argument. */
const moved = vi.hoisted(() => {
  class Redirect extends Error {
    constructor(readonly to: string) {
      super(`redirect to ${to}`);
    }
  }
  return { Redirect };
});
const state = vi.hoisted((): { open: Project[] } => ({ open: [] }));

vi.mock('next/navigation', () => ({
  notFound: (): never => {
    throw new missing.NotFound('not found');
  },
  redirect: (to: string): never => {
    throw new moved.Redirect(to);
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

const [fynixSeed, cleanstartSeed] = MOCK_PROJECTS;
if (fynixSeed === undefined || cleanstartSeed === undefined) throw new Error('The fixture projects are missing');
const fynix = projectFactory(fynixSeed);
const cleanstart = projectFactory(cleanstartSeed);

const page = (project: string, search: Record<string, string | string[]> = {}): Promise<unknown> =>
  InternalLinksPage({
    params: Promise.resolve({ workspace: 'digibranders', project }),
    searchParams: Promise.resolve(search),
  });

const ALL_PAGES = '/digibranders/cleanstart/seo/pages/all';
/** The address the page redirects to for `search`, or `null` when it renders the screen. */
const redirectedTo = async (search: Record<string, string | string[]>): Promise<string | null> => {
  try {
    await page('cleanstart', search);
    return null;
  } catch (error) {
    if (error instanceof moved.Redirect) return error.to;
    throw error;
  }
};

beforeEach(() => {
  state.open = [fynix, cleanstart];
});

describe('Internal links of a project', () => {
  it('renders the screen with the website of the project', async () => {
    expect(await page('cleanstart')).toMatchObject({
      type: InternalLinksScreen,
      props: {
        workspaceId: 'w1',
        workspaceSlug: 'digibranders',
        project: {
          id: cleanstart.project_id,
          slug: 'cleanstart',
          name: 'Cleanstart',
          timeZone: cleanstart.timezone,
          host: cleanstart.primary_domain?.host ?? null,
        },
        promptDrawer: {
          type: PromptDrawerHost,
          props: {
            workspaceId: 'w1',
            workspaceSlug: 'digibranders',
            projectId: cleanstart.project_id,
            projectSlug: 'cleanstart',
            timeZone: cleanstart.timezone,
          },
        },
      },
    });
  });

  it('passes no host for a project without a website', async () => {
    state.open = [{ ...fynix, primary_domain: null }];
    expect(await page('fynix')).toMatchObject({ props: { project: { host: null } } });
  });

  it('404s for an unknown project, and for one the member cannot open', async () => {
    await expect(page('nowhere')).rejects.toBeInstanceOf(missing.NotFound);
    state.open = [cleanstart];
    await expect(page('fynix')).rejects.toBeInstanceOf(missing.NotFound);
  });

  it.each<[string, Record<string, string | string[]>, string]>([
    ['tab=pages alone', { tab: 'pages' }, ALL_PAGES],
    ['tab=pages with its keys', { tab: 'pages', view: 'orphans', tier: 'none' }, `${ALL_PAGES}?view=orphans&tier=none`],
    ...['view', 'sort', 'q', 'tier', 'tag', 'status', 'idx', 'flag', 'cols', 'density'].map(
      (key): [string, Record<string, string | string[]>, string] => [
        `${key} alone, with no tab`,
        { [key]: 'x' },
        `${ALL_PAGES}?${key}=x`,
      ],
    ),
    [
      'the drawer keys with a search',
      { inspect: 'page:108', itab: 'links', q: 'x' },
      `${ALL_PAGES}?inspect=page%3A108&itab=links&q=x`,
    ],
    ['a repeated key', { tier: ['a', 'b'] }, `${ALL_PAGES}?tier=a&tier=b`],
  ])('redirects to All pages for %s, keeping every key but tab', async (_name, search, to) => {
    expect(await redirectedTo(search)).toBe(to);
  });

  it.each<[string, Record<string, string>]>([
    ['a bare address', {}],
    ['a Journey address with its own keys', { focus: '103', jv: 'tree', open: 'o:108' }],
    ['the Links tab with its filter keys', { tab: 'links', q: 'x', cols: 'a', density: 'default' }],
  ])('renders the screen for %s', async (_name, search) => {
    expect(await redirectedTo(search)).toBeNull();
  });

  it('sets the title', async () => {
    expect(await generateMetadata()).toEqual({ title: 'internalLinks.title' });
  });
});
