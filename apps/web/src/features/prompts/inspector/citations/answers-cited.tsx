'use client';

import { Quote } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { answerRows, type AnswerCitedRow } from './answer-rows';
import { ANSWER_PAGE_WIDTH, FAVICON } from './citations-model';
import type { CitationRead } from './citations-reads';
import { CountPopover } from '@/components/app/cells/count-popover';
import { URLCell } from '@/components/app/cells/url-cell';
import { EngineLogo } from '@/components/app/engine/engine-logo';
import { InspectorSection, type InspectorSectionStatus } from '@/components/app/inspector/inspector-section';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip } from '@/components/ui/tooltip';
import type { Schemas } from '@/lib/api/types';
import { groupByAnswer } from '@/lib/citations/group-answers';
import type { CitationPage } from '@/lib/citations/types';
import { EMPTY_VALUE, formatInteger, formatTableDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface AnswersCitedProps {
  /** The prompt's answers in the window, newest first (the read History shares). */
  answers: CitationRead<Schemas['ObservationPage']>;
  /** The citation rows of those answers: the first page of the list, newest answer first. */
  citations: CitationRead<CitationPage>;
  /** The name of an engine by its code, for engines that are off too. */
  labelOf: (code: string) => string;
  timeZone: string;
  /** Opens the answer in the viewer; without it the date is plain text. */
  onOpenAnswer: ((observationId: string, observedAt: string) => void) | undefined;
}

/** The cell of a value that waits for the citations: a skeleton while they load, n/a, never 0, when they failed. */
function Pending({ loading, reason }: { loading: boolean; reason: string }): ReactElement {
  if (loading) return <Skeleton shape="text-12" widthPct={48} />;
  return (
    <Tooltip content={reason}>
      <span>{EMPTY_VALUE}</span>
    </Tooltip>
  );
}

/**
 * The latest valid answers of the prompt and what each cites (WB-PIC-06 to 09): the own page cited in it with its
 * place among the sources the answer lists ("Source 2 of 9", never a rank), and the other domains behind a count
 * that opens them. An answer that cites sources and none is own says Not cited; one that cites none says so, which
 * is not the same. The citation list is read apart, so the answers stay when it fails and their cells say n/a.
 */
export function AnswersCited({ answers, citations, labelOf, timeZone, onOpenAnswer }: AnswersCitedProps): ReactElement {
  const t = useTranslations('prompts.citationsTab.answers');
  const tab = useTranslations('prompts.citationsTab');
  const pages = useTranslations('prompts.citationsTab.pages');
  const inspector = useTranslations('prompts.inspector');
  const common = useTranslations('common');
  const loaded = citations.data;
  const groups = loaded === undefined ? null : groupByAnswer(loaded.data, loaded.page.has_more);
  const rows = answers.data === undefined ? [] : answerRows(answers.data.data, groups);
  const citationsLoading = citations.status === 'loading';
  // Why a cell is n/a: the list failed, or the answer lies past the rows the first page holds
  const pendingReason =
    citations.status === 'error' ? t('notLoaded') : t('pastLoaded', { rows: loaded?.data.length ?? 0 });

  const columns: PlainColumn<AnswerCitedRow>[] = [
    {
      id: 'answer',
      header: t('answer'),
      cell: ({ observation }) => {
        const date = formatTableDateTime(observation.observed_at, timeZone);
        const engine = labelOf(observation.engine_code);
        return (
          <span className="flex min-w-0 flex-col items-start">
            {onOpenAnswer === undefined ? (
              <span className="num">{date}</span>
            ) : (
              <Button
                variant="link"
                aria-label={inspector('openAnswer', { engine, date })}
                onClick={() => onOpenAnswer(observation.observation_id, observation.observed_at)}
              >
                <span className="num">{date}</span>
              </Button>
            )}
            <span className="type-meta text-foreground-secondary">
              <EngineLogo engine={observation.engine_code} name={engine} />
            </span>
          </span>
        );
      },
    },
    {
      id: 'cited-page',
      header: t('citedPage'),
      wrap: true,
      cell: ({ state, ownPage, moreOwn }) => {
        if (state === 'unknown') return <Pending loading={citationsLoading} reason={pendingReason} />;
        if (state === 'noSource') return <span>{t('noSources')}</span>;
        if (ownPage === null) return <span>{t('notCited')}</span>;
        return (
          <span className={cn('flex min-w-0 flex-col', ANSWER_PAGE_WIDTH)}>
            <URLCell
              url={ownPage.row.url}
              hostDisplay="hide"
              label={pages('urlLabel')}
              title={ownPage.row.title}
              favicon={FAVICON}
              context="list"
            />
            <span className="flex flex-wrap gap-x-2 num type-meta">
              <span>{t('position', ownPage.position)}</span>
              {moreOwn > 0 ? <span>{t('moreOwn', { count: moreOwn })}</span> : null}
            </span>
          </span>
        );
      },
    },
    {
      id: 'other',
      header: t('other'),
      description: t('otherDescription'),
      cell: ({ state, ownPage, others }) => {
        if (state === 'unknown') return <Pending loading={citationsLoading} reason={pendingReason} />;
        // An answer that cites only the own page has no other domain: a bare 0 beside a button would read as a count of nothing
        if (others.length === 0) return <span>{t('noOthers')}</span>;
        return (
          <CountPopover
            context="list"
            favicon={FAVICON}
            countText={formatInteger(others.length)}
            label={t('insteadLabel', { count: others.length })}
            title={ownPage === null ? t('insteadTitle') : t('alsoTitle')}
            total={others.length}
            domains={others.map((entry) => ({
              id: entry.key,
              host: entry.domain,
              registrable: entry.domain,
              role: entry.role,
              countText: t('domainPages', { count: entry.units }),
            }))}
          />
        );
      },
    },
  ];

  let status: InspectorSectionStatus = 'ready';
  if (answers.status === 'error') status = 'error';
  else if (answers.status === 'loading') status = 'loading';
  else if (rows.length === 0) status = 'empty';
  return (
    <InspectorSection
      title={t('title')}
      icon={Quote}
      status={status}
      error={
        <InlineError
          title={inspector('answersFailed')}
          reason={inspector('loadFailedReason')}
          errorId={answers.errorId}
          onRetry={answers.retry}
          retrying={answers.retrying}
          retryLabel={common('retry')}
        />
      }
      empty={
        <EmptyState
          variant="inline"
          title={t('emptyTitle')}
          reason={inspector('answersEmptyReason')}
          headingLevel={3}
        />
      }
    >
      <div aria-busy={answers.refreshing ? true : undefined} className="flex flex-col gap-3">
        {citations.status === 'error' ? (
          <p className="flex flex-wrap items-center gap-x-2 type-meta">
            {t('failed')}
            <Button variant="link" size="sm" loading={citations.retrying} onClick={citations.retry}>
              {common('retry')}
            </Button>
          </p>
        ) : null}
        {groups !== null && loaded?.page.has_more === true ? (
          <p className="num type-meta">
            {groups.length === 0
              ? tab('basedOnNone', { rows: loaded.data.length })
              : tab('basedOn', { count: groups.length })}
          </p>
        ) : null}
        <PlainTable<AnswerCitedRow>
          caption={t('caption')}
          columns={columns}
          rows={rows}
          rowKey={({ observation }) => observation.observation_id}
          status="ready"
          errorState={null}
          emptyText={t('emptyTitle')}
        />
      </div>
    </InspectorSection>
  );
}
