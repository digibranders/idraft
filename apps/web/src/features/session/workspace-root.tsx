import 'server-only';

import { dehydrate, HydrationBoundary } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { WorkspaceProviders } from './workspace-providers';
import { makeQueryClient } from '@/lib/api/query-client';
import { meQuery } from '@/lib/session/me-query';
import { requireMembership } from '@/lib/session/server';

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
  const { me, membership } = await requireMembership(slug);
  const queryClient = makeQueryClient();
  queryClient.setQueryData(meQuery().queryKey, { data: me });
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <WorkspaceProviders membership={membership}>{children}</WorkspaceProviders>
    </HydrationBoundary>
  );
}
