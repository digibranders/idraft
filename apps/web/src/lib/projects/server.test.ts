import { describe, expect, it, vi } from 'vitest';

import { projectsOfMembership, projectsWithArchivedOfMembership } from './server';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { server } from '@/test/msw';

const incoming = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock('next/headers', () => ({ headers: (): Promise<Headers> => Promise.resolve(incoming.headers) }));
vi.mock('@/lib/env/server', () => ({ serverEnv: () => ({ API_INTERNAL_ORIGIN: 'http://api.test' }) }));

/** The query strings of the project list the calls ask for. */
async function asked(read: () => Promise<unknown>): Promise<URLSearchParams[]> {
  const queries: URLSearchParams[] = [];
  const record = ({ request }: { request: Request }): void => {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/projects')) queries.push(url.searchParams);
  };
  server.events.on('request:start', record);
  incoming.headers = new Headers({
    cookie: `${SESSION_COOKIE}=mock.active.${mockUser('admin').user_id}.${String(Date.now() + 600_000)}`,
  });
  try {
    await read();
  } finally {
    server.events.removeListener('request:start', record);
  }
  return queries;
}

describe('the projects of a membership', () => {
  it('lists the active and paused ones, which is what the API gives without a filter', async () => {
    const [query] = await asked(() => projectsOfMembership(membershipFactory('admin')));
    expect(query?.has('filter[status_in]')).toBe(false);
  });

  it('can list the archived ones too, for the pages that show what archived projects spent', async () => {
    const [query] = await asked(() => projectsWithArchivedOfMembership(membershipFactory('admin')));
    expect(query?.get('filter[status_in]')).toBe('active,paused,archived');
  });

  it('leaves out a project the member cannot open, archived or not', async () => {
    const [first, second] = MOCK_PROJECTS;
    if (first === undefined || second === undefined) throw new Error('The fixtures have no two projects');
    incoming.headers = new Headers({
      cookie: `${SESSION_COOKIE}=mock.active.${mockUser('admin').user_id}.${String(Date.now() + 600_000)}`,
    });
    const projects = await projectsWithArchivedOfMembership(
      membershipFactory('admin', { projectIds: [second.project_id] }),
    );
    expect(projects.map((project) => project.project_id)).toEqual([second.project_id]);
  });
});
