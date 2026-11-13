'use client';

import { Ban } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';

import { AI_OVERVIEW_CARDS } from './cards/registry';
import { OverviewHeader } from './header/overview-header';
import { OverviewProvider, useOverview, type OverviewProject } from './overview-context';
import { GridPlaceholder, ScopeBarPlaceholder, StripPlaceholder } from './overview-placeholders';
import { EnginesError } from './states/engines-error';
import { NoEngineState } from './states/no-engine-state';
import { PAGE_CLASS, PageHeader } from '@/components/app/shell/page-header';
import { EmptyState } from '@/components/app/status/empty-state';
import {
  CustomizableGrid,
  CustomizableScreen,
  useLayoutCapabilities,
  useLayoutScreen,
  type LayoutPreset,
} from '@/features/layouts';
import { useCan, useMembership } from '@/lib/permissions';

export interface AiOverviewScreenProps {
  workspaceId: string;
  workspaceSlug: string;
  project: OverviewProject;
  /** What the Start from menu of the save bar offers besides the built-in layout (the presets of T6). */
  presets?: readonly LayoutPreset[];
}

/**
 * The rhythm of the approved preview's Overview: gutters of 12, 16 and 20 px at 390, 768 and 1024 px, 20 px above
 * the header and 16 px between the blocks. `PAGE_CLASS` is the table pages' rhythm (12 px, 12 px).
 */
const OVERVIEW_PAGE_CLASS = 'flex flex-col gap-4 px-3 pt-5 pb-8 md:px-4 lg:px-5';

const NO_PRESETS: readonly LayoutPreset[] = [];

/**
 * The page's body in each of its states. The engines decide what the page can say, so until they are read it holds
 * the shape of the finished page (no empty state is ever drawn from `loading`). With no engine on, or when they
 * could not be read, view mode has nothing to count and says so; customize mode keeps the grid, so a person can
 * still arrange the layout, with the AI cards as placeholders that say why.
 */
function OverviewBody(): ReactElement {
  const t = useTranslations('aiOverview');
  const { engines, enabledEngines } = useOverview();
  const { mode } = useLayoutScreen();
  const customizing = mode === 'customize';
  let content: ReactNode;
  if (engines.status === 'loading') {
    content = (
      <>
        <StripPlaceholder />
        <ScopeBarPlaceholder />
        <GridPlaceholder />
      </>
    );
  } else if (!customizing && engines.status === 'error') {
    content = <EnginesError />;
  } else if (!customizing && enabledEngines.length === 0) {
    content = <NoEngineState />;
  } else {
    content = (
      <>
        {/* The strip (T8) and the scope bar (T7) take these places */}
        <StripPlaceholder />
        <ScopeBarPlaceholder />
        <CustomizableGrid label={t('cards')} />
      </>
    );
  }
  return (
    <div className={OVERVIEW_PAGE_CLASS}>
      <OverviewHeader />
      {content}
    </div>
  );
}

function CustomizableOverview({ presets }: { presets: readonly LayoutPreset[] }): ReactElement {
  const { workspaceId, project } = useOverview();
  const { workspace } = useMembership();
  const { capabilities } = useLayoutCapabilities({ workspaceId, projectId: project.id });
  return (
    <CustomizableScreen
      screen="ai_overview"
      workspaceId={workspaceId}
      workspaceName={workspace.name}
      capabilities={capabilities}
      registry={AI_OVERVIEW_CARDS}
      presets={presets}
    >
      <OverviewBody />
    </CustomizableScreen>
  );
}

/**
 * AI > Overview (WP-33, 24 section 9.2): the project's AI visibility as a customizable dashboard. A member without
 * `data:read` is told so and nothing is read. The cards are the card packages' (WP-34 to 37); until a package lists
 * its cards in `cards/*`, each shows its pending placeholder.
 */
export function AiOverviewScreen({ presets = NO_PRESETS, ...props }: AiOverviewScreenProps): ReactElement {
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
      <CustomizableOverview presets={presets} />
    </OverviewProvider>
  );
}
