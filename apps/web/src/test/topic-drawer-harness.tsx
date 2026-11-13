import type { ReactElement } from 'react';

import {
  TopicDrawerProvider,
  type TopicDrawerExtras,
  type TopicDrawerState,
} from '@/features/prompts/topic-drawer/drawer-context';
import { projectEngine } from '@/features/prompts/topics-by-engine/cells-fixtures';
import type { TopicCounts } from '@/features/prompts/topic-inspector';
import type { PromptsSummary, TopicSummaryRow } from '@/lib/api/types';
import { MOCK_PROJECTS, MOCK_WORKSPACE } from '@/mocks/fixtures';
import { renderWithProviders, type ProvidedRender, type ProvidedRenderOptions } from '@/test/render';

/**
 * What the tests of the topic drawer's parts have in common: the drawer's context filled with the fixtures of the
 * mock project, so a test names only what it is about (`renderDrawerPart(<EnginePanel />, { summary })`).
 */

const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The Fynix project fixture is missing');

/** The topic every drawer test opens, a term id of the vocabulary. */
export const DRAWER_TOPIC_ID = '33333333-0000-4000-8000-000000000001';

/** The window the fixtures are read over. */
export const DRAWER_RANGE = { from: '2026-10-16', to: '2026-11-12' } as const;

export const drawerExtras = (over: Partial<TopicDrawerExtras> = {}): TopicDrawerExtras => ({
  scope: { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: fynix.project_id },
  range: DRAWER_RANGE,
  includeBranded: false,
  country: null,
  workspaceSlug: MOCK_WORKSPACE.slug,
  projectSlug: fynix.slug,
  tree: [],
  countryName: (iso) => iso,
  onAddPrompt: null,
  run: null,
  ...over,
});

export const READY_COUNTS: TopicCounts = { status: 'ready', errorId: null, retry: () => undefined, retrying: false };

/** A summary of `topics` (and `entities`), with the blocks the drawer's parts do not read left empty. */
export function summaryOf(
  topics: readonly TopicSummaryRow[],
  entities: PromptsSummary['entities'] = [],
): PromptsSummary {
  return {
    window: { ...DRAWER_RANGE, timezone: 'UTC' },
    include_branded: false,
    branded_only: false,
    engine_codes: ['chatgpt_web', 'gemini_web', 'google_ai_mode'],
    entities,
    entity_config_versions: [],
    metric_context: {} as PromptsSummary['metric_context'],
    topics: [...topics],
    prompts: [],
  };
}

export interface DrawerPartOptions extends ProvidedRenderOptions {
  topicKey?: string;
  summary?: PromptsSummary | undefined;
  counts?: TopicCounts;
  engines?: TopicDrawerState['engines'];
  descendants?: TopicDrawerState['descendants'];
  extras?: Partial<TopicDrawerExtras>;
}

/** Renders `ui` inside the drawer's context and the providers of a page. */
export function renderDrawerPart(
  ui: ReactElement,
  {
    topicKey = DRAWER_TOPIC_ID,
    summary,
    counts = READY_COUNTS,
    engines = [projectEngine('chatgpt_web'), projectEngine('gemini_web')],
    descendants = new Map(),
    extras,
    ...options
  }: DrawerPartOptions = {},
): ProvidedRender {
  const value: TopicDrawerState = {
    topicKey,
    summary,
    counts,
    engines,
    descendants,
    extras: drawerExtras(extras),
  };
  return renderWithProviders(<TopicDrawerProvider value={value}>{ui}</TopicDrawerProvider>, options);
}
