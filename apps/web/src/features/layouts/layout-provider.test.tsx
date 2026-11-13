import { act, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { useEffect, type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApiResolvedLayout } from './layout-api';
import { layoutQueryKey } from './layout-api';
import { LayoutProvider, useLayoutScreen, type LayoutContextValue, type SaveOutcome } from './layout-provider';
import { defineCards } from './registry';
import { ApiProblem } from '@/lib/api/problem';
import type * as Layouts from '@/lib/layouts';
import { SCREENS, type Capabilities, type CardItem, type LayoutDocument } from '@/lib/layouts';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_WORKSPACE } from '@/mocks/fixtures';
import { mswPath } from '@/mocks/respond';
import { server } from '@/test/msw';
import { renderWithProviders, type ProvidedRender } from '@/test/render';

/** No catalog type holds a permission yet: this one is given one so that the hidden state can be seen. */
vi.mock('@/lib/layouts', async (importOriginal) => {
  const original = await importOriginal<typeof Layouts>();
  return {
    ...original,
    cardType: (key: string) => {
      const type = original.cardType(key);
      return type?.key === 'cross.unclassified' ? { ...type, permission: 'costs:read' } : type;
    },
  };
});

const WORKSPACE = MOCK_WORKSPACE.workspace_id;
const W = `/api/v1/workspaces/${WORKSPACE}`;
const READ = mswPath(`${W}/layouts/overview`);
const PERSONAL = mswPath(`${W}/me/layouts/overview`);
const TEAM = mswPath(`${W}/layouts/overview/default`);

const FULL_CAPABILITIES: Capabilities = { channels: ['seo', 'ai'], permissions: ['costs:read'], integrations: [] };
const REGISTRY = defineCards({});
const BUILTIN = SCREENS.overview.builtin;

const BUILTIN_LAYOUT: ApiResolvedLayout = {
  screen: 'overview',
  source: 'builtin',
  document: null,
  team_default_exists: false,
  team_document: null,
  updated_at: null,
  updated_by: null,
};
const EDITOR = { user_id: '0000005a-7c1e-4a52-9b3d-00000000005a', name: 'Mara Voss' };
const stored = (
  source: 'personal' | 'team',
  document: LayoutDocument,
  team: LayoutDocument | null,
): ApiResolvedLayout => ({
  ...BUILTIN_LAYOUT,
  source,
  document,
  team_default_exists: team !== null,
  team_document: team,
  updated_at: '2026-11-10T09:12:44Z',
  updated_by: EDITOR,
});

const withoutCompetitors: LayoutDocument = {
  ...BUILTIN,
  cards: (BUILTIN.cards ?? []).filter((card) => card.id !== 'competitors'),
};
const SOLO: LayoutDocument = {
  schema: 1,
  numbers: [],
  cards: [{ id: 'solo', type: 'seo.rank_distribution', width: 'third' }],
};
const TEAM_DOCUMENT: LayoutDocument = {
  schema: 1,
  numbers: [],
  cards: [{ id: 't1', type: 'ai.by_engine', width: 'full' }],
};

const PRECONDITION_FAILED = {
  type: 'about:blank',
  title: 'Precondition failed',
  status: 412,
  code: 'precondition_failed',
};
const INTERNAL = { type: 'about:blank', title: 'Internal', status: 500, code: 'internal' };

interface Served {
  /** What the next read answers. */
  layout: ApiResolvedLayout;
  reads: number;
  puts: { target: 'personal' | 'team'; ifMatch: string | null }[];
  deletes: ('personal' | 'team')[];
  /** What a write answers: 200, or the status of a problem. */
  putStatus: 200 | 412 | 500;
}

/** The layout routes, answering `layout`; every read has its own ETag (`"e1"`, `"e2"`...). */
function serve(layout: ApiResolvedLayout = BUILTIN_LAYOUT): Served {
  const served: Served = { layout, reads: 0, puts: [], deletes: [], putStatus: 200 };
  const put =
    (target: 'personal' | 'team') =>
    ({ request }: { request: Request }): Response => {
      served.puts.push({ target, ifMatch: request.headers.get('if-match') });
      if (served.putStatus === 412) return HttpResponse.json(PRECONDITION_FAILED, { status: 412 });
      if (served.putStatus === 500) return HttpResponse.json(INTERNAL, { status: 500 });
      return HttpResponse.json(
        { data: { ...served.layout, source: 'personal' } },
        { headers: { etag: `"p${String(served.puts.length)}"` } },
      );
    };
  const remove = (target: 'personal' | 'team') => (): Response => {
    served.deletes.push(target);
    return new HttpResponse(null, { status: 204 });
  };
  server.use(
    http.get(READ, () => {
      served.reads += 1;
      return HttpResponse.json({ data: served.layout }, { headers: { etag: `"e${String(served.reads)}"` } });
    }),
    http.put(PERSONAL, put('personal')),
    http.put(TEAM, put('team')),
    http.delete(PERSONAL, remove('personal')),
    http.delete(TEAM, remove('team')),
  );
  return served;
}

/** An answer held back until the test lets it go. */
function gate(): { wait: Promise<void>; open: () => void } {
  let release: () => void = () => undefined;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { wait, open: () => release() };
}

let latest: LayoutContextValue | null = null;

function Probe(): ReactElement {
  const value = useLayoutScreen();
  useEffect(() => {
    latest = value;
  }, [value]);
  return <p>{`${value.mode} ${String(value.changes)} ${value.status}`}</p>;
}

const current = (): LayoutContextValue => {
  if (latest === null) throw new Error('The probe has not rendered');
  return latest;
};

interface Tree {
  capabilities?: Capabilities;
  role?: 'admin' | 'viewer';
  screen?: 'overview' | 'rankings';
  workspaceId?: string;
}

function tree({
  capabilities = FULL_CAPABILITIES,
  role = 'admin',
  screen: onScreen = 'overview',
  workspaceId = WORKSPACE,
}: Tree = {}): ReactElement {
  return (
    <PermissionProvider membership={membershipFactory(role)}>
      <LayoutProvider screen={onScreen} workspaceId={workspaceId} capabilities={capabilities} registry={REGISTRY}>
        <Probe />
      </LayoutProvider>
    </PermissionProvider>
  );
}

function mount(capabilities: Capabilities = FULL_CAPABILITIES, role: 'admin' | 'viewer' = 'admin'): ProvidedRender {
  return renderWithProviders(tree({ capabilities, role }));
}

/** Runs an action inside `act` and gives back what it returned. */
function run<T>(action: () => T): T {
  const box: { result?: { value: T } } = {};
  act(() => {
    box.result = { value: action() };
  });
  if (box.result === undefined) throw new Error('act did not run the action');
  return box.result.value;
}

async function runAsync<T>(action: () => Promise<T>): Promise<T> {
  const box: { result?: { value: T } } = {};
  await act(async () => {
    box.result = { value: await action() };
  });
  if (box.result === undefined) throw new Error('act did not run the action');
  return box.result.value;
}

async function ready(): Promise<void> {
  await waitFor(() => {
    expect(current().status).toBe('ready');
  });
}

async function customizing(): Promise<void> {
  await ready();
  act(() => {
    current().actions.enter();
  });
  expect(current().mode).toBe('customize');
}

const polite = (): string => document.getElementById('live-region-polite')?.textContent ?? '';
const idsOf = (cards: readonly CardItem[]): string[] => cards.map((card) => card.id);
const cardIds = (): string[] => idsOf(current().document.cards ?? []);

/** What the live region says now: an action that does nothing must leave it as it was. */
function expectSilent(action: () => unknown): void {
  const before = polite();
  act(() => {
    action();
  });
  expect(polite()).toBe(before);
}

beforeEach(() => {
  latest = null;
});

describe('reading the layout', () => {
  it('shows the built-in layout while loading, then the read one', async () => {
    serve(stored('personal', SOLO, null));
    mount();
    expect(screen.getByText('view 0 loading')).toBeInTheDocument();
    expect(current().canCustomize).toBe(false);
    expect(current().resolved.source).toBe('builtin');
    expect(current().document).toEqual(BUILTIN);

    await ready();
    expect(current().canCustomize).toBe(true);
    expect(current().resolved.source).toBe('personal');
    expect(idsOf(current().document.cards ?? [])).toEqual(['solo']);
  });

  it('after a failed read shows the built-in layout, refuses to customize and reads again on retry', async () => {
    let reads = 0;
    server.use(
      http.get(READ, () => {
        reads += 1;
        return reads === 1
          ? HttpResponse.json(INTERNAL, { status: 500 })
          : HttpResponse.json({ data: BUILTIN_LAYOUT }, { headers: { etag: '"e1"' } });
      }),
    );
    mount();
    await waitFor(() => {
      expect(current().status).toBe('error');
    });
    expect(current().canCustomize).toBe(false);
    expect(current().resolved.source).toBe('builtin');
    expect(current().document).toEqual(BUILTIN);

    expectSilent(() => {
      current().actions.enter();
    });
    expect(current().mode).toBe('view');

    act(() => {
      current().retry();
    });
    await ready();
    expect(reads).toBe(2);
    expect(current().canCustomize).toBe(true);
  });

  it('goes back to the built-in default as the one to reset to when no team default exists', async () => {
    serve();
    mount();
    await ready();
    expect(current().defaultDocument).toEqual(BUILTIN);
    expect(current().resolved.teamDefaultExists).toBe(false);
  });

  it('takes the team default document as the one to reset to, also under a personal layout', async () => {
    serve(stored('personal', SOLO, TEAM_DOCUMENT));
    mount();
    await ready();
    expect(current().resolved.source).toBe('personal');
    expect(current().resolved.teamDefaultExists).toBe(true);
    expect(current().defaultDocument).toEqual(TEAM_DOCUMENT);
  });

  it('tells the manager of the team default from the others', async () => {
    serve();
    mount(FULL_CAPABILITIES, 'viewer');
    await ready();
    expect(current().canManage).toBe(false);
  });

  it('lets an admin manage the team default', async () => {
    serve();
    mount();
    await ready();
    expect(current().canManage).toBe(true);
  });
});

describe('which cards are shown', () => {
  it('drops a card the project cannot use in view mode and keeps it, explained, in customize mode', async () => {
    serve();
    mount({ ...FULL_CAPABILITIES, channels: ['seo'] });
    await ready();
    const aiCard = (current().document.cards ?? []).find((card) => card.id === 'ai-by-engine');
    if (aiCard === undefined) throw new Error('The built-in layout has no AI card');
    expect(idsOf(current().shownCards)).not.toContain('ai-by-engine');
    expect(idsOf(current().shownCards)).toContain('rank-distribution');
    expect(current().availabilityOf(aiCard).state).toBe('unavailable');

    act(() => {
      current().actions.enter();
    });
    expect(idsOf(current().shownCards)).toContain('ai-by-engine');
  });

  it('drops a card the person has no permission for in both modes', async () => {
    serve();
    mount({ ...FULL_CAPABILITIES, permissions: [] });
    await ready();
    expect(idsOf(current().shownCards)).not.toContain('unclassified');
    expect(cardIds()).toContain('unclassified');

    act(() => {
      current().actions.enter();
    });
    expect(idsOf(current().shownCards)).not.toContain('unclassified');
  });
});

describe('customize mode', () => {
  it('announces that customizing began and works on a copy', async () => {
    serve();
    mount();
    await ready();
    act(() => {
      current().actions.enter();
    });
    expect(screen.getByText('customize 0 ready')).toBeInTheDocument();
    expect(current().baseline).toEqual(BUILTIN);
    expect(current().document).toEqual(BUILTIN);
    expect(current().document).not.toBe(current().resolved.document);
    await waitFor(() => {
      expect(polite()).toBe('Customizing Overview. Drag cards to reorder, or use the Move menu of each card.');
    });
  });

  it('refuses every edit outside customize mode, without a word', async () => {
    serve();
    mount();
    await ready();
    const { actions } = current();
    expectSilent(() => {
      expect(actions.addCard('seo.top_movers')).toBeNull();
      expect(actions.hideCard('matrix')).toBe(false);
      expect(actions.moveCard('matrix', 0)).toBe(false);
      expect(actions.setCardWidth('rank-distribution', 'half')).toBe(false);
      expect(actions.setCardOption('key-changes', 'rows', '5')).toBe(false);
      expect(actions.undo()).toBe(false);
      expect(actions.redo()).toBe(false);
      expect(actions.replaceDraft(withoutCompetitors, 'Reset')).toBe(false);
    });
    expect(current().mode).toBe('view');
  });

  it('drops the draft on exit', async () => {
    serve();
    mount();
    await customizing();
    run(() => current().actions.hideCard('matrix'));
    expect(current().changes).toBe(1);
    act(() => {
      current().actions.exit();
    });
    expect(current().mode).toBe('view');
    expect(current().changes).toBe(0);
    expect(current().canUndo).toBe(false);
    expect(current().document).toEqual(BUILTIN);
  });

  it('turns off the refetch on window focus while customizing', async () => {
    serve();
    const { queryClient } = mount();
    await ready();
    const focusOf = (): unknown =>
      queryClient.getQueryCache().find({ queryKey: layoutQueryKey(WORKSPACE, 'overview') })?.observers[0]?.options
        .refetchOnWindowFocus;
    expect(focusOf()).not.toBe(false);
    act(() => {
      current().actions.enter();
    });
    expect(focusOf()).toBe(false);
    act(() => {
      current().actions.exit();
    });
    expect(focusOf()).not.toBe(false);
  });

  it('never lets a refetch touch the draft or the baseline', async () => {
    const served = serve();
    const { queryClient } = mount();
    await customizing();
    run(() => current().actions.hideCard('matrix'));

    served.layout = stored('personal', SOLO, null);
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: layoutQueryKey(WORKSPACE, 'overview') });
    });
    await waitFor(() => {
      expect(current().resolved.source).toBe('personal');
    });

    expect(current().baseline).toEqual(BUILTIN);
    expect(cardIds()).toContain('competitors');
    expect(cardIds()).not.toContain('matrix');
    expect(current().changes).toBe(1);
    expect(current().mode).toBe('customize');
  });
});

describe('editing cards', () => {
  it('hides a card, says so, and asks for focus on the next card', async () => {
    serve();
    mount();
    await customizing();
    expect(run(() => current().actions.hideCard('matrix'))).toBe(true);
    expect(cardIds()).not.toContain('matrix');
    expect(current().focus).toEqual({ id: 'unclassified', part: 'handle' });
    await waitFor(() => {
      expect(polite()).toBe('SEO and AI matrix hidden. Add it back from the catalog.');
    });
    act(() => {
      current().actions.focused();
    });
    expect(current().focus).toBeNull();
  });

  it('asks for focus on the previous card when the last one is hidden', async () => {
    serve();
    mount();
    await customizing();
    run(() => current().actions.hideCard('competitors'));
    expect(current().focus).toEqual({ id: 'ai-by-engine', part: 'handle' });
  });

  it('asks for focus on the Add card slot when the only card is hidden', async () => {
    serve(stored('personal', SOLO, null));
    mount();
    await customizing();
    run(() => current().actions.hideCard('solo'));
    expect(current().focus).toEqual({ id: null, part: 'handle' });
  });

  it('skips a card the person cannot see when it looks for the next one', async () => {
    serve();
    mount({ ...FULL_CAPABILITIES, permissions: [] });
    await customizing();
    run(() => current().actions.hideCard('matrix'));
    expect(current().focus).toEqual({ id: 'key-changes', part: 'handle' });
  });

  it('refuses to hide a card that is not there, without a word', async () => {
    serve();
    mount();
    await customizing();
    expectSilent(() => {
      expect(current().actions.hideCard('nothing')).toBe(false);
    });
  });

  it('moves a card, says where it went and asks for focus on the part that moved it', async () => {
    serve();
    mount();
    await customizing();
    expect(run(() => current().actions.moveCard('competitors', 0, 'more'))).toBe(true);
    expect(cardIds()[0]).toBe('competitors');
    expect(current().focus).toEqual({ id: 'competitors', part: 'more' });
    await waitFor(() => {
      expect(polite()).toBe('Competitors, position 1 of 8');
    });
  });

  it('asks for focus on the handle when a move names no part', async () => {
    serve();
    mount();
    await customizing();
    run(() => current().actions.moveCard('competitors', 0));
    expect(current().focus).toEqual({ id: 'competitors', part: 'handle' });
  });

  it('refuses a move that goes nowhere, without a word', async () => {
    serve();
    mount();
    await customizing();
    expectSilent(() => {
      expect(current().actions.moveCard('competitors', 7)).toBe(false);
    });
    expect(current().changes).toBe(0);
    expect(current().canUndo).toBe(false);
  });

  it('changes a width and says it', async () => {
    serve();
    mount();
    await customizing();
    expect(run(() => current().actions.setCardWidth('rank-distribution', 'half'))).toBe(true);
    expect(current().focus).toEqual({ id: 'rank-distribution', part: 'width' });
    await waitFor(() => {
      expect(polite()).toBe('Rank distribution width: Half');
    });
  });

  it('refuses a width the type does not take, without a word', async () => {
    serve();
    mount();
    await customizing();
    expectSilent(() => {
      expect(current().actions.setCardWidth('rank-distribution', 'full')).toBe(false);
    });
  });

  it('changes an option and says it', async () => {
    serve();
    mount();
    await customizing();
    expect(run(() => current().actions.setCardOption('key-changes', 'rows', '5'))).toBe(true);
    // The open options popover keeps focus in its radio group: no focus request that would pull it to the button
    expect(current().focus).toBeNull();
    await waitFor(() => {
      expect(polite()).toBe('Key changes: Rows 5 rows');
    });
  });

  it('adds a card at the end with a new id, says where it is and asks for focus on it', async () => {
    serve();
    mount();
    await customizing();
    const id = run(() => current().actions.addCard('seo.top_movers'));
    expect(id).toMatch(/^c-[0-9a-f]{8}$/);
    expect(cardIds().at(-1)).toBe(id);
    expect(current().focus).toEqual({ id, part: 'handle' });
    await waitFor(() => {
      expect(polite()).toBe('Top movers added, position 9 of 9');
    });
  });

  it('adds a card at a place', async () => {
    serve();
    mount();
    await customizing();
    const id = run(() => current().actions.addCard('seo.top_movers', 1));
    expect(cardIds()[1]).toBe(id);
  });

  it('refuses a card type that is not on this screen, one that is already placed, and a made up one', async () => {
    serve();
    mount();
    await customizing();
    expectSilent(() => {
      expect(current().actions.addCard('inspector.key_numbers')).toBeNull();
      expect(current().actions.addCard('seo.rank_distribution')).toBeNull();
      expect(current().actions.addCard('nothing.like_it')).toBeNull();
    });
    expect(current().changes).toBe(0);
  });

  it('refuses an identity value another instance of the type already shows', async () => {
    serve();
    mount();
    await customizing();
    run(() => current().actions.addCard('ai.mention_trend'));
    const second = run(() => current().actions.addCard('ai.mention_trend'));
    if (second === null) throw new Error('The second instance was refused');
    expectSilent(() => {
      expect(current().actions.setCardOption(second, 'engine', 'chatgpt_web')).toBe(false);
    });
    expect(run(() => current().actions.setCardOption(second, 'engine', 'google_ai_mode'))).toBe(true);
    await waitFor(() => {
      expect(polite()).toBe('Mention rate trend: AI Mode: Engine AI Mode');
    });
  });
});

describe('editing numbers', () => {
  it('adds, moves and removes a number without a word of its own', async () => {
    serve();
    mount();
    await customizing();
    const before = polite();
    expect(run(() => current().actions.removeNumber('visibility'))).toBe(true);
    const id = run(() => current().actions.addNumber('seo.top3_count'));
    expect(id).toMatch(/^n-[0-9a-f]{8}$/);
    if (id === null) throw new Error('The number was refused');
    expect(run(() => current().actions.moveNumber(id, 0))).toBe(true);
    expect(current().document.numbers?.[0]?.id).toBe(id);
    expect(polite()).toBe(before);
  });

  it('adds a number for one engine and refuses one without its engine', async () => {
    serve();
    mount();
    await customizing();
    run(() => current().actions.removeNumber('mention-chatgpt'));
    expect(run(() => current().actions.addNumber('ai.mention_rate'))).toBeNull();
    const id = run(() => current().actions.addNumber('ai.mention_rate', 'chatgpt_web', 0));
    expect(id).not.toBeNull();
    expect(current().document.numbers?.[0]).toMatchObject({ metric: 'ai.mention_rate', engine: 'chatgpt_web' });
  });

  it('refuses a sixth number too many', async () => {
    serve();
    mount();
    await customizing();
    expect(run(() => current().actions.addNumber('seo.top3_count'))).toBeNull();
  });
});

describe('history', () => {
  it('undoes and redoes, says so, and counts the changes against where customizing began', async () => {
    serve();
    mount();
    await customizing();
    expect(current().canUndo).toBe(false);
    expect(current().canRedo).toBe(false);
    run(() => current().actions.hideCard('matrix'));
    expect(current().changes).toBe(1);
    expect(current().dirty).toBe(true);
    expect(current().canUndo).toBe(true);
    expect(screen.getByText('customize 1 ready')).toBeInTheDocument();

    expect(run(() => current().actions.undo())).toBe(true);
    expect(cardIds()).toContain('matrix');
    expect(current().changes).toBe(0);
    expect(current().dirty).toBe(false);
    expect(current().canRedo).toBe(true);
    await waitFor(() => {
      expect(polite()).toBe('Change undone');
    });

    expect(run(() => current().actions.redo())).toBe(true);
    expect(cardIds()).not.toContain('matrix');
    expect(current().changes).toBe(1);
    expect(current().canRedo).toBe(false);
    await waitFor(() => {
      expect(polite()).toBe('Change redone');
    });
  });

  it('refuses to undo or redo with nothing to go back or forward to, without a word', async () => {
    serve();
    mount();
    await customizing();
    expectSilent(() => {
      expect(current().actions.undo()).toBe(false);
      expect(current().actions.redo()).toBe(false);
    });
  });
});

describe('actions kept from an earlier render', () => {
  it('lands two edits made in one event, the second on the result of the first', async () => {
    serve();
    mount();
    await customizing();
    const { actions } = current();
    act(() => {
      expect(actions.hideCard('matrix')).toBe(true);
      expect(actions.hideCard('competitors')).toBe(true);
    });
    expect(cardIds()).not.toContain('matrix');
    expect(cardIds()).not.toContain('competitors');
    expect(current().changes).toBe(2);
  });

  it('undoes and redoes twice in one event', async () => {
    serve();
    mount();
    await customizing();
    const { actions } = current();
    act(() => {
      actions.hideCard('matrix');
      actions.hideCard('competitors');
    });
    act(() => {
      expect(actions.undo()).toBe(true);
      expect(actions.undo()).toBe(true);
    });
    expect(cardIds()).toEqual(idsOf(BUILTIN.cards ?? []));
    act(() => {
      expect(actions.redo()).toBe(true);
      expect(actions.redo()).toBe(true);
    });
    expect(cardIds()).not.toContain('competitors');
  });

  it('undoes through the undo of a render before the edit (the Hide toast keeps it)', async () => {
    serve();
    mount();
    await customizing();
    const undoOfTheToast = current().actions.undo;
    run(() => current().actions.hideCard('matrix'));
    expect(cardIds()).not.toContain('matrix');
    expect(run(() => undoOfTheToast())).toBe(true);
    expect(cardIds()).toContain('matrix');
    await waitFor(() => {
      expect(polite()).toBe('Change undone');
    });
  });

  it('saves the draft through the save of a render before the edit', async () => {
    const served = serve();
    mount();
    await customizing();
    const saveOfAnEarlierRender = current().actions.save;
    run(() => current().actions.hideCard('matrix'));
    expect(await runAsync(() => saveOfAnEarlierRender())).toEqual<SaveOutcome>({ kind: 'saved' });
    expect(served.puts).toHaveLength(1);
  });

  it('starts again, with no draft, when the screen changes', async () => {
    server.use(
      http.get(mswPath(`${W}/layouts/rankings`), () =>
        HttpResponse.json({ data: { ...BUILTIN_LAYOUT, screen: 'rankings' } }, { headers: { etag: '"r1"' } }),
      ),
    );
    serve();
    const { rerender } = renderWithProviders(tree());
    await customizing();
    run(() => current().actions.hideCard('matrix'));
    expect(current().changes).toBe(1);

    rerender(tree({ screen: 'rankings' }));
    await waitFor(() => {
      expect(current().screen).toBe('rankings');
    });
    await ready();
    expect(current().mode).toBe('view');
    expect(current().changes).toBe(0);
    expect(current().baseline).toBeNull();
    expect(current().canUndo).toBe(false);
    expect(current().document).toEqual(SCREENS.rankings.builtin);
    // The earlier actions of the old screen have nothing to undo on the new one
    expectSilent(() => {
      expect(current().actions.undo()).toBe(false);
    });
  });

  it('starts again, with no draft, when the workspace changes', async () => {
    const OTHER = 'other-workspace';
    server.use(
      http.get(mswPath(`/api/v1/workspaces/${OTHER}/layouts/overview`), () =>
        HttpResponse.json({ data: BUILTIN_LAYOUT }, { headers: { etag: '"o1"' } }),
      ),
    );
    serve();
    const { rerender } = renderWithProviders(tree());
    await customizing();
    run(() => current().actions.hideCard('matrix'));

    rerender(tree({ workspaceId: OTHER }));
    await waitFor(() => {
      expect(current().mode).toBe('view');
    });
    await ready();
    expect(current().changes).toBe(0);
    expect(current().document).toEqual(BUILTIN);
    expect(current().canUndo).toBe(false);
  });
});

describe('replaceDraft', () => {
  it('pushes no history entry when the draft already shows that layout, so Reset to default is a no-op then', async () => {
    serve();
    mount();
    await customizing();
    expectSilent(() => {
      expect(current().actions.replaceDraft(current().defaultDocument, 'Layout reset to the default')).toBe(false);
    });
    expect(current().canUndo).toBe(false);
    expect(current().changes).toBe(0);
  });

  it('replaces the draft with a copy, says the message and can be undone', async () => {
    serve();
    mount();
    await customizing();
    run(() => current().actions.hideCard('matrix'));
    const target = current().defaultDocument;
    expect(run(() => current().actions.replaceDraft(target, 'Layout reset to the default'))).toBe(true);
    expect(current().document).toEqual(BUILTIN);
    expect(current().document).not.toBe(target);
    expect(current().changes).toBe(0);
    await waitFor(() => {
      expect(polite()).toBe('Layout reset to the default');
    });
    expect(run(() => current().actions.undo())).toBe(true);
    expect(cardIds()).not.toContain('matrix');
  });
});

describe('saving the personal layout', () => {
  it('has nothing to save without changes and sends no request', async () => {
    const served = serve();
    mount();
    await customizing();
    const outcome = await runAsync(() => current().actions.save());
    expect(outcome).toEqual<SaveOutcome>({ kind: 'unchanged' });
    expect(served.puts).toEqual([]);
    expect(served.deletes).toEqual([]);
    expect(current().mode).toBe('customize');
  });

  it('puts the draft with the ETag it read, leaves customize mode and says so', async () => {
    const served = serve();
    mount();
    await customizing();
    run(() => current().actions.hideCard('matrix'));
    const outcome = await runAsync(() => current().actions.save());
    expect(outcome).toEqual<SaveOutcome>({ kind: 'saved' });
    expect(served.puts).toEqual([{ target: 'personal', ifMatch: '"e1"' }]);
    expect(current().mode).toBe('view');
    expect(current().saving).toBe(false);
    await waitFor(() => {
      expect(polite()).toBe('Layout saved');
    });
  });

  it('sends one request when Save is pressed twice before the first answer, and both calls get its outcome', async () => {
    serve();
    const answer = gate();
    let puts = 0;
    server.use(
      http.put(PERSONAL, async () => {
        puts += 1;
        await answer.wait;
        return HttpResponse.json({ data: { ...BUILTIN_LAYOUT, source: 'personal' } }, { headers: { etag: '"p1"' } });
      }),
    );
    mount();
    await customizing();
    run(() => current().actions.hideCard('matrix'));
    const { actions } = current();
    const pending: Promise<SaveOutcome>[] = [];
    act(() => {
      pending.push(actions.save(), actions.save());
    });
    await waitFor(() => {
      expect(current().saving).toBe(true);
    });
    answer.open();
    expect(await runAsync(() => Promise.all(pending))).toEqual<SaveOutcome[]>([{ kind: 'saved' }, { kind: 'saved' }]);
    expect(puts).toBe(1);
  });

  it('counts the re-read of "Keep mine" as saving, and puts once when it is pressed twice', async () => {
    const served = serve();
    mount();
    await customizing();
    run(() => current().actions.hideCard('matrix'));
    served.putStatus = 412;
    await runAsync(() => current().actions.save());
    served.putStatus = 200;
    const answer = gate();
    server.use(
      http.get(READ, async () => {
        await answer.wait;
        return HttpResponse.json({ data: BUILTIN_LAYOUT }, { headers: { etag: '"e9"' } });
      }),
    );

    const { actions } = current();
    const pending: Promise<SaveOutcome>[] = [];
    act(() => {
      pending.push(actions.saveAnyway(), actions.saveAnyway());
    });
    await waitFor(() => {
      expect(current().saving).toBe(true);
    });
    expect(served.puts).toHaveLength(1);

    answer.open();
    expect(await runAsync(() => Promise.all(pending))).toEqual<SaveOutcome[]>([{ kind: 'saved' }, { kind: 'saved' }]);
    expect(served.puts.map((put) => put.ifMatch)).toEqual(['"e1"', '"e9"']);
    expect(current().saving).toBe(false);
  });

  it('finishes a save quietly when the screen is gone before the answer', async () => {
    serve();
    const answer = gate();
    server.use(
      http.put(PERSONAL, async () => {
        await answer.wait;
        return HttpResponse.json({ data: { ...BUILTIN_LAYOUT, source: 'personal' } }, { headers: { etag: '"p1"' } });
      }),
    );
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { unmount } = mount();
    await customizing();
    run(() => current().actions.hideCard('matrix'));
    const pending: Promise<SaveOutcome>[] = [];
    act(() => {
      pending.push(current().actions.save());
    });
    unmount();
    answer.open();
    await expect(pending[0]).resolves.toEqual({ kind: 'saved' });
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it('deletes the personal layout instead when the draft shows the default again', async () => {
    const served = serve(stored('personal', withoutCompetitors, null));
    mount();
    await customizing();
    run(() => current().actions.addCard('competitors.summary'));
    expect(current().changes).toBe(1);
    const outcome = await runAsync(() => current().actions.save());
    expect(outcome).toEqual<SaveOutcome>({ kind: 'saved' });
    expect(served.deletes).toEqual(['personal']);
    expect(served.puts).toEqual([]);
    expect(current().mode).toBe('view');
  });

  it('compares the draft with the team default when there is one', async () => {
    const served = serve(stored('personal', SOLO, TEAM_DOCUMENT));
    mount();
    await customizing();
    run(() => current().actions.hideCard('solo'));
    run(() => current().actions.addCard('ai.by_engine'));
    run(() => current().actions.setCardWidth(cardIds()[0] ?? '', 'full'));
    const outcome = await runAsync(() => current().actions.save());
    expect(outcome).toEqual<SaveOutcome>({ kind: 'saved' });
    expect(served.deletes).toEqual(['personal']);
    expect(served.puts).toEqual([]);
  });

  it('answers a stale ETag with a conflict and keeps the mode, the draft and the changes', async () => {
    const served = serve();
    mount();
    await customizing();
    run(() => current().actions.hideCard('matrix'));
    served.putStatus = 412;
    const outcome = await runAsync(() => current().actions.save());
    expect(outcome).toEqual<SaveOutcome>({ kind: 'conflict' });
    expect(current().mode).toBe('customize');
    expect(current().changes).toBe(1);
    expect(cardIds()).not.toContain('matrix');
    expect(served.reads).toBe(2);
    expect(current().saving).toBe(false);
  });

  it('keeps the draft on "Keep mine" and puts it again with the ETag read after the conflict', async () => {
    const served = serve();
    mount();
    await customizing();
    run(() => current().actions.hideCard('matrix'));
    served.putStatus = 412;
    await runAsync(() => current().actions.save());

    served.putStatus = 200;
    const outcome = await runAsync(() => current().actions.saveAnyway());
    expect(outcome).toEqual<SaveOutcome>({ kind: 'saved' });
    expect(served.puts.map((put) => put.ifMatch)).toEqual(['"e1"', '"e3"']);
    expect(current().mode).toBe('view');
  });

  it('replaces the draft and the baseline on "Load the other version"', async () => {
    const served = serve();
    mount();
    await customizing();
    run(() => current().actions.hideCard('matrix'));
    served.layout = stored('personal', SOLO, null);
    served.putStatus = 412;
    await runAsync(() => current().actions.save());
    await waitFor(() => {
      expect(current().resolved.source).toBe('personal');
    });

    act(() => {
      current().actions.loadRemote();
    });
    expect(cardIds()).toEqual(['solo']);
    expect(idsOf(current().baseline?.cards ?? [])).toEqual(['solo']);
    expect(current().changes).toBe(0);
    expect(current().canUndo).toBe(false);
    expect(current().mode).toBe('customize');
  });

  it('answers another failure with the problem and keeps the mode and the draft', async () => {
    const served = serve();
    mount();
    await customizing();
    run(() => current().actions.hideCard('matrix'));
    served.putStatus = 500;
    const outcome = await runAsync(() => current().actions.save());
    expect(outcome.kind).toBe('failed');
    if (outcome.kind !== 'failed') throw new Error('Expected a failure');
    expect(outcome.problem).toBeInstanceOf(ApiProblem);
    expect(current().mode).toBe('customize');
    expect(current().changes).toBe(1);
    expect(served.reads).toBe(1);
  });
});

describe('the team default', () => {
  it('puts the draft as the team default, then removes the personal layout it replaces', async () => {
    const served = serve(stored('personal', withoutCompetitors, null));
    mount();
    await customizing();
    run(() => current().actions.hideCard('matrix'));
    const outcome = await runAsync(() => current().actions.saveTeamDefault());
    expect(outcome).toEqual<SaveOutcome>({ kind: 'saved' });
    expect(served.puts).toEqual([{ target: 'team', ifMatch: '"e1"' }]);
    expect(served.deletes).toEqual(['personal']);
    expect(current().mode).toBe('view');
  });

  it('removes no personal layout when the person had none', async () => {
    const served = serve();
    mount();
    await customizing();
    run(() => current().actions.hideCard('matrix'));
    const outcome = await runAsync(() => current().actions.saveTeamDefault());
    expect(outcome).toEqual<SaveOutcome>({ kind: 'saved' });
    expect(served.puts).toEqual([{ target: 'team', ifMatch: '"e1"' }]);
    expect(served.deletes).toEqual([]);
    expect(current().mode).toBe('view');
  });

  it('answers a stale ETag of the team default with a conflict', async () => {
    const served = serve();
    mount();
    await customizing();
    run(() => current().actions.hideCard('matrix'));
    served.putStatus = 412;
    const outcome = await runAsync(() => current().actions.saveTeamDefault());
    expect(outcome).toEqual<SaveOutcome>({ kind: 'conflict' });
    expect(current().mode).toBe('customize');
  });

  it('keeps the mode and the draft when the team default is removed while there are changes, and rebases', async () => {
    const served = serve(stored('team', TEAM_DOCUMENT, TEAM_DOCUMENT));
    mount();
    await customizing();
    expect(current().defaultDocument).toEqual(TEAM_DOCUMENT);
    run(() => current().actions.addCard('seo.top_movers'));
    served.layout = BUILTIN_LAYOUT;

    const outcome = await runAsync(() => current().actions.removeTeamDefault());
    expect(outcome).toEqual<SaveOutcome>({ kind: 'saved' });
    expect(served.deletes).toEqual(['team']);
    expect(current().mode).toBe('customize');
    expect(idsOf(current().document.cards ?? []).length).toBe(2);
    expect(current().baseline).toEqual(BUILTIN);
    expect(current().defaultDocument).toEqual(BUILTIN);
    // The team card matches the built-in AI card (a new width), Top movers is added, 7 cards and 6 numbers are gone
    expect(current().changes).toBe(15);
  });

  it('leaves customize mode when the team default is removed and there are no changes', async () => {
    const served = serve(stored('team', TEAM_DOCUMENT, TEAM_DOCUMENT));
    mount();
    await customizing();
    served.layout = BUILTIN_LAYOUT;
    const outcome = await runAsync(() => current().actions.removeTeamDefault());
    expect(outcome).toEqual<SaveOutcome>({ kind: 'saved' });
    expect(current().mode).toBe('view');
    expect(current().document).toEqual(BUILTIN);
  });
});
