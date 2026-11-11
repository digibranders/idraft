import { FIRST_MINTED } from './mock-ids';
import { DAY_MS, FIXTURE_ENGINES, FIXTURE_PROMPTS, type StoredEngine, type StoredPrompt } from './prompt-fixtures';
import { onMockReset } from './state';

/**
 * What the AI prompt mocks changed, per project, in the memory of the page (or of the test process). Like the
 * keyword import mock, and unlike ./operations-state.ts, it is not kept in a cookie: 150 prompts do not fit
 * in one, and no server component reads prompts.
 * shortcut: a page reload starts again from the fixtures; move it to a cookie if a server page ever reads prompts.
 */
export interface ProjectPrompts {
  engines: StoredEngine[];
  prompts: StoredPrompt[];
  /** When Run now last asked each prompt on each engine, by `prompt_id engine_code`: epoch milliseconds. */
  asked: Map<string, number>;
  /** The manual runs of Run now, by UTC day number. */
  manualRuns: Map<number, number>;
  /** The answers Run now asked for, by UTC month (`2026-11`): they count against the workspace's monthly limit. */
  answersAsked: Map<string, number>;
}

/** A Run now answer counts as on its way this long: the standard queue answers within minutes. */
export const PENDING_MS = 10 * 60_000;
/** The workspace's AI answers a month (`workspace_quotas.max_ai_observations_per_month`, 20,000 by default). */
export const AI_ANSWER_QUOTA = 20_000;

const STATE = new Map<string, ProjectPrompts>();
let minted = FIRST_MINTED - 1;
let providerPaused = false;

/** The project's AI prompt state, made from the fixtures on first use. */
export function promptsOf(projectId: string): ProjectPrompts {
  const found = STATE.get(projectId);
  if (found !== undefined) return found;
  const fresh: ProjectPrompts = {
    engines: (FIXTURE_ENGINES.get(projectId) ?? []).map((engine) => ({
      ...engine,
      location_ids: [...engine.location_ids],
    })),
    prompts: (FIXTURE_PROMPTS.get(projectId) ?? []).map((prompt) => ({ ...prompt, term_ids: [...prompt.term_ids] })),
    asked: new Map(),
    manualRuns: new Map(),
    answersAsked: new Map(),
  };
  STATE.set(projectId, fresh);
  return fresh;
}

/** Active prompts of these projects together: the workspace's use of its prompt quota. */
export const activePromptCount = (projectIds: readonly string[]): number =>
  projectIds.reduce((sum, id) => sum + promptsOf(id).prompts.filter((prompt) => prompt.is_active).length, 0);

/** The number of the next prompt made here; the fixtures stay below it. */
export function mintPromptNumber(): number {
  minted += 1;
  return minted;
}

/** The manual runs Run now has made in the project today (UTC); they count against the day's 20 with the others. */
export const runNowRunsToday = (projectId: string, now: number): number =>
  promptsOf(projectId).manualRuns.get(Math.floor(now / DAY_MS)) ?? 0;

/** Whether the data provider is refusing every request: Run now then answers `503 provider_paused`. */
export const isProviderPaused = (): boolean => providerPaused;

/** Puts the provider on pause or takes it off, for a test or a session that wants to see the pause. */
export function setProviderPaused(paused: boolean): void {
  providerPaused = paused;
}

onMockReset(() => {
  STATE.clear();
  minted = FIRST_MINTED - 1;
  providerPaused = false;
});
