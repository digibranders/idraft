import 'server-only';

import type { EmptyReason, ListedProject } from './project-list';
import type { MeMembership } from '@/lib/api/types';
import { can } from '@/lib/permissions/permissions';
import { projectsOfMembership } from '@/lib/projects/server';

/**
 * Who can change an empty list: a member limited to some projects asks for access; a member who may
 * create projects (`projects:write`, not limited to some) will create them; anyone else learns who can.
 */
export function emptyReasonFor(membership: MeMembership): EmptyReason {
  if (membership.project_ids !== null) return 'restricted';
  return can(membership.permissions, 'projects:write') ? 'creator' : 'viewer';
}

/**
 * The projects the member can open, as the workspace's list shows them: by name, ignoring case, then by
 * slug, so two projects with one name keep their order from one visit to the next.
 */
export async function listedProjectsOf(membership: MeMembership): Promise<ListedProject[]> {
  const projects = await projectsOfMembership(membership);
  return projects
    .map((project) => ({
      id: project.project_id,
      slug: project.slug,
      name: project.name,
      domain: project.primary_domain?.host ?? null,
      timeZone: project.timezone,
      paused: project.status === 'paused',
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.slug.localeCompare(b.slug));
}
