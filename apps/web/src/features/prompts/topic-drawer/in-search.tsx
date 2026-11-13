'use client';

import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { useTopicDrawer } from './drawer-context';
import { InspectorSection, type InspectorSectionStatus } from '@/components/app/inspector/inspector-section';
import { KeyValues } from '@/components/app/inspector/key-values';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { TextLink } from '@/components/ui/text-link';
import { NO_TOPIC } from '@/features/prompts/prompt-model';
import type { TopicReadScope } from '@/features/prompts/topics-by-engine/topic-entities-query';
import { apiQuery, type ApiQueryOptions } from '@/lib/api/query';
import { useErrorId } from '@/lib/api/use-error-id';
import { formatEnumList } from '@/lib/filters/filter-values';
import { formatInteger } from '@/lib/format';
import { rankingsPath } from '@/lib/routes/paths';

const TRACKED = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/tracked-keywords' as const;

/** The ids of the two rows of the card. */
const ROW = { keywords: 'keywords', top10: 'top10' } as const;

/** How far up the places a keyword counts as in the top: the first page of results. */
const TOP_PLACES = 10;

/**
 * `GET {P}/tracked-keywords` for one topic, asking for one row: only `page.total` is read, so the answer is a few hundred
 * bytes however many keywords the topic holds. `filter[term]` takes the keywords given the topic or a topic under it.
 */
const countQuery = (read: TopicReadScope, termId: string, topTen: boolean): ApiQueryOptions<typeof TRACKED> =>
  apiQuery(TRACKED, {
    params: {
      path: { workspace_id: read.scope.workspaceId, project_id: read.scope.projectId },
      query: { 'filter[term]': [termId], limit: 1, ...(topTen ? { 'filter[rank_lte]': TOP_PLACES } : {}) },
    },
  });

export interface InSearchCounts {
  /** The tracked keywords given the topic. */
  keywords: number;
  /** Those of them ranking in the top 10 on their last check. */
  top10: number;
}

export interface InSearchRead {
  /** `loading` while either count is on its way or not asked; `failed` when one failed; `ready` when both are held. */
  status: 'loading' | 'failed' | 'ready';
  counts: InSearchCounts | null;
  /** What the read failed with, for the error id; `null` while nothing failed. */
  error: unknown;
  /** A read is on its way (a retry, for a failed one). */
  fetching: boolean;
  retry: () => void;
}

/** The two counts of a topic's In search card, asked only while `enabled`. */
export function useInSearch(read: TopicReadScope, topicKey: string, enabled: boolean): InSearchRead {
  const keywords = useQuery({ ...countQuery(read, topicKey, false), enabled });
  const top = useQuery({ ...countQuery(read, topicKey, true), enabled });
  const failed = keywords.isError || top.isError;
  const counts =
    keywords.data === undefined || top.data === undefined
      ? null
      : { keywords: keywords.data.page.total, top10: top.data.page.total };
  return {
    status: failed ? 'failed' : counts === null ? 'loading' : 'ready',
    counts: failed ? null : counts,
    error: keywords.error ?? top.error,
    fetching: keywords.isFetching || top.isFetching,
    retry: () => {
      if (keywords.isError) void keywords.refetch();
      if (top.isError) void top.refetch();
    },
  };
}

/**
 * The In search card of the topic's Overview (WB-TI-13): how many tracked keywords are given this topic and how many of
 * them are in the top 10, with a link to Rankings. A topic with no tracked keyword says so, and why: tracked keywords carry
 * topics of their own, so a count of 0 is no fact about the topic's rank. It is not drawn for the prompts without a topic.
 * A failed read is an inline error with Retry and leaves the other cards of the drawer as they are.
 */
export function InSearch(): ReactElement | null {
  const { topicKey, extras } = useTopicDrawer();
  const t = useTranslations('prompts.topicDrawer.inSearch');
  const prompts = useTranslations('prompts');
  const common = useTranslations('common');
  const untopiced = topicKey === NO_TOPIC;
  const search = useInSearch(extras, topicKey, !untopiced);
  const errorId = useErrorId(search.error);
  if (untopiced) return null;

  const { counts } = search;
  const status: InspectorSectionStatus =
    search.status === 'loading'
      ? 'loading'
      : search.status === 'failed'
        ? 'error'
        : counts !== null && counts.keywords === 0
          ? 'empty'
          : 'ready';
  const rankings = rankingsPath(extras.workspaceSlug, extras.projectSlug);
  // The path is the project's own Rankings page, so it is a route of the app; typed routes cannot know that of a query
  const filtered = `${rankings}?${new URLSearchParams({ tag: formatEnumList([topicKey]) }).toString()}` as Route;
  const open = (href: Route): ReactElement => <TextLink render={<Link href={href} />}>{t('open')}</TextLink>;

  return (
    <InspectorSection
      title={t('title')}
      icon={Search}
      status={status}
      action={status === 'ready' ? open(filtered) : undefined}
      error={
        <InlineError
          title={t('failedTitle')}
          reason={prompts('loadFailedReason')}
          errorId={errorId}
          onRetry={search.retry}
          retrying={search.fetching}
          retryLabel={common('retry')}
        />
      }
      empty={
        <EmptyState
          variant="inline"
          title={t('noneTitle')}
          reason={t('noneReason')}
          secondaryAction={open(rankings)}
          headingLevel={3}
        />
      }
    >
      {counts === null ? null : (
        <KeyValues
          items={[
            {
              id: ROW.keywords,
              label: t('keywords'),
              value: (
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="num type-body-strong">{formatInteger(counts.keywords)}</span>
                  <span className="type-meta text-foreground-tertiary">{t('keywordsNote')}</span>
                </span>
              ),
            },
            {
              id: ROW.top10,
              label: t('top10'),
              value: (
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="num type-body-strong">{formatInteger(counts.top10)}</span>
                  <span className="type-meta text-foreground-tertiary">
                    {t('top10Note', { total: counts.keywords })}
                  </span>
                </span>
              ),
            },
          ]}
        />
      )}
    </InspectorSection>
  );
}
