import { screen, within } from '@testing-library/react';
import type { Route } from 'next';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectList, ProjectListSkeleton, type ListedProject } from './project-list';
import { emptyReasonFor, listedProjectsOf } from './server';
import { WorkspaceProjects } from './workspace-projects';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { TEST_API_ORIGIN } from '@/test/api-server';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

const session = vi.hoisted(() => ({ cookie: '' }));
vi.mock('@/lib/api/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/server')>();
  return {
    ...actual,
    serverApi: () => Promise.resolve(actual.createServerApi(new Headers({ cookie: session.cookie }), TEST_API_ORIGIN)),
  };
});
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  useRouter: () => router,
}));
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
const as = (role: 'analyst' | 'editor'): void => {
  session.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.0`;
};

const PROJECTS_ROUTE = '*/api/v1/workspaces/:workspaceId/projects';
const FAILED_REQUEST_ID = 'req_01J0000000000000000000FAIL';
// Summer time in Berlin: the abbreviation is the one of the day the page is shown
const SUMMER = new Date('2026-07-01T12:00:00Z');

const FYNIX: ListedProject = {
  id: 'p1',
  slug: 'fynix',
  name: 'Fynix',
  domain: 'fynix.digital',
  timeZone: 'Europe/Berlin',
  paused: false,
};

describe('the projects of a membership', () => {
  beforeEach(() => as('editor'));

  it('are all of them for a member with every project, by name', async () => {
    const projects = await listedProjectsOf(membershipFactory('editor'));
    const byName = [...MOCK_PROJECTS]
      .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))
      .map((project) => project.slug);
    expect(projects.map((project) => project.slug)).toEqual(byName);
  });

  it('are only the listed ones for a member limited to some projects', async () => {
    as('analyst');
    const limited = mockUser('analyst').project_ids ?? [];
    const projects = await listedProjectsOf(membershipFactory('analyst', { projectIds: limited }));
    expect(projects.map((project) => project.id).sort()).toEqual([...limited].sort());
  });

  it('follow the membership even when the API would list more', async () => {
    // The session sees every project; the membership rendered with the page lists one
    const [first] = MOCK_PROJECTS;
    if (first === undefined) throw new Error('The mocks have no project');
    const projects = await listedProjectsOf(membershipFactory('editor', { projectIds: [first.project_id] }));
    expect(projects.map((project) => project.id)).toEqual([first.project_id]);
  });

  it('say who can change an empty list', () => {
    expect(emptyReasonFor(membershipFactory('editor'))).toBe('creator');
    expect(emptyReasonFor(membershipFactory('viewer'))).toBe('viewer');
    expect(emptyReasonFor(membershipFactory('editor', { projectIds: [] }))).toBe('restricted');
  });
});

describe('ProjectList', () => {
  it('links each project by its name, with its domain and time zone, and has no accessibility violations', async () => {
    const { container } = renderWithProviders(
      <ProjectList
        workspace="digibranders"
        projects={[FYNIX, { ...FYNIX, id: 'p2', slug: 'new', name: 'New', domain: null, paused: true }]}
        emptyReason="creator"
        now={SUMMER}
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Projects' })).toBeInTheDocument();
    expect(screen.getByText('2 projects')).toBeInTheDocument();
    expect(screen.getByRole('list')).toBeInTheDocument();
    const fynix = screen.getByRole('link', { name: 'Fynix' });
    expect(fynix).toHaveAttribute('href', '/digibranders/fynix');
    expect(within(fynix).getByText('Times in GMT+2')).toBeInTheDocument();
    const paused = screen.getByRole('link', { name: 'New' });
    expect(within(paused).getByText('Paused')).toBeInTheDocument();
    expect(within(paused).getByText('No domain yet')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it.each([
    ['creator', 'Projects created in this workspace appear here.'],
    ['viewer', 'Owners, admins and editors can create projects.'],
    ['restricted', "Owners and admins can give you access to this workspace's projects."],
  ] as const)('says who can create a project when there is none (%s)', async (reason, text) => {
    const { container } = renderWithProviders(
      <ProjectList workspace="digibranders" projects={[]} emptyReason={reason} />,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'No projects yet' })).toBeInTheDocument();
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('offers New project to a member who may create one, in the header and in the empty state', () => {
    const { unmount } = renderWithProviders(
      <ProjectList
        workspace="digibranders"
        projects={[FYNIX]}
        emptyReason="creator"
        createHref={'/digibranders/onboarding' as Route}
      />,
    );
    expect(screen.getByRole('link', { name: 'New project' })).toHaveAttribute('href', '/digibranders/onboarding');
    unmount();
    renderWithProviders(
      <ProjectList
        workspace="digibranders"
        projects={[]}
        emptyReason="creator"
        createHref={'/digibranders/onboarding' as Route}
      />,
    );
    expect(screen.getByRole('link', { name: 'New project' })).toBeInTheDocument();
  });

  it('has no New project for anyone else', () => {
    renderWithProviders(<ProjectList workspace="digibranders" projects={[]} emptyReason="viewer" />);
    expect(screen.queryByRole('link', { name: 'New project' })).toBeNull();
  });

  it('keeps the header while it loads', () => {
    renderWithProviders(<ProjectListSkeleton />);
    expect(screen.getByRole('heading', { level: 1, name: 'Projects' })).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('WorkspaceProjects', () => {
  beforeEach(() => as('editor'));

  const render = async (): Promise<ReturnType<typeof renderWithProviders>> => {
    const membership = membershipFactory('editor');
    return renderWithProviders(<>{await WorkspaceProjects({ membership, projects: listedProjectsOf(membership) })}</>);
  };

  it('lists the projects once the API answers, with New project for an editor', async () => {
    await render();
    expect(screen.getAllByRole('link', { name: /^(?!New project$)/ })).toHaveLength(MOCK_PROJECTS.length);
    expect(screen.getByRole('link', { name: 'New project' })).toHaveAttribute('href', '/digibranders/onboarding');
  });

  it('says the list failed in its place, with Try again and the error id', async () => {
    server.use(
      http.get(PROJECTS_ROUTE, () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Internal error',
            status: 500,
            code: 'internal',
            request_id: FAILED_REQUEST_ID,
          },
          { status: 500, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    const { user } = await render();
    expect(screen.getByRole('heading', { level: 1, name: 'Projects' })).toBeInTheDocument();
    expect(screen.getByText('Could not load the projects')).toBeInTheDocument();
    expect(screen.getByText(`Error ID ${FAILED_REQUEST_ID}`)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(router.refresh).toHaveBeenCalledOnce();
  });

  it('sends a session that ended meanwhile to sign in, back to the workspace', async () => {
    session.cookie = '';
    await expect(render()).rejects.toThrow('REDIRECT /login?next=%2Fdigibranders');
  });
});
