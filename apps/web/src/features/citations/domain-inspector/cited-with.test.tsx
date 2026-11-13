import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { CitedWithSection, type CitedWithSectionProps } from './cited-with';
import type { CitedWith, SourceDomainDetailData, SourceScope } from '@/lib/citations/types';
import { MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { mswPath } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

const ENTITIES = mswPath('/api/v1/workspaces/{workspace_id}/projects/{project_id}/entities');
const SOURCE: SourceScope = { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: 'p-fynix' };

const ACME = '0b0e3d6a-0000-4000-8000-000000000001';
const BOLT = '0b0e3d6a-0000-4000-8000-000000000002';
const UNLISTED = '0b0e3d6a-0000-4000-8000-000000000003';

/** The entities read of the project: the two entities the project tracks. */
const serveEntities = (): void => {
  const entry = (id: string, name: string): unknown => ({ entity: { entity_id: id, canonical_name: name } });
  server.use(
    http.get(ENTITIES, () => HttpResponse.json({ data: [entry(ACME, 'Acme CRM'), entry(BOLT, 'Bolt Sales')] })),
  );
};

const dataOf = (citedWith: CitedWith[]): SourceDomainDetailData => ({
  registrable_domain: 'g2.com',
  rows: [],
  engines: [],
  top_pages: [],
  prompts: [],
  cited_with: citedWith,
});

function Section(props: Partial<CitedWithSectionProps> = {}): ReactElement {
  return (
    <CitedWithSection
      source={SOURCE}
      data={dataOf([
        { entity_id: ACME, observations: 120 },
        { entity_id: BOLT, observations: 45 },
      ])}
      answers={640}
      {...props}
    />
  );
}

const tooltip = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-slot="tooltip"]');

beforeEach(() => {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('viewer').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  serveEntities();
});

describe('the entities named when the domain is cited', () => {
  it('names each entity from the entities read, most named first, with the answers it is of', async () => {
    renderWithProviders(
      <Section
        data={dataOf([
          { entity_id: BOLT, observations: 45 },
          { entity_id: ACME, observations: 120 },
        ])}
      />,
    );
    expect(await screen.findByText('Acme CRM')).toBeInTheDocument();
    const items = screen.getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining('Acme CRM'),
      expect.stringContaining('Bolt Sales'),
    ]);
    expect(items[0]).toHaveTextContent('120 of 640 answers');
    expect(items[1]).toHaveTextContent('45 of 640 answers');
    expect(screen.getByRole('heading', { level: 3, name: 'Named when cited' })).toBeInTheDocument();
    expect(
      screen.getByText('The tracked entities named most often in the answers that cite this domain.'),
    ).toBeInTheDocument();
  });

  it('lists at most five entities, the most named, whatever the read holds', async () => {
    const many = Array.from({ length: 7 }, (_, index) => ({
      entity_id: `0b0e3d6a-0000-4000-8000-0000000001${String(index).padStart(2, '0')}`,
      observations: 10 + index,
    }));
    renderWithProviders(<Section data={dataOf(many)} />);
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(5));
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('16 of 640 answers');
    expect(screen.getAllByRole('listitem')[4]).toHaveTextContent('12 of 640 answers');
  });

  it('says n/a for a name that is not known, never a blank, and says why', async () => {
    const { user } = renderWithProviders(<Section data={dataOf([{ entity_id: UNLISTED, observations: 7 }])} />);
    const unknown = await screen.findByText('Name n/a');
    expect(screen.getByRole('listitem')).toHaveTextContent('7 of 640 answers');
    await user.hover(unknown);
    await waitFor(() => expect(tooltip()).toHaveTextContent('The name of this entity is not loaded yet.'));
  });

  it('says n/a for the names when the entities read fails, and still shows the counts', async () => {
    server.use(http.get(ENTITIES, () => HttpResponse.json({ title: 'down' }, { status: 500 })));
    renderWithProviders(<Section />);
    expect(await screen.findAllByText('Name n/a')).toHaveLength(2);
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('120 of 640 answers');
  });

  it('counts the answers that cite the domain as the whole', async () => {
    renderWithProviders(<Section />);
    const first = (await screen.findAllByRole('listitem'))[0];
    expect(first).toBeDefined();
    // The shape of a sample count: the part, then the whole it is counted in
    expect(within(first as HTMLElement).getByText(/^120 of 640/)).toBeInTheDocument();
  });

  it('gives the count alone when the answers that cite the domain are not known', async () => {
    renderWithProviders(<Section answers={null} />);
    const first = (await screen.findAllByRole('listitem'))[0];
    expect(first).toHaveTextContent('named in 120 answers');
    expect(first).not.toHaveTextContent(' of ');
  });

  it('says none named in words when no entity is named', async () => {
    renderWithProviders(<Section data={dataOf([])} />);
    expect(await screen.findByText('None named')).toBeInTheDocument();
    expect(screen.getByText('No answer that cites this domain names a tracked entity.')).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).toBeNull();
  });

  it('shows a skeleton while the domain has not been read', () => {
    renderWithProviders(<Section data={null} />);
    expect(screen.getByRole('heading', { level: 3, name: 'Named when cited' }).closest('section')).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(screen.queryByText('None named')).toBeNull();
  });

  it('shows a skeleton while the entities load, not names that are not known yet', async () => {
    server.use(http.get(ENTITIES, () => new Promise<never>(() => undefined)));
    renderWithProviders(<Section />);
    expect(screen.getByRole('heading', { level: 3, name: 'Named when cited' }).closest('section')).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(screen.queryByText('Name n/a')).toBeNull();
  });

  it('has no accessibility violations', async () => {
    const { container } = renderWithProviders(<Section />);
    await screen.findByText('Acme CRM');
    expect(await axe(container)).toHaveNoViolations();
  });
});
