import { screen } from '@testing-library/react';
import { isValidElement, type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { meQuery } from '@/lib/session/me-query';
import { WorkspaceRoot } from './workspace-root';
import { useMembership } from '@/lib/permissions';
import { mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { TEST_API_ORIGIN } from '@/test/api-server';
import { renderWithProviders } from '@/test/render';

const session = vi.hoisted(() => ({ cookie: '' }));
// `/me` comes from the mocks, as the API would answer it for the session cookie
vi.mock('@/lib/api/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/server')>();
  return {
    ...actual,
    serverApi: () => Promise.resolve(actual.createServerApi(new Headers({ cookie: session.cookie }), TEST_API_ORIGIN)),
  };
});
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
    session.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('analyst').user_id}.0`;
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
    session.cookie = '';
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
