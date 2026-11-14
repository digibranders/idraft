'use client';

import type { ReactNode } from 'react';

import { SpecimenGroup, SpecimenRow } from './specimen';
import { TableScroll } from './table-scroll';
import { EngineBadge } from '@/components/app/engine/engine-badge';
import { EngineLogo } from '@/components/app/engine/engine-logo';
import { ConfidenceIndicator } from '@/components/app/metric/confidence-indicator';
import { Delta, type DeltaTip } from '@/components/app/metric/delta';
import { DeltaCell } from '@/components/app/metric/delta-cell';
import { BudgetMeter, Meter, type MeterProps } from '@/components/app/metric/meter';
import { MetricInfo } from '@/components/app/metric/metric-info';
import { SampleCount } from '@/components/app/metric/sample-count';
import {
  StatisticsPanel,
  type StatisticsContent,
  type StatisticsPanelProps,
  type StatisticsState,
} from '@/components/app/metric/statistics-panel';
import { Banner } from '@/components/app/status/banner';
import { Button } from '@/components/ui/button';
import type { MetricDeltaInput } from '@/lib/format';
import { cn } from '@/lib/utils';

const noop = (): void => undefined;

const MENTION_RATE_UP: MetricDeltaInput = {
  value: 0.053,
  unit: 'points',
  polarity: 'higher_is_better',
  isDetectable: true,
};
const MENTION_RATE_DOWN: MetricDeltaInput = { ...MENTION_RATE_UP, value: -0.041 };
const MENTION_RATE_QUIET: MetricDeltaInput = { ...MENTION_RATE_UP, value: 0.018, isDetectable: false };
const NO_COMPARISON: MetricDeltaInput = { ...MENTION_RATE_UP, value: null, isDetectable: null };

const TIP: DeltaTip = {
  previousText: 'Previous 29.0%',
  intervalText: '95% interval +1.8 to +8.8 pts',
  method: 'paired, 243 prompts',
};

/** Four engines, then one with no mark of its own. */
const ENGINES: ReadonlyArray<{ code: string; name: string }> = [
  { code: 'chatgpt_web', name: 'ChatGPT' },
  { code: 'gemini_web', name: 'Gemini' },
  { code: 'google_ai_mode', name: 'Google AI Mode' },
  { code: 'google_ai_overview', name: 'Google AI Overview' },
];
const UNKNOWN_ENGINE = { code: 'perplexity_web', name: 'Perplexity' } as const;

const QUOTA: Pick<MeterProps, 'max' | 'warnFrom' | 'label'> = { max: 150, warnFrom: 150, label: 'Active prompts' };
const QUOTA_STATES: ReadonlyArray<{ id: string; value: number; text: string }> = [
  { id: 'under', value: 120, text: '120 of 150 active prompts' },
  { id: 'at', value: 150, text: '150 of 150 active prompts' },
  { id: 'over', value: 168, text: '168 of 150 active prompts' },
];
const BUDGET_STATES: ReadonlyArray<{
  id: string;
  pct: number;
  state: 'ok' | 'soft_exceeded' | 'hard_exceeded';
  label: string;
}> = [
  { id: 'ok', pct: 64, state: 'ok', label: '64.0% of $2,000.00' },
  { id: 'soft', pct: 90, state: 'soft_exceeded', label: '90.0% of $2,000.00' },
  { id: 'hard', pct: 112, state: 'hard_exceeded', label: '112.0% of $2,000.00' },
];

const ERROR_ID = {
  id: 'req_01JC8M2QX4',
  label: 'Error ID req_01JC8M2QX4',
  copyLabel: 'Copy error ID',
  copiedLabel: 'Copied',
} as const;

const STATISTICS: StatisticsContent = {
  metricName: 'Mention rate',
  engine: { code: 'chatgpt_web', name: 'ChatGPT' },
  scopeText: 'core panel, 28 days',
  definition: 'The share of valid answers that name your brand.',
  estimate: {
    value: 0.34,
    numerator: 612,
    denominator: 1800,
    noun: 'observations',
    prompts: 250,
    observationWeighted: 0.352,
    insufficient: null,
  },
  interval: { low: 0.312, high: 0.369, methodText: 'Normal interval over prompts, fixed panel' },
  comparison: {
    delta: MENTION_RATE_UP,
    test: 'paired',
    periodText: 'Aug 4 to Aug 31',
    designText: 'Paired: the same 243 prompts in both periods',
    intervalText: '95% interval +1.8 to +8.8 pts',
    gained: 41,
    lost: 19,
  },
  boundaries: [{ id: 'extractor-v4', text: 'Extractor v3 to v4 on Sep 14' }],
};
const INTERIM_COMPARISON =
  STATISTICS.comparison === null ? null : { ...STATISTICS.comparison, test: 'interim' as const };
const BACK_TO: NonNullable<StatisticsPanelProps['backTo']> = { label: 'prompt best crm for startups', onBack: noop };

const PANELS: ReadonlyArray<{ label: string; state: StatisticsState; backTo?: StatisticsPanelProps['backTo'] }> = [
  { label: 'Loading', state: { kind: 'loading' }, backTo: BACK_TO },
  { label: 'Ready', state: { kind: 'ready', data: STATISTICS }, backTo: BACK_TO },
  {
    label: 'Interim comparison',
    state: { kind: 'ready', data: { ...STATISTICS, comparison: INTERIM_COMPARISON } },
  },
  {
    label: 'Insufficient',
    state: {
      kind: 'ready',
      data: {
        ...STATISTICS,
        estimate: {
          ...STATISTICS.estimate,
          value: null,
          observationWeighted: null,
          insufficient: { valid: 3, required: 7 },
        },
        interval: null,
        comparison: null,
        boundaries: [],
      },
    },
  },
  {
    label: 'Empty',
    state: {
      kind: 'empty',
      reason: 'No answers were collected for this engine in the last 28 days.',
      action: (
        <Button variant="secondary" size="sm">
          Change dates
        </Button>
      ),
    },
  },
  {
    label: 'Error',
    state: {
      kind: 'error',
      title: 'Could not load statistics',
      reason: 'The server returned an error. Your filters are unchanged.',
      onRetry: noop,
      retrying: false,
      errorId: ERROR_ID,
    },
  },
  {
    label: 'Partial',
    state: { kind: 'ready', data: STATISTICS, partial: 'Two of the 250 prompts have no answers yet.' },
  },
  { label: 'Stale', state: { kind: 'ready', data: STATISTICS, stale: 'Last updated 3 hours ago.' } },
];

const HEAD = cn('h-row-header px-3 text-left type-table-header');

/** The change column of a keyword table at one row height, as a results table holds it. */
function DeltaTable({ caption, rowClass }: { caption: string; rowClass: string }): ReactNode {
  const rows: ReadonlyArray<{
    keyword: string;
    rate: string;
    input: MetricDeltaInput;
    boundaryText?: string;
  }> = [
    { keyword: 'best crm for startups', rate: '34.0%', input: MENTION_RATE_UP },
    { keyword: 'crm pricing', rate: '21.5%', input: MENTION_RATE_DOWN, boundaryText: 'Extractor v3 to v4 on Sep 14' },
    { keyword: 'free crm software', rate: '18.2%', input: MENTION_RATE_QUIET },
    { keyword: 'crm for agencies', rate: '12.0%', input: NO_COMPARISON },
  ];
  return (
    <TableScroll label={caption}>
      <table className="w-full border-collapse type-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className={HEAD}>
              Keyword
            </th>
            <th scope="col" className={cn(HEAD, 'text-right')}>
              Mention rate
            </th>
            <th scope="col" className={cn(HEAD, 'text-right')}>
              Change
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.keyword} className="border-t border-border-subtle">
              <th scope="row" className={cn(rowClass, 'px-3 text-left font-normal')}>
                {row.keyword}
              </th>
              <td className={cn(rowClass, 'px-3 text-right num')}>{row.rate}</td>
              <td className={cn(rowClass, 'px-3')}>
                <DeltaCell
                  input={row.input}
                  tip={TIP}
                  {...(row.boundaryText === undefined ? {} : { boundaryText: row.boundaryText })}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}

/** A meter with the number beside it: the meter never carries the number alone. */
function MeterLine({ meter, text }: { meter: ReactNode; text: string }): ReactNode {
  return (
    <span className="flex items-center gap-2">
      {meter}
      <span className="num type-meta">{text}</span>
    </span>
  );
}

export function MetricPartsSection(): ReactNode {
  return (
    <>
      <SpecimenGroup
        title="Delta"
        note="25 section 9.4. Coloured only when detectable, by polarity; signed points, no arrow. Tab to a change to read its tooltip."
      >
        <SpecimenRow label="Detectable, up">
          <Delta input={MENTION_RATE_UP} tip={TIP} />
        </SpecimenRow>
        <SpecimenRow label="Detectable, down">
          <Delta input={MENTION_RATE_DOWN} tip={{ ...TIP, previousText: 'Previous 35.4%' }} />
        </SpecimenRow>
        <SpecimenRow label="Not detectable">
          <Delta input={MENTION_RATE_QUIET} tip={TIP} />
        </SpecimenRow>
        <SpecimenRow label="Interim test">
          <Delta input={MENTION_RATE_UP} test="interim" tip={TIP} />
          <Delta input={MENTION_RATE_QUIET} test="interim" tip={TIP} />
        </SpecimenRow>
        <SpecimenRow label="Small size">
          <Delta input={MENTION_RATE_UP} size="sm" tip={false} />
        </SpecimenRow>
        <SpecimenRow label="No comparison">
          <Delta input={NO_COMPARISON} />
          <span className="type-meta">Nothing is drawn, and a strip leaves the slot out.</span>
        </SpecimenRow>
      </SpecimenGroup>

      <SpecimenGroup
        title="DeltaCell"
        note="The change column of a table, at Compact (32 px rows, h-row-compact) and Default (40 px rows, h-row)."
      >
        <SpecimenRow label="Compact, 32 px">
          <div className="w-full">
            <DeltaTable caption="Change column at the Compact row height" rowClass="h-row-compact" />
          </div>
        </SpecimenRow>
        <SpecimenRow label="Default, 40 px">
          <div className="w-full">
            <DeltaTable caption="Change column at the Default row height" rowClass="h-row" />
          </div>
        </SpecimenRow>
      </SpecimenGroup>

      <SpecimenGroup
        title="EngineLogo"
        note="07-icons.md section 5. The vendor mark always sits beside the name; an engine with no mark shows its name alone."
      >
        <SpecimenRow label="Four engines">
          {ENGINES.map((engine) => (
            <span key={engine.code} className="type-body">
              <EngineLogo engine={engine.code} name={engine.name} />
            </span>
          ))}
        </SpecimenRow>
        <SpecimenRow label="Mark hidden">
          <span className="type-body">
            <EngineLogo engine="chatgpt_web" name="ChatGPT" hidden />
          </span>
        </SpecimenRow>
        <SpecimenRow label="Unknown code">
          <span className="type-body">
            <EngineLogo engine={UNKNOWN_ENGINE.code} name={UNKNOWN_ENGINE.name} />
          </span>
        </SpecimenRow>
      </SpecimenGroup>

      <SpecimenGroup
        title="EngineBadge"
        note="A neutral subtle badge: no brand colours. The mark is opt in, for roomy views."
      >
        <SpecimenRow label="Four engines">
          {ENGINES.map((engine) => (
            <EngineBadge key={engine.code} engine={engine.code} name={engine.name} />
          ))}
        </SpecimenRow>
        <SpecimenRow label="With the mark">
          {ENGINES.map((engine) => (
            <EngineBadge key={engine.code} engine={engine.code} name={engine.name} logo />
          ))}
        </SpecimenRow>
        <SpecimenRow label="Unknown code">
          <EngineBadge engine={UNKNOWN_ENGINE.code} name={UNKNOWN_ENGINE.name} />
          <EngineBadge engine={UNKNOWN_ENGINE.code} name={UNKNOWN_ENGINE.name} logo />
        </SpecimenRow>
      </SpecimenGroup>

      <SpecimenGroup
        title="Meter"
        note="23 section 11.2. Muted up to the limit, warning at and past it; never red. 160 px in a summary, 64 px in a cell."
      >
        <SpecimenRow label="Summary, 160 px">
          {QUOTA_STATES.map((quota) => (
            <MeterLine
              key={quota.id}
              text={quota.text}
              meter={<Meter {...QUOTA} value={quota.value} valueText={quota.text} width="summary" />}
            />
          ))}
        </SpecimenRow>
        <SpecimenRow label="Cell, 64 px">
          {QUOTA_STATES.map((quota) => (
            <MeterLine
              key={quota.id}
              text={quota.text}
              meter={<Meter {...QUOTA} value={quota.value} valueText={quota.text} width="cell" />}
            />
          ))}
        </SpecimenRow>
      </SpecimenGroup>

      <SpecimenGroup
        title="BudgetMeter"
        note="Warning from the soft limit (the tick, at 80%), wholly warning at the hard limit."
      >
        <SpecimenRow label="Ok, soft, hard">
          {BUDGET_STATES.map((budget) => (
            <MeterLine
              key={budget.id}
              text={budget.label}
              meter={
                <BudgetMeter
                  pct={budget.pct}
                  softLimitPct={80}
                  state={budget.state}
                  size="summary"
                  label={budget.label}
                />
              }
            />
          ))}
        </SpecimenRow>
        <SpecimenRow label="In a cell">
          {BUDGET_STATES.map((budget) => (
            <MeterLine
              key={budget.id}
              text={budget.label}
              meter={
                <BudgetMeter pct={budget.pct} softLimitPct={80} state={budget.state} size="cell" label={budget.label} />
              }
            />
          ))}
        </SpecimenRow>
      </SpecimenGroup>

      <SpecimenGroup
        title="Banner in the inspector"
        note="18 section 4. Full width under the inspector header. Cited is info; not cited is a neutral fact, not a warning."
      >
        <div className="w-inspector max-w-full overflow-hidden rounded-lg border border-border-subtle bg-surface">
          <Banner
            tone="info"
            placement="inspector"
            message="Cited in 3 of 8 answers; last answer Nov 11, 09:05; 13 pages cited."
          />
          <Banner tone="neutral" placement="inspector" message="Not cited in any of the 8 answers." />
        </div>
      </SpecimenGroup>

      <SpecimenGroup
        title="SampleCount"
        note="23 section 8.3. The noun is always there; an unknown count is n/a, never 0."
      >
        <SpecimenRow label="k of n">
          <SampleCount k={612} n={1800} noun="observations" />
          <SampleCount k={84} n={250} noun="answers" />
        </SpecimenRow>
        <SpecimenRow label="n only">
          <SampleCount k={null} n={250} noun="prompts" form="n-only" />
          <SampleCount k={null} n={1} noun="keywords" form="n-only" />
        </SpecimenRow>
        <SpecimenRow label="Unknown">
          <SampleCount k={null} n={null} noun="observations" />
        </SpecimenRow>
      </SpecimenGroup>

      <SpecimenGroup
        title="ConfidenceIndicator"
        note="23 section 8. The interval is the 95 percent Wilson interval; an unknown estimate shows no bar."
      >
        <SpecimenRow label="Text">
          <ConfidenceIndicator estimate={0.34} low={0.312} high={0.369} form="text" label="95% interval 31% to 37%" />
        </SpecimenRow>
        <SpecimenRow label="Text and bar">
          <ConfidenceIndicator
            estimate={0.34}
            low={0.312}
            high={0.369}
            form="text-and-bar"
            label="95% interval 31% to 37%"
          />
        </SpecimenRow>
        <SpecimenRow label="Bar">
          <ConfidenceIndicator estimate={0.34} low={0.312} high={0.369} form="bar" label="95% interval 31% to 37%" />
        </SpecimenRow>
        <SpecimenRow label="Unknown">
          <ConfidenceIndicator estimate={null} low={null} high={null} form="text-and-bar" label="No estimate yet" />
        </SpecimenRow>
      </SpecimenGroup>

      <SpecimenGroup
        title="MetricInfo"
        note="23 section 8.1. The (i) button opens the popover. Methodology is always the last line."
      >
        <SpecimenRow label="AI rate">
          <span className="flex items-center gap-1 type-body">
            Mention rate
            <MetricInfo
              name="Mention rate"
              definition="The share of valid answers that name your brand."
              formula="Answers that name the brand divided by valid answers"
              denominatorText="250 prompts, 1,800 valid answers"
              aggregation="prompt_weighted"
              methodVersion={3}
              onOpenStatistics={noop}
              methodologyHref="/design-system/metric-parts"
            />
          </span>
        </SpecimenRow>
        <SpecimenRow label="Definition only">
          <span className="flex items-center gap-1 type-body">
            Visibility score
            <MetricInfo
              name="Visibility score"
              definition="How often your pages are cited across the tracked engines."
              formula="Cited answers divided by all answers"
              methodologyHref="/design-system/metric-parts"
            />
          </span>
        </SpecimenRow>
      </SpecimenGroup>

      <SpecimenGroup
        title="StatisticsPanel"
        note="23 section 8.6. Content for the inspector, never a dialog. Shown in a 560 px region (w-drawer), one engine per panel."
      >
        {PANELS.map(({ label, state, backTo }) => (
          <SpecimenRow key={label} label={label}>
            <div className="w-drawer max-w-full">
              <TableScroll label={`StatisticsPanel, ${label.toLowerCase()}`}>
                <StatisticsPanel state={state} placement="inspector-region" backTo={backTo} />
              </TableScroll>
            </div>
          </SpecimenRow>
        ))}
      </SpecimenGroup>
    </>
  );
}
