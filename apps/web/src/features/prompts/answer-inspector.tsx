'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ClipboardList, ExternalLink, Link2, MessageSquareText, Quote, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';

import { answerCompareQuery } from './answer-compare-query';
import { markerAnchors } from './answer-markers';
import { answerSegments, type AnswerSegment } from './answer-segments';
import { entityColorOf, MarkedAnswer } from './marked-answer';
import { failedReasonKey, outcomeKey } from './prompt-model';
import {
  aiKey,
  fetchRawAnswer,
  observationQuery,
  projectEntitiesQuery,
  type ObservationAnswer,
  type PromptScope,
} from './prompt-queries';
import { AnswerComparePanel, type AnswerCompareState } from '@/components/app/evidence/answer-compare-panel';
import { AnswerViewMode, type AnswerView } from '@/components/app/evidence/answer-view-mode';
import { CitationList, citationItemId, type CitationListItem } from '@/components/app/evidence/citation-list';
import { EntityToggleList, type EntityToggleItem } from '@/components/app/evidence/entity-toggle-list';
import { FactsFooter, type FactsFooterFacts } from '@/components/app/evidence/facts-footer';
import { QuotedPassage } from '@/components/app/evidence/quoted-passage';
import { SafeMarkdown } from '@/components/app/evidence/safe-markdown';
import { Inspector } from '@/components/app/inspector/inspector';
import { InspectorSection } from '@/components/app/inspector/inspector-section';
import { InspectorBody } from '@/components/app/inspector/inspector-tabs';
import { KeyValues, type KeyValue } from '@/components/app/inspector/key-values';
import { useInspector } from '@/components/app/inspector/use-inspector';
import { Banner } from '@/components/app/status/banner';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/skeleton';
import { TextLink } from '@/components/ui/text-link';
import { toast } from '@/components/ui/toast';
import { isApiProblem } from '@/lib/api/problem';
import type { ProjectEngine } from '@/lib/api/types';
import { useErrorId } from '@/lib/api/use-error-id';
import { downloadUrl } from '@/lib/dom/download';
import { EMPTY_VALUE, formatDetailDateTime, formatInteger, formatTableDateTime, webHref } from '@/lib/format';
import { useCan } from '@/lib/permissions';

/** How long the address of a downloaded raw answer lives, in milliseconds. */
const RAW_URL_RELEASE_MS = 1000;
/** The Raw view shows this many characters of the provider's answer; the download has all of it. */
const RAW_VIEW_LIMIT = 200_000;

/**
 * The first `RAW_VIEW_LIMIT` UTF-16 units of a text the viewer shows whole in no view but Evidence (the raw answer, the
 * markdown), never ending between the halves of one character.
 */
function rawExcerpt(text: string): string {
  if (text.length <= RAW_VIEW_LIMIT) return text;
  const last = text.charCodeAt(RAW_VIEW_LIMIT - 1);
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? RAW_VIEW_LIMIT - 1 : RAW_VIEW_LIMIT);
}

/** Takes focus to an element and scrolls it into view, smoothly unless the reader asked for less motion. */
function reveal(target: HTMLElement | null): void {
  if (target === null) return;
  target.focus({ preventScroll: true });
  // Not every environment has either (jsdom): focus has happened regardless
  if (typeof target.scrollIntoView === 'function') {
    const reduced =
      typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
  }
}

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
 * One answer (spec 2026-11-11 section 4.6, 23-application-patterns.md section 5): the answer text in three views
 * (Evidence, with the own brand and the tracked competitors marked at their evidence spans and a marker after each
 * cited address; Formatted, the markdown as elements; Raw, the provider's reply as received, for `raw:read`), the
 * brands it names, the sources it cites with their role (own, competitor, third party), what it came to, and for
 * `raw:read` a link to the provider's raw answer. Ads are left out of mentions and sources by the normalizer, which
 * the viewer says. A failed, empty or refused answer says so, since it counts in no rate; one whose facts are not
 * read yet says so. It replaces the prompt inspector while it is open, and goes back to it. The view, the entities
 * turned off and the citation in focus belong to one answer: opening another starts them again.
 */
export function AnswerInspector(props: AnswerInspectorProps): ReactElement {
  return <AnswerInspectorBody key={props.observationId} {...props} />;
}

function AnswerInspectorBody({
  scope,
  observationId,
  observedAt,
  timeZone,
  engines,
  onBack,
  onClose,
}: AnswerInspectorProps): ReactElement {
  const t = useTranslations('prompts.answer');
  const evidence = useTranslations('evidence');
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

  const [view, setView] = useState<AnswerView>('evidence');
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const [activeCitation, setActiveCitation] = useState<number | null>(null);
  const idPrefix = useId();
  const textRef = useRef<HTMLDivElement>(null);
  // "Show in answer" from another view first goes back to the marked text, and the marker takes focus once it is drawn
  const pendingMarker = useRef<number | null>(null);
  // Raw is only for a member who may read it, whatever was chosen before
  const shownView: AnswerView = view === 'raw' && !canReadRaw ? 'evidence' : view;

  // The raw answer is read when Raw is opened, once: it stays for the life of the viewer, and a failure is kept until
  // Try again. A refusal reads as a problem: past its retention (410) or not readable now (503) each says so.
  const raw = useQuery({
    queryKey: [...aiKey(scope), 'raw-answer', observationId],
    queryFn: async () => (await fetchRawAnswer(scope, observationId, answer?.observed_at ?? observedAt)).text(),
    enabled: shownView === 'raw' && answer !== null,
    retry: false,
    staleTime: Infinity,
  });
  const rawErrorId = useErrorId(raw.error);

  useEffect(() => {
    const index = pendingMarker.current;
    if (index === null) return;
    pendingMarker.current = null;
    reveal(textRef.current?.querySelector<HTMLElement>(`[data-citation-marker="${String(index)}"]`) ?? null);
  });

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

  /** A marker in the text was used: its item in the list is marked, scrolled to and given focus. */
  const showCitation = (index: number): void => {
    setActiveCitation(index);
    reveal(document.getElementById(citationItemId(idPrefix, index)));
  };
  /** "Show in answer" in the list: the marker in the text is marked, scrolled to and given focus. */
  const showInAnswer = (index: number): void => {
    setActiveCitation(index);
    if (shownView === 'evidence') {
      reveal(textRef.current?.querySelector<HTMLElement>(`[data-citation-marker="${String(index)}"]`) ?? null);
      return;
    }
    pendingMarker.current = index;
    setView('evidence');
  };
  const toggleEntity = (entityId: string, visible: boolean): void => {
    setHidden((current) => {
      const next = new Set(current);
      if (visible) next.delete(entityId);
      else next.add(entityId);
      return next;
    });
  };

  const rawView = (): ReactNode => {
    if (raw.isError) {
      if (isApiProblem(raw.error, 'raw_expired')) {
        return (
          <EmptyState variant="inline" title={evidence('raw.expiredTitle')} reason={t('rawExpired')} headingLevel={3} />
        );
      }
      const failedReason = isApiProblem(raw.error, 'raw_unavailable') ? t('rawUnavailable') : t('rawFailed');
      return (
        <InlineError
          title={evidence('raw.failedTitle')}
          reason={failedReason}
          errorId={rawErrorId}
          onRetry={() => void raw.refetch()}
          retrying={raw.isFetching}
          retryLabel={common('retry')}
        />
      );
    }
    if (raw.data === undefined) {
      return (
        <div role="status" aria-label={evidence('raw.loading')} className="flex flex-col gap-2">
          <Skeleton shape="text-13" widthPct={100} />
          <Skeleton shape="text-13" widthPct={80} />
          <Skeleton shape="text-13" widthPct={64} />
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-2">
        {/* Escaped text as the provider sent it: React text, never markup */}
        <pre className="rounded-md bg-surface-subtle p-3 type-mono wrap-anywhere whitespace-pre-wrap">
          {rawExcerpt(raw.data)}
        </pre>
        {raw.data.length > RAW_VIEW_LIMIT ? (
          <p className="type-meta">{evidence('raw.truncated', { count: formatInteger(RAW_VIEW_LIMIT) })}</p>
        ) : null}
      </div>
    );
  };

  /** The entities the text marks, the own brand first, each with the number of marks it has there. */
  const entityItems = (
    segments: readonly AnswerSegment<ObservationAnswer['mentions'][number]>[],
  ): EntityToggleItem[] => {
    const found = new Map<string, EntityToggleItem>();
    for (const segment of segments) {
      if (segment.kind !== 'mention') continue;
      const { mention } = segment;
      // A competitor's marks wait for its color, so its toggle does too
      if (entities.isPending && mention.role !== 'own') continue;
      const current = found.get(mention.entity_id);
      found.set(mention.entity_id, {
        entityId: mention.entity_id,
        name: mention.name,
        own: mention.role === 'own',
        colorIndex: entityColorOf(colors.get(mention.entity_id)),
        spanCount: (current?.spanCount ?? 0) + 1,
        visible: !hidden.has(mention.entity_id),
      });
    }
    return [...found.values()].sort((a, b) => Number(b.own) - Number(a.own));
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
    const segments = answerSegments(shown.answer_text, shown.mentions);
    const hosts = new Map(shown.citations.map((citation) => [citation.citation_index, citation.host]));
    return (
      <div className="flex flex-col gap-3">
        {shown.status === 'refused' ? <Banner tone="info" placement="region" message={t('refused')} /> : null}
        {shown.status === 'partial' ? <Banner tone="warning" placement="region" message={t('partial')} /> : null}
        {shownView === 'evidence' ? (
          <>
            <EntityToggleList items={entityItems(segments)} onToggle={toggleEntity} />
            <div ref={textRef}>
              <MarkedAnswer
                segments={segments}
                colors={colors}
                colorsPending={entities.isPending}
                lang={shown.language_code ?? undefined}
                className="type-prose wrap-anywhere whitespace-pre-wrap"
                hidden={hidden}
                markers={markerAnchors(shown.answer_text, shown.citations)}
                citationLabel={(index) => evidence('citationMarker.label', { index, host: hosts.get(index) ?? '' })}
                activeCitation={activeCitation}
                onCitation={showCitation}
              />
            </div>
          </>
        ) : shownView === 'formatted' ? (
          <>
            <SafeMarkdown source={rawExcerpt(shown.answer_text)} lang={shown.language_code ?? undefined} />
            {shown.answer_text.length > RAW_VIEW_LIMIT ? (
              <p className="type-meta">{evidence('raw.truncated', { count: formatInteger(RAW_VIEW_LIMIT) })}</p>
            ) : null}
          </>
        ) : (
          rawView()
        )}
        {shownView === 'raw' ? null : <p className="type-meta">{t('adsNote')}</p>}
      </div>
    );
  };

  const citationItems = (shown: ObservationAnswer): CitationListItem[] => {
    const anchored = new Set(
      markerAnchors(shown.answer_text ?? '', shown.citations).map((anchor) => anchor.citationIndex),
    );
    return shown.citations.map((citation) => ({
      index: citation.citation_index,
      title: citation.title ?? citation.host,
      url: citation.url,
      rawUrl: citation.raw_url,
      host: citation.host,
      role: citation.domain_role,
      // The passages have a section of their own (QuotedPassage): the source list does not repeat them
      quote: null,
      flags: citation.flags,
      inAnswer: anchored.has(citation.citation_index),
    }));
  };

  const detailsOf = (shown: ObservationAnswer): KeyValue[] => {
    // Only an http or https address without credentials becomes a link; anything else (`javascript:`, say) stays text
    const checkHref = shown.check_url === null ? null : webHref(shown.check_url);
    return [
      { id: 'engine', label: t('engine'), value: engineName(shown.engine_code) },
      { id: 'observed', label: t('observed'), value: formatDetailDateTime(shown.observed_at, timeZone) },
      { id: 'model', label: t('model'), value: shown.model_reported ?? EMPTY_VALUE },
      { id: 'outcome', label: t('outcome'), value: words(`outcomes.${outcomeKey(shown.status, shown.facts)}`) },
      ...(checkHref !== null
        ? [
            {
              id: 'check',
              label: t('checkLabel'),
              value: (
                <TextLink
                  href={checkHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1"
                >
                  {evidence('provider.open')}
                  <Icon icon={ExternalLink} size="sm" />
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
  };

  /** What the extractor read, as the facts footer lists it; `null` while the answer has not been read yet. */
  const factsOf = (shown: ObservationAnswer): FactsFooterFacts | null =>
    shown.facts === null
      ? null
      : {
          ownMentioned: shown.facts.own_mentioned,
          ownDomainCited: shown.facts.own_domain_cited,
          ownMentionOrder: shown.facts.own_mention_order,
          ownProminence: shown.facts.own_prominence,
          ownCitationCount: shown.facts.own_citation_count,
          totalCitationCount: shown.facts.total_citation_count,
          derivationId: shown.facts.derivation_id,
        };

  const mentionsPending = answer !== null && outcomeKey(answer.status, answer.facts) === 'pending';
  const hasText = answer !== null && answer.answer_text !== null && answer.answer_text !== '';
  // An answer with no text has no brands or sources to compare. `no_baseline` is a reason, not a failure
  const compare = useQuery({ ...answerCompareQuery(scope, observationId), enabled: hasText });
  const compareErrorId = useErrorId(compare.error);
  const compareState: AnswerCompareState =
    compare.data !== undefined
      ? { status: compare.isFetching ? 'refetching' : 'ready', compare: compare.data.data }
      : isApiProblem(compare.error, 'no_baseline')
        ? { status: 'empty' }
        : compare.isError
          ? {
              status: 'error',
              errorId: compareErrorId,
              onRetry: () => void compare.refetch(),
              retrying: compare.isFetching,
            }
          : { status: 'loading' };
  // The viewer opens another answer by the address, as the prompt inspector does
  const inspector = useInspector();
  const hasQuotes = answer !== null && answer.citations.some((citation) => (citation.quote ?? '') !== '');

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
            <InspectorSection
              title={t('text')}
              icon={MessageSquareText}
              status={answer === null ? 'loading' : 'ready'}
              action={
                hasText ? (
                  <AnswerViewMode value={shownView} onValueChange={setView} canViewRaw={canReadRaw} />
                ) : undefined
              }
            >
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
                <CitationList
                  items={citationItems(answer)}
                  idPrefix={idPrefix}
                  activeIndex={activeCitation}
                  lang={answer.language_code ?? undefined}
                  onShowInAnswer={showInAnswer}
                />
              )}
            </InspectorSection>
            {answer !== null && hasQuotes ? (
              <InspectorSection title={evidence('quotedPassage.title')} icon={Quote} status="ready">
                <QuotedPassage
                  lang={answer.language_code ?? undefined}
                  items={answer.citations.map((citation) => ({
                    index: citation.citation_index,
                    host: citation.host,
                    url: citation.url,
                    quote: citation.quote ?? null,
                  }))}
                />
              </InspectorSection>
            ) : null}
            {hasText ? (
              <AnswerComparePanel
                state={compareState}
                timeZone={timeZone}
                onOpenBaseline={(baselineId) => inspector.open({ type: 'answer', id: baselineId })}
              />
            ) : null}
            <InspectorSection title={t('details')} icon={ClipboardList} status={answer === null ? 'loading' : 'ready'}>
              {answer === null ? null : (
                <div className="flex flex-col gap-3">
                  <KeyValues items={detailsOf(answer)} />
                  <FactsFooter
                    facts={factsOf(answer)}
                    answerSha256={answer.answer_sha256}
                    rawSha256={answer.raw_sha256}
                  />
                </div>
              )}
            </InspectorSection>
          </>
        )}
      </InspectorBody>
    </Inspector>
  );
}
