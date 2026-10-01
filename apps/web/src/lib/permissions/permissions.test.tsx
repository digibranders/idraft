import { render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import {
  Can,
  can,
  canCreateProjects,
  canOpenProject,
  PermissionProvider,
  useCan,
  useMembership,
  type Permission,
} from '.';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS } from '@/mocks/fixtures';
import type { Role } from '@/lib/api/types';

/** What each role may do, for a sample of the permissions that decide what the screens offer. */
const EXPECTED: Readonly<Record<Role, readonly Permission[]>> = {
  owner: [
    'workspace:delete',
    'members:manage',
    'keywords:write',
    'runs:trigger',
    'data:read',
    'costs:read',
    'budgets:manage',
  ],
  admin: ['members:manage', 'keywords:write', 'runs:trigger', 'data:read', 'costs:read', 'budgets:manage'],
  editor: ['keywords:write', 'runs:trigger', 'data:read', 'costs:read'],
  analyst: ['runs:trigger', 'data:read', 'costs:read'],
  viewer: ['data:read'],
  billing: ['costs:read', 'budgets:manage'],
};
const SAMPLE: readonly Permission[] = [
  'workspace:delete',
  'members:manage',
  'keywords:write',
  'runs:trigger',
  'data:read',
  'costs:read',
  'budgets:manage',
];

describe('can', () => {
  it.each(Object.entries(EXPECTED) as [Role, readonly Permission[]][])(
    'gives a %s exactly its permissions',
    (role, allowed) => {
      const { permissions } = membershipFactory(role);
      for (const permission of SAMPLE) {
        expect(can(permissions, permission), `${role} ${permission}`).toBe(allowed.includes(permission));
      }
    },
  );
});

describe('canOpenProject', () => {
  const [fynix, cleanstart] = MOCK_PROJECTS;

  it('opens every project for a membership without a limit', () => {
    expect(canOpenProject(null, fynix?.project_id ?? '')).toBe(true);
  });

  it('opens only the listed projects for a limited membership, and none for an empty list', () => {
    const limited = [fynix?.project_id ?? ''];
    expect(canOpenProject(limited, fynix?.project_id ?? '')).toBe(true);
    expect(canOpenProject(limited, cleanstart?.project_id ?? '')).toBe(false);
    expect(canOpenProject([], fynix?.project_id ?? '')).toBe(false);
  });
});

describe('canCreateProjects', () => {
  it('lets a role with projects:write create projects only while it sees every project', () => {
    expect(canCreateProjects(membershipFactory('editor'))).toBe(true);
    expect(canCreateProjects({ ...membershipFactory('editor'), project_ids: [] })).toBe(false);
    expect(canCreateProjects(membershipFactory('analyst'))).toBe(false);
  });
});

function providedAs(role: Role): (props: { children: ReactNode }) => ReactNode {
  return function Provided({ children }: { children: ReactNode }): ReactNode {
    return <PermissionProvider membership={membershipFactory(role)}>{children}</PermissionProvider>;
  };
}

describe('the permission context', () => {
  it('answers useCan from the membership it provides', () => {
    expect(renderHook(() => useCan('keywords:write'), { wrapper: providedAs('editor') }).result.current).toBe(true);
    expect(renderHook(() => useCan('keywords:write'), { wrapper: providedAs('viewer') }).result.current).toBe(false);
  });

  it('gives the membership to useMembership', () => {
    const { result } = renderHook(() => useMembership(), { wrapper: providedAs('analyst') });
    expect(result.current.role).toBe('analyst');
  });

  it('refuses useMembership outside a provider', () => {
    expect(() => renderHook(() => useMembership())).toThrow(/outside a PermissionProvider/);
  });

  it('renders Can children for a holder and the fallback for anyone else', () => {
    const action = (
      <Can permission="keywords:write" fallback={<span>read only</span>}>
        <button type="button">Add keyword</button>
      </Can>
    );
    const { unmount } = render(action, { wrapper: providedAs('editor') });
    expect(screen.getByRole('button', { name: 'Add keyword' })).toBeInTheDocument();
    unmount();
    render(action, { wrapper: providedAs('viewer') });
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('read only')).toBeInTheDocument();
  });

  it('renders nothing by default when the permission is missing', () => {
    const { container } = render(
      <Can permission="members:manage">
        <button type="button">Invite</button>
      </Can>,
      { wrapper: providedAs('viewer') },
    );
    expect(container).toBeEmptyDOMElement();
  });
});
