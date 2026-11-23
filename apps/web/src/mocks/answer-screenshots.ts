import { onMockReset } from './state';
import type { LatestAnswer, ScreenshotState } from '@/lib/api/prompt-facts';

/**
 * The screenshots of AI answers, as the mocks keep them (backend `screenshots/service.py`, `api/ai/screenshots.py`): an
 * answer on a platform page engine can be captured within 6 days 20 hours of its time (the provider keeps a task 7
 * days from posting it), and a capture is stored for good. The captured ids live in the memory of the page or test
 * process, like the other prompt mocks, and a reload starts again from none.
 */

/** The engines whose answer is a platform page to photograph. */
export const SHOT_ENGINES: ReadonlySet<string> = new Set(['chatgpt_web', 'gemini_web', 'google_ai_mode']);
/** How long after an answer a capture is still possible. */
export const SHOT_WINDOW_MS = (6 * 24 + 20) * 3_600_000;

const STORED = new Set<string>();
onMockReset(() => STORED.clear());

const keyOf = (projectId: string, observationId: string): string => `${projectId}:${observationId}`;

export const isShotStored = (projectId: string, observationId: string): boolean =>
  STORED.has(keyOf(projectId, observationId));

export function storeShot(projectId: string, observationId: string): void {
  STORED.add(keyOf(projectId, observationId));
}

/** The API path of a stored screenshot. */
export const shotPathOf = (workspaceId: string, projectId: string, observationId: string): string =>
  `/api/v1/workspaces/${workspaceId}/projects/${projectId}/ai/observations/${observationId}/screenshot`;

/** What a screenshot of an answer can be: stored, still capturable, too late, or not for this engine. */
export function shotStateOf(code: string, stored: boolean, observedAt: number, now: number): ScreenshotState {
  if (stored) return 'available';
  if (!SHOT_ENGINES.has(code)) return 'unsupported';
  return now - observedAt <= SHOT_WINDOW_MS ? 'capturable' : 'expired';
}

/** The newest answer of an engine for a prompt row, with the state of its screenshot. */
export function latestOf(
  scope: { workspaceId: string; projectId: string; now: number },
  code: string,
  newest: Pick<LatestAnswer, 'observation_id' | 'observed_at'>,
): LatestAnswer {
  const stored = isShotStored(scope.projectId, newest.observation_id);
  return {
    observation_id: newest.observation_id,
    observed_at: newest.observed_at,
    screenshot_url: stored ? shotPathOf(scope.workspaceId, scope.projectId, newest.observation_id) : null,
    screenshot_state: shotStateOf(code, stored, Date.parse(newest.observed_at), scope.now),
  };
}

/** The picture a stored capture serves in the mocks: a sample page, not a real capture. */
export const sampleShot = (observationId: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400"><rect width="640" height="400" fill="lightgray"/><text x="320" y="204" font-family="sans-serif" font-size="18" text-anchor="middle" fill="dimgray">Sample screenshot of answer ${observationId}</text></svg>`;
