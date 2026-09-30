'use client';

import { createContext, use, useMemo, type ReactNode } from 'react';

import { can, type Permission } from './permissions';
import type { MeMembership } from '@/lib/api/types';

const MembershipContext = createContext<MeMembership | null>(null);

/**
 * The caller's membership of the workspace being shown, from `/me` (the `[workspace]` layout). Everything
 * below reads permissions, role and project access from here.
 */
export function PermissionProvider({
  membership,
  children,
}: Readonly<{ membership: MeMembership; children: ReactNode }>): ReactNode {
  return <MembershipContext value={membership}>{children}</MembershipContext>;
}

/** The membership of the current workspace. Only inside `PermissionProvider`. */
export function useMembership(): MeMembership {
  const membership = use(MembershipContext);
  if (membership === null) throw new Error('useMembership is used outside a PermissionProvider');
  return membership;
}

/** Whether the caller holds `permission` in the current workspace. */
export function useCan(permission: Permission): boolean {
  const { permissions } = useMembership();
  return useMemo(() => can(permissions, permission), [permissions, permission]);
}

/**
 * Renders `children` only when the caller holds `permission`, else `fallback` (nothing by default): an
 * action the role can never perform is hidden, not disabled (20 section 3.9).
 */
export function Can({
  permission,
  fallback = null,
  children,
}: Readonly<{ permission: Permission; fallback?: ReactNode; children: ReactNode }>): ReactNode {
  return useCan(permission) ? children : fallback;
}
