'use client';

import { useQueries, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { MessageSquareText } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement, type ReactNode } from 'react';

import { answerSegments, clipSegments } from './answer-segments';
import { mentionOrderKey } from './latest-model';
import { MarkedAnswer } from './marked-answer';
import { failedReasonKey, trailingRange, WIDEST_WINDOW, type DateRange } from './prompt-model';
import {
  newestAnswerQuery,
  observationQuery,
  projectEntitiesQuery,
  type ObservationAnswer,
  type PromptScope,
} from './prompt-queries';
import { DomainChipList, type DomainChipProps } from '@/components/app/cells/domain-chip';
import { hasHash, HashCopy } from '@/components/app/evidence/facts-footer';
import { InspectorSection } from '@/components/app/inspector/inspector-section';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import type { ObservationFactsWithExtra } from '@/lib/api/prompt-facts';
import type { CitationOut, ProjectEngine } from '@/lib/api/types';
import { useErrorId } from '@/lib/api/use-error-id';
import { formatDetailDateTime, formatTableDateTime } from '@/lib/format';
import { displayDomain } from '@/lib/format/url';

/** A time with its exact reading in a tooltip is a tab stop, so the keyboard reaches the tooltip (20 section 6.2 rule 6). */
const TAB_STOP = { tabIndex: 0 } as const;

/** The characters of an answer the card shows; the viewer has the rest. */
const EXCERPT_LENGTH = 280;

export interface InspectorLatestProps {
  scope: PromptScope;
  promptId: string;
  /** The prompt is one the API has: nothing is read for an id that names none. */
  exists: boolean;
  /** The window of the page: the newest answer is looked for further back than it, from the day it ends on. */
  range: DateRange;
  timeZone: string;
  /** The enabled engines, in order: one card each. */
  engines: readonly ProjectEngine[];
  /** Opens the answer in the answer viewer; without it the cards have no button. */
  onOpenAnswer: ((observationId: string, observedAt: string) => void) | undefined;
  /** What follows the cards: the prompt's facts. */
  children?: ReactNode;
}

/** The domains an answer cites, in the order it cites them, one for each domain as displayed (`www.` dropped). */
function citedDomains(citations: readonly CitationOut[]): DomainChipProps[] {
  const domains = [...citations]
    .sort((a, b) => a.citation_index - b.citation_index)
    .map((citation) => displayDomain(citation.host));
  return [...new Set(domains)].map((domain) => ({ domain }));
}

type NewestRead = UseQueryResult<{ data: { observation_id: string; observed_at: string }[] }>;

/** One fact of an answer: its label and its value, as the preview sets them ("Mentioned Yes"). */
function Fact({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <span className="flex items-baseline gap-1.5 whitespace-nowrap">
      <span className="text-foreground-tertiary">{label}</span>{' '}
      <span className="type-body-strong text-foreground">{value}</span>
    </span>
  );
}

/**
 * The third fact: the place of the brand in a list the answer gives (`Rank 2 of 3`), or, for an answer that is not a
 * list, whether it recommends the brand. A fact the backend has not built is "Not collected yet", never a "No" or a
 * place of 0; `null` is a platform whose answers are not classified for it.
 */
function ThirdFact({ facts }: { facts: ObservationFactsWithExtra }): ReactElement {
  const drawer = useTranslations('prompts.drawer.latest');
  if (facts.list_rank != null) {
    return (
      <Fact
        label={drawer('rank')}
        value={drawer('rankOf', { place: facts.list_rank.place, listed: facts.list_rank.listed })}
      />
    );
  }
  if (facts.had_structured_list && facts.list_rank === undefined) {
    return <Fact label={drawer('rank')} value={drawer('notCollected')} />;
  }
  const { recommended } = facts;
  const value =
    recommended === undefined
      ? drawer('notCollected')
      : recommended === null
        ? drawer('notApplicable')
        : recommended
          ? drawer('yes')
          : drawer('no');
  return <Fact label={drawer('recommended')} value={value} />;
}

interface LatestCardProps {
  /** The read of the newest valid answer of the engine; the card falls back to the newest of any status. */
  newest: NewestRead;
  engine: ProjectEngine;
  scope: PromptScope;
  promptId: string;
  wide: DateRange;
  timeZone: string;
  colors: ReadonlyMap<string, number | null | undefined>;
  colorsPending: boolean;
  onOpenAnswer: InspectorLatestProps['onOpenAnswer'];
}

/** One engine's card: its newest valid answer, or why it has none. */
function LatestCard({
  newest,
  engine,
  scope,
  promptId,
  wide,
  timeZone,
  colors,
  colorsPending,
  onOpenAnswer,
}: LatestCardProps): ReactElement {
  const t = useTranslations('prompts.inspector');
  const latest = useTranslations('prompts.inspector.latest');
  const statuses = useTranslations('prompts.inspector.statuses');
  const answerWords = useTranslations('prompts.answer');
  const drawer = useTranslations('prompts.drawer.latest');
  const separators = useTranslations('inspector');
  const hash = useTranslations('evidence.hash');
  const common = useTranslations('common');
  const code = engine.engine.engine_code;
  const valid = newest.data?.data[0] ?? null;
  // With no valid answer in the window the newest of any status says why: the failure, the refusal, the empty answer
  const fallback = useQuery({
    ...newestAnswerQuery(scope, promptId, code, wide, false),
    enabled: newest.isSuccess && valid === null,
  });
  const target = valid ?? fallback.data?.data[0] ?? null;
  const detail = useQuery({
    ...observationQuery(scope, target?.observation_id ?? '', target?.observed_at),
    enabled: target !== null,
  });
  const failed = valid === null && fallback.isError ? fallback : detail.isError ? detail : null;
  const errorId = useErrorId(failed?.error ?? null);
  const name = engine.engine.label;
  const noValid = (reason: string): ReactElement => (
    <EmptyState
      variant="inline"
      title={latest('noValidTitle', { engine: name, days: WIDEST_WINDOW })}
      reason={reason}
      headingLevel={3}
    />
  );

  const body = (shown: ObservationAnswer): ReactElement => {
    if (valid === null) {
      if (shown.status === 'error') return noValid(answerWords(`failedReasons.${failedReasonKey(shown.error_code)}`));
      if (shown.status === 'refused') return noValid(answerWords('refusedReason'));
      if (shown.status === 'empty') return noValid(answerWords('emptyReason'));
      return noValid(latest('pendingReason'));
    }
    const hasText = shown.answer_text !== null && shown.answer_text !== '';
    const { segments, clipped } = clipSegments(answerSegments(shown.answer_text ?? '', shown.mentions), EXCERPT_LENGTH);
    const facts: ObservationFactsWithExtra | null = shown.facts;
    const exact = formatDetailDateTime(shown.observed_at, timeZone);
    const separator = <span aria-hidden="true">{separators('separator')}</span>;
    return (
      <div className="flex flex-col gap-3">
        <p className="flex flex-wrap items-center gap-x-1.5 type-meta">
          <Tooltip content={exact} purpose="label">
            <time
              {...TAB_STOP}
              dateTime={shown.observed_at}
              aria-label={exact}
              className="rounded-xs num outline-none focus-visible:focus-ring"
            >
              {formatTableDateTime(shown.observed_at, timeZone)}
            </time>
          </Tooltip>
          {separator}
          <span>{drawer('replicate', { n: shown.replicate_index })}</span>
          {shown.model_reported === null ? null : (
            <>
              {separator}
              <span>{shown.model_reported}</span>
            </>
          )}
        </p>
        {hasText ? (
          <MarkedAnswer
            segments={segments}
            colors={colors}
            colorsPending={colorsPending}
            lang={shown.language_code ?? undefined}
            className="type-body wrap-anywhere whitespace-pre-wrap"
            suffix={clipped ? <span aria-hidden="true">{latest('ellipsis')}</span> : null}
          />
        ) : (
          <p className="type-meta">{latest('noText')}</p>
        )}
        {shown.status === 'partial' ? <p className="type-meta">{answerWords('partial')}</p> : null}
        {facts === null ? null : (
          <>
            <p aria-label={latest('factsLabel')} className="flex flex-wrap gap-x-4 gap-y-1 type-meta">
              <Fact label={latest('mentioned')} value={facts.own_mentioned ? drawer('yes') : drawer('no')} />
              <Fact label={latest('cited')} value={facts.own_domain_cited ? drawer('yes') : drawer('no')} />
              <ThirdFact facts={facts} />
            </p>
            {facts.own_mentioned && facts.own_mention_order !== null ? (
              // The place of the brand among the tracked brands the answer names: not a recommendation
              <p className="type-meta">
                {latest('order', {
                  place: mentionOrderKey(facts.own_mention_order),
                  order: facts.own_mention_order,
                })}
              </p>
            ) : null}
          </>
        )}
        <DomainChipList label={latest('sourcesLabel')} domains={citedDomains(shown.citations)} />
        {/* The hashes that identify the answer stay (audit evidence); the preview has no room for them */}
        {hasHash(shown.answer_sha256) ? (
          <p className="type-meta">
            <span>{hash('answer')}</span> <HashCopy kind="answer" hash={shown.answer_sha256} />
          </p>
        ) : null}
        {hasHash(shown.raw_sha256) ? (
          <p className="type-meta">
            <span>{hash('raw')}</span> <HashCopy kind="raw" hash={shown.raw_sha256} />
          </p>
        ) : null}
        {onOpenAnswer === undefined ? null : (
          <div>
            <Button
              variant="secondary"
              size="sm"
              aria-label={latest('openLabel', { engine: name })}
              onClick={() => onOpenAnswer(shown.observation_id, shown.observed_at)}
            >
              {latest('open')}
            </Button>
          </div>
        )}
      </div>
    );
  };

  let status: 'loading' | 'error' | 'empty' | 'ready' = 'ready';
  let error: ReactNode = null;
  let empty: ReactNode = null;
  if (newest.isPending) status = 'loading';
  else if (failed !== null) {
    status = 'error';
    error = (
      <InlineError
        title={latest('loadFailed', { engine: name })}
        reason={t('loadFailedReason')}
        errorId={errorId}
        onRetry={() => void failed.refetch()}
        retrying={failed.isFetching}
        retryLabel={common('retry')}
      />
    );
  } else if (valid === null && fallback.isPending) status = 'loading';
  else if (target === null) {
    status = 'empty';
    empty = noValid(latest('noAnswerReason'));
  } else if (detail.data === undefined) status = 'loading';

  const shownAnswer = detail.data?.data;
  return (
    <InspectorSection
      title={name}
      icon={MessageSquareText}
      status={status}
      error={error}
      empty={empty}
      // The answer shown is the newest valid one; a partial answer says so, as it did before
      action={
        valid === null || shownAnswer === undefined ? undefined : shownAnswer.status === 'partial' ? (
          <Badge tone="warning">{statuses('partial')}</Badge>
        ) : (
          <Badge tone="positive">{drawer('valid')}</Badge>
        )
      }
    >
      {shownAnswer === undefined ? null : body(shownAnswer)}
    </InspectorSection>
  );
}

/**
 * The Latest tab of the prompt inspector (parity spec G93): for each enabled engine its newest valid answer, whatever
 * the window of the page, with the start of its text marked at the brands it names, whether it names and cites the
 * brand, its first sources and a button to the whole answer. Each engine has its own read of its newest valid answer
 * over the 90 days of the longest window (one row), then one read of the answer; when it has none the newest answer of any
 * status says why. A failed read of the newest answers is one error for the tab, with one retry.
 */
export function InspectorLatest({
  scope,
  promptId,
  exists,
  range,
  timeZone,
  engines,
  onOpenAnswer,
  children,
}: InspectorLatestProps): ReactElement {
  const t = useTranslations('prompts.inspector');
  const common = useTranslations('common');
  const entities = useQuery(projectEntitiesQuery(scope));
  const colors = new Map((entities.data?.data ?? []).map((entry) => [entry.entity.entity_id, entry.color_index]));
  const wide = useMemo(() => trailingRange(range.to, WIDEST_WINDOW), [range.to]);
  const reads = useQueries({
    queries: engines.map((engine) => ({
      ...newestAnswerQuery(scope, promptId, engine.engine.engine_code, wide, true),
      enabled: exists,
    })),
  });
  const failedReads = reads.filter((read) => read.isError && read.data === undefined);
  const errorId = useErrorId(failedReads[0]?.error ?? null);
  return (
    <>
      {failedReads.length === 0 ? null : (
        <InspectorSection
          title={t('tabLatest')}
          icon={MessageSquareText}
          status="error"
          error={
            <InlineError
              title={t('answersFailed')}
              reason={t('loadFailedReason')}
              errorId={errorId}
              onRetry={() => failedReads.forEach((read) => void read.refetch())}
              retrying={failedReads.some((read) => read.isFetching)}
              retryLabel={common('retry')}
            />
          }
        />
      )}
      {engines.map((engine, at) => {
        const newest = reads[at];
        return newest === undefined || (newest.isError && newest.data === undefined) ? null : (
          <LatestCard
            key={engine.engine.engine_code}
            newest={newest}
            engine={engine}
            scope={scope}
            promptId={promptId}
            wide={wide}
            timeZone={timeZone}
            colors={colors}
            colorsPending={entities.isPending}
            onOpenAnswer={onOpenAnswer}
          />
        );
      })}
      {children}
    </>
  );
}
