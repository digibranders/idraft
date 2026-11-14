import type { PromptsSummary } from '@/lib/api/types';

/** The parts of a summary that tell how many prompts and topics are in scope. */
export type ScopeSummary = Pick<PromptsSummary, 'topics' | 'prompts' | 'total'>;

/**
 * Whether the summary carried its prompt rows. A read with `rows` of `topics` or `none` leaves them out: then the
 * prompts are empty while the topic rows or the total say there are some. With no prompt, no topic and no total,
 * the read cannot tell a project with no prompt from one that left the rows out, and is taken as having read them.
 */
export const promptRowsRead = (summary: ScopeSummary): boolean =>
  summary.prompts.length > 0 || (summary.topics.length === 0 && (summary.total?.prompt_count ?? 0) === 0);

/**
 * The prompts in scope, each once whatever the engines: the prompt rows, or the total's count when the rows
 * were left out of the read.
 */
export const promptsInScope = (summary: ScopeSummary): number =>
  summary.prompts.length > 0 ? summary.prompts.length : (summary.total?.prompt_count ?? 0);

/**
 * How many topics the prompts in scope span, as the Topics and Prompts strip counts them (`topicsSpanned` of the
 * Prompts page): the topic rows that hold a prompt, not the row of no topic, and within `kept` (the chosen topic
 * and the topics below it) when a topic filter is set. `null` while the topic rows are absent: the prompts are
 * there and no row is, which is a read that left the rows out and not a project with no topic.
 */
export function topicsInScope(summary: ScopeSummary, kept: ReadonlySet<string> | null): number | null {
  if (summary.topics.length === 0) return promptsInScope(summary) > 0 ? null : 0;
  return summary.topics.filter(
    (topic) => topic.term_id !== null && topic.prompt_count > 0 && (kept === null || kept.has(topic.term_id)),
  ).length;
}
