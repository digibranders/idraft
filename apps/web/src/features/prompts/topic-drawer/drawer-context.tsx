'use client';

import { parseAsString, useQueryState } from 'nuqs';
import { createContext, useContext, type ReactElement, type ReactNode } from 'react';

import { parseMetric, type DateRange, type RateMetric, type TopicDescendants } from '@/features/prompts/prompt-model';
import type { PromptScope } from '@/features/prompts/prompt-queries';
import type { TopicCounts } from '@/features/prompts/topic-inspector';
import type { ProjectEngine, PromptsSummary } from '@/lib/api/types';
import type { NamedTerm } from '@/lib/keywords/taxonomy-reads';

/**
 * What the topic drawer's parts need of the page beyond the summary: the scope of its reads, where its links go, the
 * trees, and the two actions of the screen (Add prompt opens the dialog on the topic, Run now asks first above one
 * prompt). The screen builds it once; a part that needs one of them reads it here and never takes it as a prop.
 */
export interface TopicDrawerExtras {
  scope: PromptScope;
  range: DateRange;
  includeBranded: boolean;
  country: string | null;
  workspaceSlug: string;
  projectSlug: string;
  /** The terms of the topic vocabularies, depth first. */
  tree: readonly NamedTerm[];
  /** The name of a market by its ISO code. */
  countryName: (iso: string) => string;
  /** Opens the add dialog with the topic chosen; `null` for a role that cannot write prompts. */
  onAddPrompt: ((termId: string) => void) | null;
  /** Runs the prompts now; `null` for a role that cannot trigger runs. `blockedReason` says why it is off. */
  run: { onRun: (promptIds: readonly string[]) => void; blockedReason: string | null } | null;
}

/** What every part of the drawer reads: the topic, the page's summary of the window, and the page. */
export interface TopicDrawerState {
  /** The term id, or `__none` for the prompts without a topic. */
  topicKey: string;
  summary: PromptsSummary | undefined;
  counts: TopicCounts;
  /** The engines the page shows, in order. */
  engines: readonly ProjectEngine[];
  descendants: TopicDescendants;
  extras: TopicDrawerExtras;
}

const Context = createContext<TopicDrawerState | null>(null);

export function TopicDrawerProvider({
  value,
  children,
}: {
  value: TopicDrawerState;
  children: ReactNode;
}): ReactElement {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** The drawer's state; a part drawn outside the drawer is a mistake of the code, so it throws and says which. */
export function useTopicDrawer(): TopicDrawerState {
  const value = useContext(Context);
  if (value === null) {
    throw new Error('useTopicDrawer was called outside a TopicDrawerProvider: draw the part inside the topic drawer.');
  }
  return value;
}

/**
 * The metric of the engine panel and the trend (`?metric=`, Mention when the address names none): the same key the
 * Topics tab's columns and the Prompts tab read, so one choice holds on the page and in the drawer.
 */
export function useDrawerMetric(): { metric: RateMetric; setMetric: (metric: RateMetric) => void } {
  const [text, setText] = useQueryState('metric', parseAsString);
  return {
    metric: parseMetric(text),
    setMetric: (next) => void setText(next === 'mention' ? null : next),
  };
}
