import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { BrandsCell } from './brands-cell';
import { chatgptRow, PROJECT, platformName, TRACKED } from '@/test/prompt-lists-fixtures';
import { brandsOf, type FactsRow, type TrackedEntity } from '../facts';
import { cellOf, engine, entityCells, rowOf } from '../facts/test-helpers';
import { aiKey } from '../prompt-queries';
import type { Role } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { mswPath } from '@/mocks/respond';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

const WORKSPACE_ENTITIES = '/api/v1/workspaces/{workspace_id}/entities';
const PROJECT_ENTITIES = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/entities';

function Cell({
  rows,
  scope = ['chatgpt_web'],
  entities = TRACKED,
  memberRole = 'editor',
}: {
  rows: readonly FactsRow[];
  scope?: readonly string[];
  entities?: readonly TrackedEntity[];
  memberRole?: Role;
}) {
  return (
    <PermissionProvider membership={membershipFactory(memberRole)}>
      <BrandsCell
        reading={brandsOf(rows, scope, entities)}
        rows={rows}
        entities={entities}
        label="This prompt"
        project={PROJECT}
        platformName={platformName}
      />
    </PermissionProvider>
  );
}

/** The routes Add as competitor calls; each test says what they answer. */
function routes(over: { create?: () => Response; detach?: () => Response } = {}): {
  calls: string[];
  bodies: unknown[];
} {
  const calls: string[] = [];
  const bodies: unknown[] = [];
  server.use(
    http.get(mswPath(PROJECT_ENTITIES), () =>
      HttpResponse.json({ data: [{ entity: { entity_id: 'own' }, role: 'own', color_index: 1 }] }),
    ),
    http.post(mswPath(WORKSPACE_ENTITIES), async ({ request }) => {
      calls.push('create');
      bodies.push(await request.json());
      return over.create?.() ?? HttpResponse.json({ data: { entity_id: 'new-entity' } }, { status: 201 });
    }),
    http.post(mswPath(PROJECT_ENTITIES), async ({ request }) => {
      calls.push('attach');
      bodies.push(await request.json());
      return HttpResponse.json({ data: {} }, { status: 201 });
    }),
    http.delete(mswPath(`${PROJECT_ENTITIES}/{entity_id}`), () => {
      calls.push('detach');
      return over.detach?.() ?? new HttpResponse(null, { status: 204 });
    }),
  );
  return { calls, bodies };
}

const opener = (): HTMLElement =>
  screen.getByRole('button', { name: /^Brands mentioned in the answers for This prompt/ });

describe('the Brands cell', () => {
  it('shows the own brand mark, the first three names and the count of the others', () => {
    renderWithProviders(<Cell rows={[chatgptRow()]} />);
    expect(screen.getByRole('img', { name: 'Your brand is mentioned in these answers' })).toBeInTheDocument();
    expect(opener()).toHaveAccessibleName('Brands mentioned in the answers for This prompt: 3 brands. Open the list');
    expect(opener()).toHaveTextContent('Northwind, HubSpot, Copper');
    expect(opener()).toHaveAttribute('aria-haspopup', 'dialog');
  });

  it('counts the brands past the third as +N', () => {
    const many = chatgptRow({
      other_brands: ['Copper', 'Close', 'Keap'].map((name, index) => ({ name, mentioned: cellOf(3 - index, 12) })),
    });
    renderWithProviders(<Cell rows={[many]} />);
    expect(opener()).toHaveTextContent('+2');
  });

  it('shows a grey dash when the own brand is in none of the answers', () => {
    const without = chatgptRow({ entities: [entityCells('own', cellOf(0, 12)), entityCells('rival', cellOf(4, 12))] });
    renderWithProviders(<Cell rows={[without]} />);
    expect(screen.getByRole('img', { name: 'Your brand is not mentioned in these answers' })).toBeInTheDocument();
  });

  it('keeps a competitor just added in the list when it is opened again: 0% with its counts, never hidden', async () => {
    // The summary has read the new competitor's cell: 0 of the 12 answers name it
    const tracked: TrackedEntity[] = [...TRACKED, { entity_id: 'added', name: 'Pipedrive', role: 'competitor' }];
    const row = chatgptRow({
      entities: [
        entityCells('own', cellOf(6, 12)),
        entityCells('rival', cellOf(4, 12)),
        entityCells('added', cellOf(0, 12)),
      ],
    });
    const { user } = renderWithProviders(<Cell rows={[row]} entities={tracked} />);
    await user.click(opener());
    const dialog = await screen.findByRole('dialog', { name: 'Brands mentioned in answers' });
    const added = within(dialog)
      .getAllByRole('listitem')
      .find((item) => item.textContent.includes('Pipedrive'));
    expect(added).toHaveTextContent(/^4Pipedrive0%0 of 12$/);
    expect(within(dialog).queryByRole('button', { name: /^Add Pipedrive/ })).not.toBeInTheDocument();
  });

  it('shows n/a for a tracked competitor the summary holds no cell for yet', async () => {
    const tracked: TrackedEntity[] = [...TRACKED, { entity_id: 'added', name: 'Pipedrive', role: 'competitor' }];
    const { user } = renderWithProviders(<Cell rows={[chatgptRow()]} entities={tracked} />);
    await user.click(opener());
    const dialog = await screen.findByRole('dialog', { name: 'Brands mentioned in answers' });
    const added = within(dialog)
      .getAllByRole('listitem')
      .find((item) => item.textContent.includes('Pipedrive'));
    expect(added).toHaveTextContent(/Pipedrive.*n\/a/);
    expect(added).not.toHaveTextContent('0%');
  });

  it('renders nothing for a reading without a list: the column words it', () => {
    renderWithProviders(<Cell rows={[rowOf(engine('chatgpt_web', { valid: 2 }))]} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('opens a dialog named by its title, with the places, the shares and the counts of one prompt on one platform', async () => {
    const { user } = renderWithProviders(<Cell rows={[chatgptRow()]} />);
    await user.click(opener());
    const dialog = await screen.findByRole('dialog', { name: 'Brands mentioned in answers' });
    expect(opener()).toHaveAttribute('aria-expanded', 'true');
    expect(within(dialog).getByText('This prompt · ChatGPT only · 12 answers')).toBeInTheDocument();
    const rows = within(dialog).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent(/^1NorthwindYou50%6 of 12$/);
    expect(rows[1]).toHaveTextContent(/^2HubSpot33%4 of 12$/);
    expect(rows[2]).toHaveTextContent(/^3CopperNot a competitor.*Add.*17%2 of 12$/);
    // One prompt on one platform has no row tooltip: the counts are in the row
    expect(rows[1]).not.toHaveAccessibleDescription();
    expect(
      within(dialog).getByText(/The share of answers that mention each brand\. A brand marked Not a competitor/),
    ).toBeInTheDocument();
  });

  it('says the rates are an equal-weight average over several platforms', async () => {
    const both = rowOf(
      engine('chatgpt_web', { valid: 12, entities: [entityCells('own', cellOf(6, 12))], other_brands: [] }),
      engine('gemini_web', { valid: 8, entities: [entityCells('own', cellOf(2, 8))], other_brands: [] }),
    );
    const { user } = renderWithProviders(<Cell rows={[both]} scope={['chatgpt_web', 'gemini_web']} />);
    await user.click(opener());
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText('This prompt · Equal-weight average of ChatGPT, Gemini · 20 answers'),
    ).toBeInTheDocument();
    // One prompt on several platforms: each platform's counts are in the row's tooltip, not beside the rate
    expect(within(dialog).queryByText('6 of 12')).not.toBeInTheDocument();
    expect(within(dialog).getAllByRole('listitem')[0]).toHaveAccessibleDescription(
      'ChatGPT 6 of 12 answers, Gemini 2 of 8 answers',
    );
  });

  it('pins the own brand under the list with its true place when it ranks below the ten shown', async () => {
    const crowd = Array.from({ length: 11 }, (_, index) => ({
      name: `Brand ${String(index + 1).padStart(2, '0')}`,
      mentioned: cellOf(12 - index, 12),
    }));
    const row = chatgptRow({
      entities: [entityCells('own', cellOf(1, 12)), entityCells('rival', cellOf(0, 12))],
      other_brands: crowd,
    });
    const { user } = renderWithProviders(<Cell rows={[row]} />);
    await user.click(opener());
    const dialog = await screen.findByRole('dialog');
    const lists = within(dialog).getAllByRole('list');
    // The ten most named, and HubSpot below them at 0%: a competitor the project follows is never cut off
    const shown = within(lists[0] as HTMLElement).getAllByRole('listitem');
    expect(shown).toHaveLength(11);
    expect(shown[10]).toHaveTextContent(/HubSpot0%/);
    const pinned = within(lists[1] as HTMLElement).getByRole('listitem');
    expect(pinned).toHaveTextContent(/^12Northwind/);
    expect(pinned).toHaveTextContent('8%');
  });

  it('closes with Escape and returns focus to the cell button', async () => {
    const { user } = renderWithProviders(<Cell rows={[chatgptRow()]} />);
    await user.click(opener());
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(opener()).toHaveFocus();
  });

  it('keeps Add reachable by keyboard: Tab from the panel reaches the Add button', async () => {
    const { user } = renderWithProviders(<Cell rows={[chatgptRow()]} />);
    opener().focus();
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog).toHaveFocus());
    await user.tab();
    expect(screen.getByRole('button', { name: 'Add Copper to your competitors' })).toHaveFocus();
  });

  it('has no accessibility violations with the list open', async () => {
    const { user, container } = renderWithProviders(<Cell rows={[chatgptRow()]} />);
    await user.click(opener());
    await screen.findByRole('dialog');
    expect(await axe(document.body)).toHaveNoViolations();
    expect(container).toBeTruthy();
  });
});

describe('Add as competitor', () => {
  it('flips the row at once, creates the brand and gives it the competitor role in AI, and offers Undo', async () => {
    const { calls, bodies } = routes();
    const { user } = renderWithProviders(<Cell rows={[chatgptRow()]} />);
    await user.click(opener());
    await user.click(await screen.findByRole('button', { name: 'Add Copper to your competitors' }));
    // The tag and the button are gone and the row says Added
    const dialog = screen.getByRole('dialog', { name: 'Brands mentioned in answers' });
    expect(within(dialog).getByText('Added')).toBeInTheDocument();
    expect(within(dialog).queryByText('Not a competitor')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /^Add Copper/ })).not.toBeInTheDocument();
    expect(await screen.findByText('Copper added to your competitors')).toBeInTheDocument();
    expect(
      screen.getByText('It counts in share of voice and the Lost to competitor card from the next run.'),
    ).toBeInTheDocument();
    expect(calls).toEqual(['create', 'attach']);
    // The name goes in as an alias too (decision 17), as the backend request says
    expect(bodies[0]).toMatchObject({
      entity_type: 'brand',
      canonical_name: 'Copper',
      aliases: [{ alias: 'Copper', match_mode: 'word_boundary', case_sensitive: false }],
    });
    // Color 2: the own brand holds 1 and no competitor holds a color
    expect(bodies[1]).toMatchObject({
      entity_id: 'new-entity',
      role: 'competitor',
      track_ai: true,
      track_seo: false,
      color_index: 2,
    });
  });

  it('keeps the row in the open list and reads the summary again only when the list closes', async () => {
    routes();
    const { user, queryClient } = renderWithProviders(<Cell rows={[chatgptRow()]} />);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    await user.click(opener());
    await user.click(await screen.findByRole('button', { name: 'Add Copper to your competitors' }));
    await screen.findByText('Copper added to your competitors');
    expect(invalidate).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: aiKey(PROJECT) }));
  });

  it('Undo takes the role off again and, the list being closed by the click outside it, reads the summary again at once', async () => {
    const { calls } = routes();
    const { user, queryClient } = renderWithProviders(<Cell rows={[chatgptRow()]} />);
    await user.click(opener());
    await user.click(await screen.findByRole('button', { name: 'Add Copper to your competitors' }));
    const undo = await screen.findByRole('button', { name: 'Undo' });
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Brands mentioned in answers' })).not.toBeInTheDocument(),
    );
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    await user.click(undo);
    await waitFor(() => expect(calls).toContain('detach'));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: aiKey(PROJECT) }));
  });

  it('uses the brand the workspace already has when the name is taken', async () => {
    const { calls, bodies } = routes({
      create: () => HttpResponse.json({ code: 'duplicate', title: 'The name is taken' }, { status: 409 }),
    });
    server.use(
      http.get(mswPath(WORKSPACE_ENTITIES), () =>
        HttpResponse.json({
          data: [{ entity_id: 'existing', entity_type: 'brand', canonical_name: 'copper' }],
          page: { has_more: false, limit: 50, next_cursor: null, total: 1 },
        }),
      ),
    );
    const { user } = renderWithProviders(<Cell rows={[chatgptRow()]} />);
    await user.click(opener());
    await user.click(await screen.findByRole('button', { name: 'Add Copper to your competitors' }));
    await screen.findByText('Copper added to your competitors');
    expect(calls).toEqual(['create', 'attach']);
    expect(bodies[1]).toMatchObject({ entity_id: 'existing' });
  });

  it('takes the row back and says so when the competitor cannot be added', async () => {
    routes({ create: () => HttpResponse.json({ code: 'internal_error', title: 'Failed' }, { status: 500 }) });
    const { user } = renderWithProviders(<Cell rows={[chatgptRow()]} />);
    await user.click(opener());
    await user.click(await screen.findByRole('button', { name: 'Add Copper to your competitors' }));
    expect((await screen.findAllByText('Copper could not be added to your competitors')).length).toBeGreaterThan(0);
    expect(await screen.findByRole('button', { name: 'Add Copper to your competitors' })).toBeInTheDocument();
  });

  it('turns Add off, with its reason, when the project follows as many brands as the summary has cells for', async () => {
    const twenty: TrackedEntity[] = Array.from({ length: 20 }, (_, index) => ({
      entity_id: index === 0 ? 'own' : `rival-${String(index)}`,
      name: index === 0 ? 'Northwind' : `Rival ${String(index)}`,
      role: index === 0 ? 'own' : 'competitor',
    }));
    const { user } = renderWithProviders(<Cell rows={[chatgptRow()]} entities={twenty} />);
    await user.click(opener());
    const add = await screen.findByRole('button', { name: 'Add Copper to your competitors' });
    expect(add).toHaveAttribute('aria-disabled', 'true');
    expect(add).toHaveAccessibleDescription(/20 brands are tracked, the most the project can track\./);
  });

  it('has no Add button for a role that may not change the project entities, but still says Not a competitor', async () => {
    const { user } = renderWithProviders(<Cell rows={[chatgptRow()]} memberRole="viewer" />);
    await user.click(opener());
    const dialog = await screen.findByRole('dialog', { name: 'Brands mentioned in answers' });
    expect(within(dialog).queryByRole('button', { name: /^Add / })).not.toBeInTheDocument();
    expect(within(dialog).getByText('Not a competitor')).toBeInTheDocument();
  });

  it('counts a brand it added once towards the limit, also after the summary lists it among the entities', async () => {
    routes();
    const eighteen: TrackedEntity[] = Array.from({ length: 18 }, (_, index) => ({
      entity_id: index === 0 ? 'own' : `rival-${String(index)}`,
      name: index === 0 ? 'Northwind' : `Rival ${String(index)}`,
      role: index === 0 ? 'own' : 'competitor',
    }));
    const row = chatgptRow({
      other_brands: [
        { name: 'Copper', mentioned: cellOf(2, 12) },
        { name: 'Close', mentioned: cellOf(1, 12) },
      ],
    });
    const { user, rerender } = renderWithProviders(<Cell rows={[row]} entities={eighteen} />);
    await user.click(opener());
    await user.click(await screen.findByRole('button', { name: 'Add Copper to your competitors' }));
    await screen.findByText('Copper added to your competitors');
    // The summary has been read again and lists Copper: 19 brands are tracked, not 20
    rerender(
      <Cell rows={[row]} entities={[...eighteen, { entity_id: 'new-entity', name: 'Copper', role: 'competitor' }]} />,
    );
    expect(await screen.findByRole('button', { name: 'Add Close to your competitors' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });
});
