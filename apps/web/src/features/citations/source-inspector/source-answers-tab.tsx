'use client';

import { MessagesSquare } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement, type ReactNode } from 'react';

import { answerRows, type AnswerRow } from './answer-rows';
import type { SourceCitationsRead } from './source-reads';
import { usePromptTexts } from '../domain-inspector/domain-reads';
import { EngineBadge } from '@/components/app/engine/engine-badge';
import { QuotedPassage } from '@/components/app/evidence/quoted-passage';
import { InspectorSection, type InspectorSectionStatus } from '@/components/app/inspector/inspector-section';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { Skeleton } from '@/components/ui/skeleton';
import { TextLink } from '@/components/ui/text-link';
import { Truncate } from '@/components/ui/truncate';
import type { EngineCode, SourceScope } from '@/lib/citations/types';
import { formatTableDateTime } from '@/lib/format';
import { formatInspectTarget } from '@/lib/inspector/placement';
import { withQuery } from '@/lib/routes/paths';

/** The inspector lists the ten latest answers. */
const LIMIT = 10;

export interface SourceAnswersTabProps {
  source: SourceScope;
  /** The citations of the page: the inspector's own read, which this tab lists and never repeats. */
  citations: SourceCitationsRead;
  /** A read is on its way while the rows are on screen: they stay and the section says it is busy. */
  refetching: boolean;
  /** The engines in scope with their names. */
  engines: readonly { code: EngineCode; label: string }[];
  timeZone: string;
  /** The prompts page of the project, where the evidence viewer is: an answer opens there, by address. */
  promptsHref: Route;
}

/**
 * The Answers tab (WB-SRC-03): the ten latest answers that cite the page, each with its time, engine and prompt, the
 * place the answer's source list first names the page (never a rank, and never "of N": one URL's rows do not give the
 * length of the list) and a link to the evidence viewer of that answer with the source to show (`cite`). The rows
 * are the latest citations the inspector already read, newest answer first. The prompt texts are provider data: text only.
 */
export function SourceAnswersTab({
  source,
  citations,
  refetching,
  engines,
  timeZone,
  promptsHref,
}: SourceAnswersTabProps): ReactElement {
  const t = useTranslations('citations.inspectors.source');
  const common = useTranslations('common');
  const texts = usePromptTexts(source);
  const read = citations.data;
  const rows = useMemo(() => answerRows(read?.data ?? [], LIMIT), [read]);
  const labels = useMemo(() => new Map(engines.map((engine) => [engine.code, engine.label])), [engines]);
  const status: InspectorSectionStatus =
    read === undefined ? (citations.status === 'error' ? 'error' : 'loading') : rows.length === 0 ? 'empty' : 'ready';

  const promptCell = (row: AnswerRow): ReactNode => {
    const text = texts.data?.get(row.promptId);
    if (text === undefined && texts.status === 'loading') return <Skeleton shape="text-12" widthPct={48} />;
    return (
      <Truncate
        text={text ?? t('promptUnknown', { id: row.promptId })}
        className={text === undefined ? 'max-w-40 text-foreground-tertiary' : 'max-w-40'}
      />
    );
  };

  const evidenceCell = (row: AnswerRow): ReactNode => {
    const href = withQuery(
      promptsHref,
      new URLSearchParams({
        inspect: formatInspectTarget({ type: 'answer', id: row.observationId }),
        cite: String(row.position),
      }).toString(),
    );
    return (
      <TextLink
        render={
          <Link
            href={href}
            aria-label={t('openEvidenceName', {
              date: formatTableDateTime(row.observedAt, timeZone),
              index: row.position,
            })}
          />
        }
      >
        {t('openEvidence')}
      </TextLink>
    );
  };

  const columns: PlainColumn<AnswerRow>[] = [
    {
      id: 'answer',
      header: t('answerDate'),
      wrap: true,
      cell: (row) => (
        <div className="flex min-w-56 flex-col gap-2">
          <span className="flex flex-col">
            <time dateTime={row.observedAt}>{formatTableDateTime(row.observedAt, timeZone)}</time>
            <span className="type-meta text-foreground-tertiary">{t('answerPosition', { index: row.position })}</span>
          </span>
          {/* A null or empty quote draws nothing (QuotedPassage returns null), so there is no gap and no empty box */}
          <QuotedPassage items={[{ index: row.position, host: row.host, url: row.url, quote: row.quote }]} />
        </div>
      ),
    },
    {
      id: 'engine',
      header: t('answerEngine'),
      cell: (row) => <EngineBadge engine={row.engine} name={labels.get(row.engine) ?? row.engine} />,
    },
    { id: 'prompt', header: t('answerPrompt'), cell: promptCell },
    { id: 'evidence', header: t('openEvidence'), hideHeader: true, actions: true, cell: evidenceCell },
  ];

  return (
    <InspectorSection
      title={t('answersTitle')}
      icon={MessagesSquare}
      status={status}
      error={
        <InlineError
          title={t('answersFailed')}
          reason={t('loadFailedReason')}
          errorId={citations.errorId}
          onRetry={citations.retry}
          retrying={citations.retrying}
          retryLabel={common('retry')}
        />
      }
      empty={
        <EmptyState variant="inline" title={t('answersEmptyTitle')} reason={t('answersEmptyReason')} headingLevel={3} />
      }
    >
      <div aria-busy={refetching ? true : undefined}>
        <PlainTable<AnswerRow>
          caption={t('answersCaption')}
          columns={columns}
          rows={rows}
          rowKey={(row) => row.observationId}
          status="ready"
          errorState={null}
          emptyText={t('answersEmptyTitle')}
        />
      </div>
    </InspectorSection>
  );
}
