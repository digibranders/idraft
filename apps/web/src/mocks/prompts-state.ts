import { FIRST_MINTED } from './mock-ids';
import { FIXTURE_ENGINES, FIXTURE_PROMPTS, type StoredEngine, type StoredPrompt } from './prompt-fixtures';
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
}

const STATE = new Map<string, ProjectPrompts>();
let minted = FIRST_MINTED - 1;

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

onMockReset(() => {
  STATE.clear();
  minted = FIRST_MINTED - 1;
});
