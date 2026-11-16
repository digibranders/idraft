'use client';

import { useMemo } from 'react';

import { buildAggregates } from '../../data/aggregates';
import { askedEngines, type SummaryOptions } from '../../data/overview-queries';
import type { Read } from '../../data/read-state';
import { promptRowsRead } from '../../data/topics-in-scope';
import { useOverviewSummary as readSummary, type SummaryReadOptions } from '../../data/use-overview-reads';
import { useOverview, useOverviewPeriods, useOverviewSummary } from '../../overview-context';
import type { OverviewScope } from '../../scope/scope-model';
import type { EngineInfo, Phase, TopicData, TopicNode } from './model-types';
import { buildTopicNodes, topicDescendants, topicsBelow } from './topic-nodes';
import type { PromptsSummary, PromptSummaryRow } from '@/lib/api/types';
import { useVocabularies } from '@/lib/keywords/taxonomy-reads';
import { ENGINES } from '@/lib/layouts/catalog';

/**
 * The reads of the topics cards (plan section 2.2): the one place that turns the shell's reads into `TopicData`.
 * A card never calls the API and never reads the URL. The same options are one request, so the default options
 * share the strip's reads and add none; the series cards pass `READ.topicSeries` or `READ.promptSeries`.
 */

/** The options of the cards that need weekly points. No card asks `compare`, `cells` or `total`. */
export const READ = {
  /** The weekly points of the topic rows, with the prompt rows left out. */
  topicSeries: { include: ['series'], rows: 'topics' },
  /** The pooled weekly points of the prompt rows. */
  promptSeries: { include: ['series'] },
} as const satisfies Record<string, SummaryOptions>;

interface Reads {
  current: Read<PromptsSummary>;
  /** `null` when there is no previous window to read. */
  previous: Read<PromptsSummary> | null;
  paired: boolean;
  settled: boolean;
  /** `false` while the card is paused (customize mode): a read with nothing to show then is not "nothing asked". */
  subscribed: boolean;
}

/** The newest of ISO times; `null` when there is none. */
function newest(times: readonly (string | null)[]): string | null {
  let best: { text: string; time: number } | null = null;
  for (const text of times) {
    const time = text === null ? Number.NaN : Date.parse(text);
    if (text !== null && !Number.isNaN(time) && (best === null || time > best.time)) best = { text, time };
  }
  return best?.text ?? null;
}

/** Every node of the tree by key: the top level ones and the ones below them. */
const flatByKey = (nodes: readonly TopicNode[]): Map<string, TopicNode> =>
  new Map(nodes.flatMap((node) => [node, ...node.children]).map((node) => [node.key, node] as const));

const NO_PROMPTS: readonly PromptSummaryRow[] = [];

/** The prompt rows of a summary; none when the read left them out (`rows` of `topics`). */
const promptsOf = (summary: PromptsSummary | null | undefined): readonly PromptSummaryRow[] =>
  summary !== null && summary !== undefined && promptRowsRead(summary) ? summary.prompts : NO_PROMPTS;

function useTopicData(
  { current, previous, paired, settled, subscribed }: Reads,
  scopeOf?: (page: OverviewScope) => OverviewScope,
): TopicData {
  const { workspaceId, project, scope: pageScope, enabledEngines, engines: engineRead } = useOverview();
  // The groups cards read every group on every platform whatever the page's Group and Platform say
  const scope = useMemo(() => (scopeOf === undefined ? pageScope : scopeOf(pageScope)), [scopeOf, pageScope]);
  const vocabularies = useVocabularies({ workspaceId, projectId: project.id });
  const tree = useMemo(
    () => vocabularies.loaded.filter((entry) => entry.vocabulary.kind === 'topic').flatMap((entry) => entry.terms),
    [vocabularies.loaded],
  );
  const descendants = useMemo(() => topicDescendants(tree, []), [tree]);
  // A topic filter narrows every topic card to that topic and the ones below it (D17)
  const kept = useMemo(
    () => (scope.topic === null ? null : topicsBelow([scope.topic], descendants)),
    [scope.topic, descendants],
  );
  const asked = useMemo((): EngineInfo[] => {
    const codes = askedEngines({ scope, enabledEngines });
    return ENGINES.filter((engine) => codes.includes(engine.code)).map(({ code, label }) => ({ code, label }));
  }, [scope, enabledEngines]);

  const summary = current.data;
  // A change between two windows of different scopes is no change: the previous window counts only while paired
  const previousSummary = paired && previous?.data !== undefined ? previous.data : null;

  const built = useMemo(() => {
    // The row of no topic is worded by the card: the API has no name for it
    const nodesOf = (source: PromptsSummary): TopicNode[] =>
      buildTopicNodes({
        topics: source.topics,
        prompts: promptsOf(source),
        tree,
        descendants,
        kept,
        noTopicName: '',
      });
    return {
      nodes: summary === undefined ? [] : nodesOf(summary),
      previousNodes: previousSummary === null ? null : flatByKey(nodesOf(previousSummary)),
      aggregates:
        summary === undefined
          ? null
          : buildAggregates({
              current: summary,
              previous: previousSummary,
              engines: engineRead.data ?? [],
              chosenEngines: scope.engines,
              topicsKept: kept,
              sources: null,
              fanout: null,
            }),
    };
  }, [summary, previousSummary, tree, descendants, kept, engineRead.data, scope.engines]);

  const phase: Phase =
    engineRead.status === 'idle' || engineRead.status === 'loading'
      ? 'loading'
      : engineRead.status === 'error'
        ? 'error'
        : asked.length === 0
          ? 'idle'
          : // A paused card with no data of this scope waits for its turn: it is a skeleton, not an empty card
            current.status === 'idle' && !subscribed
            ? 'loading'
            : current.status;
  const prompts = promptsOf(summary);
  return {
    phase,
    stale: current.stale || (previous?.stale ?? false),
    errorId: engineRead.status === 'error' ? engineRead.errorId : (current.errorId ?? previous?.errorId ?? null),
    retry: () => {
      if (engineRead.status === 'error') engineRead.refetch();
      current.refetch();
      previous?.refetch();
    },
    paired,
    settled,
    compared: previousSummary !== null,
    scope,
    engines: asked,
    summary,
    previous: previousSummary,
    nodes: built.nodes,
    previousNodes: built.previousNodes,
    prompts,
    previousPrompts: previousSummary === null ? null : promptsOf(previousSummary),
    promptsRead: summary !== undefined && promptRowsRead(summary),
    descendants,
    tree: { pending: vocabularies.pending, failed: vocabularies.error },
    aggregates: built.aggregates,
    lastValidAt: newest([
      ...prompts.map((prompt) => prompt.last_valid_at),
      ...(summary?.topics.map((topic) => topic.last_valid_at) ?? []),
    ]),
  };
}

/** The read has no data of this scope yet: it is loading, or shows the last scope's data meanwhile. */
const waiting = (read: Read<PromptsSummary>): boolean =>
  read.status === 'loading' || (read.status === 'refetching' && read.placeholder);

/**
 * The topic data of the scope's window: one read, which the default options share with the strip. `subscribed` is
 * the `live` of the card's props: while it is `false` nothing is asked.
 */
export function useTopicSummary(options?: SummaryReadOptions): TopicData {
  const current = useOverviewSummary(options);
  return useTopicData({
    current,
    previous: null,
    paired: true,
    settled: !waiting(current),
    subscribed: options?.subscribed ?? true,
  });
}

/** The page's scope with every platform and every group: what the groups heat map and extremes are read over. */
const ALL_GROUPS_SCOPE = (page: OverviewScope): OverviewScope => ({ ...page, engines: null, topic: null });

/**
 * The topic data of every group on every platform, whatever the page's Group and Platform select say (the heat map
 * has a column for each platform, the group against all groups needs the groups and the platforms both). At the
 * default scope this is the strip's own read, so it adds no request. `subscribed` is the `live` of the card.
 */
export function useAllGroupsSummary(options?: SummaryReadOptions): TopicData {
  const { workspaceId, project, scope, enabledEngines } = useOverview();
  const input = useMemo(
    () => ({ project: { workspaceId, projectId: project.id }, scope: ALL_GROUPS_SCOPE(scope), enabledEngines }),
    [workspaceId, project.id, scope, enabledEngines],
  );
  const current = readSummary(input, options);
  return useTopicData(
    { current, previous: null, paired: true, settled: !waiting(current), subscribed: options?.subscribed ?? true },
    ALL_GROUPS_SCOPE,
  );
}

/**
 * The topic data of the window and, while the comparison is on and its window can be asked, of the window before,
 * with whether the two answer for the same scope (`paired`): a card shows a change only when `compared` is true.
 * A refetch of the same scope keeps both windows paired; a scope change never pairs the last scope's window.
 */
export function useTopicPeriods(options?: SummaryReadOptions): TopicData {
  const { current, previous, paired, settled } = useOverviewPeriods(options);
  return useTopicData({ current, previous, paired, settled, subscribed: options?.subscribed ?? true });
}
