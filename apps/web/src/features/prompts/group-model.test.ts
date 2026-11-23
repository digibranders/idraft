import { describe, expect, it } from 'vitest';

import { distinctPrompts, groupChoices, groupCoverage, groupsOfSummary, searchGroups, type Group } from './group-model';
import { topicDescendants } from './prompt-model';
import { engine, promptRow, term, topicRow, weighted } from './topics-by-engine/cells.test-fixtures';

const TREE = [
  term('seo', 'SEO'),
  term('tech', 'Technical SEO', 'seo', 'SEO / Technical SEO'),
  term('local', 'Local SEO', 'seo', 'SEO / Local SEO'),
  term('ads', 'Paid Search'),
];
const DESCENDANTS = topicDescendants(TREE, []);

/** `rate` is the mention rate of ChatGPT, 4 of 8 by default. */
const prompt = (id: string, text: string, topics: string[], k = 4) =>
  promptRow(id, text, topics, [engine('chatgpt_web', { mentioned: weighted(k, 8, 1) })]);

const SUMMARY = {
  topics: [
    topicRow('seo', 'SEO', 4),
    topicRow('tech', 'Technical SEO', 2),
    topicRow('local', 'Local SEO', 1),
    topicRow('ads', 'Paid Search', 2),
  ],
  prompts: [
    prompt('p1', 'best crawl budget tools', ['tech'], 2),
    prompt('p2', 'crawl errors explained', ['tech'], 6),
    prompt('p3', 'local pack ranking factors', ['local', 'ads']),
    prompt('p4', 'what is a seo audit', ['seo']),
    prompt('p5', 'google ads agency pricing', ['ads'], 3),
    prompt('p6', 'unfiled question', []),
  ],
};

const base = { summary: SUMMARY, tree: TREE, descendants: DESCENDANTS, kept: new Set<string>(), filtering: false };
const groups = (codes: string[] = ['chatgpt_web']): Group[] => groupsOfSummary({ ...base, codes });
const ids = (group: Group | undefined): string[] => group?.members?.map((member) => member.prompt_id) ?? [];

describe('groupsOfSummary', () => {
  it('lists the groups only, in the order of the tree, and lists a prompt in every group that holds it', () => {
    const found = groups();
    expect(found.map((group) => group.name)).toEqual(['Technical SEO', 'Local SEO', 'Paid Search']);
    expect(ids(found.find((group) => group.key === 'local'))).toEqual(['p3']);
    expect(ids(found.find((group) => group.key === 'ads'))).toEqual(['p3', 'p5']);
  });

  it('orders the prompts of a group most mentioned first over the platforms in view, a prompt without a rate last', () => {
    expect(ids(groups()[0])).toEqual(['p2', 'p1']);
    const mixed = promptRow('p7', 'no answers yet', ['tech']);
    const withNone = groupsOfSummary({
      ...base,
      summary: { ...SUMMARY, prompts: [mixed, ...SUMMARY.prompts] },
      codes: ['chatgpt_web'],
    });
    expect(ids(withNone[0])).toEqual(['p2', 'p1', 'p7']);
  });

  it('keeps the groups the filter keeps', () => {
    const only = groupsOfSummary({ ...base, kept: new Set(['ads']), filtering: true, codes: [] });
    expect(only.map((group) => group.key)).toEqual(['ads']);
  });

  it('narrows to the groups "Detectable changes only" keeps without promoting a parent to a group of all their prompts', () => {
    // Only the parent's row changed: the groups below it did not, and the parent is still no group
    expect(groupsOfSummary({ ...base, codes: [], only: new Set(['seo']) }).map((group) => group.key)).toEqual([]);
    expect(groupsOfSummary({ ...base, codes: [], only: new Set(['tech', 'ads']) }).map((group) => group.key)).toEqual([
      'tech',
      'ads',
    ]);
    expect(groupsOfSummary({ ...base, codes: [], only: null })).toHaveLength(3);
  });

  it('knows no prompts of a group the trees do not hold yet', () => {
    const unread = groupsOfSummary({ ...base, tree: [], descendants: new Map(), codes: [] });
    expect(unread.every((group) => group.members === null)).toBe(true);
  });
});

describe('searchGroups', () => {
  const all = groups();

  it('keeps all the prompts of a group whose name matches, case-insensitively, after trimming', () => {
    const found = searchGroups(all, '  paid ', 'en');
    expect(found.map(({ group }) => group.key)).toEqual(['ads']);
    expect(found[0]?.listed.map((member) => member.prompt_id)).toEqual(['p3', 'p5']);
  });

  it('keeps a group with only the prompts whose text matches otherwise, and hides a group with none', () => {
    const found = searchGroups(all, 'crawl', 'en');
    expect(found.map(({ group }) => group.key)).toEqual(['tech']);
    expect(found[0]?.listed.map((member) => member.prompt_id)).toEqual(['p2', 'p1']);
    expect(searchGroups(all, 'zzz', 'en')).toEqual([]);
  });

  it('keeps every group without a search', () => {
    expect(searchGroups(all, '', 'en')).toHaveLength(3);
  });
});

describe('groupCoverage and distinctPrompts', () => {
  it('counts the prompts in two groups and the prompts in none, and the footer counts a prompt once', () => {
    const all = groups();
    // p3 is in two groups; p4 is only in a parent that has groups below it, and p6 in none
    expect(groupCoverage(SUMMARY.prompts, all)).toEqual({ overlapping: 1, outside: 2 });
    expect(distinctPrompts(searchGroups(all, '', 'en'))).toBe(4);
  });
});

describe('groupChoices', () => {
  const paths = new Map(TREE.map((entry) => [entry.termId, entry.path]));

  it('offers the groups only, flat, with their prompt counts: a parent with groups below it is none', () => {
    expect(groupChoices(SUMMARY.topics, TREE, paths)).toEqual([
      { key: 'tech', label: 'Technical SEO', promptCount: 2 },
      { key: 'local', label: 'Local SEO', promptCount: 1 },
      { key: 'ads', label: 'Paid Search', promptCount: 2 },
    ]);
  });

  it('leaves out a term of the tree that no prompt is in', () => {
    const topics = SUMMARY.topics.filter((row) => row.term_id !== 'ads');
    expect(groupChoices(topics, TREE, paths).map((choice) => choice.key)).toEqual(['tech', 'local']);
  });

  it('labels two groups of one name by their paths', () => {
    const tree = [...TREE, term('ads-tech', 'Technical SEO', 'ads', 'Paid Search / Technical SEO')];
    const topics = [...SUMMARY.topics, topicRow('ads-tech', 'Technical SEO', 1)];
    const labels = groupChoices(topics, tree, new Map(tree.map((entry) => [entry.termId, entry.path])));
    expect(labels.filter((choice) => choice.key === 'tech' || choice.key === 'ads-tech').map((c) => c.label)).toEqual([
      'SEO / Technical SEO',
      'Paid Search / Technical SEO',
    ]);
  });

  it('keeps a chosen group that has no prompt in this scope but that a prompt carries, with no prompts, after the others', () => {
    const inThisLocation = SUMMARY.topics.filter((row) => row.term_id === 'ads');
    const carried = new Map([
      ['tech', 'Technical SEO'],
      ['ads', 'Paid Search'],
    ]);
    expect(groupChoices(inThisLocation, TREE, paths, ['tech'], carried)).toEqual([
      { key: 'ads', label: 'Paid Search', promptCount: 2 },
      { key: 'tech', label: 'Technical SEO', promptCount: 0 },
    ]);
    // A chosen id no prompt carries is no group, and a chosen group already in scope is not listed twice
    expect(groupChoices(inThisLocation, TREE, paths, ['missing', 'ads'], carried).map((choice) => choice.key)).toEqual([
      'ads',
    ]);
  });

  it('has none while the summary has no topic rows', () => {
    expect(groupChoices([], TREE, paths)).toEqual([]);
  });
});
