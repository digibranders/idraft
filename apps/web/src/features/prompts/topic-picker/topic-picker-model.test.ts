import { describe, expect, it } from 'vitest';

import {
  buildTopicChoices,
  createTarget,
  keepOnePerSingleVocabulary,
  leafTermId,
  MAX_TOPIC_TERMS,
  newTopicChoice,
  NEW_TOPIC_VOCABULARY,
  nextTopicValue,
  selectionOf,
  splitSelections,
  topicPathProblem,
  type TopicChoice,
} from './topic-picker-model';
import type { Vocabulary, VocabularyTerms } from '@/lib/keywords/taxonomy-reads';

const vocabulary = (over: Partial<Vocabulary> & Pick<Vocabulary, 'vocabulary_id' | 'name' | 'kind'>): Vocabulary => ({
  project_id: null,
  is_single_valued: false,
  is_hierarchical: true,
  term_count: 0,
  ...over,
});

const term = (termId: string, path: string, parentId: string | null = null): VocabularyTerms['terms'][number] => ({
  termId,
  name: path.split(' / ').at(-1) ?? path,
  parentId,
  path,
});

const TOPICS = vocabulary({ vocabulary_id: 'v-topics', name: 'Topics', kind: 'topic' });
const SERVICES = vocabulary({
  vocabulary_id: 'v-services',
  name: 'Services',
  kind: 'service',
  project_id: 'p-1',
  is_single_valued: true,
});
const LOADED: readonly VocabularyTerms[] = [
  { vocabulary: SERVICES, terms: [term('s-1', 'Audit'), term('s-2', 'Link building')] },
  { vocabulary: TOPICS, terms: [term('t-1', 'CRM'), term('t-2', 'CRM / Startups', 't-1'), term('t-3', 'SEO')] },
];
const tagLabel = (vocabularyName: string, path: string): string => `${vocabularyName}: ${path}`;
const CHOICES = buildTopicChoices(LOADED, tagLabel);
const choice = (key: string): TopicChoice => {
  const found = CHOICES.find((entry) => entry.key === key);
  if (found === undefined) throw new Error(`No choice ${key}`);
  return found;
};

describe('buildTopicChoices', () => {
  it('lists the topics depth first and the tags of the other vocabularies after them, labelled by vocabulary', () => {
    expect(CHOICES.map((entry) => [entry.label, entry.group])).toEqual([
      ['CRM', 'topic'],
      ['CRM / Startups', 'topic'],
      ['SEO', 'topic'],
      ['Services: Audit', 'tag'],
      ['Services: Link building', 'tag'],
    ]);
  });

  it('names the vocabulary on every topic when the project sees more than one topic vocabulary', () => {
    const own = vocabulary({ vocabulary_id: 'v-own', name: 'Fynix topics', kind: 'topic', project_id: 'p-1' });
    const two = buildTopicChoices([...LOADED, { vocabulary: own, terms: [term('o-1', 'Pricing')] }], tagLabel);
    expect(two.filter((entry) => entry.group === 'topic').map((entry) => entry.label)).toEqual([
      'Topics: CRM',
      'Topics: CRM / Startups',
      'Topics: SEO',
      'Fynix topics: Pricing',
    ]);
  });
});

describe('topicPathProblem', () => {
  it('accepts a name or a path and names what is wrong with an empty level, a long name and too many levels', () => {
    expect(topicPathProblem('Startups')).toBeNull();
    expect(topicPathProblem('CRM / Startups')).toBeNull();
    expect(topicPathProblem('CRM//Startups')).toBe('pathEmpty');
    expect(topicPathProblem('   ')).toBe('pathEmpty');
    expect(topicPathProblem('x'.repeat(201))).toBe('pathTooLong');
    expect(topicPathProblem(Array.from({ length: 11 }, () => 'a').join('/'))).toBe('pathTooDeep');
  });
});

describe('keepOnePerSingleVocabulary', () => {
  it('keeps the term chosen last of a single-valued vocabulary and leaves other vocabularies alone', () => {
    const kept = keepOnePerSingleVocabulary([choice('s-1'), choice('t-1'), choice('s-2'), choice('t-3')]);
    expect(kept.map((entry) => entry.key)).toEqual(['t-1', 's-2', 't-3']);
  });
});

describe('nextTopicValue', () => {
  it('adds a child without adding its parent', () => {
    const { value, problem } = nextTopicValue([], [choice('t-2')], CHOICES);
    expect(value.map((entry) => entry.key)).toEqual(['t-2']);
    expect(problem).toBeNull();
  });

  it('says which vocabulary takes one term when a second one replaces the first', () => {
    const { value, problem } = nextTopicValue([choice('s-1')], [choice('s-1'), choice('s-2')], CHOICES);
    expect(value.map((entry) => entry.key)).toEqual(['s-2']);
    expect(problem).toEqual({ code: 'single', vocabulary: 'Services' });
  });

  /** `count` chosen terms of a topic vocabulary, none of them in `CHOICES`. */
  const extras = (count: number): TopicChoice[] =>
    Array.from({ length: count }, (_, index) => ({
      key: `x-${String(index)}`,
      label: `Extra ${String(index)}`,
      kind: 'existing',
      termId: `x-${String(index)}`,
      path: `Extra ${String(index)}`,
      vocabularyId: 'v-topics',
      vocabularyName: 'Topics',
      single: false,
      group: 'topic',
    }));

  it('takes the 20th term: 19 chosen and one more are all kept, with no problem', () => {
    const nineteen = extras(MAX_TOPIC_TERMS - 1);
    const { value, problem } = nextTopicValue(nineteen, [...nineteen, choice('t-1')], CHOICES);
    expect(value).toHaveLength(MAX_TOPIC_TERMS);
    expect(value.at(-1)?.key).toBe('t-1');
    expect(problem).toBeNull();
  });

  it('refuses more than 20 terms and keeps what was chosen', () => {
    const many = extras(MAX_TOPIC_TERMS);
    const { value, problem } = nextTopicValue(many, [...many, choice('t-1')], CHOICES);
    expect(value).toEqual(many);
    expect(problem).toEqual({ code: 'tooMany' });
  });

  it('turns a typed path that is already a topic into that topic, whatever its case and spacing', () => {
    const typed: TopicChoice = {
      key: 'new:v-topics:crm/startups',
      label: 'crm/startups',
      kind: 'new',
      path: 'crm / startups',
      vocabularyId: 'v-topics',
      vocabularyName: 'Topics',
      single: false,
      group: 'topic',
    };
    const { value } = nextTopicValue([], [typed], CHOICES);
    expect(value.map((entry) => entry.key)).toEqual(['t-2']);
  });

  it('drops a typed path with an empty level and says so', () => {
    const typed: TopicChoice = {
      key: 'new:v-topics:a//b',
      label: 'a//b',
      kind: 'new',
      path: 'a//b',
      vocabularyId: 'v-topics',
      vocabularyName: 'Topics',
      single: false,
      group: 'topic',
    };
    const { value, problem } = nextTopicValue([], [typed], CHOICES);
    expect(value).toEqual([]);
    expect(problem).toEqual({ code: 'pathEmpty' });
  });
});

describe('splitSelections', () => {
  it('separates the terms that exist from the paths to create, in the order chosen', () => {
    expect(
      splitSelections([
        { kind: 'existing', termId: 't-1' },
        { kind: 'new', vocabularyId: 'v-topics', path: 'CRM / Startups' },
        { kind: 'existing', termId: 't-3' },
      ]),
    ).toEqual({
      termIds: ['t-1', 't-3'],
      created: [{ vocabularyId: 'v-topics', path: 'CRM / Startups' }],
    });
  });
});

describe('a topic typed where no vocabulary exists yet', () => {
  it('is held with no vocabulary id, and carries it through the choice, the selection and the split', () => {
    const typed = newTopicChoice('CRM/Startups', NEW_TOPIC_VOCABULARY, (path) => `${path} (new)`);
    expect(typed).toMatchObject({
      kind: 'new',
      label: 'CRM / Startups (new)',
      vocabularyId: null,
      path: 'CRM / Startups',
    });
    const selection = selectionOf(typed);
    expect(selection).toEqual({ kind: 'new', vocabularyId: null, path: 'CRM / Startups' });
    expect(splitSelections([selection]).created).toEqual([{ vocabularyId: null, path: 'CRM / Startups' }]);
  });

  it('keeps the same typed path once, whatever its case', () => {
    const first = newTopicChoice('Startups', NEW_TOPIC_VOCABULARY, (path) => path);
    const again = newTopicChoice('STARTUPS', NEW_TOPIC_VOCABULARY, (path) => path);
    expect(again.key).toBe(first.key);
    const { value } = nextTopicValue([], [first, again], []);
    expect(value).toHaveLength(1);
  });
});

describe('createTarget', () => {
  const own = vocabulary({ vocabulary_id: 'v-own', name: 'Fynix topics', kind: 'topic', project_id: 'p-1' });
  const withOwn: readonly VocabularyTerms[] = [...LOADED, { vocabulary: own, terms: [] }];

  it('prefers the project own topic vocabulary, and falls back to the shared one only for a member of every project', () => {
    expect(createTarget(withOwn, 'p-1', { canWrite: true, canWriteShared: true })?.vocabulary_id).toBe('v-own');
    expect(createTarget(LOADED, 'p-1', { canWrite: true, canWriteShared: true })?.vocabulary_id).toBe('v-topics');
  });

  it('gives a member limited to some projects only the vocabulary of their project, and none without taxonomy write', () => {
    expect(createTarget(withOwn, 'p-1', { canWrite: true, canWriteShared: false })?.vocabulary_id).toBe('v-own');
    expect(createTarget(withOwn, 'p-1', { canWrite: false, canWriteShared: false })).toBeNull();
  });

  it('never targets a vocabulary of another project or one that is not a topic vocabulary', () => {
    const other = vocabulary({ vocabulary_id: 'v-other', name: 'Other', kind: 'topic', project_id: 'p-2' });
    const target = createTarget(
      [
        { vocabulary: other, terms: [] },
        { vocabulary: SERVICES, terms: [] },
      ],
      'p-1',
      { canWrite: true, canWriteShared: true },
    );
    expect(target).toEqual(NEW_TOPIC_VOCABULARY);
  });

  it('offers to make the topic vocabulary of the project when none exists to write to, to a person who can write', () => {
    for (const vocabularies of [[], [{ vocabulary: SERVICES, terms: [] }]] satisfies VocabularyTerms[][]) {
      expect(createTarget(vocabularies, 'p-1', { canWrite: true, canWriteShared: true })).toEqual(NEW_TOPIC_VOCABULARY);
    }
    expect(NEW_TOPIC_VOCABULARY.vocabulary_id).toBeNull();
    expect(NEW_TOPIC_VOCABULARY.name).toBe('Topics');
  });

  it('lets a member limited to some projects make the vocabulary of their project beside a shared one they cannot write', () => {
    expect(createTarget(LOADED, 'p-1', { canWrite: true, canWriteShared: false })).toEqual(NEW_TOPIC_VOCABULARY);
  });

  it('offers nothing to a person who cannot write when there is no topic vocabulary', () => {
    expect(createTarget([], 'p-1', { canWrite: false, canWriteShared: false })).toBeNull();
    expect(createTarget(LOADED, 'p-1', { canWrite: false, canWriteShared: true })).toBeNull();
  });
});

describe('leafTermId', () => {
  const tree = [
    {
      term_id: 't-1',
      name: 'CRM',
      children: [{ term_id: 't-2', name: 'Startups', children: [] }],
    },
  ];

  it('walks the names down the tree and ignores case', () => {
    expect(leafTermId(tree, ['crm', 'STARTUPS'])).toBe('t-2');
    expect(leafTermId(tree, ['CRM'])).toBe('t-1');
  });

  it('answers null when a level is not there', () => {
    expect(leafTermId(tree, ['CRM', 'Agencies'])).toBeNull();
  });
});
