'use client';

import { MessageSquareText } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, type ReactElement, type ReactNode } from 'react';

import { promptRows, type PromptRow } from './answer-rows';
import type { SourceCitationsRead } from './source-reads';
import { usePromptTexts } from '../domain-inspector/domain-reads';
import { EngineBadge } from '@/components/app/engine/engine-badge';
import { InspectorSection, type InspectorSectionStatus } from '@/components/app/inspector/inspector-section';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { Skeleton } from '@/components/ui/skeleton';
import { TextLink } from '@/components/ui/text-link';
import { Truncate } from '@/components/ui/truncate';
import type { EngineCode, SourceScope } from '@/lib/citations/types';
import { formatInteger, formatTableDateTime } from '@/lib/format';
import { withQuery } from '@/lib/routes/paths';
import { formatInspectTarget } from '@/lib/inspector/placement';

export interface SourcePromptsTabProps {
  source: SourceScope;
  /** The citations of the page: the inspector's own read, which this tab lists and never repeats. */
  citations: SourceCitationsRead;
  /** A read is on its way while the rows are on screen: they stay and the section says it is busy. */
  refetching: boolean;
  /** The engines in scope with their names. */
  engines: readonly { code: EngineCode; label: string }[];
  timeZone: string;
  /** The prompts page of the project: a prompt opens its inspector there, by address (a feature never imports another). */
  promptsHref: Route;
}

/**
 * The Prompts tab (WB-SRC-02): the ten prompts whose answers cite the page most, each with its text, the engines it
 * was cited on, its answers and when it was last cited. The rows come from the citations the inspector already read
 * (the latest 100: the note says so when the page has more), and the texts from the project's prompts. A prompt
 * whose text is not read shows its id and says the text is n/a. The texts are provider data: text only.
 */
export function SourcePromptsTab({
  source,
  citations,
  refetching,
  engines,
  timeZone,
  promptsHref,
}: SourcePromptsTabProps): ReactElement {
  const t = useTranslations('citations.inspectors.source');
  const common = useTranslations('common');
  const locale = useLocale();
  const texts = usePromptTexts(source);
  const read = citations.data;
  const rows = useMemo(() => promptRows(read?.data ?? []), [read]);
  const labels = useMemo(() => new Map(engines.map((engine) => [engine.code, engine.label])), [engines]);
  const status: InspectorSectionStatus =
    read === undefined ? (citations.status === 'error' ? 'error' : 'loading') : rows.length === 0 ? 'empty' : 'ready';

  const promptCell = (row: PromptRow): ReactNode => {
    const text = texts.data?.get(row.promptId);
    if (text === undefined && texts.status === 'loading') return <Skeleton shape="text-12" widthPct={48} />;
    const href = withQuery(
      promptsHref,
      new URLSearchParams({ inspect: formatInspectTarget({ type: 'prompt', id: row.promptId }) }).toString(),
    );
    return (
      <TextLink render={<Link href={href} />} tone="inherit" className="text-foreground">
        <Truncate
          text={text ?? t('promptUnknown', { id: row.promptId })}
          className={text === undefined ? 'max-w-40 text-foreground-tertiary' : 'max-w-40'}
        />
      </TextLink>
    );
  };

  const columns: PlainColumn<PromptRow>[] = [
    { id: 'prompt', header: t('prompt'), cell: promptCell },
    {
      id: 'engines',
      header: t('promptEngines'),
      wrap: true,
      cell: (row) => (
        <span className="flex flex-wrap gap-1">
          {row.engines.map((code) => (
            <EngineBadge key={code} engine={code} name={labels.get(code) ?? code} />
          ))}
        </span>
      ),
    },
    { id: 'answers', header: t('promptAnswers'), cell: (row) => formatInteger(row.answers, { locale }) },
    {
      id: 'last',
      header: t('promptLast'),
      cell: (row) => <time dateTime={row.lastAnswerAt}>{formatTableDateTime(row.lastAnswerAt, timeZone)}</time>,
    },
  ];

  return (
    <InspectorSection
      title={t('promptsTitle')}
      icon={MessageSquareText}
      status={status}
      error={
        <InlineError
          title={t('loadFailed')}
          reason={t('loadFailedReason')}
          errorId={citations.errorId}
          onRetry={citations.retry}
          retrying={citations.retrying}
          retryLabel={common('retry')}
        />
      }
      empty={
        <EmptyState variant="inline" title={t('promptsEmptyTitle')} reason={t('promptsEmptyReason')} headingLevel={3} />
      }
    >
      <div aria-busy={refetching ? true : undefined} className="flex flex-col gap-2">
        {read?.page.has_more === true ? <p className="type-meta">{t('basedOn', { count: read.data.length })}</p> : null}
        <PlainTable<PromptRow>
          caption={t('promptsCaption')}
          columns={columns}
          rows={rows}
          rowKey={(row) => row.promptId}
          status="ready"
          errorState={null}
          emptyText={t('promptsEmptyTitle')}
        />
      </div>
    </InspectorSection>
  );
}
