import type { ReactNode } from 'react';

import type { TopicDescendants } from '../prompt-model';
import type { TopicCounts } from '../topic-inspector';
import { placeAfter, type Translate } from './shared';
import type { ProjectEngine, PromptsSummary } from '@/lib/api/types';

// Entries of later packages (MASTER-PLAN 3.4). A package uncomments its own import line and its own slot line and
// edits nothing else in this file; the "WP-NN" line above each stays as it is.

// WP-20 topics-by-engine
// import { topicCompetitorsTab } from '../inspector/topic/topic-competitors-tab';
// import { topicRelatedTab } from '../inspector/topic/topic-related-tab';

/** What the topic drawer lends a tab. */
export interface TopicTabContext {
  /** The term id, or `NO_TOPIC` for the prompts without one. */
  topicKey: string;
  summary: PromptsSummary | undefined;
  counts: TopicCounts;
  /** The engines the page shows, in order. */
  engines: readonly ProjectEngine[];
  descendants: TopicDescendants;
  onOpenPrompt: (promptId: string) => void;
}

export interface TopicInspectorTab {
  /** The `?itab=` value. */
  id: string;
  label: (t: Translate) => string;
  /** Placed after this tab; last without one. */
  after?: string | undefined;
  /** Offered only while this holds; always without one. */
  available?: ((context: TopicTabContext) => boolean) | undefined;
  /** The panel's content: an element whose hooks run inside it. It calls no hook itself. */
  render: (context: TopicTabContext) => ReactNode;
}

export const TOPIC_TAB_ENTRIES: readonly TopicInspectorTab[] = [
  // WP-20 topics-by-engine (the end; WP-23 fills the competitors content inside this tab)
  // topicCompetitorsTab,
  // WP-20 topics-by-engine (the end)
  // topicRelatedTab,
];

/** The tabs to show, in order: `builtIns` with `entries` placed, those not available to `context` left out. */
export function topicTabs(
  builtIns: readonly TopicInspectorTab[],
  entries: readonly TopicInspectorTab[],
  context: TopicTabContext,
): TopicInspectorTab[] {
  // Placed first and filtered after, so an entry placed after an unavailable entry still finds its anchor
  const placed = placeAfter(
    builtIns,
    entries.map((entry) => ({ after: entry.after, items: [entry] })),
    (tab) => tab.id,
  );
  return placed.filter((tab) => tab.available === undefined || tab.available(context));
}
