'use client';

import { Network } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import { useTopicDrawer } from './drawer-context';
import { siblingKeys, siblingsOf, type Sibling } from './related-model';
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
 * The Related tab of the topic drawer (WB-TI-19): the topics beside this one, the siblings under the same parent, each
 * with its prompts and its mention rate (the equal weight average of the engines that show one, with the count of each
 * behind it in the tooltip). At most 10, the ones with most prompts first, the rest counted. A name opens that topic's
 * drawer on this tab. The siblings are worked out from the topic tree alone; a topic the tree does not hold says so, and
 * the section is a skeleton only while the page summary is on its way (or says it failed, with Retry).
 */
export function RelatedTab(): ReactElement {
  const { topicKey, summary, counts, descendants, engines } = useTopicDrawer();
  const t = useTranslations('prompts.topicDrawer.related');
  const prompts = useTranslations('prompts');
  const common = useTranslations('common');
  const rate = useTranslations('prompts.rate');
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
      siblingsOf(
        topicKey,
        summary,
        descendants,
        engines.map(({ engine }) => engine.engine_code),
      ),
    [topicKey, summary, descendants, engines],
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
        detail={rate(sibling.counting.length === 1 ? 'onlyTip' : 'avgTip', { engines: engineNames })}
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

  // The tree does not hold the topic: its neighbours cannot be told, which is said and not waited for
  const unlisted = siblingKeys(topicKey, descendants) === null;
  // A page read that failed leaves nothing to list; a row already held stays while the next window is read
  const status: InspectorSectionStatus =
    summary === undefined && counts.status === 'failed'
      ? 'error'
      : unlisted
        ? 'empty'
        : siblings === null
          ? 'loading'
          : siblings.shown.length === 0
            ? 'empty'
            : 'ready';
  return (
    <InspectorSection
      title={t('title')}
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
          title={t('emptyTitle')}
          reason={unlisted ? t('notInTreeReason') : t('emptyReason')}
          headingLevel={3}
        />
      }
    >
      <div className="flex flex-col gap-3">
        <PlainTable<Sibling>
          caption={t('title')}
          columns={columns}
          rows={siblings?.shown ?? []}
          rowKey={(sibling) => sibling.key}
          status="ready"
          errorState={null}
          emptyText={t('emptyTitle')}
        />
        {siblings === null || siblings.more === 0 ? null : (
          <p className="type-meta text-foreground-tertiary">{t('more', { count: siblings.more })}</p>
        )}
      </div>
    </InspectorSection>
  );
}

/**
 * The tab entry of the topic drawer (the seam `seams/topic-tabs.ts`), after Competitors: offered when the topic has
 * siblings in the tree. While the tree does not hold the topic it is offered too, so an address that names the tab keeps
 * it; the tab then says why it is empty, and leaves once the tree is read and the topic has no sibling.
 */
export const topicRelatedTab: TopicInspectorTab = {
  id: 'related',
  label: (t) => t('prompts.topicDrawer.tabRelated'),
  after: 'competitors',
  available: ({ topicKey, descendants }) => {
    const keys = siblingKeys(topicKey, descendants);
    return keys === null || keys.length > 0;
  },
  render: () => <RelatedTab />,
};
