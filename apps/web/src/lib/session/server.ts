import 'server-only';

import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';

import { unwrap } from '@/lib/api/client';
import { isSignedOut } from '@/lib/api/query-client';
import { serverApi } from '@/lib/api/server';
import type { Me, MeMembership } from '@/lib/api/types';
import { PATHNAME_HEADER, signInPath, workspacePath } from '@/lib/routes/paths';

/**
 * `/me` for the request being rendered, or `null` when the session is gone (a stale cookie: the proxy only
 * checks that one is present). Once per request: the page and every layout above it share the answer. Any
 * other failure throws, for the route's error boundary.
 */
export const getMe = cache(async (): Promise<Me | null> => {
  const client = await serverApi();
  try {
    return (await unwrap(client.GET('/api/v1/me'))).data;
  } catch (error) {
    if (isSignedOut(error)) return null;
    throw error;
  }
});

/**
 * The memberships a person can open. `/me` still lists one whose workspace is being deleted, and every
 * route of such a workspace answers 404, so it is left out everywhere.
 */
export function openMemberships(me: Me): MeMembership[] {
  return me.memberships.filter((membership) => membership.workspace.status !== 'deleting');
}

/** The membership of the workspace with `slug`, or `null`: not a member, or a workspace being deleted. */
export function membershipOf(me: Me, slug: string): MeMembership | null {
  return openMemberships(me).find((membership) => membership.workspace.slug === slug) ?? null;
}

/**
 * The caller's membership of the workspace `slug`, for a layout or page of it: a session that has ended
 * goes to sign in, told to come back to the page asked for (the proxy hands every render its path); a
 * workspace the caller is not in is the 404 page, like one that does not exist (19 section 2.2). The
 * workspace layout, the project layout and the pages all ask, since Next.js renders them in parallel.
 */
export async function requireMembership(slug: string): Promise<{ me: Me; membership: MeMembership }> {
  const me = await getMe();
  if (me === null) redirect(signInPath((await headers()).get(PATHNAME_HEADER) ?? workspacePath(slug)));
  const membership = membershipOf(me, slug);
  if (membership === null) notFound();
  return { me, membership };
}
