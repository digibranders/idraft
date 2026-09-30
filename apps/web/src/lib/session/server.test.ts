import { describe, expect, it } from 'vitest';

import { membershipOf, openMemberships } from './server';
import { meFactory, membershipFactory, workspaceFactory } from '@/mocks/factories/identity';
import { mockUser } from '@/mocks/fixtures';

const acme = workspaceFactory({ workspace_id: '0192d1a8-0000-7000-8000-00000000acme', name: 'Acme', slug: 'acme' });
const leaving = workspaceFactory({
  workspace_id: '0192d1a8-0000-7000-8000-0000000000de',
  name: 'Old agency',
  slug: 'old-agency',
  status: 'deleting',
});

describe('the memberships a person can open', () => {
  const me = meFactory(mockUser('editor'), {
    memberships: [
      membershipFactory('viewer', { workspace: leaving }),
      membershipFactory('editor'),
      membershipFactory('admin', { workspace: acme }),
    ],
  });

  it('leaves out a workspace that is being deleted, whose routes all answer 404', () => {
    expect(openMemberships(me).map((membership) => membership.workspace.slug)).toEqual(['digibranders', 'acme']);
  });

  it('finds the membership of a slug, and none for a slug the person is not in or that is going', () => {
    expect(membershipOf(me, 'acme')?.role).toBe('admin');
    expect(membershipOf(me, 'old-agency')).toBeNull();
    expect(membershipOf(me, 'someone-else')).toBeNull();
  });
});
