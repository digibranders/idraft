'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { ChangesPanel, PageButton } from './changes-panel';
import type { LinksTabContext } from '../tabs';
import { reasonOf } from '../rules/problem-reason';
import { InlineError } from '@/components/app/status/inline-error';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { TierBadge } from '@/components/app/tier/tier-badge';
import { EMPTY_VALUE, formatInteger } from '@/lib/format';
import { formatDelta, type Tone } from '@/lib/internal-links/changes-format';
import { movedPagesQuery } from '@/lib/internal-links/queries';
import type { MovedPage } from '@/lib/internal-links/types';
import { cn } from '@/lib/utils';

const TONE_CLASS: Readonly<Record<Tone, string>> = {
  negative: 'text-negative-text',
  warning: 'text-warning-text',
  positive: 'text-positive-text',
  neutral: 'text-foreground-secondary',
};

/** A value with its change beside it: the sign is in the text, the tone is only a second cue. */
function WithChange({ value, change }: { value: string; change: { text: string; tone: Tone } | null }): ReactElement {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="num text-foreground">{value}</span>
      {change === null ? null : <span className={cn('num type-label', TONE_CLASS[change.tone])}>{change.text}</span>}
    </span>
  );
}

/**
 * The pages whose editorial links in or click depth changed most (mock `movedPanel`). Deeper is worse, so a depth
 * increase is negative. A page that became unreachable or reachable says so in words. No equity figure is read.
 */
export function MovedPagesPanel({
  context,
  since,
}: {
  context: LinksTabContext;
  /** "since 7 Nov". */
  since: string;
}): ReactElement {
  const c = useTranslations('internalLinks.changes');
  const common = useTranslations('common');
  const read = useQuery(movedPagesQuery(context.scope, context.crawl.run));
  const rows = read.data?.data ?? [];
  const open = (urlId: string) => () => context.inspect.open(urlId);
  const columns: PlainColumn<MovedPage>[] = [
    {
      id: 'page',
      header: c('columns.page'),
      cell: (row) => <PageButton path={row.page.path} onOpen={open(row.page.url_id)} />,
    },
    { id: 'tier', header: c('columns.tier'), cell: (row) => <TierBadge tier={row.page.tier} /> },
    {
      id: 'editorialIn',
      header: c('columns.editorialIn'),
      cell: (row) => (
        <WithChange value={formatInteger(row.editorial_in)} change={formatDelta(row.editorial_in_delta, 'in')} />
      ),
    },
    {
      id: 'depth',
      header: c('columns.depth'),
      cell: (row) => {
        const state =
          row.depth_state === 'lost'
            ? { text: c('unreachable'), tone: 'negative' as const }
            : row.depth_state === 'found'
              ? { text: c('reachable'), tone: 'positive' as const }
              : formatDelta(row.depth_delta, 'depth');
        return <WithChange value={row.depth === null ? EMPTY_VALUE : formatInteger(row.depth)} change={state} />;
      },
    },
  ];
  return (
    <ChangesPanel id="il-changes-moved-title" title={c('movedTitle')} meta={c('movedMeta', { since })}>
      <PlainTable<MovedPage>
        caption={c('movedTitle')}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.page.url_id}
        status={read.isError ? 'error' : read.isPending ? 'loading' : 'ready'}
        emptyText={c('emptyMoved')}
        errorState={
          <InlineError
            title={c('movedLoadFailed')}
            reason={reasonOf(read.error) || c('loadFailedReason')}
            errorId={null}
            onRetry={() => void read.refetch()}
            retrying={read.isFetching}
            retryLabel={common('retry')}
          />
        }
      />
    </ChangesPanel>
  );
}
