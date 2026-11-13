'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState, type ReactElement, type ReactNode } from 'react';

import { SpecimenGroup } from './specimen';
import {
  BarList,
  BarListTable,
  barListCsv,
  type BarListProps,
  type BarValue,
  type ComparisonRow,
  type DistributionRow,
} from '@/components/app/chart/bar-list';
import { ChartFrame, type HtmlFrameProps } from '@/components/app/chart/chart-frame';
import {
  IntervalBar,
  IntervalBarTable,
  changeDomain,
  intervalBarCsv,
  type ChangeDomain,
  type DivergingRow,
  type DumbbellRow,
  type IntervalBarProps,
  type IntervalCsvWords,
  type IntervalValue,
  type PointsDeltaInput,
} from '@/components/app/chart/interval-bar';
import {
  ShareBarCell,
  StackedShareBar,
  StackedShareTable,
  stackedShareCsv,
  type ShareCell,
  type ShareRow,
  type ShareSegment,
  type StackedShareBarProps,
} from '@/components/app/chart/stacked-share-bar';
import {
  StepBars,
  StepBarsTable,
  stepBarsCsv,
  type Step,
  type StepBarsProps,
  type StepGroup,
  type StepShare,
} from '@/components/app/chart/step-bars';
import {
  TopicEnginePanel,
  TopicEnginePanelTable,
  type EnginePanelRow,
  type TopicEnginePanelProps,
} from '@/components/app/chart/topic-engine-panel';
import { useRateTipWords } from '@/components/app/chart/use-rate-tip-words';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { Badge } from '@/components/ui/badge';
import { LinkButton } from '@/components/ui/link-button';
import { SegmentedControl, type SegmentedControlItem } from '@/components/ui/segmented-control';
import { rateTipText, type RateTipWords } from '@/lib/charts/rate-tip';
import {
  formatInteger,
  formatMetricDelta,
  formatPercent,
  formatPointsDelta,
  formatSampleCount,
  type MetricDeltaInput,
} from '@/lib/format';
import {
  differenceInterval,
  isDetectableChange,
  MIN_OBSERVATIONS,
  rateState,
  wilsonInterval,
  type Counts,
} from '@/lib/stats';
import { DEFAULT_DENSITY, type Density } from '@/lib/tables/table-state';

/*
 * Every value on this page is fixed (no clock, no random numbers), so the preview and its visual test look the
 * same each time. Counts sit beside every percent, an unknown value is never a zero, engines are never pooled and a
 * change is coloured only when it is detectable (rules R1, R2, R3, R5 and R6 of the AI visibility inventory).
 */

const DENSITY_ITEMS: readonly SegmentedControlItem<Density>[] = [
  { value: 'default', label: 'Default' },
  { value: 'compact', label: 'Compact' },
];

const rate = (ratio: number): string => formatPercent(ratio, { decimals: 0 });
const rateOne = (ratio: number): string => formatPercent(ratio, { decimals: 1 });
const answersText = (k: number, n: number): string => `${formatSampleCount(k, n)} answers`;
/** A link to the part of this page that stands for the screen the row would open. */
const anchor = (id: string): Route => `#${id}`;
const menuLink = (id: string): string => `https://app.idraft.test/design-system/chart-parts#${id}`;

/** "3 answers", from the messages the parts use for a row with too few answers. */
function useThinWords(): (answers: number) => string {
  const t = useTranslations('common.insufficient');
  return (answers) => t('answers', { count: answers });
}

interface DensityProps {
  density: Density;
}

/* ---------- 1. BarList, share of voice (CH-02) ---------- */

const SOV_TOTAL = 1412;

interface SovEntry {
  id: string;
  name: string;
  own: boolean;
  count: number;
}

/** Largest first, as a ranked list is; the counts add up to the 1,412 answers. */
const SOV_ENTRIES: readonly SovEntry[] = [
  { id: 'hubspot', name: 'HubSpot', own: false, count: 466 },
  { id: 'idraft', name: 'idraft.ai', own: true, count: 312 },
  { id: 'zapier', name: 'Zapier', own: false, count: 198 },
  { id: 'pipedrive', name: 'Pipedrive', own: false, count: 171 },
  { id: 'salesforce', name: 'Salesforce', own: false, count: 150 },
  { id: 'notion', name: 'Notion', own: false, count: 115 },
];

function sovRows(words: RateTipWords): ComparisonRow[] {
  return SOV_ENTRIES.map(({ id, name, own, count }): ComparisonRow => {
    const share = count / SOV_TOTAL;
    const counted = answersText(count, SOV_TOTAL);
    return {
      id,
      label: name,
      own,
      value: { kind: 'value', value: share, valueText: rate(share), contextText: counted },
      accessibleText: `${name}: ${rate(share)} share of voice, ${counted}`,
      tip: rateTipText(
        { value: share, k: count, n: SOV_TOTAL, band: wilsonInterval(count, SOV_TOTAL), thin: false },
        words,
      ),
      href: anchor(`sov-${id}`),
    };
  });
}

function ShareOfVoiceSpecimen({ density }: DensityProps): ReactElement {
  const words = useRateTipWords();
  const thin = useThinWords();
  const bars: BarListProps = {
    mode: 'comparison',
    caption: 'Share of voice on ChatGPT',
    labelHeader: 'Brand',
    valueHeader: 'Share of voice',
    contextHeader: 'Answers',
    rows: sovRows(words),
    density,
  };
  return (
    <div id="sov">
      <ChartFrame
        kind="html"
        variant="panel"
        title="Share of voice vs competitors"
        meta="ChatGPT, last 28 days, 1,412 answers naming a tracked brand"
        footnote="Tracked set: your brand and 5 competitors. Pipedrive was added Sep 14 and Notion Oct 5, so earlier shares were taken against fewer brands. Excludes branded prompts."
        height={180}
        summary="HubSpot is named in 466 of 1,412 answers that name a tracked brand, idraft.ai in 312, Zapier in 198, Pipedrive in 171, Salesforce in 150 and Notion in 115."
        status="ready"
        body={<BarList {...bars} />}
        table={<BarListTable {...bars} />}
        menu={{ fileName: 'share-of-voice', link: menuLink('sov'), csv: barListCsv(bars, thin) }}
      />
    </div>
  );
}

/* ---------- 2. BarList, top cited domains by role (CH-07) ---------- */

const UNITS_TOTAL = 18_420;

type DomainRole = 'Own' | 'Competitor' | 'Third party';

interface DomainEntry {
  id: string;
  domain: string;
  role: DomainRole;
  units: number;
  /** Change in the share since the previous 28 days, in ratio points. */
  change?: { ratio: number; detectable: boolean };
}

/** Largest first. One label is long on purpose: it is cut at the label column and shown whole in the tooltip. */
const DOMAIN_ENTRIES: readonly DomainEntry[] = [
  { id: 'reddit', domain: 'reddit.com', role: 'Third party', units: 2210 },
  {
    id: 'hubspot',
    domain: 'hubspot.com',
    role: 'Competitor',
    units: 1842,
    change: { ratio: 0.004, detectable: false },
  },
  { id: 'g2', domain: 'g2.com', role: 'Third party', units: 1512 },
  { id: 'idraft', domain: 'idraft.ai', role: 'Own', units: 1290, change: { ratio: 0.011, detectable: true } },
  { id: 'agency', domain: 'knowledge-base.very-long-example-agency.co.uk', role: 'Third party', units: 1160 },
  { id: 'zapier', domain: 'zapier.com', role: 'Competitor', units: 1105 },
  { id: 'capterra', domain: 'capterra.com', role: 'Third party', units: 884 },
  { id: 'youtube', domain: 'youtube.com', role: 'Third party', units: 740 },
  { id: 'pipedrive', domain: 'pipedrive.com', role: 'Competitor', units: 612 },
];

function RoleBadge({ role }: { role: DomainRole }): ReactElement {
  return <Badge tone={role === 'Own' ? 'info' : 'neutral'}>{role}</Badge>;
}

function domainRows(): ComparisonRow[] {
  return DOMAIN_ENTRIES.map(({ id, domain, role, units, change }): ComparisonRow => {
    const share = units / UNITS_TOTAL;
    const counted = `${formatSampleCount(units, UNITS_TOTAL)} citation units`;
    const own = role === 'Own';
    const input: MetricDeltaInput | null =
      change === undefined
        ? null
        : {
            value: change.ratio,
            unit: 'points',
            polarity: own ? 'higher_is_better' : 'neutral',
            isDetectable: change.detectable,
          };
    const changeWords =
      input === null || change === undefined
        ? ''
        : `, ${formatMetricDelta(input).text}, ${change.detectable ? 'detectable' : 'within normal variation'}`;
    return {
      id,
      label: domain,
      own,
      value: { kind: 'value', value: share, valueText: rate(share), contextText: counted },
      accessibleText: `${domain}: ${rate(share)} of citation units, ${counted}, ${role}${changeWords}`,
      badge: <RoleBadge role={role} />,
      delta: input === null ? undefined : { input, test: 'interim', text: formatMetricDelta(input).text },
      href: anchor(`domain-${id}`),
    };
  });
}

function TopDomainsSpecimen({ density }: DensityProps): ReactElement {
  const thin = useThinWords();
  const bars: BarListProps = {
    mode: 'comparison',
    caption: 'Top cited domains by role',
    labelHeader: 'Domain',
    valueHeader: 'Share of citation units',
    contextHeader: 'Citation units',
    changeHeader: 'Change in points',
    rows: domainRows(),
    limit: 6,
    showAllHref: anchor('domains-all'),
    density,
  };
  return (
    <div id="domains">
      <ChartFrame
        kind="html"
        variant="panel"
        title="Top cited domains by role"
        meta="Last 28 days, 18,420 citation units across all engines"
        footnote="A citation unit is one distinct URL in one answer. The change is in points against the 28 days before and is coloured only when it is detectable (unpaired, pooled counts)."
        height={240}
        summary="reddit.com holds 2,210 of 18,420 citation units, hubspot.com 1,842, g2.com 1,512 and your domain idraft.ai 1,290, up 1.1 points and detectable."
        status="ready"
        body={<BarList {...bars} />}
        table={<BarListTable {...bars} />}
        menu={{ fileName: 'top-cited-domains', link: menuLink('domains'), csv: barListCsv(bars, thin) }}
      />
    </div>
  );
}

/* ---------- 3. BarList, mention rate by engine with thin and unknown rows (WB-TI-11, WB-TPE-09) ---------- */

interface EngineWindow {
  id: string;
  name: string;
  k: number;
  n: number;
}

const ENGINE_WINDOWS: readonly EngineWindow[] = [
  { id: 'chatgpt', name: 'ChatGPT', k: 100, n: 212 },
  { id: 'gemini', name: 'Gemini', k: 77, n: 198 },
  { id: 'ai-mode', name: 'AI Mode', k: 1, n: 3 },
  { id: 'ai-overview', name: 'AI Overview', k: 0, n: 0 },
];

/** A reason longer than its row: it is cut with an ellipsis and shown whole as the row's title. */
const NO_ANSWERS_REASON =
  'No answers in 28 days: this engine has not returned an answer for the prompts of this topic since the schedule changed';

function mentionRow(
  { id, name, k, n }: EngineWindow,
  words: RateTipWords,
  thin: (answers: number) => string,
): ComparisonRow {
  const state = rateState(n);
  const value: BarValue =
    state === 'ok'
      ? { kind: 'value', value: k / n, valueText: rate(k / n), contextText: answersText(k, n) }
      : state === 'insufficient'
        ? { kind: 'thin', answers: n }
        : { kind: 'none', text: NO_ANSWERS_REASON };
  const accessibleText =
    state === 'ok'
      ? `${name}: ${rate(k / n)} mention rate, ${answersText(k, n)}`
      : state === 'insufficient'
        ? `${name}: ${thin(n)}, too few for a rate`
        : `${name}: ${NO_ANSWERS_REASON}`;
  const tip = rateTipText(
    {
      value: state === 'ok' ? k / n : null,
      k: state === 'none' ? null : k,
      n,
      band: state === 'ok' ? wilsonInterval(k, n) : null,
      thin: state === 'insufficient',
    },
    words,
  );
  return { id, label: name, own: false, value, accessibleText, tip };
}

function MentionRateSpecimen({ density }: DensityProps): ReactElement {
  const words = useRateTipWords();
  const thin = useThinWords();
  const bars: BarListProps = {
    mode: 'comparison',
    caption: 'Mention rate by engine',
    labelHeader: 'Engine',
    valueHeader: 'Mention rate',
    contextHeader: 'Answers',
    rows: ENGINE_WINDOWS.map((entry) => mentionRow(entry, words, thin)),
    // A rate fills its bar as far as the rate goes, so 47% is not drawn as a full bar
    max: 1,
    density,
  };
  return (
    <div id="mention-rate">
      <ChartFrame
        kind="html"
        variant="panel"
        title="Mention rate by engine"
        meta="Topic: CRM for startups, last 28 days, 12 prompts"
        footnote="Each engine is shown by itself and never pooled. Method: prompt weighted. Excludes branded prompts."
        height={180}
        summary="ChatGPT names your brand in 100 of 212 answers and Gemini in 77 of 198. AI Mode has 3 answers, too few for a rate, and AI Overview has no answers."
        status="ready"
        body={<BarList {...bars} />}
        table={<BarListTable {...bars} />}
        menu={{ fileName: 'mention-rate-by-engine', link: menuLink('mention-rate'), csv: barListCsv(bars, thin) }}
      />
    </div>
  );
}

/* ---------- 3b. TopicEnginePanel, the engines of one topic (SC-26, WB-TI-10, WB-TI-11) ---------- */

const PANEL_PROMPTS = 12;
/** The same engines a window earlier, as the compared window of the page reads them. */
const PANEL_BEFORE: Readonly<Record<string, Counts>> = { chatgpt: { k: 80, n: 200 }, gemini: { k: 75, n: 190 } };

/** The API engine code of each specimen engine: one code for each row, so the rows have distinct keys. */
const PANEL_CODES: Readonly<Record<string, string>> = {
  chatgpt: 'chatgpt_web',
  gemini: 'gemini_web',
  'ai-mode': 'google_ai_mode',
  'ai-overview': 'google_ai_overview',
};

function panelRow({ id, name, k, n }: EngineWindow): EnginePanelRow {
  const state = rateState(n);
  const before = PANEL_BEFORE[id];
  const input: MetricDeltaInput | null =
    state === 'ok' && before !== undefined
      ? {
          value: k / n - before.k / before.n,
          unit: 'points',
          polarity: 'higher_is_better',
          isDetectable: isDetectableChange({ k, n }, before),
        }
      : null;
  return {
    code: PANEL_CODES[id] ?? id,
    label: name,
    state,
    value: state === 'ok' ? k / n : null,
    valueText: state === 'ok' ? rate(k / n) : '',
    contextText: state === 'ok' ? `${answersText(k, n)}, ${String(PANEL_PROMPTS)} prompts` : null,
    answers: n,
    noneText: 'No answers',
    accessibleText:
      state === 'ok'
        ? `${name}: ${rate(k / n)}, ${answersText(k, n)}`
        : state === 'insufficient'
          ? `${name}: too few answers (${String(n)}), ${answersText(k, n)}`
          : `${name}: No answers`,
    href: state === 'none' ? undefined : anchor('topic-engine-panel'),
    delta: input === null ? undefined : { input, test: 'interim', text: formatMetricDelta(input).text },
  };
}

function TopicEnginePanelSpecimen({ density }: DensityProps): ReactElement {
  const panel: TopicEnginePanelProps = {
    caption: 'Mention by engine',
    labelHeader: 'Engine',
    valueHeader: 'Mention',
    contextHeader: 'Answers',
    changeHeader: 'Change',
    rows: ENGINE_WINDOWS.map(panelRow),
    density,
  };
  return (
    <div id="topic-engine-panel">
      <ChartFrame
        kind="html"
        variant="panel"
        title="By engine"
        meta="Topic: CRM for startups, last 28 days, 12 prompts"
        footnote="Each prompt counts once, whatever the number of its answers. Each engine is shown by itself and never pooled."
        height={180}
        summary="ChatGPT names your brand in 100 of 212 answers and Gemini in 77 of 198. AI Mode has 3 answers, too few for a rate, and AI Overview has no answers."
        status="ready"
        body={<TopicEnginePanel {...panel} />}
        table={<TopicEnginePanelTable {...panel} />}
      />
    </div>
  );
}

/* ---------- 4. BarList, distribution (ai.sample_coverage) ---------- */

const PROMPTS_TOTAL = 214;

interface CoverageEntry {
  id: string;
  label: string;
  prompts: number;
  scale: DistributionRow['scale'];
}

/** In a fixed order, not by size: the categories are steps of how much is known. */
const COVERAGE_ENTRIES: readonly CoverageEntry[] = [
  { id: 'enough', label: '4 or more answers', prompts: 171, scale: 'chart-other' },
  { id: 'few', label: 'Fewer than 4 answers', prompts: 31, scale: 'insufficient' },
  { id: 'none', label: 'No answers', prompts: 12, scale: 'rank-band-none' },
];

function coverageRows(): DistributionRow[] {
  return COVERAGE_ENTRIES.map(({ id, label, prompts, scale }): DistributionRow => {
    const share = prompts / PROMPTS_TOTAL;
    const counted = `${formatSampleCount(prompts, PROMPTS_TOTAL)} prompts`;
    return {
      id,
      label,
      scale,
      value: { kind: 'value', value: share, valueText: rate(share), contextText: counted },
      accessibleText: `${label}: ${rate(share)} of prompts, ${counted}`,
    };
  });
}

function CoverageSpecimen({ density }: DensityProps): ReactElement {
  const thin = useThinWords();
  const bars: BarListProps = {
    mode: 'distribution',
    caption: 'Prompts by valid answers',
    labelHeader: 'Valid answers',
    valueHeader: 'Share of prompts',
    contextHeader: 'Prompts',
    rows: coverageRows(),
    max: 1,
    density,
  };
  return (
    <div id="coverage">
      <ChartFrame
        kind="html"
        variant="panel"
        title="Answers behind the numbers"
        meta="Last 28 days, 214 prompts"
        footnote="A prompt with fewer than 4 valid answers has no rate. A prompt with no answers is unknown, not zero."
        height={180}
        summary="171 of 214 prompts have 4 or more valid answers, 31 have fewer than 4 and 12 have none."
        status="ready"
        body={<BarList {...bars} />}
        table={<BarListTable {...bars} />}
        menu={{ fileName: 'answers-behind-the-numbers', link: menuLink('coverage'), csv: barListCsv(bars, thin) }}
      />
    </div>
  );
}

/* ---------- 5 and 6. StackedShareBar ---------- */

/** The four outcomes of an answer, in their fixed order; none of them is the own colour (that is for Own below). */
const OUTCOME_SEGMENTS: readonly ShareSegment[] = [
  { id: 'named-cited', name: 'Named and cited', color: 'chart-3' },
  { id: 'named-only', name: 'Named only', color: 'chart-4' },
  { id: 'cited-only', name: 'Cited only', color: 'chart-5' },
  { id: 'neither', name: 'Neither', color: 'chart-other' },
];

const ROLE_SEGMENTS: readonly ShareSegment[] = [
  { id: 'own', name: 'Own', color: 'chart-1' },
  { id: 'competitor', name: 'Competitor', color: 'chart-2' },
  { id: 'third-party', name: 'Third party', color: 'chart-other' },
];

/** The cells of one row: a `null` count is an unknown outcome and has no cell (never a 0%). */
function shareCells(segments: readonly ShareSegment[], counts: readonly (number | null)[], n: number): ShareCell[] {
  return segments.flatMap((segment, index): ShareCell[] => {
    const k = counts[index];
    if (k === null || k === undefined) return [];
    return [{ segmentId: segment.id, share: k / n, shareText: rate(k / n), countText: formatSampleCount(k, n) }];
  });
}

function shareRow(
  id: string,
  label: string,
  segments: readonly ShareSegment[],
  counts: readonly (number | null)[],
  n: number,
  unit: string,
  href?: Route,
): ShareRow {
  return {
    id,
    label,
    denominatorText: `of ${formatInteger(n)} ${unit}`,
    value: { kind: 'shares', cells: shareCells(segments, counts, n) },
    href,
  };
}

/** One engine's valid answers by outcome; AI Overview has 3 answers, too few for shares (R2). */
const OUTCOME_ROWS: readonly ShareRow[] = [
  shareRow('chatgpt', 'ChatGPT', OUTCOME_SEGMENTS, [215, 438, 288, 979], 1920, 'answers', anchor('outcome-chatgpt')),
  shareRow('gemini', 'Gemini', OUTCOME_SEGMENTS, [213, 355, 142, 474], 1184, 'answers', anchor('outcome-gemini')),
  shareRow('ai-mode', 'AI Mode', OUTCOME_SEGMENTS, [38, 62, 29, 111], 240, 'answers', anchor('outcome-ai-mode')),
  {
    id: 'ai-overview',
    label: 'AI Overview',
    denominatorText: 'of 3 answers',
    value: { kind: 'thin', answers: 3 },
    href: anchor('outcome-ai-overview'),
  },
];

/** Citation units by the role of the source; AI Mode has no Competitor cell because 148 of its units have no role yet (R6). */
const ROLE_ROWS: readonly ShareRow[] = [
  shareRow('chatgpt', 'ChatGPT', ROLE_SEGMENTS, [398, 682, 1762], 2842, 'citation units'),
  shareRow('gemini', 'Gemini', ROLE_SEGMENTS, [176, 431, 1353], 1960, 'citation units'),
  shareRow('ai-mode', 'AI Mode', ROLE_SEGMENTS, [49, null, 215], 412, 'citation units'),
];

interface ShareSpecimenProps extends DensityProps {
  id: string;
  title: string;
  caption: string;
  segmentHeader: string;
  segments: readonly ShareSegment[];
  rows: readonly ShareRow[];
  meta: string;
  footnote: string;
  summary: string;
  fileName: string;
}

function ShareSpecimen({
  id,
  title,
  caption,
  segmentHeader,
  segments,
  rows,
  meta,
  footnote,
  summary,
  fileName,
  density,
}: ShareSpecimenProps): ReactElement {
  const thin = useThinWords();
  const share: StackedShareBarProps = { caption, segments, rows, segmentHeader, patterns: false, density };
  return (
    <div id={id}>
      <ChartFrame
        kind="html"
        variant="panel"
        title={title}
        meta={meta}
        footnote={footnote}
        height={240}
        summary={summary}
        status="ready"
        patterns
        body={({ patterns }) => <StackedShareBar {...share} patterns={patterns} />}
        table={<StackedShareTable {...share} />}
        menu={{ fileName, link: menuLink(id), csv: stackedShareCsv(share, thin) }}
      />
    </div>
  );
}

/* ---------- 7. ShareBarCell in a rate table (WB-PD-05) ---------- */

interface MixRow {
  id: string;
  prompt: string;
  answers: number;
  counts: readonly number[];
}

const MIX_ROWS: readonly MixRow[] = [
  { id: 'startups', prompt: 'best crm for startups', answers: 48, counts: [18, 12, 6, 12] },
  { id: 'email', prompt: 'crm with email automation', answers: 36, counts: [5, 9, 4, 18] },
];

const MIX_COLUMNS: readonly PlainColumn<MixRow>[] = [
  { id: 'prompt', header: 'Prompt', cell: (row) => row.prompt },
  { id: 'answers', header: 'Answers', cell: (row) => <span className="num">{formatInteger(row.answers)}</span> },
  {
    id: 'mix',
    header: 'Outcome mix',
    cell: (row) => (
      <ShareBarCell
        label={row.prompt}
        segments={OUTCOME_SEGMENTS}
        cells={shareCells(OUTCOME_SEGMENTS, row.counts, row.answers)}
        denominatorText={`of ${formatInteger(row.answers)} answers`}
      />
    ),
  },
  {
    id: 'named',
    header: 'Naming you',
    cell: (row) => {
      const named = (row.counts[0] ?? 0) + (row.counts[1] ?? 0);
      return <span className="num">{`${rate(named / row.answers)}, ${answersText(named, row.answers)}`}</span>;
    },
  },
];

function MixTable(): ReactElement {
  return (
    <PlainTable<MixRow>
      caption="Outcome mix by prompt"
      columns={MIX_COLUMNS}
      rows={MIX_ROWS}
      rowKey={(row) => row.id}
      status="ready"
      errorState={null}
      emptyText="No prompts"
    />
  );
}

/* ---------- 8. StepBars (CH-36 and CH-30) ---------- */

interface StepInput {
  id: string;
  label: string;
  /** A count, or `null` when it is not known (never 0). */
  count: number | null;
  /** The count of the step before; `null` for the first step of a group. */
  before: number | null;
  own: boolean;
  unit?: string;
  noneText?: string;
  href?: Route | undefined;
}

/** A step's count, its share of the step before beside the counts (R1) and the words for a screen reader. */
function buildStep({ id, label, count, before, own, unit, noneText, href }: StepInput): Step {
  if (count === null) {
    return {
      id,
      label,
      count: null,
      countText: null,
      share: null,
      own,
      noneText,
      accessibleText: `${label}: ${noneText ?? 'no data'}`,
      href,
    };
  }
  const countText = unit === undefined ? formatInteger(count) : `${formatInteger(count)} ${unit}`;
  if (before === null)
    return { id, label, count, countText, share: null, own, accessibleText: `${label}: ${countText}`, href };
  const share: StepShare =
    before < MIN_OBSERVATIONS
      ? { kind: 'thin', answers: before }
      : { kind: 'share', text: `${rate(count / before)}, ${formatSampleCount(count, before)}` };
  const shareWords =
    share.kind === 'thin'
      ? `${formatInteger(before)} answers in the step before, too few for a share`
      : `${rate(count / before)} of the ${formatInteger(before)} in the step before`;
  return { id, label, count, countText, share, own, accessibleText: `${label}: ${countText}, ${shareWords}`, href };
}

interface FunnelCounts {
  id: string;
  label: string;
  answers: number;
  named: number;
  cited: number;
  linked: boolean;
}

function engineGroup({ id, label, answers, named, cited, linked }: FunnelCounts): StepGroup {
  const to = (step: string): Route | undefined => (linked ? anchor(`funnel-${id}-${step}`) : undefined);
  return {
    id,
    label,
    steps: [
      buildStep({ id: 'answers', label: 'Answers', count: answers, before: null, own: false }),
      buildStep({
        id: 'named',
        label: 'Answers naming you',
        count: named,
        before: answers,
        own: true,
        href: to('named'),
      }),
      buildStep({ id: 'cited', label: 'Named and cited', count: cited, before: named, own: true, href: to('cited') }),
    ],
  };
}

/** The sessions are another unit from another source, so their group has its own scale (R11); their key events are not connected. */
const SESSION_GROUP: StepGroup = {
  id: 'ga4',
  label: 'AI referral sessions (GA4)',
  scaleMax: 2400,
  steps: [
    buildStep({
      id: 'sessions',
      label: 'Sessions from AI engines',
      count: 1840,
      before: null,
      own: false,
      unit: 'sessions',
    }),
    buildStep({
      id: 'key-events',
      label: 'Sessions with a key event',
      count: null,
      before: 1840,
      own: true,
      noneText: 'GA4 key events not connected',
    }),
  ],
};

/** The same counts as the outcome mix above: 215 and 438 name you in ChatGPT, 213 and 355 in Gemini. */
const FUNNEL_GROUPS: readonly StepGroup[] = [
  engineGroup({ id: 'chatgpt', label: 'ChatGPT', answers: 1920, named: 653, cited: 215, linked: true }),
  engineGroup({ id: 'gemini', label: 'Gemini', answers: 1184, named: 568, cited: 213, linked: false }),
  engineGroup({ id: 'ai-overview', label: 'AI Overview', answers: 3, named: 2, cited: 1, linked: false }),
  SESSION_GROUP,
];

function FunnelSpecimen({ density }: DensityProps): ReactElement {
  const t = useTranslations('chart');
  const thin = useThinWords();
  const steps: StepBarsProps = {
    caption: 'Answer funnel by engine',
    groups: FUNNEL_GROUPS,
    scaleMax: 1920,
    groupHeader: 'Engine',
    density,
  };
  return (
    <div id="funnel">
      <ChartFrame
        kind="html"
        variant="panel"
        title="Answer funnel by engine"
        meta="Last 28 days, valid answers per engine, with GA4 sessions"
        footnote="Engines share one scale and are never pooled. Sessions are another unit, so they have their own scale. A step's share is of the step above it."
        height={240}
        summary="ChatGPT has 1,920 valid answers, 653 name you and 215 of those also cite you. Gemini has 1,184 answers, 568 name you and 213 also cite you. AI Overview has 3 answers. GA4 shows 1,840 AI referral sessions and no key events."
        status="ready"
        body={<StepBars {...steps} />}
        table={<StepBarsTable {...steps} />}
        menu={{
          fileName: 'answer-funnel',
          link: menuLink('funnel'),
          csv: stepBarsCsv(steps, {
            thin,
            step: t('stepBars.step'),
            count: t('stepBars.count'),
            share: t('stepBars.share'),
          }),
        }}
      />
    </div>
  );
}

/* ---------- 9 and 10. IntervalBar (CH-09, CH-42 and CH-10) ---------- */

type CompareValue = Extract<IntervalValue, { kind: 'compare' }>;

const withoutUnit = (text: string): string => text.replace(/ pts$/, '');

/** "+9 to +77 pts": the interval of a change in points, written by the caller as the part asks. */
const pointsInterval = (low: number, high: number, decimals: 0 | 1): string =>
  `${withoutUnit(formatPointsDelta(low, { decimals }))} to ${formatPointsDelta(high, { decimals })}`;

/** The change between two windows, with its interval and detectability from the same counts the row shows. */
function compareValue(current: Counts, previous: Counts, decimals: 0 | 1): CompareValue {
  const band = differenceInterval(current, previous);
  const detectable = isDetectableChange(current, previous);
  if (band === null || detectable === null) throw new Error('A change needs 4 or more answers in both windows');
  const estimate = current.k / current.n - previous.k / previous.n;
  const change: PointsDeltaInput = {
    value: estimate,
    unit: 'points',
    polarity: 'higher_is_better',
    isDetectable: detectable,
  };
  return {
    kind: 'compare',
    interval: { estimate, low: band.low, high: band.high },
    change,
    // The test is the unpaired one on pooled counts until the paired one arrives
    test: 'interim',
    changeText: formatMetricDelta(change).text,
    intervalText: pointsInterval(band.low, band.high, decimals),
  };
}

const detectableWords = (value: CompareValue): string =>
  value.change.isDetectable === true ? 'detectable' : 'within normal variation';

interface MoverInput {
  id: string;
  label: string;
  current: Counts;
  previous: Counts;
}

/** The biggest movers first. The first two are detectable; the next four are within normal variation. */
const MOVERS: readonly MoverInput[] = [
  { id: 'startups', label: 'best crm for startups, ChatGPT', current: { k: 6, n: 8 }, previous: { k: 2, n: 8 } },
  { id: 'freelancers', label: 'crm for freelancers, Gemini', current: { k: 19, n: 100 }, previous: { k: 50, n: 100 } },
  { id: 'pricing', label: 'crm pricing comparison, ChatGPT', current: { k: 42, n: 100 }, previous: { k: 30, n: 100 } },
  {
    id: 'alternatives',
    label: 'hubspot alternatives, AI Mode',
    current: { k: 14, n: 100 },
    previous: { k: 22, n: 100 },
  },
  { id: 'email', label: 'crm with email automation, Gemini', current: { k: 40, n: 100 }, previous: { k: 35, n: 100 } },
  {
    id: 'pipeline',
    label: 'sales pipeline software, ChatGPT',
    current: { k: 38, n: 100 },
    previous: { k: 41, n: 100 },
  },
];

function moverRow({ id, label, current, previous }: MoverInput): DivergingRow {
  const value = compareValue(current, previous, 1);
  return {
    id,
    label,
    value,
    accessibleText: `${label}: ${value.changeText}, 95% interval ${value.intervalText}, ${detectableWords(value)}`,
    tip: `${rate(previous.k / previous.n)} to ${rate(current.k / current.n)} (${value.changeText}), ${formatSampleCount(previous.k, previous.n)} then ${formatSampleCount(current.k, current.n)} answers`,
  };
}

function useIntervalWords(): IntervalCsvWords {
  const t = useTranslations('chart');
  return {
    change: t('intervalBar.change'),
    interval: t('intervalBar.interval'),
    previous: t('intervalBar.previous'),
    current: t('intervalBar.current'),
    thin: t('intervalBar.thin'),
    noValue: t('noValue'),
  };
}

function MoversSpecimen({ density }: DensityProps): ReactElement {
  const words = useIntervalWords();
  const rows = MOVERS.map(moverRow);
  const intervals = rows.flatMap((row) => (row.value.kind === 'compare' ? [row.value.interval] : []));
  const bars: IntervalBarProps = {
    form: 'diverging',
    caption: 'Prompt movers',
    labelHeader: 'Prompt',
    rows,
    domain: changeDomain(intervals),
    density,
  };
  return (
    <div id="movers">
      <ChartFrame
        kind="html"
        variant="panel"
        title="Prompt movers"
        meta="Last 28 days against the 28 days before, one engine for each prompt"
        footnote="Changes are in points. A bar is coloured only when the change is detectable; the line is the 95% interval. Method: unpaired, pooled counts."
        height={240}
        summary="Two prompts changed in a way that is detectable: best crm for startups on ChatGPT is up 50.0 points and crm for freelancers on Gemini is down 31.0 points. Four other prompts moved within normal variation."
        status="ready"
        body={<IntervalBar {...bars} />}
        table={<IntervalBarTable {...bars} />}
        menu={{ fileName: 'prompt-movers', link: menuLink('movers'), csv: intervalBarCsv(bars, words) }}
      />
    </div>
  );
}

interface PeriodInput {
  id: string;
  label: string;
  color: DumbbellRow['color'];
  previous: Counts;
  current: Counts;
}

const PERIODS: readonly PeriodInput[] = [
  { id: 'chatgpt', label: 'ChatGPT', color: 'chart-1', previous: { k: 612, n: 1920 }, current: { k: 653, n: 1920 } },
  { id: 'gemini', label: 'Gemini', color: 'chart-2', previous: { k: 480, n: 1184 }, current: { k: 568, n: 1184 } },
  { id: 'ai-mode', label: 'AI Mode', color: 'chart-3', previous: { k: 1, n: 3 }, current: { k: 100, n: 240 } },
  { id: 'ai-overview', label: 'AI Overview', color: 'chart-4', previous: { k: 0, n: 0 }, current: { k: 1, n: 3 } },
];

const windowText = ({ k, n }: Counts): string => `${rateOne(k / n)}, ${formatSampleCount(k, n)}`;

/** A window has a rate to draw only with 4 or more answers; its text is empty otherwise. */
function windowOf(counts: Counts): { rate: number | null; text: string } {
  return rateState(counts.n) === 'ok'
    ? { rate: counts.k / counts.n, text: windowText(counts) }
    : { rate: null, text: '' };
}

function periodRow({ id, label, color, previous, current }: PeriodInput): DumbbellRow {
  const before = windowOf(previous);
  const now = windowOf(current);
  const base = {
    id,
    label,
    color,
    previous: before.rate,
    current: now.rate,
    previousText: before.text,
    currentText: now.text,
  };
  if (before.rate === null || now.rate === null) {
    // Too few answers in a window: the row says so in place of two dots (R2), and a window with none says that (R6)
    const none = rateState(previous.n) === 'none';
    return none
      ? {
          ...base,
          value: { kind: 'none', text: 'No answers in the earlier period' },
          accessibleText: `${label}: no answers in the earlier period`,
        }
      : {
          ...base,
          value: { kind: 'thin' },
          accessibleText: `${label}: too few answers in the earlier period to compare`,
        };
  }
  const value = compareValue(current, previous, 1);
  return {
    ...base,
    value,
    accessibleText: `${label}: ${before.text} to ${now.text}, ${value.changeText}, 95% interval ${value.intervalText}, ${detectableWords(value)}`,
    tip: `${formatSampleCount(previous.k, previous.n)} then ${formatSampleCount(current.k, current.n)} answers`,
  };
}

/** `[0, ceiling]`: the next tenth above the highest rate, at least 0.1 (15 section 6). */
function rateCeiling(rows: readonly DumbbellRow[]): ChangeDomain {
  const highest = Math.max(0, ...rows.flatMap((row) => [row.previous ?? 0, row.current ?? 0]));
  return [0, Math.max(0.1, Math.ceil(highest * 10 - 1e-9) / 10)];
}

function PeriodSpecimen({ density }: DensityProps): ReactElement {
  const words = useIntervalWords();
  const rows = PERIODS.map(periodRow);
  const intervals = rows.flatMap((row) => (row.value.kind === 'compare' ? [row.value.interval] : []));
  const bars: IntervalBarProps = {
    form: 'dumbbell',
    caption: 'Mention rate by engine, previous and current period',
    labelHeader: 'Engine',
    rows,
    rateDomain: rateCeiling(rows),
    changeDomain: changeDomain(intervals),
    density,
  };
  return (
    <div id="period">
      <ChartFrame
        kind="html"
        variant="panel"
        title="Period comparison by engine"
        meta="Last 28 days against the 28 days before, mention rate"
        footnote="Hollow dot: the earlier period. Filled dot: this period. Each engine is compared with itself and never pooled. Method: unpaired, pooled counts."
        height={240}
        summary="ChatGPT went from 31.9% to 34.0%, up 2.1 points, within normal variation. Gemini went from 40.5% to 48.0%, up 7.4 points, and the change is detectable. AI Mode has too few answers in the earlier period to compare and AI Overview has none."
        status="ready"
        body={<IntervalBar {...bars} />}
        table={<IntervalBarTable {...bars} />}
        menu={{ fileName: 'period-comparison', link: menuLink('period'), csv: intervalBarCsv(bars, words) }}
      />
    </div>
  );
}

/* ---------- 11. A part inside the frame's empty and loading states (CH-08) ---------- */

function pageRows(): ComparisonRow[] {
  const total = 1920;
  const pages: readonly { id: string; path: string; count: number }[] = [
    { id: 'pricing', path: 'idraft.ai/pricing', count: 41 },
    { id: 'guide', path: 'idraft.ai/crm-guide', count: 27 },
  ];
  return pages.map(({ id, path, count }): ComparisonRow => {
    const counted = answersText(count, total);
    return {
      id,
      label: path,
      own: true,
      value: { kind: 'value', value: count / total, valueText: rate(count / total), contextText: counted },
      accessibleText: `${path}: cited in ${rate(count / total)} of answers, ${counted}`,
    };
  });
}

function PagesSpecimen({ density }: DensityProps): ReactElement {
  const thin = useThinWords();
  const bars: BarListProps = {
    mode: 'comparison',
    caption: 'Your pages AI engines cite',
    labelHeader: 'Page',
    valueHeader: 'Cited in',
    contextHeader: 'Answers',
    rows: pageRows(),
    max: 1,
    density,
  };
  const shared: Omit<HtmlFrameProps, 'title'> = {
    kind: 'html',
    variant: 'panel',
    meta: 'Last 28 days, 1,920 ChatGPT answers',
    height: 180,
    summary: 'Pages of idraft.ai cited in ChatGPT answers, with the answers behind each count.',
    body: <BarList {...bars} />,
    table: <BarListTable {...bars} />,
    menu: { fileName: 'cited-pages', link: menuLink('pages'), csv: barListCsv(bars, thin) },
  };
  return (
    <div id="pages" className="grid gap-4 md:grid-cols-2">
      <div className="min-w-0">
        <ChartFrame
          {...shared}
          title="Your pages AI engines cite, empty"
          status="empty"
          empty={{
            title: 'No answer cited your pages in these 28 days',
            reason: 'Answers named your brand but linked other sites, so no page of yours has a count yet.',
            action: (
              <LinkButton size="sm" render={<Link href="/design-system/charts" />}>
                Open the citation gaps
              </LinkButton>
            ),
          }}
        />
      </div>
      <div className="min-w-0">
        <ChartFrame {...shared} title="Your pages AI engines cite, loading" status="loading" />
      </div>
    </div>
  );
}

/* ---------- The section ---------- */

/** The HTML chart parts of the AI visibility package (WP-05), each mapped to its consumers, in both themes and densities. */
export function ChartPartsSection(): ReactNode {
  const [density, setDensity] = useState<Density>(DEFAULT_DENSITY);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <SegmentedControl<Density>
          semantics="view"
          size="sm"
          label="Density"
          value={density}
          onValueChange={setDensity}
          items={DENSITY_ITEMS}
        />
        <p className="type-meta">Density sets the height of the bars and of the rows in every part below.</p>
      </div>
      <SpecimenGroup
        title="BarList, comparison"
        note="CH-02, WB-OV-08, WB-TI-18. Your row in the brand colour and every other bar neutral, one scale from 0, the count beside every percent. Rows are links: Tab moves down the list. The tracked set is named in the footnote (R9)."
      >
        <ShareOfVoiceSpecimen density={density} />
      </SpecimenGroup>
      <SpecimenGroup
        title="BarList, role badges and changes"
        note="CH-07. The role is a word in a badge, never colour alone. A change is coloured only when it is detectable. Six rows show and Show all opens the rest; one label is long and is cut."
      >
        <TopDomainsSpecimen density={density} />
      </SpecimenGroup>
      <SpecimenGroup
        title="BarList, thin and unknown rows"
        note="WB-TI-11, WB-TPE-09. Fewer than 4 answers says its answers and draws no bar (R2). No answers says why and is never a zero (R6). The long reason is cut and kept in the row's title."
      >
        <MentionRateSpecimen density={density} />
      </SpecimenGroup>
      <SpecimenGroup
        title="TopicEnginePanel"
        note="SC-26, WB-TI-10, WB-TI-11. The engines of one topic: the mark and name, a bar and the percent, the answers and prompts behind it. Fewer than 4 answers says its answers and draws no bar (R2); no answers says so and is never a zero (R6). A change is coloured only when it is detectable. A row is a link to the topic's prompts on that engine; the Table view repeats every row."
      >
        <TopicEnginePanelSpecimen density={density} />
      </SpecimenGroup>
      <SpecimenGroup
        title="BarList, distribution"
        note="ai.sample_coverage (9.4). Scale colours in a fixed order, the brand colour never used for a category."
      >
        <CoverageSpecimen density={density} />
      </SpecimenGroup>
      <SpecimenGroup
        title="StackedShareBar, outcomes with patterns"
        note="CH-03. One bar for each engine, never pooled. The legend table below carries every share and count. Patterns hatches each segment differently; AI Overview has 3 answers (R2)."
      >
        <ShareSpecimen
          id="outcome"
          title="Named and cited, by engine"
          caption="Named and cited, by engine"
          segmentHeader="Outcome"
          segments={OUTCOME_SEGMENTS}
          rows={OUTCOME_ROWS}
          meta="Last 28 days, valid answers per engine"
          footnote="A bar adds up to the valid answers of one engine. Engines are never pooled. Excludes branded prompts."
          summary="ChatGPT: of 1,920 answers, 215 name and cite you, 438 name you only, 288 cite you only and 979 do neither. Gemini and AI Mode are in the table. AI Overview has 3 answers, too few for shares."
          fileName="named-and-cited"
          density={density}
        />
      </SpecimenGroup>
      <SpecimenGroup
        title="StackedShareBar, source roles"
        note="CH-16, WB-OV-07, WB-SRCS-02. The own segment uses the brand colour. AI Mode has no Competitor cell because its roles are not known yet, so its bar is shorter instead of showing a 0%."
      >
        <ShareSpecimen
          id="roles"
          title="Citation units by source role"
          caption="Citation units by source role"
          segmentHeader="Role"
          segments={ROLE_SEGMENTS}
          rows={ROLE_ROWS}
          meta="Last 28 days, citation units per engine"
          footnote="A citation unit is one distinct URL in one answer. Citation units and answers are different units and never share an axis."
          summary="ChatGPT: of 2,842 citation units, 398 are your own pages, 682 are competitors and 1,762 are third parties. Gemini and AI Mode are in the table. AI Mode has no Competitor figure."
          fileName="citation-units-by-role"
          density={density}
        />
      </SpecimenGroup>
      <SpecimenGroup
        title="ShareBarCell in a rate table"
        note="WB-PD-05, DS 25 10.6 cell. A 96 by 12 px bar with no labels; its name carries every share and count and the table repeats the rate with its count."
      >
        <MixTable />
      </SpecimenGroup>
      <SpecimenGroup
        title="StepBars"
        note="CH-36, CH-30. One scale for the engines, your own steps in the brand colour. A step after fewer than 4 answers says its answers (R2). Sessions are another unit with their own scale and an unknown step says why (R6). ChatGPT steps are links."
      >
        <FunnelSpecimen density={density} />
      </SpecimenGroup>
      <SpecimenGroup
        title="IntervalBar, diverging"
        note="CH-09, CH-42. A bar from 0 to the change with its 95% interval as a line. Only the two detectable changes are coloured; the others are grey and say within normal variation. The zero line runs the full height."
      >
        <MoversSpecimen density={density} />
      </SpecimenGroup>
      <SpecimenGroup
        title="IntervalBar, dumbbell"
        note="CH-10. The two rates as a hollow and a filled dot, the change and its interval on a second axis. Two bars are never drawn. A row without enough answers says so in place of dots."
      >
        <PeriodSpecimen density={density} />
      </SpecimenGroup>
      <SpecimenGroup
        title="A part in the frame's states"
        note="CH-08. The frame draws the empty and loading states around a BarList body and keeps the title and the height."
      >
        <PagesSpecimen density={density} />
      </SpecimenGroup>
    </div>
  );
}
