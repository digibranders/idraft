'use client';

import { Network } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import { useTopicDrawer } from './drawer-context';
import { otherGroups, type Sibling } from './related-model';
import { useInspector } from '@/components/app/inspector/use-inspector';
import { InspectorSection, type InspectorSectionStatus } from '@/components/app/inspector/inspector-section';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { countText } from '@/features/prompts/prompt-model';
import { useRateWords } from '@/features/prompts/rate-view';
import { DRAWER_ENTRY_KEYS } from '@/features/prompts/topics-by-engine/drill';
import type { TopicInspectorTab } from '@/features/prompts/seams/topic-tabs';
import { EMPTY_VALUE, formatInteger, formatList } from '@/lib/format';

/**
 * The Related tab of the group drawer (PR-DRAWER-14): there are no parent groups, so it lists the other groups of the
 * scope, at most five, the ones with most prompts first, each with its prompts and its mention rate (the equal weight
 * average of the platforms that show one, with the count of each behind it in the tooltip). A name opens that group's
 * drawer on this tab. The section is a skeleton only while the page summary is on its way (or says it failed, with
 * Retry).
 */
export function RelatedTab(): ReactElement {
  const { topicKey, summary, counts, descendants, engines, extras } = useTopicDrawer();
  const t = useTranslations('prompts.topicDrawer.related');
  const groupsText = useTranslations('prompts.groupsTab');
  const prompts = useTranslations('prompts');
  const common = useTranslations('common');
  const rate = useTranslations('prompts.rate');
  const groupRates = useTranslations('prompts.groupRates');
  const columnWords = useTranslations('prompts.columns');
  const locale = useLocale();
  const words = useRateWords();
  const inspector = useInspector({ entryKeys: DRAWER_ENTRY_KEYS });
  const labels = useMemo(
    () => new Map<string, string>(engines.map(({ engine }) => [engine.engine_code, engine.label])),
    [engines],
  );
  const siblings = useMemo(
    () =>
      otherGroups(
        topicKey,
        summary,
        extras.tree,
        descendants,
        engines.map(({ engine }) => engine.engine_code),
      ),
    [topicKey, summary, extras.tree, descendants, engines],
  );

  const mentionCell = (sibling: Sibling): ReactElement => {
    const average = sibling.mention;
    if (average.state !== 'ok') return <span>{average.state === 'none' ? EMPTY_VALUE : words.text(average)}</span>;
    const engineNames = formatList(
      sibling.counting.map(({ code }) => labels.get(code) ?? code),
      locale,
    );
    // A pooled count beside an equal weight percent would read as another rate, so the counts are each engine's own
    const counts = formatList(
      sibling.counting.map(({ code, cell }) =>
        columnWords('engineCount', { engine: labels.get(code) ?? code, count: countText(cell) ?? EMPTY_VALUE }),
      ),
      locale,
    );
    return (
      // The tooltip is for sighted users; the counts are in the cell for everyone else
      <Tooltip
        content={counts}
        detail={
          sibling.counting.length === 1
            ? rate('onlyTip', { engines: engineNames })
            : groupRates('avgTip', { engines: engineNames })
        }
        purpose="label"
      >
        <span className="inline-flex items-baseline gap-2">
          <span>{words.text(average)}</span>
          <span className="type-label text-foreground-tertiary">{rate('avgLabel', { count: average.engines })}</span>
          <span className="sr-only">{counts}</span>
        </span>
      </Tooltip>
    );
  };
  const columns: PlainColumn<Sibling>[] = [
    {
      id: 'topic',
      header: t('topic'),
      cell: (sibling) => (
        <Button
          variant="link"
          size="sm"
          aria-label={t('open', { name: sibling.name })}
          className="max-w-full min-w-0 justify-start text-foreground"
          onClick={() => inspector.open({ type: 'topic', id: sibling.key }, { tab: topicRelatedTab.id })}
        >
          <span className="truncate">{sibling.name}</span>
        </Button>
      ),
    },
    { id: 'prompts', header: t('prompts'), cell: (sibling) => <span>{formatInteger(sibling.promptCount)}</span> },
    { id: 'mention', header: t('mention'), cell: mentionCell },
  ];

  // A page read that failed leaves nothing to list; a row already held stays while the next window is read
  const status: InspectorSectionStatus =
    summary === undefined && counts.status === 'failed'
      ? 'error'
      : siblings === null
        ? 'loading'
        : siblings.length === 0
          ? 'empty'
          : 'ready';
  return (
    <InspectorSection
      title={groupsText('relatedTitle')}
      icon={Network}
      status={status}
      error={
        <InlineError
          title={prompts('summaryLoadFailed')}
          reason={prompts('loadFailedReason')}
          errorId={counts.errorId}
          onRetry={counts.retry}
          retrying={counts.retrying}
          retryLabel={common('retry')}
        />
      }
      empty={
        <EmptyState
          variant="inline"
          title={groupsText('relatedEmptyTitle')}
          reason={groupsText('relatedEmptyReason')}
          headingLevel={3}
        />
      }
    >
      <div className="flex flex-col gap-3">
        <p className="type-meta text-foreground-tertiary">{groupsText('relatedNote')}</p>
        <PlainTable<Sibling>
          caption={groupsText('relatedTitle')}
          columns={columns}
          rows={siblings ?? []}
          rowKey={(sibling) => sibling.key}
          status="ready"
          errorState={null}
          emptyText={groupsText('relatedEmptyTitle')}
        />
      </div>
    </InspectorSection>
  );
}

/**
 * The tab entry of the group drawer (the seam `seams/topic-tabs.ts`), after Competitors: always offered, as the
 * preview's is; with no other group in the scope the tab says so.
 */
export const topicRelatedTab: TopicInspectorTab = {
  id: 'related',
  label: (t) => t('prompts.topicDrawer.tabRelated'),
  after: 'competitors',
  render: () => <RelatedTab />,
};
