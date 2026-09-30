import { describe, expect, it } from 'vitest';

import { homeOutcome, membershipOf, openMemberships } from './server';
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

describe('what the home page does', () => {
  const member = meFactory(mockUser('editor'));
  const outsider = meFactory(mockUser('editor'), { memberships: [] });

  it('sends a session that has ended to sign in', () => {
    expect(homeOutcome(null, null)).toEqual({ kind: 'redirect', to: '/login' });
  });

  it('opens the first workspace of a member, ignoring an invitation value it does not know', () => {
    expect(homeOutcome(member, null)).toEqual({ kind: 'redirect', to: '/digibranders' });
    expect(homeOutcome(member, 'javascript:alert(1)')).toEqual({ kind: 'redirect', to: '/digibranders' });
  });

  it('stays to say why an invitation failed, with the way on to the workspace the person has', () => {
    expect(homeOutcome(member, 'expired')).toEqual({
      kind: 'screen',
      props: {
        email: mockUser('editor').email,
        invitation: 'expired',
        workspace: { name: 'Digibranders', slug: 'digibranders' },
      },
    });
  });

  it('says there is no workspace to someone in none', () => {
    expect(homeOutcome(outsider, null)).toEqual({
      kind: 'screen',
      props: { email: mockUser('editor').email, invitation: null, workspace: null },
    });
  });
});
