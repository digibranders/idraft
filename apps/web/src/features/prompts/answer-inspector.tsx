'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ClipboardList, Link2, MessageSquareText, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ReactElement, type ReactNode } from 'react';

import { answerSegments } from './answer-segments';
import { failedReasonKey, outcomeKey } from './prompt-model';
import {
  fetchRawAnswer,
  observationQuery,
  projectEntitiesQuery,
  type ObservationAnswer,
  type PromptScope,
} from './prompt-queries';
import { EvidenceHighlight, type EntityColorIndex } from '@/components/app/evidence/evidence-highlight';
import { Inspector } from '@/components/app/inspector/inspector';
import { InspectorSection } from '@/components/app/inspector/inspector-section';
import { InspectorBody } from '@/components/app/inspector/inspector-tabs';
import { KeyValues, type KeyValue } from '@/components/app/inspector/key-values';
import { Banner } from '@/components/app/status/banner';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TextLink } from '@/components/ui/text-link';
import { toast } from '@/components/ui/toast';
import { isApiProblem } from '@/lib/api/problem';
import type { CitationOut, ProjectEngine } from '@/lib/api/types';
import { useErrorId } from '@/lib/api/use-error-id';
import { downloadUrl } from '@/lib/dom/download';
import { EMPTY_VALUE, formatDetailDateTime, formatTableDateTime } from '@/lib/format';
import { useCan } from '@/lib/permissions';

const colorOf = (value: number | null | undefined): EntityColorIndex | null =>
  value === 1 || value === 2 || value === 3 || value === 4 || value === 5 || value === 6 ? value : null;

/** How long the address of a downloaded raw answer lives, in milliseconds. */
const RAW_URL_RELEASE_MS = 1000;
const SOURCE_ROLE_KEYS = { own: 'own', competitor: 'competitor', third_party: 'thirdParty' } as const;

/** Only an http or https address becomes a link; anything else (`javascript:`, say) stays text. */
const isWebAddress = (url: string | null): url is string => url !== null && /^https?:\/\//i.test(url);

export interface AnswerInspectorProps {
  scope: PromptScope;
  observationId: string;
  /** The `observed_at` of the answer's row in a list, when the viewer was opened from one: the API finds the month by it. */
  observedAt?: string | undefined;
  timeZone: string;
  /** Every engine of the project, for their names. */
  engines: readonly ProjectEngine[];
  /** Opens the prompt the answer belongs to. */
  onBack: (promptId: string) => void;
  onClose: () => void;
}

/**
 * One answer (spec 2026-11-11 section 4.6, 23-application-patterns.md section 5.3): the answer text with the
 * own brand and the tracked competitors marked at their evidence spans, the brands it names, the sources it
 * cites with their role (own, competitor, third party), what it came to, and for `raw:read` a link to the
 * provider's raw answer. Ads are left out of mentions and sources by the normalizer, which the viewer says. A
 * failed, empty or refused answer says so, since it counts in no rate; one whose facts are not read yet says so.
 * It replaces the prompt inspector while it is open, and goes back to it.
 */
export function AnswerInspector({
  scope,
  observationId,
  observedAt,
  timeZone,
  engines,
  onBack,
  onClose,
}: AnswerInspectorProps): ReactElement {
  const t = useTranslations('prompts.answer');
  const words = useTranslations('prompts.inspector');
  const statuses = useTranslations('prompts.inspector.statuses');
  const common = useTranslations('common');
  const inspectorWords = useTranslations('inspector');
  const canReadRaw = useCan('raw:read');
  const detail = useQuery(observationQuery(scope, observationId, observedAt));
  const entities = useQuery(projectEntitiesQuery(scope));
  const errorId = useErrorId(detail.error);
  const answer = detail.data?.data ?? null;
  const colors = new Map((entities.data?.data ?? []).map((entry) => [entry.entity.entity_id, entry.color_index]));
  const engineName = (code: string): string =>
    engines.find((engine) => engine.engine.engine_code === code)?.engine.label ?? code;
  // An id that is no answer's (a hand-typed address) is an answer that is not there
  const notFound = isApiProblem(detail.error, 'not_found') || isApiProblem(detail.error, 'validation_failed');
  const [rawPending, setRawPending] = useState(false);

  // The raw answer is fetched through the API client, so a refusal reads as a problem: past its retention (410) or
  // not readable now (503) each says so; any other failure gets the generic line
  const rawAnswer = async (at: string): Promise<void> => {
    setRawPending(true);
    try {
      const file = await fetchRawAnswer(scope, observationId, at);
      const url = URL.createObjectURL(file);
      downloadUrl(url, `answer-${observationId}.json`);
      // A browser may read the address a moment after the click returns, so it is released after a while
      window.setTimeout(() => URL.revokeObjectURL(url), RAW_URL_RELEASE_MS);
    } catch (error) {
      if (isApiProblem(error, 'raw_expired')) toast({ type: 'info', title: t('rawExpired') });
      else if (isApiProblem(error, 'raw_unavailable')) toast({ type: 'error', title: t('rawUnavailable') });
      else toast({ type: 'error', title: t('rawFailed') });
    } finally {
      setRawPending(false);
    }
  };

  const answerText = (shown: ObservationAnswer): ReactNode => {
    if (shown.answer_text === null || shown.answer_text === '') {
      if (shown.status === 'error') {
        return (
          <EmptyState
            variant="inline"
            title={t('failed')}
            reason={t(`failedReasons.${failedReasonKey(shown.error_code)}`)}
            headingLevel={3}
          />
        );
      }
      return shown.status === 'refused' ? (
        <EmptyState variant="inline" title={t('refusedTitle')} reason={t('refusedReason')} headingLevel={3} />
      ) : (
        <EmptyState variant="inline" title={t('empty')} reason={t('emptyReason')} headingLevel={3} />
      );
    }
    return (
      <div className="flex flex-col gap-3">
        {shown.status === 'refused' ? <Banner tone="info" placement="region" message={t('refused')} /> : null}
        {shown.status === 'partial' ? <Banner tone="warning" placement="region" message={t('partial')} /> : null}
        <p lang={shown.language_code ?? undefined} className="type-prose wrap-anywhere whitespace-pre-wrap">
          {answerSegments(shown.answer_text, shown.mentions).map((segment) =>
            // The own brand is always the accent; the others wait for their colors, so none is drawn in the
            // style of "no color" and then recolored
            segment.kind === 'text' || (entities.isPending && segment.mention.role !== 'own') ? (
              <span key={segment.start}>{segment.text}</span>
            ) : (
              <EvidenceHighlight
                key={segment.start}
                entity={{
                  name: segment.mention.name,
                  own: segment.mention.role === 'own',
                  colorIndex: colorOf(colors.get(segment.mention.entity_id)),
                }}
                matchLabel={t(`matchLabels.${segment.mention.role}`)}
                confidence={segment.mention.confidence}
                certainty={segment.mention.mention_status === 'accepted' ? 'certain' : 'uncertain'}
              >
                {segment.text}
              </EvidenceHighlight>
            ),
          )}
        </p>
        <p className="type-meta">{t('adsNote')}</p>
      </div>
    );
  };

  const sourceBadge = (citation: CitationOut): ReactNode => {
    const label = t(`sourceRoles.${SOURCE_ROLE_KEYS[citation.domain_role]}`);
    if (citation.domain_role === 'own') return <Badge tone="info">{label}</Badge>;
    if (citation.domain_role === 'competitor') return <Badge variant="outline">{label}</Badge>;
    return <Badge>{label}</Badge>;
  };

  const detailsOf = (shown: ObservationAnswer): KeyValue[] => [
    { id: 'engine', label: t('engine'), value: engineName(shown.engine_code) },
    { id: 'observed', label: t('observed'), value: formatDetailDateTime(shown.observed_at, timeZone) },
    { id: 'model', label: t('model'), value: shown.model_reported ?? EMPTY_VALUE },
    { id: 'outcome', label: t('outcome'), value: words(`outcomes.${outcomeKey(shown.status, shown.facts)}`) },
    ...(isWebAddress(shown.check_url)
      ? [
          {
            id: 'check',
            label: t('checkLabel'),
            value: (
              <TextLink href={shown.check_url} target="_blank" rel="noopener noreferrer">
                {t('check')}
              </TextLink>
            ),
          },
        ]
      : []),
    ...(canReadRaw
      ? [
          {
            id: 'raw',
            label: t('rawLabel'),
            value: (
              <Button
                variant="link"
                size="sm"
                // Loading, not disabled: the button keeps its focus, and a second click is ignored
                loading={rawPending}
                onClick={() => void rawAnswer(shown.observed_at)}
              >
                {t('raw')}
              </Button>
            ),
          },
        ]
      : []),
  ];

  const mentionsPending = answer !== null && outcomeKey(answer.status, answer.facts) === 'pending';

  return (
    <Inspector
      type="answer"
      backLabel={t('back')}
      onClose={onClose}
      header={{
        title:
          answer === null
            ? ''
            : t('title', {
                engine: engineName(answer.engine_code),
                date: formatTableDateTime(answer.observed_at, timeZone),
              }),
        typeLabel: t('type'),
        typeNoun: t('noun'),
        badges: answer === null ? null : <Badge>{statuses(answer.status)}</Badge>,
        frequentAction:
          answer === null ? null : (
            <Button variant="secondary" size="sm" icon={ArrowLeft} onClick={() => onBack(answer.subject.prompt_id)}>
              {t('backToPrompt')}
            </Button>
          ),
        moreActions: [],
      }}
    >
      <InspectorBody>
        {detail.isError && answer === null ? (
          notFound ? (
            <EmptyState
              variant="inline"
              title={t('loadFailed')}
              reason={inspectorWords('notFound', { type: t('noun') })}
              headingLevel={3}
            />
          ) : (
            <InlineError
              title={t('loadFailed')}
              reason={t('loadFailedReason')}
              errorId={errorId}
              onRetry={() => void detail.refetch()}
              retrying={detail.isFetching}
              retryLabel={common('retry')}
            />
          )
        ) : (
          <>
            <InspectorSection title={t('text')} icon={MessageSquareText} status={answer === null ? 'loading' : 'ready'}>
              {answer === null ? null : answerText(answer)}
            </InspectorSection>
            <InspectorSection
              title={t('mentions')}
              icon={Users}
              status={answer === null ? 'loading' : answer.mentions.length === 0 ? 'empty' : 'ready'}
              empty={
                mentionsPending ? (
                  <EmptyState
                    variant="inline"
                    title={t('mentionsPending')}
                    reason={t('mentionsPendingReason')}
                    headingLevel={3}
                  />
                ) : (
                  <EmptyState
                    variant="inline"
                    title={t('noMentions')}
                    reason={t('noMentionsReason')}
                    headingLevel={3}
                  />
                )
              }
            >
              {answer === null ? null : (
                <KeyValues
                  items={answer.mentions.map((mention) => ({
                    id: mention.entity_id,
                    label: mention.name,
                    value: (
                      <span className="inline-flex flex-wrap items-center gap-1.5">
                        <Badge>{t(`roles.${mention.role}`)}</Badge>
                        {mention.mention_status === 'uncertain' ? <Badge tone="warning">{t('uncertain')}</Badge> : null}
                        {mention.match_method === 'via_product' ? <Badge>{t('viaProduct')}</Badge> : null}
                        <span>{t('mentionCount', { count: mention.mention_count })}</span>
                        {mention.mention_order === null ? null : (
                          <span className="num">{t('mentionOrder', { order: mention.mention_order })}</span>
                        )}
                      </span>
                    ),
                  }))}
                />
              )}
            </InspectorSection>
            <InspectorSection
              title={t('sources')}
              icon={Link2}
              status={answer === null ? 'loading' : answer.citations.length === 0 ? 'empty' : 'ready'}
              empty={
                <EmptyState variant="inline" title={t('noSources')} reason={t('noSourcesReason')} headingLevel={3} />
              }
            >
              {answer === null ? null : (
                <ol aria-label={t('sourcesCaption')} className="flex flex-col gap-2">
                  {answer.citations.map((citation) => (
                    <li key={citation.citation_index} className="flex items-start justify-between gap-3">
                      <span className="flex min-w-0 flex-col wrap-anywhere">
                        {/* The canonical address, never the raw one the provider sent */}
                        {isWebAddress(citation.url) ? (
                          <TextLink href={citation.url} target="_blank" rel="noopener noreferrer">
                            {citation.title ?? citation.host}
                          </TextLink>
                        ) : (
                          <span className="type-body">{citation.title ?? citation.host}</span>
                        )}
                        <span className="truncate type-meta">{citation.host}</span>
                      </span>
                      {sourceBadge(citation)}
                    </li>
                  ))}
                </ol>
              )}
            </InspectorSection>
            <InspectorSection title={t('details')} icon={ClipboardList} status={answer === null ? 'loading' : 'ready'}>
              {answer === null ? null : <KeyValues items={detailsOf(answer)} />}
            </InspectorSection>
          </>
        )}
      </InspectorBody>
    </Inspector>
  );
}
