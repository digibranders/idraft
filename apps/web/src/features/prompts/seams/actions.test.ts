import { Archive } from 'lucide-react';
import { createTranslator } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

import {
  asMenuItems,
  BUILT_IN_ACTION_IDS,
  withActionEntries,
  type PromptActionContext,
  type PromptActionEntry,
  type PromptActionSurface,
} from './actions';
import type { PromptAction } from '../prompt-action';
import { permissionsFor } from '@/mocks/factories/permissions';
import messages from '../../../../messages/en.json';

const translate = createTranslator({ locale: 'en', messages });

const context = (surface: PromptActionSurface = 'promptRow'): PromptActionContext => ({
  surface,
  scope: { workspaceId: 'w', projectId: 'p' },
  promptIds: ['prompt-1'],
  prompts: [],
  topicKey: null,
  busyReason: null,
  t: translate,
});

const built = (id: string, extra: Partial<PromptAction> = {}): PromptAction => ({
  id,
  label: id,
  group: 'object',
  run: () => undefined,
  ...extra,
});
const entry = (id: string, extra: Partial<PromptActionEntry> = {}): PromptActionEntry => ({
  id,
  surfaces: ['promptRow', 'topicRow', 'bulk', 'inspectorMore'],
  permission: null,
  build: () => built(id),
  ...extra,
});
const ids = (actions: readonly PromptAction[]): string[] => actions.map((action) => action.id);
const EDITOR = permissionsFor('editor');
const VIEWER = permissionsFor('viewer');

describe('withActionEntries', () => {
  it('is the built-in actions while no entry is added', () => {
    const builtIns = [built('open'), built('copy')];
    expect(withActionEntries(builtIns, [], context(), EDITOR)).toEqual(builtIns);
  });

  it('appends the entries offered on the surface after the built-in actions, and no others', () => {
    const entries = [
      entry('row-only', { surfaces: ['promptRow'] }),
      entry('bulk-only', { surfaces: ['bulk'] }),
      entry('both', { surfaces: ['promptRow', 'bulk'] }),
    ];
    expect(ids(withActionEntries([built('open')], entries, context('promptRow'), EDITOR))).toEqual([
      'open',
      'row-only',
      'both',
    ]);
    expect(ids(withActionEntries([built('open')], entries, context('bulk'), EDITOR))).toEqual([
      'open',
      'bulk-only',
      'both',
    ]);
    expect(ids(withActionEntries([built('open')], entries, context('topicRow'), EDITOR))).toEqual(['open']);
  });

  it('hides an entry whose permission the role lacks and shows it for a role that has it', () => {
    const entries = [entry('write', { permission: 'prompts:write' }), entry('anyone')];
    expect(ids(withActionEntries([], entries, context(), VIEWER))).toEqual(['anyone']);
    expect(ids(withActionEntries([], entries, context(), EDITOR))).toEqual(['write', 'anyone']);
  });

  it('builds each entry for the context it is given', () => {
    const build = vi.fn(() => built('seen'));
    const given = context('bulk');
    withActionEntries([], [entry('seen', { build })], given, EDITOR);
    expect(build).toHaveBeenCalledExactlyOnceWith(given);
  });

  it('drops an entry that builds nothing', () => {
    expect(ids(withActionEntries([], [entry('none', { build: () => null })], context(), EDITOR))).toEqual([]);
  });

  it('throws for the id of a built-in action', () => {
    for (const id of BUILT_IN_ACTION_IDS) {
      expect(() => withActionEntries([], [entry(id)], context(), EDITOR)).toThrow(`"${id}"`);
    }
  });

  it('throws for an id that repeats', () => {
    expect(() => withActionEntries([], [entry('twice'), entry('twice')], context(), EDITOR)).toThrow(/"twice"/);
  });
});

describe('asMenuItems', () => {
  it('drops the group, which a menu would turn into a section of its own', () => {
    const [item] = asMenuItems([built('x', { group: 'copy' })]);
    expect(item).toBeDefined();
    expect(item).not.toHaveProperty('group');
  });

  it('keeps the label, the icon, the destructive tone and the handler', () => {
    const run = vi.fn();
    const [item] = asMenuItems([built('x', { label: 'Remove', icon: Archive, tone: 'destructive', run })]);
    expect(item).toMatchObject({ id: 'x', label: 'Remove', icon: Archive, tone: 'destructive' });
    item?.onSelect?.();
    expect(run).toHaveBeenCalledOnce();
  });

  it('keeps a reason and turns a null one into no reason', () => {
    const [waiting, free] = asMenuItems([built('a', { disabledReason: 'Busy' }), built('b', { disabledReason: null })]);
    expect(waiting?.disabledReason).toBe('Busy');
    expect(free).not.toHaveProperty('disabledReason');
  });
});
