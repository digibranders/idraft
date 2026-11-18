'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { competitorOf, useCompetitorRead } from './data/use-competitor-read';
import { useScopeParts } from './data/use-scope-parts';
import { DrawerCard } from './drawer-card';
import type { PromptView } from './model/prompt-lists';
import { OverviewTab } from './overview-tab';
import { PromptsTab } from './prompts-tab';
import { SourcesTab } from './sources-tab';
import { trackedSetQuery } from '../cards/competitors/data/tracked-set-query';
import type { TrackedEntity } from '../cards/competitors/model/types';
import { useOverview } from '../overview-context';
import { Inspector } from '@/components/app/inspector/inspector';
import { InspectorBody, InspectorPanel, InspectorTabs } from '@/components/app/inspector/inspector-tabs';
import { EmptyState } from '@/components/app/status/empty-state';
import { Badge } from '@/components/ui/badge';
import { announce } from '@/lib/a11y/announcer';
import { formatInteger } from '@/lib/format';
import { Scale } from 'lucide-react';

export const COMPETITOR_TABS = ['overview', 'prompts', 'sources'] as const;
export type CompetitorTab = (typeof COMPETITOR_TABS)[number];

const isTab = (value: string): value is CompetitorTab => COMPETITOR_TABS.some((tab) => tab === value);

export interface CompetitorInspectorProps {
  /** The competitor's entity id, from `inspect=competitor:<id>`. */
  id: string;
  tab: string;
  onTabChange: (tab: CompetitorTab) => void;
  onClose: () => void;
  /** Steps to another competitor, keeping the tab (OV-DRW-05). */
  onStep: (id: string) => void;
  view: PromptView;
  onViewChange: (view: PromptView) => void;
}

/**
 * The competitor drawer (OV-DRW-01 to OV-DRW-08, 440 px): the inspector of the page for one tracked brand. It reads the
 * page scope, so its numbers are the cards' (R12) and follow the scope when it changes. The header names the competitor,
 * its domain, the platform and the group; Previous, Next, J and K step through the competitors in the order of the
 * Competitor gap card and wrap around.
 */
export function CompetitorInspector({
  id,
  tab,
  onTabChange,
  onClose,
  onStep,
  view,
  onViewChange,
}: CompetitorInspectorProps): ReactElement {
  const t = useTranslations('aiOverview.competitorDrawer');
  const inspectorWords = useTranslations('inspector');
  const stepping = useTranslations('common.inspectorStepping');
  const { workspaceId, project } = useOverview();
  const read = useCompetitorRead();
  const scope = useScopeParts();
  const entities = useQuery(trackedSetQuery({ workspaceId, projectId: project.id }));
  const competitor: TrackedEntity | undefined = competitorOf(read.set, id);
  const domain = entities.data?.data
    .find((row) => row.entity.entity_id === id)
    ?.domains.find((entry) => entry.domain.registrable_domain !== '')?.domain.registrable_domain;

  const ids = read.order.map((entry) => entry.entity.entityId);
  const index = ids.indexOf(id);
  const step = (delta: 1 | -1): void => {
    const next = ids[(index + delta + ids.length) % ids.length];
    if (next === undefined || next === id) return;
    onStep(next);
    const name = read.order.find((entry) => entry.entity.entityId === next)?.entity.name ?? '';
    announce(
      stepping('announce', {
        type: name,
        index: formatInteger(((index + delta + ids.length) % ids.length) + 1),
        count: formatInteger(ids.length),
      }),
      { key: 'inspector-step' },
    );
  };
  const steppable = index !== -1 && ids.length > 1;

  const active: CompetitorTab = isTab(tab) ? tab : 'overview';
  const notFound = competitor === undefined && (read.status === 'ready' || read.status === 'refetching');
  let body: ReactElement;
  if (competitor !== undefined) {
    body = (
      <InspectorTabs<CompetitorTab>
        label={t('tabsLabel')}
        value={active}
        onValueChange={onTabChange}
        items={[
          { value: 'overview', label: t('tabOverview') },
          { value: 'prompts', label: t('tabPrompts') },
          { value: 'sources', label: t('tabSources') },
        ]}
      >
        <InspectorPanel<CompetitorTab> value="overview">
          <OverviewTab read={read} competitor={competitor} />
        </InspectorPanel>
        <InspectorPanel<CompetitorTab> value="prompts">
          <PromptsTab read={read} competitor={competitor} view={view} onViewChange={onViewChange} />
        </InspectorPanel>
        <InspectorPanel<CompetitorTab> value="sources">
          <SourcesTab read={read} competitor={competitor} />
        </InspectorPanel>
      </InspectorTabs>
    );
  } else if (notFound || read.status === 'idle') {
    body = (
      <InspectorBody>
        <EmptyState
          variant="inline"
          title={t('notFound')}
          reason={inspectorWords('notFound', { type: t('noun') })}
          headingLevel={3}
        />
      </InspectorBody>
    );
  } else {
    // The competitor is not known until the summary is read: one card holds its place, or says the read failed
    body = (
      <InspectorBody>
        <DrawerCard
          title={t('type')}
          icon={Scale}
          info={{ what: t('summary.info.what'), how: t('summary.info.how') }}
          state={
            read.status === 'error'
              ? { status: 'error', errorId: read.errorId, retry: read.retry }
              : { status: 'loading' }
          }
          errorTitle={t('errorTitle')}
        />
      </InspectorBody>
    );
  }

  return (
    <Inspector
      type="competitor"
      backLabel={inspectorWords('back', { page: t('back') })}
      onClose={onClose}
      onStep={steppable ? (direction) => step(direction === 'next' ? 1 : -1) : undefined}
      header={{
        title: competitor?.name ?? '',
        typeLabel: t('type'),
        typeNoun: t('noun'),
        positionText:
          index === -1
            ? null
            : stepping('position', { index: formatInteger(index + 1), count: formatInteger(ids.length) }),
        freshness: t('tracked'),
        badges:
          competitor === undefined ? undefined : (
            <>
              {domain === undefined ? null : <Badge>{domain}</Badge>}
              <Badge>{scope.platform}</Badge>
              <Badge>{scope.group}</Badge>
            </>
          ),
        navigation: steppable
          ? { onPrevious: () => step(-1), onNext: () => step(1), atFirst: false, atLast: false }
          : null,
      }}
    >
      {body}
    </Inspector>
  );
}
