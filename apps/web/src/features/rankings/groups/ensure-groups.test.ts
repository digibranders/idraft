import { describe, expect, it, vi } from 'vitest';

import { ensureGroups, type CreateGroup } from './ensure-groups';

const groups = [{ group_id: 'g-blog', parent_id: null, name: 'Blog', path: 'Blog' }];

describe('ensureGroups', () => {
  it('creates missing levels parent first, once per path, and answers an id per path', async () => {
    let next = 0;
    const create = vi.fn<CreateGroup>(async (name, parentId) => {
      next += 1;
      return { group_id: `new-${String(next)}`, parent_id: parentId, name, path: name };
    });
    const ids = await ensureGroups(['Blog/Guides/SEO', 'blog/guides', 'Blog'], groups, create);
    expect(create.mock.calls).toEqual([
      ['Guides', 'g-blog'],
      ['SEO', 'new-1'],
    ]);
    expect(ids).toEqual(['new-2', 'new-1', 'g-blog']);
  });

  it('creates nothing when every path exists', async () => {
    const create = vi.fn<CreateGroup>();
    expect(await ensureGroups(['blog'], groups, create)).toEqual(['g-blog']);
    expect(create).not.toHaveBeenCalled();
  });
});
