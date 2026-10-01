'use client';

import type { ReactNode } from 'react';

import { InvitationsSection } from './invitations-section';
import { MembersScreen } from './members-screen';
import { Can } from '@/lib/permissions';

/** Members and roles: the members, and below them the invitations for whoever manages members. */
export function MembersPage(): ReactNode {
  return (
    <div className="flex flex-col gap-8">
      <MembersScreen />
      <Can permission="members:manage">
        <InvitationsSection />
      </Can>
    </div>
  );
}
