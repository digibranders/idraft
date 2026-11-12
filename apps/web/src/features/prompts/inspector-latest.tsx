'use client';

import { useQuery } from '@tanstack/react-query';
import { Check, MessageSquareText, Minus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Fragment, type ReactElement, type ReactNode } from 'react';

import { answerSegments, clipSegments } from './answer-segments';
import type { PromptAnswers } from './inspector-reads';
import { latestPerEngine, mentionOrderKey, type LatestPick } from './latest-model';
import { MarkedAnswer } from './marked-answer';
import { failedReasonKey } from './prompt-model';
import { observationQuery, projectEntitiesQuery, type ObservationAnswer, type PromptScope } from './prompt-queries';
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

export interface InspectorLatestProps {
  scope: PromptScope;
  timeZone: string;
  /** The enabled engines, in order: one card each. */
  engines: readonly ProjectEngine[];
  answers: PromptAnswers;
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

interface LatestCardProps {
  pick: LatestPick;
  engine: ProjectEngine;
  scope: PromptScope;
  timeZone: string;
  answers: PromptAnswers;
  colors: ReadonlyMap<string, number | null | undefined>;
  colorsPending: boolean;
  onOpenAnswer: InspectorLatestProps['onOpenAnswer'];
}

/** One engine's card: its latest valid answer, or why it has none. */
function LatestCard({
  pick,
  engine,
  scope,
  timeZone,
  answers,
  colors,
  colorsPending,
  onOpenAnswer,
}: LatestCardProps): ReactElement {
  const t = useTranslations('prompts.inspector');
  const latest = useTranslations('prompts.inspector.latest');
  const answerWords = useTranslations('prompts.answer');
  const common = useTranslations('common');
  const separator = useTranslations('inspector')('separator');
  const observation = pick.observation;
  const detail = useQuery({
    ...observationQuery(scope, observation?.observation_id ?? '', observation?.observed_at),
    enabled: observation !== null,
  });
  const errorId = useErrorId(detail.error);
  const name = engine.engine.label;
  const noValid = (reason: string): ReactElement => (
    <EmptyState variant="inline" title={latest('noValidTitle', { engine: name })} reason={reason} headingLevel={3} />
  );

  const body = (shown: ObservationAnswer): ReactElement => {
    if (!pick.valid || shown.answer_text === null || shown.answer_text === '') {
      if (shown.status === 'error') return noValid(answerWords(`failedReasons.${failedReasonKey(shown.error_code)}`));
      if (shown.status === 'refused') return noValid(answerWords('refusedReason'));
      if (shown.status === 'empty') return noValid(answerWords('emptyReason'));
      return noValid(latest('pendingReason'));
    }
    const { segments, clipped } = clipSegments(answerSegments(shown.answer_text, shown.mentions), EXCERPT_LENGTH);
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
            <time dateTime={shown.observed_at} aria-label={exact} className="num">
              {formatRelative(shown.observed_at, timeZone)}
            </time>
          </Tooltip>
        </p>
        <MarkedAnswer
          segments={segments}
          colors={colors}
          colorsPending={colorsPending}
          lang={shown.language_code ?? undefined}
          className="type-body wrap-anywhere whitespace-pre-wrap"
          suffix={clipped ? <span aria-hidden="true">{latest('ellipsis')}</span> : null}
        />
        {facts === null ? null : (
          <ul aria-label={latest('factsLabel')} className="flex flex-wrap gap-1.5">
            <li>
              <Badge icon={facts.own_mentioned ? Check : Minus}>
                {facts.own_mentioned ? latest('mentioned') : latest('notMentioned')}
              </Badge>
            </li>
            {facts.own_mentioned && facts.own_mention_order !== null ? (
              <li>
                {/* The place of the brand among those the answer names: not a rank, and not a recommendation */}
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
  if (answers.status === 'loading') status = 'loading';
  else if (answers.status === 'error') {
    status = 'error';
    error = (
      <InlineError
        title={t('answersFailed')}
        reason={t('loadFailedReason')}
        errorId={answers.errorId}
        onRetry={answers.retry}
        retrying={answers.retrying}
        retryLabel={common('retry')}
      />
    );
  } else if (observation === null) {
    status = 'empty';
    empty = noValid(latest('noAnswerReason'));
  } else if (detail.isError && detail.data === undefined) {
    status = 'error';
    error = (
      <InlineError
        title={latest('loadFailed', { engine: name })}
        reason={t('loadFailedReason')}
        errorId={errorId}
        onRetry={() => void detail.refetch()}
        retrying={detail.isFetching}
        retryLabel={common('retry')}
      />
    );
  } else if (detail.data === undefined) status = 'loading';

  return (
    <InspectorSection title={name} icon={MessageSquareText} status={status} error={error} empty={empty}>
      {detail.data === undefined ? null : body(detail.data.data)}
    </InspectorSection>
  );
}

/**
 * The Latest tab of the prompt inspector (parity spec G93): for each enabled engine its newest valid answer, with the
 * start of its text marked at the brands it names, whether it names and cites the brand, its first sources and a
 * button to the whole answer. One read of the answer for each engine; an engine with no valid answer says so, and
 * says why when its newest answer failed. Each card loads and fails on its own.
 */
export function InspectorLatest({
  scope,
  timeZone,
  engines,
  answers,
  onOpenAnswer,
  children,
}: InspectorLatestProps): ReactElement {
  const entities = useQuery(projectEntitiesQuery(scope));
  const colors = new Map((entities.data?.data ?? []).map((entry) => [entry.entity.entity_id, entry.color_index]));
  const picks = latestPerEngine(
    answers.rows,
    engines.map((engine) => engine.engine.engine_code),
  );
  return (
    <>
      {engines.map((engine) => {
        const pick = picks.find((candidate) => candidate.engineCode === engine.engine.engine_code);
        return pick === undefined ? null : (
          <LatestCard
            // A new answer is a new card: it reads its own detail, and the pick of another prompt is never reused
            key={`${engine.engine.engine_code}:${pick.observation?.observation_id ?? 'none'}`}
            pick={pick}
            engine={engine}
            scope={scope}
            timeZone={timeZone}
            answers={answers}
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
