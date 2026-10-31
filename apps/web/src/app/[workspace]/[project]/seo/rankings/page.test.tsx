import { describe, expect, it, vi } from 'vitest';

import RankingsImportRedirect from './import/page';
import RankingsRedirect from './page';

const redirected = vi.hoisted(() => {
  class Redirected extends Error {
    constructor(readonly target: string) {
      super(`redirect to ${target}`);
    }
  }
  return { Redirected };
});

vi.mock('next/navigation', () => ({
  redirect: (target: string): never => {
    throw new redirected.Redirected(target);
  },
}));

type Query = Record<string, string | string[] | undefined>;

async function redirectOf(searchParams: Query = {}): Promise<string> {
  try {
    await RankingsRedirect({
      params: Promise.resolve({ workspace: 'digibranders', project: 'fynix' }),
      searchParams: Promise.resolve(searchParams),
    });
    throw new Error('Did not redirect');
  } catch (error) {
    if (error instanceof redirected.Redirected) return error.target;
    throw error;
  }
}

async function importRedirectOf(searchParams: Query = {}): Promise<string> {
  try {
    await RankingsImportRedirect({
      params: Promise.resolve({ workspace: 'digibranders', project: 'fynix' }),
      searchParams: Promise.resolve(searchParams),
    });
    throw new Error('Did not redirect');
  } catch (error) {
    if (error instanceof redirected.Redirected) return error.target;
    throw error;
  }
}

describe('the legacy /seo/rankings routes', () => {
  it('redirects /seo/rankings to /seo/keywords keeping search params', async () => {
    expect(await redirectOf()).toBe('/digibranders/fynix/seo/keywords');
    expect(await redirectOf({ intent: 'commercial', sort: 'rank_change' })).toBe(
      '/digibranders/fynix/seo/keywords?intent=commercial&sort=rank_change',
    );
  });

  it('redirects /seo/rankings/import to /seo/keywords/import keeping search params', async () => {
    expect(await importRedirectOf()).toBe('/digibranders/fynix/seo/keywords/import');
    expect(await importRedirectOf({ group: 'g1', dev: ['desktop', 'mobile'] })).toBe(
      '/digibranders/fynix/seo/keywords/import?group=g1&dev=desktop&dev=mobile',
    );
  });
});
