'use client';

import { GitCompareArrows } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';

import { InspectorSection } from '@/components/app/inspector/inspector-section';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError, type InlineErrorProps } from '@/components/app/status/inline-error';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { Schemas } from '@/lib/api/types';
import { formatDetailDateTime } from '@/lib/format';

/**
 * What the panel shows. `empty` is the answer to "no earlier answer named the brand" (`404 no_baseline`): a reason,
 * not a failure. `refetching` keeps the comparison it had.
 */
export type AnswerCompareState =
  | { status: 'loading' }
  | { status: 'ready' | 'refetching'; compare: Schemas['AnswerCompare'] }
  | { status: 'empty' }
  | { status: 'error'; errorId: InlineErrorProps['errorId']; onRetry: () => void; retrying: boolean };

export interface AnswerComparePanelProps {
  state: AnswerCompareState;
  timeZone: string;
  /** Opens the baseline answer in the viewer. */
  onOpenBaseline: (observationId: string, observedAt: string) => void;
}

const ENTITY_ROLE_KEY = { own: 'own', competitor: 'competitor', watch: 'watch' } as const;
const SOURCE_ROLE_KEY = { own: 'own', competitor: 'competitor', third_party: 'thirdParty' } as const;

/** One heading, in words, with what it counts, and the names under it. A group with none has no list. */
function ChangeGroup({ heading, items }: { heading: string; items: readonly ReactNode[] }): ReactElement {
  return (
    <div className="flex flex-col gap-1">
      <p className="type-body-strong">{heading}</p>
      {items.length === 0 ? null : <ul className="flex flex-col gap-1">{items}</ul>}
    </div>
  );
}

/**
 * The answer against the last earlier one of the same prompt and engine that named the brand (WB-ANS-15, the summary
 * form): which brands and sources the answer gained, lost and kept, with both answers named and the earlier one one
 * button away. Gained and lost are told in words ("2 brands lost"), never by colour, and no tone is chosen here. The
 * names are collected text and only ever text children. The side by side text view belongs to Prompt Detail.
 */
export function AnswerComparePanel({ state, timeZone, onOpenBaseline }: AnswerComparePanelProps): ReactElement {
  const t = useTranslations('evidence.compare');
  const common = useTranslations('common');
  const compare = state.status === 'ready' || state.status === 'refetching' ? state.compare : null;
  const refetching = state.status === 'refetching';

  const sideLine = (side: Schemas['CompareSide']): ReactElement => (
    <>
      <span className="type-body wrap-anywhere">
        {t('answerOf', { date: formatDetailDateTime(side.observed_at, timeZone), id: side.observation_id })}
      </span>
      <span className="block type-meta">
        {t('ownFacts', { named: String(side.own_mentioned), cited: String(side.own_domain_cited) })}
      </span>
    </>
  );

  const entityItems = (entities: readonly Schemas['CompareEntity'][]): ReactElement[] =>
    entities.map((entity) => (
      <li key={entity.entity_id} className="flex flex-wrap items-center gap-1.5">
        <span className="type-body wrap-anywhere">{entity.name}</span>
        <Badge tone={entity.role === 'own' ? 'info' : 'neutral'}>{t(`roles.${ENTITY_ROLE_KEY[entity.role]}`)}</Badge>
      </li>
    ));

  const sourceItems = (sources: readonly Schemas['CompareSource'][]): ReactElement[] =>
    sources.map((source) => (
      <li key={source.registrable_domain} className="flex flex-wrap items-center gap-x-1.5">
        <span className="flex min-w-0 flex-col wrap-anywhere">
          <span className="type-body">{source.title ?? source.host}</span>
          {source.title === null ? null : <span className="type-meta">{source.host}</span>}
        </span>
        <Badge tone={source.domain_role === 'own' ? 'info' : 'neutral'}>
          {t(`roles.${SOURCE_ROLE_KEY[source.domain_role]}`)}
        </Badge>
      </li>
    ));

  const body = (shown: Schemas['AnswerCompare']): ReactElement => {
    const { baseline, latest, entities, sources } = shown;
    return (
      <div aria-busy={refetching ? true : undefined} className="relative flex flex-col gap-4">
        {refetching ? (
          <div
            aria-hidden="true"
            data-slot="compare-refetch-bar"
            className="absolute inset-x-0 top-0 h-0.5 bg-primary"
          />
        ) : null}
        <dl className="grid grid-cols-5 gap-x-4 gap-y-2">
          <div className="col-span-5 grid grid-cols-subgrid">
            <dt className="col-span-2 min-w-0 type-label wrap-anywhere">{t('thisAnswer')}</dt>
            <dd className="col-span-3 min-w-0">{sideLine(latest)}</dd>
          </div>
          <div className="col-span-5 grid grid-cols-subgrid">
            <dt className="col-span-2 min-w-0 type-label wrap-anywhere">{t('baseline')}</dt>
            <dd className="col-span-3 min-w-0">
              {sideLine(baseline)}
              <Button
                variant="link"
                size="sm"
                aria-label={t('openNamed', { date: formatDetailDateTime(baseline.observed_at, timeZone) })}
                onClick={() => onOpenBaseline(baseline.observation_id, baseline.observed_at)}
              >
                {t('open')}
              </Button>
            </dd>
          </div>
        </dl>
        <div className="flex flex-col gap-2">
          <h4 className="type-subsection-title">{t('brandsTitle')}</h4>
          <ChangeGroup
            heading={t('brandsGained', { count: entities.gained.length })}
            items={entityItems(entities.gained)}
          />
          <ChangeGroup heading={t('brandsLost', { count: entities.lost.length })} items={entityItems(entities.lost)} />
          <ChangeGroup heading={t('brandsKept', { count: entities.kept.length })} items={entityItems(entities.kept)} />
        </div>
        <div className="flex flex-col gap-2">
          <h4 className="type-subsection-title">{t('sourcesTitle')}</h4>
          <ChangeGroup
            heading={t('sourcesGained', { count: sources.gained.length })}
            items={sourceItems(sources.gained)}
          />
          <ChangeGroup heading={t('sourcesLost', { count: sources.lost.length })} items={sourceItems(sources.lost)} />
          <ChangeGroup heading={t('sourcesKept', { count: sources.kept_count })} items={[]} />
        </div>
      </div>
    );
  };

  return (
    <InspectorSection
      title={t('title')}
      icon={GitCompareArrows}
      status={
        state.status === 'loading'
          ? 'loading'
          : state.status === 'empty'
            ? 'empty'
            : state.status === 'error'
              ? 'error'
              : 'ready'
      }
      skeleton={
        <div role="status" aria-label={t('loading')} className="flex flex-col gap-2">
          <Skeleton shape="text-13" widthPct={72} />
          <Skeleton shape="text-13" widthPct={56} />
          <Skeleton shape="text-13" widthPct={64} />
        </div>
      }
      empty={<EmptyState variant="inline" title={t('emptyTitle')} reason={t('emptyReason')} headingLevel={3} />}
      error={
        state.status === 'error' ? (
          <InlineError
            title={t('failedTitle')}
            reason={t('failedReason')}
            errorId={state.errorId}
            onRetry={state.onRetry}
            retrying={state.retrying}
            retryLabel={common('retry')}
          />
        ) : null
      }
    >
      {compare === null ? null : body(compare)}
    </InspectorSection>
  );
}
