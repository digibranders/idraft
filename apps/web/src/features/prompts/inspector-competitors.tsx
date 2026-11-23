'use client';

import { useQuery } from '@tanstack/react-query';
import { Search, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ReactElement } from 'react';

import { ALL_ENGINES, competitorCounts, type CompetitorRow } from './competitor-counts';
import { usePromptFacts } from './facts';
import type { PromptAnswers, PromptCounts } from './inspector-reads';
import type { DateRange } from './prompt-model';
import type { PromptScope } from './prompt-queries';
import { EntitySwatch } from '@/components/app/entity/entity-swatch';
import { InspectorSection, type InspectorSectionStatus } from '@/components/app/inspector/inspector-section';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { Badge } from '@/components/ui/badge';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Tooltip } from '@/components/ui/tooltip';
import type { LinkedKeywordVolume } from '@/lib/api/prompt-facts';
import type { MetricCell, ProjectEngine } from '@/lib/api/types';
import { projectEntitiesQuery } from '@/lib/entities/project-entities';
import { EMPTY_VALUE, formatPercent } from '@/lib/format';
import { rateState } from '@/lib/stats';

type RateKind = 'mention' | 'recommendation';

/** What one cell of the matrix says: a count of answers, and its rate only with enough of them. */
type CellValue =
  | { kind: 'count'; k: number; n: number; rate: number | null }
  | { kind: 'none'; reason: 'noAnswers' | 'notClassified' | 'notCollected' };

export interface InspectorCompetitorsProps {
  scope: PromptScope;
  promptId: string;
  counts: PromptCounts;
  /** The window of the page, which the facts of the prompt are read over. */
  range: DateRange;
  /** The enabled engines, in order: one column each. */
  engines: readonly ProjectEngine[];
  answers: PromptAnswers;
}

/** A count of valid answers as a cell: the rate only from `MIN_OBSERVATIONS` answers, the count always. */
function countCell(k: number, n: number): CellValue {
  return n === 0
    ? { kind: 'none', reason: 'noAnswers' }
    : { kind: 'count', k, n, rate: rateState(n) === 'ok' ? k / n : null };
}

/**
 * The own brand's recommendation on one engine, from the facts of the prompt's row. An absent cell is a fact the backend
 * has not built (`notCollected`); a `null` cell is an engine whose answers are not classified for it.
 */
function recommendedCell(cell: MetricCell | null | undefined): CellValue {
  if (cell === undefined) return { kind: 'none', reason: 'notCollected' };
  if (cell === null) return { kind: 'none', reason: 'notClassified' };
  return countCell(cell.numerator, cell.denominator);
}

/**
 * The Competitors tab of the prompt inspector (parity spec G98, register PR-DRAWER-09): a Brands card with one column
 * for each platform and a switch between the Mention and the Recommendation rate, and a Related keywords card.
 * Mentions are counted in the browser from the list of the prompt's answers (`facts.competitor_mentions` and
 * `facts.own_mentioned`), with the names and roles of the summary's entity set, over the valid answers of each
 * platform on its own: there is no pooled column. The own brand comes first and is marked. A mention is a name in an
 * answer, not a recommendation. The recommendation of the own brand is read from the prompt's facts and the one of a
 * competitor is not collected yet. When the list is the 200 answers the API gives at most and it has more, the tab says
 * its counts are of the latest.
 */
export function InspectorCompetitors({
  scope,
  promptId,
  counts,
  range,
  engines,
  answers,
}: InspectorCompetitorsProps): ReactElement {
  const t = useTranslations('prompts.inspector');
  const words = useTranslations('prompts.inspector.competitors');
  const drawer = useTranslations('prompts.drawer.competitors');
  const common = useTranslations('common');
  const [kind, setKind] = useState<RateKind>('mention');
  const entities = useQuery(projectEntitiesQuery(scope));
  const facts = usePromptFacts(
    scope,
    range,
    counts.brandedIncluded,
    counts.brandedOnly === true ? { brandedOnly: true } : {},
  );
  const colors = new Map((entities.data?.data ?? []).map((entry) => [entry.entity.entity_id, entry.color_index]));
  // The list keeps the answers of an engine that was turned off: they are no part of any column
  const codes: string[] = engines.map((entry) => entry.engine.engine_code);
  const perEngine = new Map(codes.map((code) => [code, competitorCounts(answers.rows, counts.entities, code, codes)]));
  // The order of the rows is the one the answers of all enabled platforms give; no number of that pool is shown
  const ordered = competitorCounts(answers.rows, counts.entities, ALL_ENGINES, codes);
  const factsRow = facts.data?.prompts.get(promptId);

  const cellOf = (row: CompetitorRow, code: string): CellValue => {
    if (kind === 'mention') {
      const found = perEngine.get(code)?.rows.find((candidate) => candidate.entityId === row.entityId);
      return found === undefined ? { kind: 'none', reason: 'noAnswers' } : countCell(found.mentions, found.answers);
    }
    // Only the own brand's recommendation is in the facts; a competitor's is not collected yet
    if (!row.own) return { kind: 'none', reason: 'notCollected' };
    return recommendedCell(factsRow?.engines.find((engine) => engine.engine_code === code)?.recommended);
  };

  const renderCell = (value: CellValue, label: string): ReactElement => {
    if (value.kind === 'none') {
      const text = value.reason === 'notCollected' ? drawer('notCollected') : EMPTY_VALUE;
      const tip =
        value.reason === 'notClassified'
          ? drawer('notClassified', { platform: label })
          : value.reason === 'noAnswers'
            ? drawer('noAnswers', { platform: label })
            : null;
      const span = <span className="type-meta text-foreground-tertiary">{text}</span>;
      return tip === null ? span : <Tooltip content={tip}>{span}</Tooltip>;
    }
    return (
      <span className="flex flex-col whitespace-nowrap">
        {value.rate === null ? null : (
          <span className="num type-body-strong">{formatPercent(value.rate, { decimals: 0 })}</span>
        )}
        <span className="num type-meta">{words('count', { mentions: value.k, answers: value.n })}</span>
      </span>
    );
  };

  const columns: PlainColumn<CompetitorRow>[] = [
    {
      id: 'brand',
      header: words('brand'),
      wrap: true,
      cell: (row) => (
        <span className="inline-flex min-w-0 items-center gap-2">
          <EntitySwatch own={row.own} colorIndex={colors.get(row.entityId) ?? null} />
          <span className={row.own ? 'type-body-strong' : undefined}>{row.name}</span>
          {row.own ? <Badge tone="info">{words('own')}</Badge> : null}
        </span>
      ),
    },
    ...engines.map((entry): PlainColumn<CompetitorRow> => ({
      id: entry.engine.engine_code,
      header: entry.engine.label,
      wrap: true,
      cell: (row) => renderCell(cellOf(row, entry.engine.engine_code), entry.engine.label),
    })),
  ];

  let status: InspectorSectionStatus = 'ready';
  if (counts.status === 'failed' || answers.status === 'error') status = 'error';
  else if (counts.status === 'loading' || answers.status === 'loading') status = 'loading';

  const nothing = ordered.tracked === 0 || ordered.answers === 0 || !ordered.named;
  const empty =
    ordered.tracked === 0 ? (
      <EmptyState
        variant="inline"
        title={words('noneTrackedTitle')}
        reason={words('noneTrackedReason')}
        headingLevel={3}
      />
    ) : ordered.answers === 0 ? (
      <EmptyState variant="inline" title={t('answersEmpty')} reason={t('answersEmptyReason')} headingLevel={3} />
    ) : (
      <EmptyState variant="inline" title={words('emptyTitle')} reason={words('emptyReason')} headingLevel={3} />
    );
  const failed = counts.status === 'failed';
  // A competitor with no mention is shown in the matrix too: with none named only the own brand stays in view
  const rows = ordered.named ? ordered.rows : ordered.rows.filter((row) => row.own);

  return (
    <>
      <InspectorSection
        title={drawer('title')}
        icon={Users}
        status={status}
        action={
          <SegmentedControl<RateKind>
            semantics="view"
            size="sm"
            label={drawer('rateLabel')}
            value={kind}
            onValueChange={setKind}
            items={[
              { value: 'mention', label: drawer('mention') },
              { value: 'recommendation', label: drawer('recommendation') },
            ]}
          />
        }
        error={
          <InlineError
            title={failed ? t('countsFailed') : t('answersFailed')}
            reason={t('loadFailedReason')}
            errorId={failed ? counts.errorId : answers.errorId}
            onRetry={failed ? counts.retry : answers.retry}
            retrying={failed ? counts.retrying : answers.retrying}
            retryLabel={common('retry')}
          />
        }
      >
        <div className="flex flex-col gap-3">
          <p className="type-meta">{kind === 'mention' ? words('explain') : drawer('explainRecommendation')}</p>
          {answers.hasMore ? <p className="type-meta">{words('basedOn', { count: answers.rows.length })}</p> : null}
          {nothing ? empty : null}
          {/* With no answer there is nothing to count; the own brand stays in view when no competitor is named */}
          {ordered.tracked === 0 || ordered.answers === 0 ? null : (
            <div className="-mx-4 -mb-4 [&>div]:rounded-none [&>div]:border-x-0 [&>div]:border-b-0">
              <PlainTable<CompetitorRow>
                caption={words('caption')}
                columns={columns}
                rows={rows}
                rowKey={(row) => row.entityId}
                status="ready"
                errorState={null}
                emptyText={t('answersEmpty')}
              />
            </div>
          )}
        </div>
      </InspectorSection>
      <RelatedKeywords
        status={facts.isPending ? 'loading' : facts.isError ? 'error' : 'ready'}
        retry={() => void facts.refetch()}
        retrying={facts.isFetching}
        requested={facts.data?.requested ?? false}
        row={factsRow}
      />
    </>
  );
}

export interface RelatedKeywordsProps {
  status: 'loading' | 'error' | 'ready';
  retry: () => void;
  retrying: boolean;
  /** The read asked for the facts; without them the keyword is not collected, which is not "no keyword linked". */
  requested: boolean;
  row: { linked_keyword?: LinkedKeywordVolume | null } | undefined;
}

/**
 * The Related keywords card (PR-DRAWER-09): the keyword the prompt is linked to, where it ranks and whether Google shows
 * an AI Overview for it that cites the site. A field the backend has not built is "Not collected yet", never a rank of 0
 * or "Not cited"; a prompt linked to no keyword says so, with the reason its Google AI Overview is empty.
 */
export function RelatedKeywords({ status, retry, retrying, requested, row }: RelatedKeywordsProps): ReactElement {
  const t = useTranslations('prompts.inspector');
  const drawer = useTranslations('prompts.drawer.competitors');
  const common = useTranslations('common');
  const linked = requested ? row?.linked_keyword : undefined;
  const notCollected = <span className="type-meta text-foreground-tertiary">{drawer('notCollected')}</span>;
  const columns: PlainColumn<LinkedKeywordVolume>[] = [
    {
      id: 'keyword',
      header: drawer('keyword'),
      wrap: true,
      cell: (keyword) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="wrap-anywhere">{keyword.keyword}</span>
          <Tooltip content={drawer('linkedTip')}>
            <Badge tabIndex={0}>{drawer('linked')}</Badge>
          </Tooltip>
        </span>
      ),
    },
    {
      id: 'rank',
      header: drawer('rank'),
      cell: (keyword) =>
        keyword.rank === undefined ? (
          notCollected
        ) : (
          <span className="num">{keyword.rank === null ? drawer('rankBeyond') : keyword.rank}</span>
        ),
    },
    {
      id: 'overview',
      header: drawer('overview'),
      wrap: true,
      cell: (keyword) => {
        if (keyword.ai_overview === undefined) return notCollected;
        if (keyword.ai_overview === null) return <Badge>{drawer('noOverview')}</Badge>;
        return keyword.ai_overview.cited_position === null ? (
          <Badge>{drawer('notCited')}</Badge>
        ) : (
          <Badge tone="positive">{drawer('citedAt', { place: keyword.ai_overview.cited_position })}</Badge>
        );
      },
    },
  ];
  return (
    <InspectorSection
      title={drawer('relatedTitle')}
      icon={Search}
      status={
        status === 'ready' && linked === undefined ? 'empty' : status === 'ready' && linked === null ? 'empty' : status
      }
      error={
        <InlineError
          title={t('loadFailed')}
          reason={t('loadFailedReason')}
          errorId={null}
          onRetry={retry}
          retrying={retrying}
          retryLabel={common('retry')}
        />
      }
      empty={
        linked === null ? (
          <p className="type-meta">{drawer('noLinked')}</p>
        ) : (
          <p className="type-meta">{drawer('keywordsNotCollected')}</p>
        )
      }
    >
      {linked === undefined || linked === null ? null : (
        <div className="-mx-4 -mb-4 [&>div]:rounded-none [&>div]:border-x-0 [&>div]:border-b-0">
          <PlainTable<LinkedKeywordVolume>
            caption={drawer('relatedCaption')}
            columns={columns}
            rows={[linked]}
            rowKey={(keyword) => keyword.keyword}
            status="ready"
            errorState={null}
            emptyText={drawer('noLinked')}
          />
        </div>
      )}
    </InspectorSection>
  );
}
