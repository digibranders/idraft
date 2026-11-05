import { beforeEach, describe, expect, it, vi } from 'vitest';

import GscRedirect from './page';

const navigation = vi.hoisted(() => ({ redirect: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: navigation.redirect }));

const open = (searchParams: Record<string, string | string[]>): Promise<unknown> =>
  GscRedirect({
    params: Promise.resolve({ workspace: 'digibranders', project: 'fynix' }),
    searchParams: Promise.resolve(searchParams),
  });

beforeEach(() => navigation.redirect.mockReset());

describe('Integrations, the old Search Console address', () => {
  it('goes to the Google page', async () => {
    await open({});
    expect(navigation.redirect).toHaveBeenCalledWith('/digibranders/fynix/integrations/google');
  });

  it('keeps the query it came with', async () => {
    await open({ connection_id: 'abc', error: 'scope_denied' });
    expect(navigation.redirect).toHaveBeenCalledWith(
      '/digibranders/fynix/integrations/google?connection_id=abc&error=scope_denied',
    );
  });
});
