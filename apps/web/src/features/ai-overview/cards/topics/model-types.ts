import type { OverviewAggregates, OverviewScope } from '@/features/ai-overview';
import type { EngineCode, EngineSummary, PromptsSummary, PromptSummaryRow } from '@/lib/api/types';
import type { CellMetric } from '@/lib/rates/rate-model';

/**
 * The types and constants the topics cards share (WP-36 plan sections 2.1 and 2.2). Types only, plus three
 * constants: the code that fills `TopicData` is `use-topic-reads.ts`.
 */

/** The metric of a topic card, as the catalog option writes it. */
export type TopicMetric = 'mention' | 'citation' | 'share_of_voice';

/** The cell of an engine summary each metric reads. */
export const CELL_OF: Readonly<Record<TopicMetric, CellMetric>> = {
  mention: 'mentioned',
  citation: 'cited',
  share_of_voice: 'share_of_voice',
};

/** A topic is not ranked below this many prompts. */
export const MIN_PROMPTS_TO_RANK = 3;

/** The API pools a topic weekly point when fewer prompts than this answered that week (D-04). Words only. */
export const POOL_BELOW_PROMPTS = 10;

/** `idle`: no engine is asked, so nothing is read. */
export type Phase = 'idle' | 'loading' | 'ready' | 'refetching' | 'error';

export interface EngineInfo {
  code: EngineCode;
  label: string;
}

/** Topic id to the ids of the topics below it, from the vocabulary trees (the shape the Prompts page uses). */
export type TopicDescendants = ReadonlyMap<string, ReadonlySet<string>>;

/** A topic row as a node of a two level tree. */
export interface TopicNode {
  /** The term id, or `__none` for the prompts that have no topic. */
  key: string;
  termId: string | null;
  name: string;
  /** Names from the top level topic down to this one. */
  path: readonly string[];
  parentKey: string | null;
  level: 1 | 2;
  promptCount: number;
  engines: readonly EngineSummary[];
  /** The prompts of the topic and the topics below it; null while the tree does not hold the topic. */
  members: readonly PromptSummaryRow[] | null;
  lastValidAt: string | null;
  children: readonly TopicNode[];
}

export interface TopicData {
  phase: Phase;
  /** A refetch failed and the data is the last that was read. */
  stale: boolean;
  errorId: string | null;
  retry: () => void;
  /** Always true for `useTopicSummary`. */
  paired: boolean;
  settled: boolean;
  /** A previous window was read and is paired with the current one (`useTopicPeriods` only). */
  compared: boolean;
  scope: OverviewScope;
  /** Asked engines: enabled, inside `scope.engines`, in catalog order. */
  engines: readonly EngineInfo[];
  summary: PromptsSummary | undefined;
  /** Null when compare is off, unavailable, or not paired. */
  previous: PromptsSummary | null;
  /** The topic rows as a two level tree, narrowed to the subtree of `scope.topic`. */
  nodes: readonly TopicNode[];
  /** The previous window's nodes by key; null with no previous. */
  previousNodes: ReadonlyMap<string, TopicNode> | null;
  /** Empty when the rows were left out of the read (`promptsRead` false). */
  prompts: readonly PromptSummaryRow[];
  previousPrompts: readonly PromptSummaryRow[] | null;
  promptsRead: boolean;
  descendants: TopicDescendants;
  tree: { pending: boolean; failed: boolean };
  aggregates: OverviewAggregates | null;
  lastValidAt: string | null;
}
