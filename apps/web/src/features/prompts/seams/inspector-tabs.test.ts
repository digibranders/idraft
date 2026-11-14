import { describe, expect, it } from 'vitest';

import { promptTabs, type PromptInspectorTab, type PromptTabContext } from './inspector-tabs';
import { chosenTab } from './shared';

const context: PromptTabContext = {
  scope: { workspaceId: 'w', projectId: 'p' },
  promptId: 'prompt-1',
  prompt: null,
  exists: true,
  range: { from: '2026-10-16', to: '2026-11-12' },
  timeZone: 'Europe/Berlin',
  engines: [],
  labelOf: (code) => code,
  counts: {
    status: 'ready',
    row: undefined,
    entities: [],
    brandedIncluded: false,
    errorId: null,
    retry: () => undefined,
    retrying: false,
  },
  answers: { status: 'ready', rows: [], hasMore: false, errorId: null, retry: () => undefined, retrying: false },
  noCountsReason: '',
  onOpenAnswer: undefined,
};

const tab = (id: string, extra: Partial<PromptInspectorTab> = {}): PromptInspectorTab => ({
  id,
  label: () => id,
  render: () => id,
  ...extra,
});
const BUILT_INS = ['latest', 'history', 'competitors', 'stats'].map((id) => tab(id));
const idsOf = (tabs: readonly PromptInspectorTab[]): string[] => tabs.map((entry) => entry.id);

describe('promptTabs', () => {
  it('is the built-in tabs while no entry is added', () => {
    expect(idsOf(promptTabs(BUILT_INS, [], context))).toEqual(['latest', 'history', 'competitors', 'stats']);
  });

  it('places an entry after the tab it names, and one without an anchor last', () => {
    expect(idsOf(promptTabs(BUILT_INS, [tab('fake', { after: 'history' })], context))).toEqual([
      'latest',
      'history',
      'fake',
      'competitors',
      'stats',
    ]);
    expect(idsOf(promptTabs(BUILT_INS, [tab('fake')], context))).toEqual([
      'latest',
      'history',
      'competitors',
      'stats',
      'fake',
    ]);
  });

  it('leaves out an entry that is not available, and still places one that follows it', () => {
    const entries = [
      tab('hidden', { after: 'history', available: () => false }),
      tab('after-hidden', { after: 'hidden' }),
    ];
    expect(idsOf(promptTabs(BUILT_INS, entries, context))).toEqual([
      'latest',
      'history',
      'after-hidden',
      'competitors',
      'stats',
    ]);
  });

  it('hands the context to available', () => {
    const seen: string[] = [];
    promptTabs(
      BUILT_INS,
      [
        tab('fake', {
          available: (given) => {
            seen.push(given.promptId);
            return true;
          },
        }),
      ],
      context,
    );
    expect(seen).toEqual(['prompt-1']);
  });

  it('throws for an entry that repeats a built-in id', () => {
    expect(() => promptTabs(BUILT_INS, [tab('history')], context)).toThrow(/"history"/);
  });
});

describe('the tab chosen by the address', () => {
  const tabs = promptTabs(BUILT_INS, [], context);

  it('keeps a tab of the prompt', () => {
    expect(chosenTab(tabs, 'history')).toBe('history');
    expect(chosenTab(tabs, 'competitors')).toBe('competitors');
    expect(chosenTab(tabs, 'stats')).toBe('stats');
  });

  it('is Latest when the address names no tab that is shown', () => {
    // The first tab of every inspector is `overview` in the address: it is Latest here
    expect(chosenTab(tabs, 'overview')).toBe('latest');
    // The topic drawer's tab, left in the address by a prompt opened from it
    expect(chosenTab(tabs, 'prompts')).toBe('latest');
    expect(chosenTab(tabs, '')).toBe('latest');
  });
});
