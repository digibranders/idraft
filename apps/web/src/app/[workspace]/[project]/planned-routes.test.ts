import { describe, expect, it, vi } from 'vitest';

/** What `notFound()` throws in the app: here a plain error. */
const missing = vi.hoisted(() => {
  class NotFound extends Error {}
  return { NotFound };
});

vi.mock('next/navigation', () => ({
  notFound: (): never => {
    throw new missing.NotFound('not found');
  },
}));
vi.mock('next-intl/server', () => ({ getTranslations: () => Promise.resolve((key: string) => key) }));

interface PlannedPage {
  default: () => never;
  generateMetadata: () => Promise<unknown>;
}

/** The planned pages, each owned by the package that replaces the file when its navigation entry goes live. */
const PLANNED: ReadonlyArray<readonly [string, () => Promise<PlannedPage>]> = [
  ['/ai/sources', () => import('./ai/sources/page')],
  ['/ai/prompts/[promptId]', () => import('./ai/prompts/[promptId]/page')],
  ['/competitors', () => import('./competitors/page')],
  ['/discover/[tab]', () => import('./discover/[tab]/page')],
  ['/reports', () => import('./reports/page')],
  ['/settings/alert-rules', () => import('./settings/alert-rules/page')],
  ['/matrix', () => import('./matrix/page')],
];

describe('the route files of the planned pages', () => {
  it.each(PLANNED)('%s is the 404 page with the not found title', async (_route, load) => {
    const page = await load();
    expect(() => page.default()).toThrow(missing.NotFound);
    await expect(page.generateMetadata()).resolves.toEqual({ title: 'title' });
  });
});
