import type { ReactNode } from 'react';

import type { PromptAnswers, PromptCounts } from '../inspector-reads';
import type { DateRange } from '../prompt-model';
import type { PromptScope } from '../prompt-queries';
import { placeAfter, type Translate } from './shared';
import type { ProjectEngine, Prompt } from '@/lib/api/types';

// Entries of later packages (MASTER-PLAN 3.4). A package uncomments its own import line and its own slot line and
// edits nothing else in this file; the "WP-NN" line above each stays as it is.

// WP-21 citations-core
import { citationsTab } from '../inspector/citations/citations-tab';

// WP-24 fanout-views
// import { fanoutTab } from '../inspector/fanout/fanout-tab';

/** What the inspector lends a tab: the prompt, its window, its engines and the reads the built-in tabs share. */
export interface PromptTabContext {
  scope: PromptScope;
  promptId: string;
  /** `null` while it loads, and for an id that is no prompt's. */
  prompt: Prompt | null;
  /** The id is a prompt's (well formed and not refused): a tab may read by it. */
  exists: boolean;
  range: DateRange;
  timeZone: string;
  /** The enabled engines, in order. */
  engines: readonly ProjectEngine[];
  /** An engine's label by its code, an engine turned off included. */
  labelOf: (engineCode: string) => string;
  counts: PromptCounts;
  /** The window's answers: read only while History or Competitors is shown. A tab that needs them reads its own. */
  answers: PromptAnswers;
  noCountsReason: string;
  onOpenAnswer: ((observationId: string, observedAt: string) => void) | undefined;
}

export interface PromptInspectorTab {
  /** The `?itab=` value. */
  id: string;
  label: (t: Translate) => string;
  /** Placed after this tab; last without one. */
  after?: string | undefined;
  /** Offered only while this holds (Fan-out); always without one. */
  available?: ((context: PromptTabContext) => boolean) | undefined;
  /** The panel's content: an element whose hooks run inside it. It calls no hook itself. */
  render: (context: PromptTabContext) => ReactNode;
}

export const PROMPT_TAB_ENTRIES: readonly PromptInspectorTab[] = [
  // WP-21 citations-core (after: 'history')
  citationsTab,
  // WP-24 fanout-views (after: 'competitors', available while an enabled engine exposes fan-out)
  // fanoutTab,
];

/** The tabs to show, in order: `builtIns` with `entries` placed, those not available to `context` left out. */
export function promptTabs(
  builtIns: readonly PromptInspectorTab[],
  entries: readonly PromptInspectorTab[],
  context: PromptTabContext,
): PromptInspectorTab[] {
  // Placed first and filtered after, so an entry placed after an unavailable entry still finds its anchor
  const placed = placeAfter(
    builtIns,
    entries.map((entry) => ({ after: entry.after, items: [entry] })),
    (tab) => tab.id,
  );
  return placed.filter((tab) => tab.available === undefined || tab.available(context));
}
