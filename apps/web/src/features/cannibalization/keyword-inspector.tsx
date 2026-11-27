'use client';

import { useTranslations } from 'next-intl';
import { useContext, useMemo, type ReactElement } from 'react';

import { groupNames, pageRefs, switchList, timelineLanes } from './cann-evidence';
import type { CannTab } from './cann-model';
import { useKeywordDetail, type CannScope } from './cann-reads';
import { useCannState } from './cann-state';
import { VerdictBadge } from './cann-parts';
import { InspectorEvidence } from './inspector-evidence';
import { InspectorOptions } from './inspector-options';
import { InspectorPages } from './inspector-pages';
import { InspectorTimeline } from './inspector-timeline';
import { Inspector } from '@/components/app/inspector/inspector';
import { InspectorBody, InspectorPanel, InspectorTabs } from '@/components/app/inspector/inspector-tabs';
import { DEFAULT_INSPECTOR_TAB, useInspector } from '@/components/app/inspector/use-inspector';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { formatInteger } from '@/lib/format';
import { CannOrderContext } from '@/lib/inspector/cann-order';
import { useKeywordGroups } from '@/lib/keywords/taxonomy-reads';

export interface CannKeywordInspectorProps {
  workspaceId: string;
  workspaceSlug: string;
  projectId: string;
  projectSlug: string;
  /** The page's tab, which the address reads its view from. */
  tab: CannTab;
}

const TAB_IDS = [DEFAULT_INSPECTOR_TAB, 'timeline', 'pages'] as const;
type TabId = (typeof TAB_IDS)[number];
const isTabId = (value: string): value is TabId => TAB_IDS.some((id) => id === value);

/**
 * The keyword inspector of the Cannibalization page (docs/33 section 7.2; `inspect=cann-keyword:<tracked keyword id>`):
 * Evidence, Timeline and Pages for one keyword over the page's device and period. The page composes it into
 * `CannScreen` as `keywordInspector`; it shows when the address names a keyword and reads the table's order from
 * `CannOrderContext` for J and K.
 */
export function CannKeywordInspector(props: CannKeywordInspectorProps): ReactElement | null {
  const inspector = useInspector();
  const target = inspector.target;
  if (target === null || target.type !== 'cann-keyword') return null;
  return <KeywordDrawer {...props} keywordId={target.id} />;
}

function KeywordDrawer({
  workspaceId,
  workspaceSlug,
  projectId,
  projectSlug,
  tab: pageTab,
  keywordId,
}: CannKeywordInspectorProps & { keywordId: string }): ReactElement {
  const t = useTranslations('cannibalization.inspector');
  const page = useTranslations('cannibalization');
  const words = useTranslations('inspector');
  const common = useTranslations('common');
  const toolbar = useTranslations('cannibalization.toolbar');
  const inspector = useInspector();
  const order = useContext(CannOrderContext);
  const { state } = useCannState(pageTab);
  const scope = useMemo((): CannScope => ({ workspaceId, projectId }), [workspaceId, projectId]);
  const read = useKeywordDetail(scope, keywordId, state);
  const detail = read.data;
  const groups = useKeywordGroups(scope);
  // With the last keyword kept on screen while the next loads, the detail may not be this keyword's yet
  const stale = detail !== undefined && (detail.keyword.tracked_keyword_id !== keywordId || read.refetching);

  const refs = useMemo(() => (detail === undefined ? [] : pageRefs(detail)), [detail]);
  const lanes = useMemo(() => (detail === undefined ? [] : timelineLanes(detail, refs)), [detail, refs]);
  const switches = useMemo(() => (detail === undefined ? [] : switchList(detail, refs)), [detail, refs]);

  const at = inspector.position(order);
  const step = (direction: 'next' | 'previous'): void => inspector.step(direction, order);
  const current: TabId = isTabId(inspector.tab) ? inspector.tab : DEFAULT_INSPECTOR_TAB;
  const keyword = detail?.keyword;
  const volume = keyword?.volume ?? null;
  const groupList = useMemo(
    () =>
      keyword === undefined || groups.data === undefined
        ? []
        : groupNames(
            keyword.group_ids,
            groups.data.data.map((group) => ({ id: group.group_id, name: group.path })),
          ),
    [keyword, groups.data],
  );

  let body: ReactElement;
  if (read.status === 'error') {
    body = (
      <InspectorBody>
        {read.forbidden ? (
          <EmptyState variant="inline" title={t('notFoundTitle')} reason={t('notFoundReason')} headingLevel={3} />
        ) : (
          <InlineError
            title={t('loadFailed')}
            reason={t('loadFailedReason')}
            errorId={read.errorId}
            onRetry={read.retry}
            retrying={read.retrying}
            retryLabel={common('retry')}
          />
        )}
      </InspectorBody>
    );
  } else if (detail === undefined || keyword === undefined) {
    body = (
      <InspectorBody>
        <div role="status" aria-busy="true" className="flex flex-col gap-3">
          <Skeleton shape="block" className="h-28 w-full" />
          <Skeleton shape="block" className="h-44 w-full" />
        </div>
      </InspectorBody>
    );
  } else {
    body = (
      <InspectorTabs<TabId>
        label={t('tabsLabel')}
        value={current}
        onValueChange={(next) => inspector.setTab(next)}
        items={TAB_IDS.map((id) => ({ value: id, label: t(`tabs.${id}`) }))}
      >
        <InspectorPanel<TabId> value="overview">
          <InspectorEvidence
            detail={detail}
            days={state.days}
            options={
              <InspectorOptions
                detail={detail}
                scope={scope}
                workspaceSlug={workspaceSlug}
                projectSlug={projectSlug}
                keywordId={keywordId}
                stale={stale}
              />
            }
          />
        </InspectorPanel>
        <InspectorPanel<TabId> value="timeline">
          <InspectorTimeline lanes={lanes} switches={switches} oneCheckChanges={keyword.one_check_changes} />
        </InspectorPanel>
        <InspectorPanel<TabId> value="pages">
          <InspectorPages pages={refs} />
        </InspectorPanel>
      </InspectorTabs>
    );
  }

  return (
    <Inspector
      type="cann-keyword"
      header={{
        title: keyword?.keyword ?? '',
        typeLabel: t('typeLabel'),
        typeNoun: t('typeNoun'),
        positionText:
          at === null ? null : t('position', { index: formatInteger(at.index + 1), count: formatInteger(at.count) }),
        navigation:
          at === null
            ? null
            : {
                onPrevious: () => step('previous'),
                onNext: () => step('next'),
                atFirst: at.index === 0,
                atLast: at.index === at.count - 1,
              },
        badges:
          keyword === undefined ? undefined : (
            <span className="flex flex-wrap items-center gap-1.5">
              <VerdictBadge verdict={keyword.verdict} />
              <Badge>{toolbar(keyword.device)}</Badge>
              <Badge>{t('period', { days: state.days })}</Badge>
            </span>
          ),
        freshness:
          volume === null && groupList.length === 0 ? undefined : (
            <span className="flex flex-wrap gap-x-3 type-meta text-foreground-secondary">
              {volume === null ? null : <span>{t('volume', { count: volume })}</span>}
              {groupList.length === 0 ? null : (
                <span>{t('groups', { count: groupList.length, names: groupList.join(', ') })}</span>
              )}
            </span>
          ),
        moreActions: [],
      }}
      backLabel={words('back', { page: page('title') })}
      onClose={() => inspector.close()}
      onStep={at === null ? undefined : step}
      hideMoreActions
    >
      {body}
    </Inspector>
  );
}
