import { Upload } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { ADD_MENU_ENTRIES, addMenuItems, type AddMenuContext, type AddMenuEntry } from './add-menu-entries';
import type { Translate } from '../seams/shared';

const context = {
  scope: { workspaceId: 'w', projectId: 'p' },
  t: ((key: string) => key) as Translate,
} as AddMenuContext;

const entry = (id: string, over: Partial<AddMenuEntry> = {}): AddMenuEntry => ({
  id,
  permission: null,
  item: () => ({ id, label: id, icon: Upload }),
  ...over,
});

describe('the add menu registry', () => {
  it('ships empty, so the header has no chevron until a package adds an alternative', () => {
    expect(ADD_MENU_ENTRIES).toEqual([]);
    expect(addMenuItems(ADD_MENU_ENTRIES, context, ['prompts:write'])).toEqual([]);
  });

  it('lists the entries the role may use, in order, and drops one that has nothing to offer', () => {
    const entries = [
      entry('import-csv', { permission: 'imports:write' }),
      entry('generate', { permission: 'prompts:write' }),
      entry('nothing', { item: () => null }),
      entry('review'),
    ];
    expect(addMenuItems(entries, context, ['prompts:write']).map((item) => item.id)).toEqual(['generate', 'review']);
    expect(addMenuItems(entries, context, ['prompts:write', 'imports:write']).map((item) => item.id)).toEqual([
      'import-csv',
      'generate',
      'review',
    ]);
  });

  it('throws on a repeated id and on one that repeats the default action', () => {
    expect(() => addMenuItems([entry('a'), entry('a')], context, [])).toThrow(/used twice/);
    expect(() => addMenuItems([entry('add-prompts')], context, [])).toThrow(/default action/);
  });
});
