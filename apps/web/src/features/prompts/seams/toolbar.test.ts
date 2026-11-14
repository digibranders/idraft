import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';

import {
  BUILT_IN_TOOLBAR_IDS,
  promptsToolbarItems,
  type PromptsToolbarContext,
  type PromptsToolbarEntry,
} from './toolbar';
import { permissionsFor } from '@/mocks/factories/permissions';
import messages from '../../../../messages/en.json';

const translate = createTranslator({ locale: 'en', messages });

const context: PromptsToolbarContext = {
  scope: { workspaceId: 'w', projectId: 'p' },
  project: {
    id: 'p',
    slug: 'fynix',
    name: 'Fynix',
    timeZone: 'Europe/Berlin',
    defaultLanguage: 'en',
    defaultCountryIso: 'DE',
  },
  t: translate,
};

const more = (
  id: string,
  extra: Partial<Extract<PromptsToolbarEntry, { slot: 'more' }>> = {},
): PromptsToolbarEntry => ({
  id,
  slot: 'more',
  permission: null,
  item: () => ({ id, label: id }),
  ...extra,
});
const action = (id: string, permission: PromptsToolbarEntry['permission'] = null): PromptsToolbarEntry => ({
  id,
  slot: 'actions',
  permission,
  render: () => id,
});
const EDITOR = permissionsFor('editor');
const VIEWER = permissionsFor('viewer');

describe('promptsToolbarItems', () => {
  it('is empty while no entry is added', () => {
    expect(promptsToolbarItems([], context, EDITOR)).toEqual({ more: [], actions: [] });
  });

  it('splits the entries by slot, each in order', () => {
    const entries = [more('m1'), action('a1'), more('m2'), action('a2')];
    const items = promptsToolbarItems(entries, context, EDITOR);
    expect(items.more.map((item) => item.id)).toEqual(['m1', 'm2']);
    expect(items.actions).toEqual([
      { id: 'a1', node: 'a1' },
      { id: 'a2', node: 'a2' },
    ]);
  });

  it('hides an entry whose permission the role lacks', () => {
    const entries = [more('m', { permission: 'prompts:write' }), action('a', 'prompts:write'), action('open')];
    expect(promptsToolbarItems(entries, context, VIEWER).actions.map((item) => item.id)).toEqual(['open']);
    expect(promptsToolbarItems(entries, context, VIEWER).more).toEqual([]);
    expect(promptsToolbarItems(entries, context, EDITOR).actions.map((item) => item.id)).toEqual(['a', 'open']);
    expect(promptsToolbarItems(entries, context, EDITOR).more.map((item) => item.id)).toEqual(['m']);
  });

  it('drops a More item that is null', () => {
    expect(promptsToolbarItems([more('none', { item: () => null })], context, EDITOR).more).toEqual([]);
  });

  it('throws for the id of a built-in item', () => {
    for (const id of BUILT_IN_TOOLBAR_IDS) {
      expect(() => promptsToolbarItems([more(id)], context, EDITOR)).toThrow(`"${id}"`);
    }
  });

  it('keeps the two export ids for the header, so a later package cannot take them', () => {
    expect(BUILT_IN_TOOLBAR_IDS).toEqual(expect.arrayContaining(['export-csv', 'export-xlsx']));
    expect(() => promptsToolbarItems([more('export-csv')], context, EDITOR)).toThrow('"export-csv"');
    expect(() => promptsToolbarItems([action('export-xlsx')], context, EDITOR)).toThrow('"export-xlsx"');
  });

  it('throws for an id that repeats, across the slots too', () => {
    expect(() => promptsToolbarItems([more('twice'), action('twice')], context, EDITOR)).toThrow(/"twice"/);
  });
});
