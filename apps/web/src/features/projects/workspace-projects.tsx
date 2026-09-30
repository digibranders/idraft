import 'server-only';

import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { ProjectList, type ListedProject } from './project-list';
import { ProjectListError } from './project-list-error';
import { emptyReasonFor } from './server';
import { isApiProblem } from '@/lib/api/problem';
import { isSignedOut } from '@/lib/api/query-client';
import type { MeMembership } from '@/lib/api/types';
import { signInPath, workspacePath } from '@/lib/routes/paths';

export interface WorkspaceProjectsProps {
  membership: MeMembership;
  /** The list, already asked for by the page (which needs its first project too). */
  projects: Promise<ListedProject[]>;
}

/**
 * The project list of the workspace page, rendered inside Suspense so the shell shows at once. A failure
 * stays in the list's place with Try again, instead of replacing the page; a session that ended meanwhile
 * goes to sign in, like any page of the workspace.
 */
export async function WorkspaceProjects({ membership, projects }: WorkspaceProjectsProps): Promise<ReactNode> {
  const slug = membership.workspace.slug;
  let listed: ListedProject[];
  try {
    listed = await projects;
  } catch (error) {
    if (isSignedOut(error)) redirect(signInPath(workspacePath(slug)));
    // The error id is the API's request id, which the API's log has; anything else is logged here
    if (!isApiProblem(error)) console.error('The workspace project list could not be loaded', error);
    return <ProjectListError errorId={isApiProblem(error) ? error.requestId : null} />;
  }
  return <ProjectList workspace={slug} projects={listed} emptyReason={emptyReasonFor(membership)} />;
}
