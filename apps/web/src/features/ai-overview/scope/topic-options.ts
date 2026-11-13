import type { EnumFilterField, FilterOption } from '@/components/app/filters/types';
import type { NamedTerm } from '@/lib/keywords/taxonomy-reads';

/**
 * The topic filter of the Overview, from the topic vocabularies' trees: every topic, in the tree order, as a choice
 * that the summary's `filter[term]` takes (the topic and the topics below it). The Prompts page offers only the
 * topics its prompts carry; the Overview offers the whole tree, as a card of the topics may be asked of any of them.
 */

/**
 * The choices for `tree`. A topic below another is named by its path ("SEO / Technical SEO", the tree's own
 * rendering), so where it sits is never a guess and two topics of one name differ; a topic that has topics below it
 * says so through `below`, because choosing it counts them too.
 */
export function topicOptions(tree: readonly NamedTerm[], below: (label: string) => string): FilterOption[] {
  const parents = new Set(tree.flatMap((term) => (term.parentId === null ? [] : [term.parentId])));
  return tree.map((term) => {
    const label = term.parentId === null ? term.name : term.path;
    return { value: term.termId, label: parents.has(term.termId) ? below(label) : label };
  });
}

export interface TopicFieldInput {
  tree: readonly NamedTerm[];
  /** The trees are not all read (loading, or failed): a topic of a link is kept until they are. */
  pending: boolean;
  label: string;
  /** The words for a topic that includes the topics below it. */
  below: (label: string) => string;
}

/** The `topic` field of the filter bar: a single choice. While the tree is pending a link's topic is not dropped as unknown. */
export function topicField({ tree, pending, label, below }: TopicFieldInput): EnumFilterField {
  return {
    id: 'topic',
    kind: 'enum',
    label,
    multi: false,
    optionsLoading: pending,
    options: topicOptions(tree, below),
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
