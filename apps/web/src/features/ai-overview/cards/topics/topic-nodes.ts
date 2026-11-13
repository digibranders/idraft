import type { TopicDescendants, TopicNode } from './model-types';
import type { PromptSummaryRow, TopicSummaryRow } from '@/lib/api/types';
import type { NamedTerm } from '@/lib/keywords/taxonomy-reads';

// shortcut: copy of `topicDescendants`, `topicsBelow`, `topicMembers` and `NO_TOPIC` of features/prompts/prompt-model.ts
// and of `buildTopicTree` of features/prompts/topic-tree.ts (a feature may not import another one). Move to
// lib/topics/topic-tree.ts (lease L-A). parity.test.ts imports the originals, so a drift fails there.

/** The topic key of the prompts without a topic, in the address (`topic:__none`) and in the rows. */
export const NO_TOPIC = '__none';

/**
 * The topics below each topic of the vocabularies' trees (`tree`, from the topic vocabularies only), as the
 * summary's rows roll a prompt up: a prompt given a term counts under it and under every term above it. A
 * term in `extra` that the tree does not hold stands alone.
 */
export function topicDescendants(tree: readonly NamedTerm[], extra: Iterable<string>): Map<string, Set<string>> {
  const children = new Map<string, string[]>();
  for (const term of tree) {
    if (term.parentId !== null) children.set(term.parentId, [...(children.get(term.parentId) ?? []), term.termId]);
  }
  const below = new Map<string, Set<string>>();
  for (const id of [...tree.map((term) => term.termId), ...extra]) {
    const found = new Set<string>();
    const pending = [id];
    for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
      if (found.has(next)) continue;
      found.add(next);
      pending.push(...(children.get(next) ?? []));
    }
    below.set(id, found);
  }
  return below;
}

/** The chosen topics and every topic below them. A chosen topic the tree does not hold stands for itself. */
export function topicsBelow(chosen: readonly string[], descendants: TopicDescendants): Set<string> {
  const kept = new Set<string>();
  for (const id of chosen) for (const below of descendants.get(id) ?? [id]) kept.add(below);
  return kept;
}

/**
 * The prompts a topic row holds, as the API rolls them up: those given the topic or a topic below it, each once;
 * `null` termId is the prompts without a topic. `null` when the tree does not hold the topic (it is not read yet),
 * so its prompts cannot be told.
 */
export function topicMembers<T extends Pick<PromptSummaryRow, 'topic_term_ids'>>(
  termId: string | null,
  prompts: readonly T[],
  descendants: TopicDescendants,
): T[] | null {
  if (termId === null) return prompts.filter((prompt) => prompt.topic_term_ids.length === 0);
  const below = descendants.get(termId);
  if (below === undefined) return null;
  return prompts.filter((prompt) => prompt.topic_term_ids.some((id) => below.has(id)));
}

/** A top level row and the rows directly under it. */
interface Branch {
  row: TopicSummaryRow;
  children: TopicSummaryRow[];
}

/**
 * The summary's topic rows as a two level tree, in the order given: a row goes under its parent when the parent is
 * shown and at the top level otherwise. A topic below the second level has no row of its own: it stands for its
 * second level topic. A row the tree does not hold (not read yet, or the row of no topic) is a top level row.
 */
function branchesOf(
  rows: readonly TopicSummaryRow[],
  tree: readonly NamedTerm[],
  keep: (termId: string | null) => boolean,
): Branch[] {
  const parents = new Map(tree.map((term) => [term.termId, term.parentId]));
  /** The topic and the topics above it, the top one first; `null` when the trees do not hold the topic. */
  const chainOf = (termId: string): string[] | null => {
    if (!parents.has(termId)) return null;
    const chain: string[] = [];
    for (
      let at: string | null | undefined = termId;
      at !== null && at !== undefined && !chain.includes(at);
      at = parents.get(at)
    ) {
      chain.unshift(at);
    }
    return chain;
  };
  const rowOf = new Map<string, TopicSummaryRow>();
  for (const row of rows) if (row.term_id !== null) rowOf.set(row.term_id, row);
  // The rows shown, each once, with the topics above them: a row below the second level shows as its second level topic
  const shown = new Map<TopicSummaryRow, string[] | null>();
  for (const row of rows) {
    if (!keep(row.term_id)) continue;
    const chain = row.term_id === null ? null : chainOf(row.term_id);
    if (chain === null || chain.length <= 2) {
      shown.set(row, chain);
      continue;
    }
    const second = rowOf.get(chain[1] ?? '');
    if (second !== undefined) shown.set(second, chain.slice(0, 2));
  }
  const placed = [...shown].map(([row, chain]) => {
    const parent = chain?.length === 2 ? rowOf.get(chain[0] ?? '') : undefined;
    return { row, parent: parent !== undefined && shown.has(parent) ? parent : undefined };
  });
  const branches = new Map<TopicSummaryRow, Branch>(
    placed.filter(({ parent }) => parent === undefined).map(({ row }) => [row, { row, children: [] }]),
  );
  for (const { row, parent } of placed) if (parent !== undefined) branches.get(parent)?.children.push(row);
  return [...branches.values()];
}

export interface BuildTopicNodesArgs {
  topics: readonly TopicSummaryRow[];
  /** The prompt rows of the same read; empty when the read left them out (then every `members` is empty too). */
  prompts: readonly PromptSummaryRow[];
  /** The topic terms of the vocabularies, with their parents. */
  tree: readonly NamedTerm[];
  descendants: TopicDescendants;
  /** The topics a topic filter keeps (the chosen one and those below it); `null` keeps every row, no topic included. */
  kept: ReadonlySet<string> | null;
  /** The name of the row of the prompts without a topic. */
  noTopicName: string;
}

/**
 * The topic rows as nodes of a two level tree, in the order the API gave them, the row of no topic last. A node's
 * `path` is its names from the top level topic down, as the vocabulary tree writes them.
 */
export function buildTopicNodes({
  topics,
  prompts,
  tree,
  descendants,
  kept,
  noTopicName,
}: BuildTopicNodesArgs): TopicNode[] {
  const termOf = new Map(tree.map((term) => [term.termId, term]));
  /** The names from the top level topic down to `termId`; just its own name when the tree does not hold it. */
  const pathOf = (termId: string | null, name: string): string[] => {
    const names: string[] = [];
    for (
      let at = termId === null ? undefined : termOf.get(termId);
      at !== undefined && names.length < termOf.size;
      at = at.parentId === null ? undefined : termOf.get(at.parentId)
    ) {
      names.unshift(at.name);
    }
    return names.length === 0 ? [name] : names;
  };
  const nodeOf = (row: TopicSummaryRow, parent: TopicNode | null, children: readonly TopicSummaryRow[]): TopicNode => {
    const name = row.name ?? noTopicName;
    const node: TopicNode = {
      key: row.term_id ?? NO_TOPIC,
      termId: row.term_id,
      name,
      path: pathOf(row.term_id, name),
      parentKey: parent?.key ?? null,
      level: parent === null ? 1 : 2,
      promptCount: row.prompt_count,
      engines: row.engines,
      members: topicMembers(row.term_id, prompts, descendants),
      lastValidAt: row.last_valid_at,
      children: [],
    };
    return { ...node, children: children.map((child) => nodeOf(child, node, [])) };
  };
  const nodes = branchesOf(topics, tree, (termId) => kept === null || (termId !== null && kept.has(termId))).map(
    ({ row, children }) => nodeOf(row, null, children),
  );
  // The prompts without a topic are no topic: they come after every one
  return [...nodes.filter((node) => node.key !== NO_TOPIC), ...nodes.filter((node) => node.key === NO_TOPIC)];
}

/** Rows with no rows below them (a top level row without children is one), the row of no topic left out. */
export const leavesOf = (nodes: readonly TopicNode[]): TopicNode[] =>
  nodes.flatMap((node) => (node.key === NO_TOPIC ? [] : node.children.length > 0 ? [...node.children] : [node]));

/** The top level rows, the row of no topic left out. */
export const topLevelOf = (nodes: readonly TopicNode[]): TopicNode[] => nodes.filter((node) => node.key !== NO_TOPIC);

/** How many prompts are in more than one top level topic: the overlap the footnote of a topic card names. */
export function overlapCount(prompts: readonly PromptSummaryRow[], nodes: readonly TopicNode[]): number {
  const topics = new Map<string, number>();
  for (const node of topLevelOf(nodes)) {
    for (const member of node.members ?? []) topics.set(member.prompt_id, (topics.get(member.prompt_id) ?? 0) + 1);
  }
  return prompts.filter((prompt) => (topics.get(prompt.prompt_id) ?? 0) > 1).length;
}
