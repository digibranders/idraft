import type { EnumFilterField, FilterOption } from '@/components/app/filters/types';
import type { NamedTerm } from '@/lib/keywords/taxonomy-reads';

/**
 * The topic filter of the Overview, from the topic vocabularies' trees: every topic, in the tree order, as a choice
 * that the summary's `filter[term]` takes (the topic and the topics below it). The Prompts page offers only the
 * topics its prompts carry; the Overview offers the whole tree, as a card of the topics may be asked of any of them.
 */

/** The choices for `tree`; two topics of one name are told apart by their paths, written by `withPath`. */
export function topicOptions(
  tree: readonly NamedTerm[],
  withPath: (name: string, path: string) => string,
): FilterOption[] {
  const counts = new Map<string, number>();
  for (const term of tree) counts.set(term.name, (counts.get(term.name) ?? 0) + 1);
  return tree.map((term) => ({
    value: term.termId,
    label: (counts.get(term.name) ?? 0) > 1 ? withPath(term.name, term.path) : term.name,
  }));
}

export interface TopicFieldInput {
  tree: readonly NamedTerm[];
  /** The trees are not all read (loading, or failed): a topic of a link is kept until they are. */
  pending: boolean;
  label: string;
  withPath: (name: string, path: string) => string;
}

/** The `topic` field of the filter bar: a single choice. While the tree is pending a link's topic is not dropped as unknown. */
export function topicField({ tree, pending, label, withPath }: TopicFieldInput): EnumFilterField {
  return {
    id: 'topic',
    kind: 'enum',
    label,
    multi: false,
    optionsLoading: pending,
    options: topicOptions(tree, withPath),
  };
}

/**
 * The topics a topic filter keeps: the chosen topic and every topic below it, for the count of topics in scope.
 * `null` without a topic, and while the tree is pending (what is below a topic cannot be told yet). A topic the
 * read tree does not hold stands for itself, as the Prompts page treats one.
 */
export function topicsKeptOf(
  tree: readonly NamedTerm[],
  topic: string | null,
  pending: boolean,
): ReadonlySet<string> | null {
  if (topic === null || pending) return null;
  const children = new Map<string, string[]>();
  for (const term of tree) {
    if (term.parentId !== null) children.set(term.parentId, [...(children.get(term.parentId) ?? []), term.termId]);
  }
  const kept = new Set<string>();
  const waiting = [topic];
  for (let next = waiting.pop(); next !== undefined; next = waiting.pop()) {
    if (kept.has(next)) continue;
    kept.add(next);
    waiting.push(...(children.get(next) ?? []));
  }
  return kept;
}
