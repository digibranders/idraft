'use client';

import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { useId, useState, type ReactElement, type ReactNode } from 'react';

import { CustomizableGrid, CustomizableScreen } from './customize/customizable-screen';
import { CustomizeButton } from './customize/customize-button';
import { CustomizingBadge } from './customize/customizing-badge';
import { GALLERY_CARDS } from './live-fixtures';
import { NumberStrip } from './numbers/number-strip';
import { specimenValueOf } from './numbers/number-strip-specimen-values';
import { definePresets } from './presets/presets';
import { defineCards, type CardRegistry } from './registry';
import { useLayoutCapabilities } from './use-layout-capabilities';
import { PageHeader } from '@/components/app/shell/page-header';
import { Select } from '@/components/ui/select';
import { apiQuery } from '@/lib/api/query';
import type { MeMembership } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { meQuery } from '@/lib/session/me-query';

/*
 * The customize UI of WP-16 on the gallery page /design-system/layouts-live (docs/superpowers/plans/
 * 2026-11-13-ai-wp-16-layouts-customize.md): the real CustomizableScreen on the mock API, on the overview of the
 * signed-in person's first workspace, with a project select that changes what the cards may show. Later tasks add
 * their parts to this one screen. A feature may not import the design-system folder, so the page furniture is
 * written here again; the gallery is for the team and is never translated, so its words are kept in one table.
 */
const COPY = {
  title: 'Customize mode, live',
  note: 'WP-16. The real customize UI on the mock API: the Customize button and badge in the page header, Escape, the question before changes are lost, Undo and Redo with Ctrl or Cmd Z. A saved layout is kept in a cookie of the mock, so a reload keeps it. A project with AI tracking off shows placeholders for the AI cards. The SERP features card fails its first load: add it, save, and Retry in view mode loads it. Hide offers Undo in a toast, and More has Duplicate. Start from in the save bar applies the built-in layout, the team default, or one of two fixture presets to the draft; nothing is stored until Save.',
  project: 'Project',
  presetExecutive: 'Executive summary',
  presetSeo: 'SEO focus',
  pageTitle: 'Overview',
  grid: 'Customizable overview cards',
  numbers: 'Overview numbers',
  checking: 'Checking who is signed in.',
  signedOut: 'Sign in to try customize mode. While you are signed out this page asks for no layout.',
  noWorkspace: 'This person has no workspace, so there is no layout to show.',
  loadingProjects: 'Loading the projects of the workspace.',
  noProject: 'The workspace has no project, so there is nothing to scope the cards to.',
  projectsFailed: 'The projects could not be read.',
} as const;

const PROJECTS = '/api/v1/workspaces/{workspace_id}/projects';

/** The card whose code fails to load the first time, so the error state and Retry can be tried. */
const FAILING_TYPE = 'seo.serp_features';
let failingLoads = 0;

/**
 * The gallery's cards, with SERP features made to fail its first load (add it from the catalog, save, and view the
 * page): Retry then loads it. Fixture only: no production registry has a card like this.
 */
const CUSTOMIZE_CARDS: CardRegistry = {
  ...GALLERY_CARDS,
  ...defineCards({
    [FAILING_TYPE]: {
      load: () => {
        failingLoads += 1;
        const working = GALLERY_CARDS[FAILING_TYPE];
        if (failingLoads === 1 || working === undefined) {
          return Promise.reject(new Error('The code of this card could not be loaded'));
        }
        return Promise.resolve({ default: working.Component });
      },
    },
  }),
};

/**
 * Two presets of the overview for the Start from menu. Their cards are half or full width, which are 6 and 12 of
 * 12 columns at 1280 and at 768 px, so every row is full there and applying one leaves no part empty row.
 * Fixtures: the real overview's presets are WP-33's.
 */
const PRESETS = definePresets('overview', [
  {
    id: 'executive',
    label: COPY.presetExecutive,
    document: {
      schema: 1,
      numbers: [
        { id: 'visibility', metric: 'seo.visibility_volume' },
        { id: 'aio-citation', metric: 'seo.aio_citation_rate' },
        { id: 'mention-chatgpt', metric: 'ai.mention_rate', engine: 'chatgpt_web' },
      ],
      cards: [
        { id: 'trend', type: 'trend.visibility_mentions', width: 'full' },
        { id: 'matrix', type: 'cross.matrix_summary', width: 'half' },
        { id: 'opportunities', type: 'cross.opportunities', width: 'half', options: { rows: '5' } },
        { id: 'ai-by-engine', type: 'ai.by_engine', width: 'half' },
        { id: 'competitors', type: 'competitors.summary', width: 'half' },
        { id: 'key-changes', type: 'activity.key_changes', width: 'full', options: { rows: '5' } },
      ],
    },
  },
  {
    id: 'seo',
    label: COPY.presetSeo,
    document: {
      schema: 1,
      numbers: [
        { id: 'visibility', metric: 'seo.visibility_volume' },
        { id: 'top10', metric: 'seo.top10_count' },
      ],
      cards: [
        { id: 'ranks', type: 'seo.rank_distribution', width: 'half' },
        { id: 'movers', type: 'seo.top_movers', width: 'half', options: { direction: 'all', rows: '5' } },
        { id: 'share', type: 'competitors.share_of_voice', width: 'half', options: { channel: 'seo' } },
        { id: 'status', type: 'activity.collection_status', width: 'half' },
        { id: 'key-changes', type: 'activity.key_changes', width: 'full', options: { rows: '8' } },
      ],
    },
  },
]);

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

interface ProjectScreenProps {
  membership: MeMembership;
  projectId: string;
}

/** The screen of the workspace. A project change reaches the cards through the capabilities and nothing else. */
function ProjectScreen({ membership, projectId }: ProjectScreenProps): ReactElement {
  const workspaceId = membership.workspace.workspace_id;
  const { capabilities } = useLayoutCapabilities({ workspaceId, projectId });
  return (
    <CustomizableScreen
      screen="overview"
      workspaceId={workspaceId}
      workspaceName={membership.workspace.name}
      capabilities={capabilities}
      registry={CUSTOMIZE_CARDS}
      presets={PRESETS}
    >
      <PageHeader title={COPY.pageTitle} titleAddon={<CustomizingBadge />} actions={<CustomizeButton />} />
      <NumberStrip label={COPY.numbers} valueOf={specimenValueOf} status="ready" />
      <CustomizableGrid label={COPY.grid} />
    </CustomizableScreen>
  );
}

function WorkspaceScreen({ membership }: { membership: MeMembership }): ReactElement {
  const workspaceId = membership.workspace.workspace_id;
  const projects = useQuery(apiQuery(PROJECTS, { params: { path: { workspace_id: workspaceId } } }));
  const [chosen, setChosen] = useState<string | null>(null);
  const labelId = useId();
  if (projects.isPending) return <p className="type-meta">{COPY.loadingProjects}</p>;
  const list = projects.data?.data ?? [];
  const projectId = chosen ?? list[0]?.project_id ?? null;
  if (projectId === null) {
    return <p className="type-body">{projects.isError ? COPY.projectsFailed : COPY.noProject}</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span id={labelId} className="type-label">
          {COPY.project}
        </span>
        <Select
          aria-labelledby={labelId}
          value={projectId}
          onValueChange={setChosen}
          placeholder={COPY.project}
          options={list.map((project) => ({ value: project.project_id, label: project.name }))}
          size="sm"
          className="w-64 max-w-full"
        />
      </div>
      <ProjectScreen membership={membership} projectId={projectId} />
    </div>
  );
}

/** The first workspace of the signed-in person. Signed out, one sentence and no layout request. */
function Specimen(): ReactElement {
  const me = useQuery(meQuery());
  const membership = me.data?.data.memberships[0];
  if (me.isPending) return <p className="type-meta">{COPY.checking}</p>;
  if (membership === undefined) {
    return <p className="type-body">{me.isError ? COPY.signedOut : COPY.noWorkspace}</p>;
  }
  return (
    <PermissionProvider membership={membership}>
      <WorkspaceScreen membership={membership} />
    </PermissionProvider>
  );
}

/**
 * The customize UI on the mock API. The only user is the page /design-system/layouts-live. Its own query cache, as
 * the live specimen of WP-15 has, so a signed-out answer never sends this page to sign in.
 */
export function LayoutsCustomizeLive(): ReactElement {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return (
    <Group title={COPY.title} note={COPY.note}>
      <QueryClientProvider client={client}>
        <div data-specimen="customize" className="flex min-w-0 flex-col gap-3">
          <Specimen />
        </div>
      </QueryClientProvider>
    </Group>
  );
}
