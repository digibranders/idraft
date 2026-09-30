import 'server-only';

import { dehydrate, HydrationBoundary } from '@tanstack/react-query';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { meQuery } from './me-query';
import { getMe, membershipOf } from './server';
import { WorkspaceProviders } from './workspace-providers';
import { makeQueryClient } from '@/lib/api/query-client';
import { PATHNAME_HEADER, signInPath, workspacePath } from '@/lib/routes/paths';

/**
 * The root of every page of the workspace `slug` (the `[workspace]` layout). It reads `/me` on the server
 * and finds the caller's membership of that workspace. A session that has ended goes to sign in, told to
 * come back to the page it asked for. A workspace they are not a member of is a 404,
 * like one that does not exist, so a slug never confirms that another tenant's workspace is there
 * (19 section 2.2). The answer is handed to the client cache, so client components read `/me` without
 * asking again.
 */
export async function WorkspaceRoot({
  slug,
  children,
}: Readonly<{ slug: string; children: ReactNode }>): Promise<ReactNode> {
  const me = await getMe();
  // Back to the page asked for; sign-in checks it with safeNextPath before following it
  if (me === null) redirect(signInPath((await headers()).get(PATHNAME_HEADER) ?? workspacePath(slug)));
  const membership = membershipOf(me, slug);
  if (membership === null) notFound();
  const queryClient = makeQueryClient();
  queryClient.setQueryData(meQuery().queryKey, { data: me });
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <WorkspaceProviders membership={membership}>{children}</WorkspaceProviders>
    </HydrationBoundary>
  );
}
