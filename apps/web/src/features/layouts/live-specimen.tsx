'use client';

import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { GripVertical } from 'lucide-react';
import { useEffect, useId, useMemo, useState, type ReactElement, type ReactNode } from 'react';

import { CardFrame } from './card-frame';
import { LayoutGrid } from './layout-grid';
import { layoutQueryKey, type LayoutRead } from './layout-api';
import { LayoutProvider, useLayoutScreen, type SaveOutcome } from './layout-provider';
import { FixtureBody, GALLERY_CARDS } from './live-fixtures';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Switch } from '@/components/ui/switch';
import { makeQueryClient } from '@/lib/api/query-client';
import type { MeMembership, Schemas } from '@/lib/api/types';
import { formatInteger } from '@/lib/format';
import { cardName, type Capabilities, type CardItem, type ScreenKey } from '@/lib/layouts';
import { PermissionProvider } from '@/lib/permissions';
import { meQuery } from '@/lib/session/me-query';

/*
 * The layout core of WP-15 on the gallery page /design-system/layouts-live (docs/superpowers/plans/
 * 2026-11-13-ai-wp-15-layouts-core.md, task T11): the real provider on the mock API, and the states it keeps. It
 * lives in the feature because it fetches, which the design-system folder may not; the route renders it. The
 * gallery is for the team and is never translated, so its words are kept in one table, away from the markup.
 */
const COPY = {
  liveTitle: 'Live layout on the mock API',
  liveNote:
    "WP-15. The real provider reads the overview of the signed-in person's first workspace and saves to the mock, which keeps it in a cookie, so a reload keeps the order. Customize, Save, Cancel, Undo, Redo and the AI channel switch are this page's own buttons on the provider's actions. Drag a card by its handle, or press Space on the handle and use the arrow keys. Add card puts Top movers on the page once.",
  statesTitle: 'Layout states',
  statesNote:
    "WP-15. Loading keeps each card's title and its place. A failed read keeps the built-in layout under a banner with Retry. Refetching keeps the cards and draws a 2 px bar. An empty page says so and offers Customize. When every card is for a channel the project does not have, the page says how many are not available.",
  pickedTitle: 'A picked up card',
  pickedNote:
    'WP-15. The frame while a card is picked up: a ring on the card in the hand, and the card being dragged at half strength. Its body cannot be reached while customizing. The live layout above shows the real pick up.',
  pickedSpecimen: 'Picked up, and dragged',
  drawerTitle: 'Drawer form, one column',
  drawerNote: "WP-15. The keyword drawer's cards in one column with no widths, in the 400 px of the inspector.",
  drawerSpecimen: 'Keyword drawer',
  drawerGrid: 'Keyword cards',
  overviewGrid: 'Overview cards',
  customize: 'Customize',
  save: 'Save',
  cancel: 'Cancel',
  undo: 'Undo',
  redo: 'Redo',
  aiChannel: 'AI channel',
  checking: 'Checking who is signed in.',
  signedOut: 'Sign in to try the live layout. While you are signed out this page asks for no layout.',
  noWorkspace: 'This person has no workspace, so there is no layout to show.',
  noSave: 'none yet',
} as const;

/** The card the Add card slot puts on the page. */
const ADDED_TYPE = 'seo.top_movers';

const SEO_ONLY: Capabilities['channels'] = ['seo'];
const SEO_AND_AI: Capabilities['channels'] = ['seo', 'ai'];
const NO_PERMISSIONS: Capabilities['permissions'] = [];
const NO_INTEGRATIONS: Capabilities['integrations'] = [];
const WITH_AI: Capabilities = { channels: SEO_AND_AI, permissions: NO_PERMISSIONS, integrations: NO_INTEGRATIONS };
const WITHOUT_AI: Capabilities = { channels: SEO_ONLY, permissions: NO_PERMISSIONS, integrations: NO_INTEGRATIONS };

// -------------------------------------------------------------------------------------------------
// The page furniture, in the classes of components/design-system/specimen.tsx (a feature may not import it)

function Group({ title, note, children }: { title: string; note: string; children: ReactNode }): ReactElement {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="type-section-title">{title}</h2>
        <p className="type-meta">{note}</p>
      </header>
      {children}
    </section>
  );
}

/** A named box for one specimen, so the end-to-end test and the visual test find it. */
function Specimen({ name, title, children }: { name: string; title: string; children: ReactNode }): ReactElement {
  return (
    <div data-specimen={name} className="flex min-w-0 flex-col gap-2">
      <span className="type-label">{title}</span>
      {children}
    </div>
  );
}

// -------------------------------------------------------------------------------------------------
// Live specimen: the real provider on the mock API

const outcomeText = (outcome: SaveOutcome): string => (outcome.kind === 'failed' ? 'failed' : outcome.kind);

function LiveBar({ ai, onAiChange }: { ai: boolean; onAiChange: (checked: boolean) => void }): ReactElement {
  const { mode, resolved, canCustomize, canUndo, canRedo, saving, changes, actions } = useLayoutScreen();
  const [last, setLast] = useState<string>(COPY.noSave);
  const switchName = useId();
  const customizing = mode === 'customize';
  const changesText = `Changes: ${formatInteger(changes)}`;
  const modeText = `Mode: ${mode}. Layout from: ${resolved.source}. Last save: ${last}.`;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={!canCustomize || customizing}
          onClick={() => {
            actions.enter();
          }}
        >
          {COPY.customize}
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={!customizing || saving}
          onClick={() => {
            void actions.save().then((outcome) => setLast(outcomeText(outcome)));
          }}
        >
          {COPY.save}
        </Button>
        <Button
          size="sm"
          disabled={!customizing}
          onClick={() => {
            actions.exit();
          }}
        >
          {COPY.cancel}
        </Button>
        <Button
          size="sm"
          disabled={!canUndo}
          onClick={() => {
            actions.undo();
          }}
        >
          {COPY.undo}
        </Button>
        <Button
          size="sm"
          disabled={!canRedo}
          onClick={() => {
            actions.redo();
          }}
        >
          {COPY.redo}
        </Button>
        <span id={switchName} className="type-label">
          {COPY.aiChannel}
        </span>
        <Switch checked={ai} onCheckedChange={onAiChange} aria-labelledby={switchName} />
      </div>
      <p className="num type-meta">{changesText}</p>
      <p className="type-meta">{modeText}</p>
    </div>
  );
}

function LiveGrid(): ReactElement {
  const { actions } = useLayoutScreen();
  return (
    <LayoutGrid
      label={COPY.overviewGrid}
      onAddCard={(index) => {
        actions.addCard(ADDED_TYPE, index);
      }}
    />
  );
}

/** The first workspace of the signed-in person. Signed out, one sentence and no layout request. */
function LiveLayout(): ReactElement {
  const me = useQuery(meQuery());
  const [ai, setAi] = useState(true);
  const membership = me.data?.data.memberships[0];
  const capabilities = useMemo<Capabilities>(
    () => ({
      channels: ai ? SEO_AND_AI : SEO_ONLY,
      permissions: membership?.permissions ?? NO_PERMISSIONS,
      integrations: NO_INTEGRATIONS,
    }),
    [ai, membership],
  );
  if (me.isPending) return <p className="type-meta">{COPY.checking}</p>;
  if (membership === undefined) {
    return <p className="type-body">{me.isError ? COPY.signedOut : COPY.noWorkspace}</p>;
  }
  return (
    <PermissionProvider membership={membership}>
      <LayoutProvider
        screen="overview"
        workspaceId={membership.workspace.workspace_id}
        capabilities={capabilities}
        registry={GALLERY_CARDS}
      >
        <div className="flex flex-col gap-3">
          <LiveBar ai={ai} onAiChange={setAi} />
          <LiveGrid />
        </div>
      </LayoutProvider>
    </PermissionProvider>
  );
}

/**
 * Its own query cache, so a signed-out answer never sends this page to sign in. Not `makeQueryClient`: that
 * empties the cache on a 401, which would strand the `/me` query pending, and this page wants to read the 401.
 */
function LiveSpecimen(): ReactElement {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return (
    <QueryClientProvider client={client}>
      <div data-specimen="live" className="flex min-w-0 flex-col gap-3">
        <LiveLayout />
      </div>
    </QueryClientProvider>
  );
}

// -------------------------------------------------------------------------------------------------
// Static specimens: the same provider on a cache that holds one state

type StaticState = 'loading' | 'failed' | 'refetching' | 'ready';

/** The workspace of the static specimens: nobody's, so no request of theirs is ever answered with a layout. */
const STATIC_WORKSPACE = '00000000-0000-4000-8000-000000000001';
/** A workspace the mock does not know: its layout read fails for real, which is what the failure specimen shows. */
const UNKNOWN_WORKSPACE = '00000000-0000-4000-8000-0000000000ff';
const STATIC_MEMBERSHIP: MeMembership = {
  permissions: [],
  project_ids: null,
  role: 'viewer',
  workspace: { name: 'Gallery', slug: 'gallery', status: 'active', workspace_id: STATIC_WORKSPACE },
};

const THREE_CARDS: Schemas['LayoutDocument'] = {
  schema: 1,
  numbers: null,
  cards: [
    { id: 'chart', type: 'seo.rank_distribution', width: 'third' },
    { id: 'list', type: 'seo.top_movers', width: 'third' },
    { id: 'metric', type: 'seo.serp_features', width: 'third' },
  ],
};
const NO_CARDS: Schemas['LayoutDocument'] = { schema: 1, numbers: null, cards: [] };
const AI_CARDS: Schemas['LayoutDocument'] = {
  schema: 1,
  numbers: null,
  cards: [
    { id: 'by-engine', type: 'ai.by_engine', width: 'half' },
    { id: 'citations', type: 'ai.citation_share_by_domain_type', width: 'half' },
  ],
};

const answerOf = (screen: ScreenKey, document: Schemas['LayoutDocument'] | null): Schemas['ResolvedLayout'] => ({
  screen,
  source: document === null ? 'builtin' : 'personal',
  document,
  team_default_exists: false,
  team_document: null,
  updated_at: document === null ? null : '2026-11-10T09:12:44Z',
  updated_by: document === null ? null : { user_id: '0192d1a8-5b10-7c01-9a11-000000000003', name: 'Priya Natarajan' },
});

/** A read that never answers: loading and refetching are states a person sees for a moment, held here. */
const neverAnswers = (): Promise<LayoutRead> => new Promise<LayoutRead>(() => undefined);

/**
 * A cache that holds one state of the layout read. Nothing goes stale in it, so no window focus sends a request;
 * the failure specimen is the exception, it reads a workspace the mock does not know and so fails for real.
 */
function staticClient(
  state: StaticState,
  workspaceId: string,
  screen: ScreenKey,
  document: Schemas['LayoutDocument'] | null,
): QueryClient {
  const client = makeQueryClient({ retry: false, onSignedOut: () => false });
  client.setDefaultOptions({ queries: { staleTime: Infinity, retry: false } });
  const queryKey = layoutQueryKey(workspaceId, screen);
  if (state === 'ready' || state === 'refetching') {
    client.setQueryData<LayoutRead>(queryKey, { layout: answerOf(screen, document), etag: '"gallery"' });
  }
  if (state === 'loading' || state === 'refetching')
    void client.fetchQuery({ queryKey, queryFn: neverAnswers, staleTime: 0 });
  return client;
}

interface StaticProviderProps {
  state: StaticState;
  screen: ScreenKey;
  document: Schemas['LayoutDocument'] | null;
  capabilities: Capabilities;
  children: ReactNode;
}

function StaticProvider({ state, screen, document, capabilities, children }: StaticProviderProps): ReactElement {
  const workspaceId = state === 'failed' ? UNKNOWN_WORKSPACE : STATIC_WORKSPACE;
  const [client] = useState(() => staticClient(state, workspaceId, screen, document));
  return (
    <QueryClientProvider client={client}>
      <PermissionProvider membership={STATIC_MEMBERSHIP}>
        <LayoutProvider screen={screen} workspaceId={workspaceId} capabilities={capabilities} registry={GALLERY_CARDS}>
          {children}
        </LayoutProvider>
      </PermissionProvider>
    </QueryClientProvider>
  );
}

function StaticGrid({ label, columns }: { label: string; columns?: 'grid' | 'one' }): ReactElement {
  const { actions } = useLayoutScreen();
  return (
    <LayoutGrid
      label={label}
      columns={columns}
      onAddCard={(index) => {
        actions.addCard(ADDED_TYPE, index);
      }}
      emptyAction={
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            actions.enter();
          }}
        >
          {COPY.customize}
        </Button>
      }
    />
  );
}

interface StateSpecimenDefinition {
  name: string;
  title: string;
  state: StaticState;
  document: Schemas['LayoutDocument'] | null;
  capabilities: Capabilities;
}

const STATE_SPECIMENS: readonly StateSpecimenDefinition[] = [
  { name: 'loading', title: 'Loading', state: 'loading', document: THREE_CARDS, capabilities: WITH_AI },
  { name: 'failed', title: 'Read failure', state: 'failed', document: null, capabilities: WITH_AI },
  { name: 'refetching', title: 'Refetching', state: 'refetching', document: THREE_CARDS, capabilities: WITH_AI },
  { name: 'empty', title: 'Empty', state: 'ready', document: NO_CARDS, capabilities: WITH_AI },
  {
    name: 'empty-unavailable',
    title: 'Empty, unavailable',
    state: 'ready',
    document: AI_CARDS,
    capabilities: WITHOUT_AI,
  },
];

function StateSpecimen({ name, title, state, document, capabilities }: StateSpecimenDefinition): ReactElement {
  const label = `${COPY.overviewGrid}, ${title.toLowerCase()}`;
  return (
    <Specimen name={name} title={title}>
      <StaticProvider state={state} screen="overview" document={document} capabilities={capabilities}>
        <StaticGrid label={label} />
      </StaticProvider>
    </Specimen>
  );
}

const reorderLabel = (item: CardItem): string => `Reorder ${cardName(item)}`;

/** The grid draws these with `dragState` while a card is dragged or picked up by keyboard. */
function PickedFrames(): ReactElement {
  const { document, mode, canCustomize, actions } = useLayoutScreen();
  useEffect(() => {
    if (canCustomize && mode === 'view') actions.enter();
  }, [canCustomize, mode, actions]);
  const cards = (document.cards ?? []).slice(0, 2);
  return (
    <div className="grid grid-cols-12 gap-4">
      {cards.map((item, index) => (
        <CardFrame
          key={item.id}
          item={item}
          className="col-span-12 md:col-span-6"
          dragState={index === 0 ? 'picked' : 'dragging'}
          handle={
            <IconButton
              icon={GripVertical}
              label={reorderLabel(item)}
              aria-pressed={index === 0}
              className="touch-none"
            />
          }
        >
          <FixtureBody item={item} />
        </CardFrame>
      ))}
    </div>
  );
}

/**
 * The layout grid, its frame and its toolbar on the real provider and the mock API of this app, and the states they
 * keep. The only user is the page /design-system/layouts-live.
 */
export function LayoutsLive(): ReactElement {
  return (
    <div className="flex flex-col gap-6">
      <Group title={COPY.liveTitle} note={COPY.liveNote}>
        <LiveSpecimen />
      </Group>
      <Group title={COPY.statesTitle} note={COPY.statesNote}>
        <div className="flex flex-col gap-6">
          {STATE_SPECIMENS.map((specimen) => (
            <StateSpecimen key={specimen.name} {...specimen} />
          ))}
        </div>
      </Group>
      <Group title={COPY.pickedTitle} note={COPY.pickedNote}>
        <Specimen name="picked" title={COPY.pickedSpecimen}>
          <StaticProvider state="ready" screen="overview" document={THREE_CARDS} capabilities={WITH_AI}>
            <PickedFrames />
          </StaticProvider>
        </Specimen>
      </Group>
      <Group title={COPY.drawerTitle} note={COPY.drawerNote}>
        <Specimen name="drawer" title={COPY.drawerSpecimen}>
          <div className="w-inspector max-w-full">
            <StaticProvider state="ready" screen="inspector.keyword" document={null} capabilities={WITH_AI}>
              <StaticGrid label={COPY.drawerGrid} columns="one" />
            </StaticProvider>
          </div>
        </Specimen>
      </Group>
    </div>
  );
}
