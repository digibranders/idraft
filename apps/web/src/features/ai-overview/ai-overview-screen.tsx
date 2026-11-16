'use client';

import { Ban } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement, type ReactNode } from 'react';

import { AI_OVERVIEW_CARDS } from './cards/registry';
import { ExportProvider } from './export/export-registry';
import { cardMinHeight } from './states/card-min-height';
import { OverviewFreshness } from './header/overview-freshness';
import { OverviewHeader } from './header/overview-header';
import { OverviewNotices } from './notices/overview-notices';
import { useOverviewNotice } from './notices/use-overview-notice';
import { OverviewProvider, useOverview, useOverviewPeriods, type OverviewProject } from './overview-context';
import { GridPlaceholder, ScopeBarPlaceholder } from './overview-placeholders';
import { buildOverviewPresets } from './presets/presets';
import { ScopeBar } from './scope/scope-bar';
import { SeveralPlatformsNotice } from './scope/several-platforms-notice';
import { EnginesError } from './states/engines-error';
import { NoEngineState } from './states/no-engine-state';
import { NoCountryPromptsState, NoGroupPromptsState, NoPromptsState } from './states/no-prompts-state';
import { CardInfoProvider } from '@/components/app/chart/card-info';
import { StatusChip } from '@/components/app/page-toolbar';
import { PAGE_CLASS, PageHeader } from '@/components/app/shell/page-header';
import { EmptyState } from '@/components/app/status/empty-state';
import { RefetchBar } from '@/components/app/status/refetch-bar';
import {
  CustomizableGrid,
  CustomizableScreen,
  useLayoutCapabilities,
  useLayoutScreen,
  type LayoutPreset,
} from '@/features/layouts';
import { useCan, useMembership } from '@/lib/permissions';
import type { CardItem } from '@/lib/layouts';
import { projectPath } from '@/lib/routes/paths';

export interface AiOverviewScreenProps {
  workspaceId: string;
  workspaceSlug: string;
  project: OverviewProject;
  /** What the Start from menu offers besides the built-in layout; the page's own four presets when omitted (tests set it). */
  presets?: readonly LayoutPreset[];
  /**
   * The setup checklist, which the route passes in (a route may import the onboarding feature, this feature may
   * not). It sits in the notice region under the header, and is left out where an empty state says the same step.
   */
  setupSlot?: ReactNode;
}

/**
 * The rhythm of the approved preview's Overview: gutters of 12, 16 and 20 px at 390, 768 and 1024 px, 12 px above
 * the header and 12 px between the blocks.
 */
const OVERVIEW_PAGE_CLASS = 'flex flex-col gap-3 px-3 pt-3 pb-8 md:px-4 lg:px-5';

/** Every card keeps its smallest height in every scope (preview commit 98e7d226), so the cards below do not jump. */
const minHeightOf = (item: CardItem): string => cardMinHeight(item.type);

/**
 * The page's body in each of its states. The engines decide what the page can say, so until they are read it holds
 * the shape of the finished page (no empty state is ever drawn from `loading`). With no engine on, or when they
 * could not be read, view mode has nothing to count and says so; customize mode keeps the grid, so a person can
 * still arrange the layout, with the AI cards as placeholders that say why.
 */
function OverviewBody({ setupSlot }: { setupSlot: ReactNode }): ReactElement {
  const t = useTranslations('aiOverview');
  const tNotices = useTranslations('aiOverview.notices');
  const { engines, workspaceSlug, project } = useOverview();
  const { mode } = useLayoutScreen();
  const { notice, settled } = useOverviewNotice();
  const periods = useOverviewPeriods();
  const customizing = mode === 'customize';
  // Values of the last scope stay on screen while this one is read: the grid says so, and the bar shows
  const refetching = periods.current.status === 'refetching' || periods.previous?.status === 'refetching';
  const empty = customizing ? null : notice?.kind;

  // The setup checklist is left out where an empty state already says the same step and gives its action (turn on
  // an engine, add prompts). While the engines load it holds its place, so the page does not move when it arrives
  const showSetup = notice?.kind !== 'noEngine' && notice?.kind !== 'noPrompts';

  const pausedChip =
    notice?.kind === 'paused' ? (
      <StatusChip
        label={tNotices('pausedChip')}
        href={projectPath(workspaceSlug, project.slug, '/settings/schedules')}
        tooltip={tNotices('paused')}
        tone="warning"
      />
    ) : null;

  if (engines.status === 'loading') {
    return (
      <div className={OVERVIEW_PAGE_CLASS}>
        <OverviewHeader filters={<ScopeBarPlaceholder />} setupSlot={showSetup ? setupSlot : null} />
        <GridPlaceholder />
      </div>
    );
  }

  if (!customizing && engines.status === 'error') {
    return (
      <div className={OVERVIEW_PAGE_CLASS}>
        <OverviewHeader setupSlot={showSetup ? setupSlot : null} />
        <EnginesError />
      </div>
    );
  }

  if (empty === 'noEngine') {
    return (
      <div className={OVERVIEW_PAGE_CLASS}>
        <OverviewHeader setupSlot={showSetup ? setupSlot : null} />
        <NoEngineState />
      </div>
    );
  }

  if (empty === 'noPrompts') {
    return (
      <div className={OVERVIEW_PAGE_CLASS}>
        <OverviewHeader setupSlot={showSetup ? setupSlot : null} />
        <NoPromptsState />
      </div>
    );
  }

  // A location or a group with no prompt leaves the grid out; the scope bar stays, in the same place in
  // the tree whatever the body, so a control the person is using is not remounted when the answer comes
  const scopeEmpty =
    !customizing && (notice?.kind === 'noCountryPrompts' || notice?.kind === 'noGroupPrompts') ? notice : null;

  const scopeFilters = (
    <div className="relative">
      <ScopeBar />
      <RefetchBar active={refetching} position="under-filter-bar" />
    </div>
  );

  return (
    <div className={OVERVIEW_PAGE_CLASS}>
      <OverviewHeader filters={scopeFilters} noticeChip={pausedChip} setupSlot={showSetup ? setupSlot : null} />
      {notice?.kind !== 'paused' ? <OverviewNotices notice={notice} settled={settled} /> : null}
      {scopeEmpty === null ? (
        <div aria-busy={refetching || undefined}>
          <CustomizableGrid label={t('cards')} cardClassName={minHeightOf} />
        </div>
      ) : scopeEmpty.kind === 'noCountryPrompts' ? (
        <NoCountryPromptsState country={scopeEmpty.country} />
      ) : (
        <NoGroupPromptsState topic={scopeEmpty.topic} />
      )}
      <OverviewFreshness place="foot" />
    </div>
  );
}

function CustomizableOverview({
  presets,
  setupSlot,
}: {
  presets: readonly LayoutPreset[] | undefined;
  setupSlot: ReactNode;
}): ReactElement {
  const t = useTranslations('aiOverview');
  const { workspaceId, project } = useOverview();
  const ownPresets = useMemo(
    () =>
      buildOverviewPresets({
        executive: t('presets.executive'),
        analyst: t('presets.analyst'),
        competitive: t('presets.competitive'),
      }),
    [t],
  );
  const { workspace } = useMembership();
  const { capabilities } = useLayoutCapabilities({ workspaceId, projectId: project.id });
  return (
    <CustomizableScreen
      screen="ai_overview"
      workspaceId={workspaceId}
      workspaceName={workspace.name}
      capabilities={capabilities}
      registry={AI_OVERVIEW_CARDS}
      presets={presets ?? ownPresets}
    >
      <CardInfoProvider>
        <SeveralPlatformsNotice />
        <OverviewBody setupSlot={setupSlot} />
      </CardInfoProvider>
    </CustomizableScreen>
  );
}

/**
 * AI > Overview (WP-33, 24 section 9.2): the project's AI visibility as a customizable dashboard. A member without
 * `data:read` is told so and nothing is read. The cards are the card packages' (WP-34 to 37); until a package lists
 * its cards in `cards/*`, each shows its pending placeholder.
 */
export function AiOverviewScreen({ presets, setupSlot, ...props }: AiOverviewScreenProps): ReactElement {
  const t = useTranslations('aiOverview');
  const canRead = useCan('data:read');
  if (!canRead) {
    return (
      <div className={PAGE_CLASS}>
        <PageHeader title={t('title')} />
        <EmptyState icon={Ban} title={t('noAccessTitle')} reason={t('noAccessReason')} headingLevel={2} />
      </div>
    );
  }
  return (
    <OverviewProvider {...props}>
      <ExportProvider>
        <CustomizableOverview presets={presets} setupSlot={setupSlot} />
      </ExportProvider>
    </OverviewProvider>
  );
}
