import { beforeEach, describe, expect, it, vi } from 'vitest';

import IntegrationsRedirect from './page';

const navigation = vi.hoisted(() => ({ redirect: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: navigation.redirect }));

const open = (searchParams: Record<string, string | string[]>): Promise<unknown> =>
  IntegrationsRedirect({
    params: Promise.resolve({ workspace: 'digibranders', project: 'fynix' }),
    searchParams: Promise.resolve(searchParams),
  });

beforeEach(() => navigation.redirect.mockReset());

describe('Integrations', () => {
  it('opens Google, the first source', async () => {
    await open({});
    expect(navigation.redirect).toHaveBeenCalledWith('/digibranders/fynix/integrations/google');
  });

  it('keeps the query it came with', async () => {
    await open({ error: 'scope_denied' });
    expect(navigation.redirect).toHaveBeenCalledWith('/digibranders/fynix/integrations/google?error=scope_denied');
  });
});
