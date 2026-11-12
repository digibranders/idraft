'use client';

import { ChevronLeft, GitCommitVertical, GitCompareArrows, Ruler, Target, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';

import { ConfidenceIndicator } from './confidence-indicator';
import { Delta, hasDeltaComparison, type DeltaTest } from './delta';
import { SampleCount, type SampleNoun } from './sample-count';
import { EngineLogo } from '@/components/app/engine/engine-logo';
import { InspectorSection } from '@/components/app/inspector/inspector-section';
import { Banner } from '@/components/app/status/banner';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError, type InlineErrorProps } from '@/components/app/status/inline-error';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { EMPTY_VALUE, formatInterval, formatPercent, type MetricDeltaInput } from '@/lib/format';

export interface StatisticsContent {
  /** "Mention rate". */
  metricName: string;
  /** One engine per panel: engines are never pooled silently. */
  engine: { code: string; name: string };
  /** "core panel, 28 days". */
  scopeText: string;
  /** One sentence. */
  definition: string;
  estimate: {
    /** A ratio from 0 to 1, or `null` when unknown. */
    value: number | null;
    numerator: number | null;
    denominator: number | null;
    noun: SampleNoun;
    prompts: number | null;
    /** The observation-weighted ratio, when the API sends one beside the prompt-weighted `value`. */
    observationWeighted: number | null;
    /** Set when there are too few valid answers for a rate: no percent is drawn. */
    insufficient: { valid: number; required: number } | null;
  };
  interval: { low: number; high: number; methodText: string } | null;
  comparison: {
    delta: MetricDeltaInput;
    test: DeltaTest;
    /** "Aug 4 to Aug 31". */
    periodText: string;
    /** "Paired: the same 243 prompts in both periods". */
    designText: string;
    /** "95% interval -1.1 to +4.6 pts", made by the caller. */
    intervalText: string | null;
    gained: number | null;
    lost: number | null;
  } | null;
  boundaries: ReadonlyArray<{ id: string; text: string }>;
}

export type StatisticsState =
  | { kind: 'loading' }
  | {
      kind: 'error';
      title: string;
      reason: string;
      onRetry: () => void;
      retrying: boolean;
      errorId: InlineErrorProps['errorId'];
    }
  | { kind: 'empty'; reason: string; action?: ReactNode }
  | { kind: 'ready' | 'refetching'; data: StatisticsContent; partial?: string | undefined; stale?: string | undefined };

export interface StatisticsPanelProps {
  state: StatisticsState;
  /** `inspector-tab`: the Stats tab of a record, which already has its title. `inspector-region`: the 560 px region. */
  placement: 'inspector-tab' | 'inspector-region';
  /** "Back to {record}": `label` is the record's name. Present when a record inspector was open. */
  backTo?: { label: string; onBack: () => void } | null | undefined;
}

type SectionKey = 'estimate' | 'uncertainty' | 'comparison' | 'boundaries';
const SECTIONS: ReadonlyArray<{ key: SectionKey; icon: LucideIcon }> = [
  { key: 'estimate', icon: Target },
  { key: 'uncertainty', icon: Ruler },
  { key: 'comparison', icon: GitCompareArrows },
  { key: 'boundaries', icon: GitCommitVertical },
];

/** The bar's scale tops out at the next tenth above the upper bound, so a narrow interval stays readable. */
const scaleFor = (high: number): number => Math.min(1, Math.max(0.1, Math.ceil(high * 10) / 10));

/** A rate and the sample behind it, side by side: a percent is never drawn without its count. */
function RateWithCount({
  label,
  ratio,
  count,
}: {
  label?: string | undefined;
  ratio: number;
  count: ReactElement;
}): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {label === undefined ? null : <p className="type-meta">{label}</p>}
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="num type-metric">{formatPercent(ratio)}</span>
        {count}
      </div>
    </div>
  );
}

function EstimateBody({ estimate }: { estimate: StatisticsContent['estimate'] }): ReactElement {
  const t = useTranslations('common.statistics');
  const { value, insufficient, observationWeighted, prompts } = estimate;
  if (insufficient !== null) {
    // The hatched ground of InsufficientData (23 section 8.4): never a percent, never 0
    return (
      <div className="flex flex-col gap-1 rounded-xs bg-insufficient p-3">
        <p className="type-body-strong text-foreground-tertiary">{t('insufficient')}</p>
        <p className="type-meta">
          {t('insufficientCounts', { valid: insufficient.valid, required: insufficient.required })}
        </p>
      </div>
    );
  }
  const observations = <SampleCount k={estimate.numerator} n={estimate.denominator} noun={estimate.noun} />;
  const promptCount = <SampleCount k={null} n={prompts} noun="prompts" form="n-only" />;
  if (value === null) {
    return (
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="type-body text-foreground-tertiary">{EMPTY_VALUE}</span>
        {observations}
      </div>
    );
  }
  if (observationWeighted !== null) {
    return (
      <div className="grid grid-cols-2 gap-4">
        <RateWithCount label={t('promptWeighted')} ratio={value} count={promptCount} />
        <RateWithCount label={t('observationWeighted')} ratio={observationWeighted} count={observations} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <RateWithCount ratio={value} count={observations} />
      {prompts === null ? null : promptCount}
    </div>
  );
}

function UncertaintyBody({ data }: { data: StatisticsContent }): ReactElement {
  const t = useTranslations('common.statistics');
  const { interval, estimate } = data;
  if (interval === null || estimate.value === null || estimate.insufficient !== null) {
    return (
      <p className="type-body text-foreground-secondary">
        {estimate.insufficient === null ? t('noInterval') : t('noIntervalInsufficient')}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <ConfidenceIndicator
        estimate={estimate.value}
        low={interval.low}
        high={interval.high}
        decimals={1}
        scaleMax={scaleFor(interval.high)}
        form="text-and-bar"
        label={t('interval', { interval: formatInterval(interval.low, interval.high, 1) })}
      />
      <p className="type-meta">{interval.methodText}</p>
    </div>
  );
}

function ComparisonBody({ comparison }: { comparison: StatisticsContent['comparison'] }): ReactElement {
  const t = useTranslations('common.statistics');
  const tDelta = useTranslations('common.delta');
  if (comparison === null) return <p className="type-body text-foreground-secondary">{t('noComparison')}</p>;
  const { delta, test, gained, lost } = comparison;
  const { isDetectable } = delta;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-2">
        {hasDeltaComparison(delta) ? (
          // The sentences below carry the interval and the design, so the delta needs no tooltip of its own
          <Delta input={delta} size="md" test={test} tip={false} />
        ) : (
          <span className="type-body text-foreground-tertiary">{EMPTY_VALUE}</span>
        )}
        <span className="type-meta">{t('comparedWith', { period: comparison.periodText })}</span>
      </div>
      <p className="type-body text-foreground-secondary">{comparison.designText}</p>
      {comparison.intervalText === null ? null : <p className="num type-meta">{comparison.intervalText}</p>}
      {gained === null || lost === null ? null : <p className="num type-meta">{t('gainedLost', { gained, lost })}</p>}
      {isDetectable === null ? null : (
        <p className="type-body-strong text-foreground">{isDetectable ? t('resultDetectable') : t('resultWithin')}</p>
      )}
      {test === 'interim' && isDetectable !== null ? <p className="type-meta">{tDelta('interimTip')}</p> : null}
    </div>
  );
}

function BoundariesBody({ boundaries }: { boundaries: StatisticsContent['boundaries'] }): ReactElement {
  const t = useTranslations('common.statistics');
  if (boundaries.length === 0) return <p className="type-body text-foreground-secondary">{t('noBoundaries')}</p>;
  return (
    <ul className="flex flex-col gap-2">
      {boundaries.map((boundary) => (
        <li key={boundary.id} className="flex items-start gap-2 type-body">
          <Icon icon={GitCommitVertical} size="sm" className="mt-1 text-foreground-muted" />
          {boundary.text}
        </li>
      ))}
    </ul>
  );
}

function sectionBody(key: SectionKey, data: StatisticsContent): ReactElement {
  if (key === 'estimate') return <EstimateBody estimate={data.estimate} />;
  if (key === 'uncertainty') return <UncertaintyBody data={data} />;
  if (key === 'comparison') return <ComparisonBody comparison={data.comparison} />;
  return <BoundariesBody boundaries={data.boundaries} />;
}

/**
 * The statistics of one AI rate for one engine (23-application-patterns.md section 8.6): the estimate, its
 * uncertainty, the comparison with an earlier period and the version boundaries in the window. It is content
 * for the inspector and never a dialog: nothing traps focus and the page stays usable. Movers and panel sizing
 * are not drawn until the data for them exists.
 */
export function StatisticsPanel({ state, placement, backTo }: StatisticsPanelProps): ReactElement {
  const t = useTranslations('common.statistics');
  const tCommon = useTranslations('common');
  const data = state.kind === 'ready' || state.kind === 'refetching' ? state.data : null;
  // A refetch keeps the data at full opacity: the busy state is for assistive technology, and the bar is the inspector's
  const busy = state.kind === 'loading' || state.kind === 'refetching';
  const NameTag = placement === 'inspector-region' ? 'h2' : 'p';
  return (
    <div
      data-slot="statistics-panel"
      data-placement={placement}
      aria-busy={busy ? true : undefined}
      className="flex flex-col gap-3"
    >
      {backTo === null || backTo === undefined ? null : (
        <Button variant="ghost" size="sm" icon={ChevronLeft} className="self-start" onClick={backTo.onBack}>
          {t('backTo', { record: backTo.label })}
        </Button>
      )}
      {data === null ? null : (
        <header className="flex flex-col gap-1">
          <NameTag className={placement === 'inspector-region' ? 'type-inspector-title' : 'type-body-strong'}>
            {data.metricName}
          </NameTag>
          <div className="flex flex-wrap items-center gap-x-3 type-body text-foreground-secondary">
            {/* One engine per panel, named beside its mark */}
            <EngineLogo engine={data.engine.code} name={data.engine.name} />
            <span>{data.scopeText}</span>
          </div>
          <p className="type-body text-foreground-secondary">{data.definition}</p>
        </header>
      )}
      {state.kind === 'loading' ? <p className="sr-only">{tCommon('loading')}</p> : null}
      {state.kind === 'ready' || state.kind === 'refetching' ? (
        <>
          {state.partial === undefined ? null : (
            <Banner tone="warning" placement="region" lead={t('partialLead')} message={state.partial} />
          )}
          {state.stale === undefined ? null : <Banner tone="info" placement="region" message={state.stale} />}
        </>
      ) : null}
      {state.kind === 'error' ? (
        <div className="rounded-lg border border-border bg-surface">
          <InlineError
            title={state.title}
            reason={state.reason}
            errorId={state.errorId}
            onRetry={state.onRetry}
            retrying={state.retrying}
            retryLabel={tCommon('retry')}
            live
          />
        </div>
      ) : null}
      {state.kind === 'empty' ? (
        <div className="rounded-lg border border-border bg-surface">
          <EmptyState
            variant="inline"
            headingLevel={3}
            title={t('emptyTitle')}
            reason={state.reason}
            primaryAction={state.action}
          />
        </div>
      ) : null}
      {state.kind === 'loading' || data !== null
        ? SECTIONS.map(({ key, icon }) => (
            <InspectorSection key={key} title={t(key)} icon={icon} status={data === null ? 'loading' : 'ready'}>
              {data === null ? null : sectionBody(key, data)}
            </InspectorSection>
          ))
        : null}
    </div>
  );
}
