import 'server-only';

import type { Route } from 'next';

import { NAVIGATION, navHref, visibleNavigation } from '@/lib/navigation/registry';
import { getMe, membershipOf } from '@/lib/session/server';

/**
 * The first destination of the project that the member can open, in sidebar order, or `null` for none (a
 * membership that can open nothing, or none at all). The project layout has checked the project itself.
 */
export async function firstDestination(workspace: string, project: string): Promise<Route | null> {
  const me = await getMe();
  const membership = me === null ? null : membershipOf(me, workspace);
  if (membership === null) return null;
  const [first] = visibleNavigation(NAVIGATION, membership.permissions).flatMap((section) =>
    section.groups.flatMap((group) => group.items),
  );
  return first === undefined ? null : navHref(first, workspace, project);
}
