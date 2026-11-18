import type { Route } from 'next';

import { drillHref } from '../drilldown/drill-links';
import type { OverviewScope } from '../scope/scope-model';
import { promptInspectHref } from '@/lib/inspector/inspect-href';
import { projectPath } from '@/lib/routes/paths';

/** The path of the Prompts page in a project (`/ai/prompts`), where the prompt inspector lives. */
const PROMPTS_PATH = '/ai/prompts';

/**
 * Where a prompt of the drawer's list opens: the prompt inspector over the Prompts page. The link carries the Overview
 * scope (platform, period, group) when the Prompts page can express it, so the numbers there are the ones of the card;
 * a scope it cannot express (a custom Branded choice, a window over its limit) opens the prompt with the page's own scope.
 */
export function promptHref(
  scope: OverviewScope,
  project: { workspace: string; project: string },
  promptId: string,
): Route {
  return (
    drillHref('prompt', scope, { promptId }, project) ??
    promptInspectHref(projectPath(project.workspace, project.project, PROMPTS_PATH), promptId)
  );
}
