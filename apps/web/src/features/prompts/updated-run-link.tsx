'use client';

import type { Route } from 'next';
import type { ReactElement } from 'react';

import { UpdatedLink } from '@/components/app/status/updated-link';
import { useCan } from '@/lib/permissions';
import { useLatestFinishedAiRun, type AiRunsScope } from '@/lib/runs/ai-reads';
import { runInspectHref } from '@/lib/runs/run-link';

export interface UpdatedRunLinkProps {
  scope: AiRunsScope;
  workspaceSlug: string;
  projectSlug: string;
  /** "Updated 5m ago": what the page showed before, unchanged. */
  text: string;
}

/**
 * The Runs page with the newest AI run that finished with answers open (WP-30 decision D14), or `null`
 * without such a run and for a member who cannot read the data.
 */
export function useUpdatedRunHref(scope: AiRunsScope, workspaceSlug: string, projectSlug: string): Route | null {
  const canRead = useCan('data:read');
  const run = useLatestFinishedAiRun(scope, canRead);
  return run === null ? null : runInspectHref(workspaceSlug, projectSlug, run.run_id);
}

/**
 * The "Updated" text of Topics & Prompts as a link to that run. Without a run, or without the permission,
 * it is the same text and nothing else.
 */
export function UpdatedRunLink({ scope, workspaceSlug, projectSlug, text }: UpdatedRunLinkProps): ReactElement {
  return <UpdatedLink text={text} href={useUpdatedRunHref(scope, workspaceSlug, projectSlug)} />;
}
