import { isValidElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { firstDestination } from './destinations';
import { ProjectRoot } from './project-root';
import type { Me } from '@/lib/api/types';
import { meFactory, membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { TEST_API_ORIGIN } from '@/test/api-server';

const state = vi.hoisted(() => ({ me: null as Me | null, cookie: '', path: null as string | null }));
vi.mock('@/lib/session/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/session/server')>()),
  getMe: () => Promise.resolve(state.me),
}));
vi.mock('@/lib/api/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/server')>();
  return {
    ...actual,
    serverApi: () => Promise.resolve(actual.createServerApi(new Headers({ cookie: state.cookie }), TEST_API_ORIGIN)),
  };
});
vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(new Headers(state.path === null ? {} : { 'x-pathname': state.path })),
  cookies: () => Promise.resolve({ get: () => undefined }),
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));

/** Signed in as `role`, limited to `projectIds` when given, as the API and `/me` both see it. */
function as(role: 'editor' | 'analyst' | 'billing'): void {
  const seed = mockUser(role);
  state.cookie = `${SESSION_COOKIE}=mock.active.${seed.user_id}.0`;
  state.me = meFactory(seed, { memberships: [membershipFactory(role, { projectIds: seed.project_ids })] });
}
const render = (project: string, workspace = 'digibranders'): Promise<unknown> =>
  ProjectRoot({ workspace, project, children: null });

describe('ProjectRoot', () => {
  beforeEach(() => {
    state.path = null;
    as('editor');
  });

  it('renders the shell for a project the member can open', async () => {
    const root = await render('fynix');
    expect(isValidElement<{ project: { slug: string } }>(root) && root.props.project.slug).toBe('fynix');
  });

  it('answers 404 for an unknown slug, and for another workspace', async () => {
    await expect(render('no-such-project')).rejects.toThrow('NOT_FOUND');
    await expect(render('fynix', 'another-tenant')).rejects.toThrow('NOT_FOUND');
  });

  it('answers 404 for a project outside the projects a limited member may open', async () => {
    as('analyst');
    const outside = MOCK_PROJECTS.find(
      (project) => !(mockUser('analyst').project_ids ?? []).includes(project.project_id),
    );
    if (!outside) throw new Error('every project is open to the analyst');
    await expect(render(outside.slug)).rejects.toThrow('NOT_FOUND');
    await expect(render('fynix')).resolves.toBeDefined();
  });

  it('sends an ended session to sign in, back to the page asked for', async () => {
    state.me = null;
    state.path = '/digibranders/fynix/settings/security';
    await expect(render('fynix')).rejects.toThrow('REDIRECT /login?next=%2Fdigibranders%2Ffynix%2Fsettings%2Fsecurity');
  });
});

describe('firstDestination', () => {
  it('is the first live destination the member can open, and none outside the workspace', async () => {
    as('editor');
    await expect(firstDestination('digibranders', 'fynix')).resolves.toBe('/digibranders/fynix/settings');
    await expect(firstDestination('another-tenant', 'fynix')).resolves.toBeNull();
    state.me = null;
    await expect(firstDestination('digibranders', 'fynix')).resolves.toBeNull();
  });
});
