import { describe, expect, it } from 'vitest';

import { chosenTab } from './shared';
import { topicTabs, type TopicInspectorTab, type TopicTabContext } from './topic-tabs';

const context: TopicTabContext = {
  topicKey: 'seo',
  summary: undefined,
  counts: { status: 'ready', errorId: null, retry: () => undefined, retrying: false },
  engines: [],
  descendants: new Map(),
  onOpenPrompt: () => undefined,
};

const tab = (id: string, extra: Partial<TopicInspectorTab> = {}): TopicInspectorTab => ({
  id,
  label: () => id,
  render: () => id,
  ...extra,
});
const BUILT_INS = ['overview', 'prompts'].map((id) => tab(id));
const idsOf = (tabs: readonly TopicInspectorTab[]): string[] => tabs.map((entry) => entry.id);

describe('topicTabs', () => {
  it('is the built-in tabs while no entry is added', () => {
    expect(idsOf(topicTabs(BUILT_INS, [], context))).toEqual(['overview', 'prompts']);
  });

  it('places an entry after the tab it names, and one without an anchor last', () => {
    expect(idsOf(topicTabs(BUILT_INS, [tab('fake', { after: 'overview' })], context))).toEqual([
      'overview',
      'fake',
      'prompts',
    ]);
    expect(idsOf(topicTabs(BUILT_INS, [tab('fake')], context))).toEqual(['overview', 'prompts', 'fake']);
  });

  it('leaves out an entry that is not available, and still places one that follows it', () => {
    const entries = [tab('hidden', { available: () => false }), tab('after-hidden', { after: 'hidden' })];
    expect(idsOf(topicTabs(BUILT_INS, entries, context))).toEqual(['overview', 'prompts', 'after-hidden']);
  });

  it('hands the context to available', () => {
    const seen: string[] = [];
    topicTabs(
      BUILT_INS,
      [
        tab('fake', {
          available: (given) => {
            seen.push(given.topicKey);
            return true;
          },
        }),
      ],
      context,
    );
    expect(seen).toEqual(['seo']);
  });
});

describe('the tab chosen by the address', () => {
  const tabs = topicTabs(BUILT_INS, [], context);

  it('opens on Overview unless the link names the Prompts tab', () => {
    expect(chosenTab(tabs, 'prompts')).toBe('prompts');
    expect(chosenTab(tabs, 'overview')).toBe('overview');
    expect(chosenTab(tabs, 'answers')).toBe('overview');
  });
});
