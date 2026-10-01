import { describe, expect, it } from 'vitest';

import { homeOutcome } from './server';
import { meFactory } from '@/mocks/factories/identity';
import { mockUser } from '@/mocks/fixtures';

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
        canCreateWorkspace: false,
      },
    });
  });

  it('says there is no workspace to someone in none', () => {
    expect(homeOutcome(outsider, null)).toEqual({
      kind: 'screen',
      props: { email: mockUser('editor').email, invitation: null, workspace: null, canCreateWorkspace: false },
    });
  });

  it('lets a platform operator in no workspace create one', () => {
    const operator = meFactory(mockUser('owner'), { memberships: [] });
    expect(homeOutcome(operator, null)).toMatchObject({ kind: 'screen', props: { canCreateWorkspace: true } });
  });
});
