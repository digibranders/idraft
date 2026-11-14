import type { Route } from 'next';

import { formatInspectTarget } from '@/lib/inspector/placement';
import { runsPath, withQuery } from '@/lib/routes/paths';

/** The Runs page of the project with the run open in the inspector: `?inspect=run%3A<id>`. */
export function runInspectHref(workspaceSlug: string, projectSlug: string, runId: string): Route {
  const query = new URLSearchParams({ inspect: formatInspectTarget({ type: 'run', id: runId }) });
  return withQuery(runsPath(workspaceSlug, projectSlug), query.toString());
}
