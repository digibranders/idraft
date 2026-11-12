'use client';

import { useQueries, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { Check, MessageSquareText, Minus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Fragment, useMemo, type ReactElement, type ReactNode } from 'react';

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
import { InspectorSection } from '@/components/app/inspector/inspector-section';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import type { CitationOut, ProjectEngine } from '@/lib/api/types';
import { useErrorId } from '@/lib/api/use-error-id';
import { formatDetailDateTime, formatRelative } from '@/lib/format';

/** The characters of an answer the card shows; the viewer has the rest. */
const EXCERPT_LENGTH = 280;
/** The sources a card names. */
const TOP_SOURCES = 3;
const SOURCE_ROLE_KEYS = { own: 'own', competitor: 'competitor', third_party: 'thirdParty' } as const;
/** A time with its exact reading in a tooltip is a tab stop, so the keyboard reaches the tooltip (20 section 6.2 rule 6). */
const TAB_STOP = { tabIndex: 0 } as const;

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

/** The first sources of an answer, in the order it cites them, one for each host. */
function topSources(citations: readonly CitationOut[]): CitationOut[] {
  const hosts = new Set<string>();
  const sources: CitationOut[] = [];
  for (const citation of [...citations].sort((a, b) => a.citation_index - b.citation_index)) {
    if (hosts.has(citation.host)) continue;
    hosts.add(citation.host);
    sources.push(citation);
    if (sources.length === TOP_SOURCES) break;
  }
  return sources;
}

type NewestRead = UseQueryResult<{ data: { observation_id: string; observed_at: string }[] }>;

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
  const common = useTranslations('common');
  const separator = useTranslations('inspector')('separator');
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
    const facts = shown.facts;
    const sources = topSources(shown.citations).map((source) => ({
      host: source.host,
      own: source.domain_role === 'own',
      text: latest('source', {
        host: source.host,
        role: answerWords(`sourceRoles.${SOURCE_ROLE_KEYS[source.domain_role]}`),
      }),
    }));
    const exact = formatDetailDateTime(shown.observed_at, timeZone);
    return (
      <div className="flex flex-col gap-3">
        <p className="flex flex-wrap items-center gap-x-1.5 type-meta">
          {shown.model_reported === null ? null : (
            <Fragment>
              <span>{shown.model_reported}</span>
              <span aria-hidden="true">{separator}</span>
            </Fragment>
          )}
          <Tooltip content={exact} purpose="label">
            <time
              {...TAB_STOP}
              dateTime={shown.observed_at}
              aria-label={exact}
              className="rounded-xs num outline-none focus-visible:focus-ring"
            >
              {formatRelative(shown.observed_at, timeZone)}
            </time>
          </Tooltip>
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
          <ul aria-label={latest('factsLabel')} className="flex flex-wrap gap-1.5">
            {shown.status === 'partial' ? (
              <li>
                <Badge tone="warning">{statuses('partial')}</Badge>
              </li>
            ) : null}
            <li>
              <Badge icon={facts.own_mentioned ? Check : Minus}>
                {facts.own_mentioned ? latest('mentioned') : latest('notMentioned')}
              </Badge>
            </li>
            {facts.own_mentioned && facts.own_mention_order !== null ? (
              <li>
                {/* The place of the brand among the tracked brands the answer names: not a rank, not a recommendation */}
                <Badge>
                  {latest('order', { place: mentionOrderKey(facts.own_mention_order), order: facts.own_mention_order })}
                </Badge>
              </li>
            ) : null}
            <li>
              <Badge icon={facts.own_domain_cited ? Check : Minus}>
                {facts.own_domain_cited ? latest('cited') : latest('notCited')}
              </Badge>
            </li>
          </ul>
        )}
        {sources.length === 0 ? null : (
          <ul aria-label={latest('sourcesLabel')} className="flex flex-wrap gap-1.5">
            {sources.map((source) => (
              <li key={source.host}>
                {source.own ? <Badge tone="info">{source.text}</Badge> : <Badge variant="outline">{source.text}</Badge>}
              </li>
            ))}
          </ul>
        )}
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

  return (
    <InspectorSection title={name} icon={MessageSquareText} status={status} error={error} empty={empty}>
      {detail.data === undefined ? null : body(detail.data.data)}
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
