import type { Vocabulary, VocabularyTerms } from '@/lib/keywords/taxonomy-reads';

/**
 * The topic field of a form as a pure model: the choices the picker lists, what a form holds for them, and the
 * rules every change passes (at most 20 terms, one per single-valued vocabulary, a typed path that can be
 * made). It knows no React and no request.
 */

/** A prompt takes at most this many topics and tags (the API refuses more). */
export const MAX_TOPIC_TERMS = 20;
/** A topic path is this many levels at most, and a level's name this many characters (the API's limits). */
export const MAX_TOPIC_DEPTH = 10;
export const MAX_TOPIC_NAME = 200;

/** What a form holds: a term that exists, or a path to make in a vocabulary when the form is saved. */
export type TopicSelection = { kind: 'existing'; termId: string } | { kind: 'new'; vocabularyId: string; path: string };

/** One row of the list and one chip of the field. */
export interface TopicChoice {
  /** The term's id, or `new:` with the vocabulary and the folded path. */
  key: string;
  /** What the row and the chip say: "CRM / Startups", "Services: Audit", "CRM / Startups (new)". */
  label: string;
  kind: 'existing' | 'new';
  /** Set for an existing term. */
  termId?: string;
  /** The term's place by name in its vocabulary, "CRM / Startups". */
  path: string;
  vocabularyId: string;
  vocabularyName: string;
  /** Its vocabulary takes one term per prompt. */
  single: boolean;
  /** Topics are listed first; the terms of every other vocabulary are tags. */
  group: 'topic' | 'tag';
}

/** Why a change was not taken as it was made. */
export type TopicProblem =
  { code: 'tooMany' | 'pathEmpty' | 'pathTooLong' | 'pathTooDeep' } | { code: 'single'; vocabulary: string };

/** The names of a typed path, each trimmed: "CRM / Startups" and "CRM/Startups" are the same two names. */
export const splitTopicPath = (text: string): string[] => text.split('/').map((name) => name.trim());

/** The path as the list shows it. */
export const displayTopicPath = (text: string): string => splitTopicPath(text).join(' / ');

/** What keeps a typed path from becoming a topic, or `null` when it can. */
export function topicPathProblem(text: string): 'pathEmpty' | 'pathTooLong' | 'pathTooDeep' | null {
  const names = splitTopicPath(text);
  if (names.some((name) => name === '')) return 'pathEmpty';
  if (names.length > MAX_TOPIC_DEPTH) return 'pathTooDeep';
  return names.some((name) => name.length > MAX_TOPIC_NAME) ? 'pathTooLong' : null;
}

const foldPath = (text: string): string =>
  splitTopicPath(text)
    .map((name) => name.toLowerCase())
    .join('/');

/**
 * Every term the project sees as a choice: the terms of the topic vocabularies first, then the terms of the
 * others as tags labelled with their vocabulary. With more than one topic vocabulary each topic names its own.
 */
export function buildTopicChoices(
  vocabularies: readonly VocabularyTerms[],
  tagLabel: (vocabulary: string, path: string) => string,
): TopicChoice[] {
  const topics = vocabularies.filter((entry) => entry.vocabulary.kind === 'topic');
  const tags = vocabularies.filter((entry) => entry.vocabulary.kind !== 'topic');
  const named = (entries: readonly VocabularyTerms[], group: TopicChoice['group'], prefixed: boolean): TopicChoice[] =>
    entries.flatMap(({ vocabulary, terms }) =>
      terms.map((term) => ({
        key: term.termId,
        label: prefixed ? tagLabel(vocabulary.name, term.path) : term.path,
        kind: 'existing' as const,
        termId: term.termId,
        path: term.path,
        vocabularyId: vocabulary.vocabulary_id,
        vocabularyName: vocabulary.name,
        single: vocabulary.is_single_valued,
        group,
      })),
    );
  return [...named(topics, 'topic', topics.length > 1), ...named(tags, 'tag', true)];
}

/** A typed path as a choice to make in `vocabulary`; `label` words it for the chip ("CRM / Startups (new)"). */
export function newTopicChoice(
  text: string,
  vocabulary: Pick<Vocabulary, 'vocabulary_id' | 'name' | 'is_single_valued'>,
  label: (path: string) => string,
): TopicChoice {
  const path = displayTopicPath(text);
  return {
    key: `new:${vocabulary.vocabulary_id}:${foldPath(text)}`,
    label: label(path),
    kind: 'new',
    path,
    vocabularyId: vocabulary.vocabulary_id,
    vocabularyName: vocabulary.name,
    single: vocabulary.is_single_valued,
    group: 'topic',
  };
}

/** The choices with each single-valued vocabulary down to its term chosen last. */
export function keepOnePerSingleVocabulary(choices: readonly TopicChoice[]): TopicChoice[] {
  const kept: TopicChoice[] = [];
  for (const choice of [...choices].reverse()) {
    const taken = choice.single && kept.some((other) => other.vocabularyId === choice.vocabularyId);
    if (!taken) kept.unshift(choice);
  }
  return kept;
}

/**
 * The value after a change of the field. A typed path that is already a term becomes that term, one that
 * cannot be made is left out, a single-valued vocabulary keeps its last term, and a change that would pass
 * the cap is refused whole. `problem` says what was done, so the field can tell the person why.
 */
export function nextTopicValue(
  previous: readonly TopicChoice[],
  next: readonly TopicChoice[],
  listed: readonly TopicChoice[],
): { value: TopicChoice[]; problem: TopicProblem | null } {
  let problem: TopicProblem | null = null;
  const taken = new Map<string, TopicChoice>();
  for (const choice of next) {
    const found =
      choice.kind === 'new'
        ? listed.find(
            (entry) => entry.vocabularyId === choice.vocabularyId && foldPath(entry.path) === foldPath(choice.path),
          )
        : undefined;
    const pathProblem = choice.kind === 'new' && found === undefined ? topicPathProblem(choice.path) : null;
    if (pathProblem !== null) {
      problem = { code: pathProblem };
      continue;
    }
    const resolved = found ?? choice;
    taken.set(resolved.key, resolved);
  }
  const kept = keepOnePerSingleVocabulary([...taken.values()]);
  const replaced = [...taken.values()].find((choice) => !kept.includes(choice));
  if (replaced !== undefined) problem = { code: 'single', vocabulary: replaced.vocabularyName };
  if (kept.length > MAX_TOPIC_TERMS) return { value: [...previous], problem: { code: 'tooMany' } };
  return { value: kept, problem };
}

/** The form's value as the terms that exist and the paths to make, each in the order chosen. */
export function splitSelections(selections: readonly TopicSelection[]): {
  termIds: string[];
  created: { vocabularyId: string; path: string }[];
} {
  return {
    termIds: selections.flatMap((selection) => (selection.kind === 'existing' ? [selection.termId] : [])),
    created: selections.flatMap((selection) =>
      selection.kind === 'new' ? [{ vocabularyId: selection.vocabularyId, path: selection.path }] : [],
    ),
  };
}

export const selectionOf = (choice: TopicChoice): TopicSelection =>
  choice.kind === 'existing'
    ? { kind: 'existing', termId: choice.termId ?? choice.key }
    : { kind: 'new', vocabularyId: choice.vocabularyId, path: choice.path };

/**
 * The vocabulary a typed topic is made in: a topic vocabulary of the project itself first, then a workspace-wide
 * one. A member limited to some projects may write only the first kind (the API refuses a shared vocabulary with
 * 403), and without `taxonomy:write` nothing can be made.
 */
export function createTarget(
  vocabularies: readonly VocabularyTerms[],
  projectId: string,
  access: { canWrite: boolean; canWriteShared: boolean },
): Vocabulary | null {
  if (!access.canWrite) return null;
  const topics = vocabularies.map((entry) => entry.vocabulary).filter((vocabulary) => vocabulary.kind === 'topic');
  const own = topics.find((vocabulary) => vocabulary.project_id === projectId);
  if (own !== undefined) return own;
  return access.canWriteShared ? (topics.find((vocabulary) => vocabulary.project_id === null) ?? null) : null;
}

/** A term of a tree read from the API: what `leafTermId` walks. */
export interface TermTreeNode {
  term_id: string;
  name: string;
  children: readonly TermTreeNode[];
}

/** The id of the term a path names in a tree, comparing names without case; `null` when a level is missing. */
export function leafTermId(tree: readonly TermTreeNode[], names: readonly string[]): string | null {
  let level = tree;
  let found: TermTreeNode | undefined;
  for (const name of names) {
    found = level.find((node) => node.name.toLowerCase() === name.toLowerCase());
    if (found === undefined) return null;
    level = found.children;
  }
  return found?.term_id ?? null;
}
