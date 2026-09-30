import { screen } from '@testing-library/react';
import { isValidElement, type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { meQuery } from '@/lib/session/me-query';
import { WorkspaceRoot } from './workspace-root';
import { useMembership } from '@/lib/permissions';
import type { Me } from '@/lib/api/types';
import { meFactory } from '@/mocks/factories/identity';
import { mockUser } from '@/mocks/fixtures';
import { renderWithProviders } from '@/test/render';

const session = vi.hoisted(() => ({ me: null as Me | null }));
vi.mock('@/lib/session/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/session/server')>()),
  getMe: () => Promise.resolve(session.me),
}));
const navigation = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
}));
vi.mock('next/navigation', () => navigation);
const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock('next/headers', () => ({ headers: (): Promise<Headers> => Promise.resolve(request.headers) }));

function Role(): ReactElement {
  return <p>{useMembership().role}</p>;
}

describe('WorkspaceRoot', () => {
  beforeEach(() => {
    session.me = meFactory(mockUser('analyst'));
  });

  it('gives the pages below the caller membership of the workspace', async () => {
    const root = await WorkspaceRoot({ slug: 'digibranders', children: <Role /> });
    if (!isValidElement(root)) throw new Error('WorkspaceRoot rendered nothing');
    renderWithProviders(root);
    expect(screen.getByText('analyst')).toBeInTheDocument();
  });

  it('answers 404 for a workspace the caller is not in, as for one that does not exist', async () => {
    await expect(WorkspaceRoot({ slug: 'another-tenant', children: null })).rejects.toThrow('NOT_FOUND');
  });

  it('sends a caller whose session has ended to sign in, and back to the page asked for afterwards', async () => {
    session.me = null;
    request.headers = new Headers({ 'x-pathname': '/digibranders/fynix/settings/profile?tab=a' });
    await expect(WorkspaceRoot({ slug: 'digibranders', children: null })).rejects.toThrow(
      'REDIRECT /login?next=%2Fdigibranders%2Ffynix%2Fsettings%2Fprofile%3Ftab%3Da',
    );
    request.headers = new Headers();
    await expect(WorkspaceRoot({ slug: 'digibranders', children: null })).rejects.toThrow(
      'REDIRECT /login?next=%2Fdigibranders',
    );
  });

  it('hands /me to the client cache, so the page does not ask for it again', async () => {
    const root = await WorkspaceRoot({ slug: 'digibranders', children: null });
    if (!isValidElement<{ state: { queries: { queryKey: unknown }[] } }>(root)) throw new Error('no element');
    expect(root.props.state.queries.map((query) => query.queryKey)).toEqual([meQuery().queryKey]);
  });
});
