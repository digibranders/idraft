'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { FileX } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useMemo, type ReactElement, type ReactNode } from 'react';

import type { CitationTabContext } from './citation-tabs';
import { domainRowId } from './domain-rows';
import { citedInsteadId, useCitedInstead, type CitedInsteadPair, type CitedInsteadRead } from './use-cited-instead';
import { CountPopover } from '@/components/app/cells/count-popover';
import type { FaviconMode } from '@/components/app/cells/domain-cell';
import { EngineLogo } from '@/components/app/engine/engine-logo';
import { Banner } from '@/components/app/status/banner';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/skeleton';
import { Truncate } from '@/components/ui/truncate';
import { useErrorId } from '@/lib/api/use-error-id';
import { promptTextsById, promptTextsQuery } from '@/lib/citations/prompt-texts-query';
import { sourcePromptsQuery } from '@/lib/citations/source-queries';
import type { PromptOwnPagesRow } from '@/lib/citations/types';
import { EMPTY_VALUE } from '@/lib/format';

/** The card lists the first 10 pairs; the rest are said, not listed (plan T5b). */
const LIMIT = 10;
const NO_ROWS: readonly PromptOwnPagesRow[] = [];
/** The characters of a prompt's id that stand for it when its text is not known. */
const SHORT_ID = 8;
// shortcut: the project setting for favicons does not exist yet (D16), so they always show; read it here when it does
const FAVICON: FaviconMode = 'show';

const pairOf = (row: PromptOwnPagesRow): CitedInsteadPair => ({ promptId: row.prompt_id, engineCode: row.engine_code });

export interface NoOwnPageProps {
  context: CitationTabContext;
}

/**
 * "Prompts with no own page cited" (DS 9.7, M-02, WB-CIT-14 and 15): the prompt and engine pairs whose answers
 * cite no page of the project, in words, each with the domains cited instead behind a count that opens them. It
 * reads the first 10 pairs of the scope, only while the Pages tab is shown and an engine is on, and fails alone:
 * the table below it stays. A count whose domains are not known is n/a, never 0.
 */
export function NoOwnPage({ context }: NoOwnPageProps): ReactElement | null {
  const { source, filters, scope, enabledEngines, labelOf, meta } = context;
  const t = useTranslations('citations.noOwn');
  const tt = useTranslations('citations.table');
  const tc = useTranslations('citations');
  const common = useTranslations('common');
  const headingId = useId();
  // A scope with no answer has no pair to list: its table already says so
  const worthReading = scope.tab === 'pages' && enabledEngines.length > 0 && meta.data?.meta.answers !== 0;

  const read = useQuery({
    ...sourcePromptsQuery(source, filters, { ownCited: false, limit: LIMIT }),
    placeholderData: keepPreviousData,
    enabled: worthReading,
  });
  const texts = useQuery({ ...promptTextsQuery(source), placeholderData: keepPreviousData, enabled: worthReading });
  const errorId = useErrorId(read.error);
  const rows = useMemo(() => read.data?.data.slice(0, LIMIT) ?? NO_ROWS, [read.data]);
  const pairs = useMemo(() => rows.map(pairOf), [rows]);
  const instead = useCitedInstead({ source, filters, pairs, enabled: worthReading });
  const promptTexts = useMemo(() => promptTextsById(texts.data), [texts.data]);

  if (!worthReading) return null;
  // The pairs of the last scope stand in while a new one is read: empty, they say nothing about the new scope
  const loading = read.isPending || (read.isPlaceholderData && rows.length === 0);
  const failed = read.isError && read.data === undefined;
  const empty = read.data !== undefined && !read.isPlaceholderData && rows.length === 0;
  // With the scope's answers not known the empty list cannot be told from one that has none to count
  if (empty && meta.data === undefined) return null;
  const hasMore = read.data?.page.has_more === true;

  const promptCell = (row: PromptOwnPagesRow): ReactNode => {
    const text = promptTexts.get(row.prompt_id);
    if (text !== undefined) return <Truncate text={text} className="max-w-40 sm:max-w-48 lg:max-w-80" />;
    if (texts.isPending) return <Skeleton shape="text-12" widthPct={48} />;
    return (
      <>
        <span className="text-foreground-tertiary">{t('promptUnknown', { id: row.prompt_id.slice(0, SHORT_ID) })}</span>
        <span className="sr-only">{t('promptUnknownTip')}</span>
      </>
    );
  };

  const insteadCell = (found: CitedInsteadRead | undefined): ReactNode => {
    if (found === undefined || found.total === null) {
      // n/a with its reason as text a screen reader reaches; a read that failed can be asked again
      return (
        <span className="inline-flex items-center gap-2">
          <span>{EMPTY_VALUE}</span>
          <span className="sr-only">{t('insteadUnknown')}</span>
          {found?.status === 'error' ? (
            <Button variant="link" size="sm" aria-label={t('insteadRetry')} onClick={found.retry}>
              {common('retry')}
            </Button>
          ) : null}
        </span>
      );
    }
    return (
      <CountPopover
        context="list"
        favicon={FAVICON}
        countText={t('insteadCount', { count: found.total })}
        label={t('insteadLabel', { count: found.total })}
        title={t('insteadTitle')}
        total={found.total}
        domains={found.domains.map((domain) => ({
          id: domainRowId(domain),
          host: domain.registrable_domain,
          registrable: domain.registrable_domain,
          role: domain.domain_role,
          countText: t('insteadUnits', { count: domain.citation_units }),
        }))}
      />
    );
  };

  const columns: PlainColumn<PromptOwnPagesRow>[] = [
    { id: 'prompt', header: t('prompt'), cell: promptCell },
    {
      id: 'engine',
      header: t('engine'),
      cell: (row) => <EngineLogo engine={row.engine_code} name={labelOf(row.engine_code)} />,
    },
    {
      id: 'result',
      header: t('result'),
      wrap: true,
      // From a tablet up the finding wraps, so the Cited instead column stays in view; a phone scrolls the list sideways instead of tripling its rows
      cell: (row) => (
        <span className="whitespace-nowrap sm:whitespace-normal">{t('finding', { answers: row.answers })}</span>
      ),
    },
    { id: 'instead', header: t('insteadTitle'), cell: (row) => insteadCell(instead.get(citedInsteadId(pairOf(row)))) },
  ];

  let body: ReactNode;
  if (failed) {
    body = (
      <InlineError
        title={t('failed')}
        reason={tc('empty.failedReason')}
        errorId={errorId}
        onRetry={() => void read.refetch()}
        retrying={read.isFetching}
        retryLabel={common('retry')}
        live
      />
    );
  } else if (empty) {
    body = <EmptyState variant="inline" title={t('emptyTitle')} reason={t('emptyReason')} headingLevel={3} />;
  } else {
    body = (
      <div className="flex flex-col gap-3">
        {/* A refresh that failed leaves the pairs of the last read on screen: say so, with a way to ask again */}
        {read.isError ? (
          <Banner
            tone="warning"
            placement="region"
            live
            message={tt('refreshFailed')}
            actions={
              <Button variant="secondary" size="sm" loading={read.isFetching} onClick={() => void read.refetch()}>
                {common('retry')}
              </Button>
            }
          />
        ) : null}
        {loading ? null : (
          <p className="type-meta">
            {hasMore ? t('leadMore', { count: rows.length }) : t('lead', { count: rows.length })}
          </p>
        )}
        {/* Ten pairs are about 400 px: the list scrolls inside its own region, which the keyboard reaches, so the card never takes the table's height */}
        <div
          role="region"
          aria-label={t('listLabel')}
          tabIndex={0}
          className="max-h-60 overflow-y-auto rounded-lg focus-visible:focus-ring"
        >
          <PlainTable<PromptOwnPagesRow>
            caption={t('title')}
            columns={columns}
            rows={rows}
            rowKey={(row) => citedInsteadId(pairOf(row))}
            status={loading ? 'loading' : 'ready'}
            errorState={null}
            emptyText={t('emptyTitle')}
            skeletonRows={3}
          />
        </div>
        {hasMore ? <p className="type-meta">{t('moreUnknown')}</p> : null}
      </div>
    );
  }

  return (
    <section
      aria-labelledby={headingId}
      aria-busy={read.isFetching ? true : undefined}
      className="shrink-0 rounded-lg border border-border bg-surface"
    >
      <div className="flex h-12 items-center gap-2 px-4">
        <Icon icon={FileX} size="default" className="shrink-0 text-foreground-tertiary" />
        <h2 id={headingId} className="min-w-0 flex-1 truncate type-subsection-title">
          {t('title')}
        </h2>
      </div>
      <div className="px-4 pb-4">{body}</div>
    </section>
  );
}
