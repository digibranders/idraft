'use client';

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
 * The "Updated" text of Topics & Prompts (WP-30 decision D14). For a member who can read the data, and when
 * the project has an AI run that finished with answers, it is a link to the Runs page with that run open.
 * Without such a run, or without the permission, it is the same text and nothing else.
 */
export function UpdatedRunLink({ scope, workspaceSlug, projectSlug, text }: UpdatedRunLinkProps): ReactElement {
  const canRead = useCan('data:read');
  const run = useLatestFinishedAiRun(scope, canRead);
  return (
    <UpdatedLink text={text} href={run === null ? null : runInspectHref(workspaceSlug, projectSlug, run.run_id)} />
  );
}
