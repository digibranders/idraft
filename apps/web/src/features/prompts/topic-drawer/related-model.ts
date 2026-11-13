import { NO_TOPIC, type TopicDescendants } from '@/features/prompts/prompt-model';
import type { MetricCell, TopicSummaryRow } from '@/lib/api/types';
import { averageRate, hasRate, type AverageRate } from '@/lib/rates/rate-model';

/**
 * The topics beside a topic (WB-TI-19), worked out from the topic tree's descendants alone: a topic is held by the
 * topics above it, so its parent is the smallest other topic that holds it, and its siblings are the topics that share
 * that parent (the other top level topics, for a top level one).
 */

/** The most siblings the Related tab lists; the rest are counted. */
export const MAX_SIBLINGS = 10;

/** The smallest other topic whose set holds `key`; `null` for a top level topic and for a topic the descendants do not hold. */
export function parentOf(key: string, descendants: TopicDescendants): string | null {
  if (!descendants.has(key)) return null;
  let parent: { id: string; size: number } | null = null;
  for (const [id, below] of descendants) {
    if (id !== key && below.has(key) && (parent === null || below.size < parent.size))
      parent = { id, size: below.size };
  }
  return parent?.id ?? null;
}

/**
 * The keys of the topics that share a parent with `key`, in the order the descendants hold them; `null` while the
 * descendants do not hold the topic (the vocabulary is not read yet). The prompts without a topic have none.
 */
export function siblingKeys(key: string, descendants: TopicDescendants): string[] | null {
  if (key === NO_TOPIC) return [];
  if (!descendants.has(key)) return null;
  const parent = parentOf(key, descendants);
  return [...descendants.keys()].filter((other) => other !== key && parentOf(other, descendants) === parent);
}

export interface Sibling {
  key: string;
  name: string;
  promptCount: number;
  /** The equal weight average of the engines' Mentioned rates; `state` says when there is none. */
  mention: AverageRate;
  /** The Mentioned cell of each engine that shows a rate and so takes part in the average, in the order of the engines. */
  counting: { code: string; cell: MetricCell }[];
}

/**
 * The siblings of `key` the summary has a row for, most prompts first (a tie by name), at most `MAX_SIBLINGS`, and how
 * many more there are. `null` while the descendants or the summary are not read.
 */
export function siblingsOf(
  key: string,
  summary: { topics: readonly TopicSummaryRow[] } | undefined,
  descendants: TopicDescendants,
  codes: readonly string[],
): { shown: Sibling[]; more: number } | null {
  const keys = siblingKeys(key, descendants);
  if (keys === null || summary === undefined) return null;
  const siblings = summary.topics
    .filter((topic) => topic.term_id !== null && keys.includes(topic.term_id))
    .map((topic): Sibling => {
      const cells = codes.map((code) => ({
        code,
        cell: topic.engines.find((engine) => engine.engine_code === code)?.mentioned,
      }));
      return {
        key: topic.term_id ?? NO_TOPIC,
        name: topic.name ?? '',
        promptCount: topic.prompt_count,
        mention: averageRate(cells.map((entry) => entry.cell)),
        counting: cells.flatMap(({ code, cell }) => (cell !== undefined && hasRate(cell) ? [{ code, cell }] : [])),
      };
    })
    .sort((a, b) => b.promptCount - a.promptCount || a.name.localeCompare(b.name));
  return { shown: siblings.slice(0, MAX_SIBLINGS), more: Math.max(0, siblings.length - MAX_SIBLINGS) };
}
