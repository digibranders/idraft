import type { CitationsTranslate, PreviousText } from './board-text';
import { FLAT_CHANGE } from '@/components/app/metric/trend-icon';
import type { CitationOverview } from '@/lib/citations/board-queries';
import {
  EMPTY_VALUE,
  formatInteger,
  formatPercent,
  formatPointsDelta,
  formatRelativeChange,
  formatSignedInteger,
  type MetricDeltaInput,
} from '@/lib/format';
import { equalWeightAverage, isDetectableChange, type Counts } from '@/lib/stats';

/** The six measures of the strip (brief 3.3, C 200 to 257). Pure: the overview read and the words in, slots out. */

export type MeasureId = 'citations' | 'frequency' | 'coverage' | 'urls' | 'domains' | 'growth';

export type MeasureDelta =
  /** A rate's change in points, drawn as a `TrendIcon` (C 87 to 89). */
  | { kind: 'points'; input: MetricDeltaInput; tip: string; spoken: string }
  /** A count's signed change, always neutral (C 91 to 97). */
  | { kind: 'count'; text: string; tip: string };

export interface MeasureSlot {
  id: MeasureId;
  label: string;
  value: string;
  unknown: boolean;
  delta: MeasureDelta | null;
  /** What, then the context (capitalised, full stop), then the tip, then how (C 234). */
  hint: string;
  /** The figure's accessible name: "<label>: <value>. <hint>" (C 237). */
  spoken: string;
}

export interface MeasureInput {
  overview: CitationOverview;
  /** All platforms: rates are the equal-weight average of the engines, and the context says so. */
  allPlatforms: boolean;
  /** The project's own registrable domain, which three texts name. */
  ownDomain: string;
  previous: PreviousText;
}

interface RateCell {
  value: number | null;
  used: number;
  pooled: Counts;
}

type Engines = CitationOverview['engines'];

/** Per engine, then the equal-weight average of those with answers (D 222 to 233). */
function rateOf(engines: Engines, pick: (engine: Engines[number]) => Counts): RateCell {
  const counts = engines.map(pick);
  const average = equalWeightAverage(counts.map((count) => (count.n > 0 ? count.k / count.n : null)));
  return {
    value: average.value,
    used: average.used,
    pooled: counts.reduce((sum, count) => ({ k: sum.k + count.k, n: sum.n + count.n }), { k: 0, n: 0 }),
  };
}

const capitalised = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

function trendDelta(current: RateCell, previous: RateCell, t: CitationsTranslate): MeasureDelta | null {
  if (current.value === null || previous.value === null) return null;
  const change = current.value - previous.value;
  const detectable = isDetectableChange(current.pooled, previous.pooled) === true;
  const flat = Math.abs(change) < FLAT_CHANGE;
  // "Up 2.5 pts", not "Up +2.5 pts": the word already says the sign (prompts-parts.js line 32)
  const points = formatPointsDelta(Math.abs(change), { decimals: 1 }).replace(/^\+/, '');
  const words = flat ? t('measures.flat') : change > 0 ? t('measures.up', { points }) : t('measures.down', { points });
  // A small change can round to the same whole percent on both sides: then one decimal tells them apart
  const decimals =
    formatPercent(previous.value, { decimals: 0 }) === formatPercent(current.value, { decimals: 0 }) ? 1 : 0;
  return {
    kind: 'points',
    input: { value: change, unit: 'points', polarity: 'higher_is_better', isDetectable: detectable },
    tip: t('measures.trendTip', {
      words,
      from: formatPercent(previous.value, { decimals }),
      to: formatPercent(current.value, { decimals }),
      verdict: detectable ? t('measures.detectable') : t('measures.notDetectable'),
    }),
    spoken: detectable ? t('measures.spokenDetectable', { words }) : t('measures.spokenNot', { words }),
  };
}

function countDelta(now: number, before: number, t: CitationsTranslate): MeasureDelta | null {
  if (now === before) return null;
  return {
    kind: 'count',
    text: formatSignedInteger(now - before),
    tip: t('measures.countBefore', { count: formatInteger(before) }),
  };
}

interface SlotParts {
  id: MeasureId;
  label: string;
  value: string;
  delta: MeasureDelta | null;
  what: string;
  context: string | null;
  tip: string | null;
  how: string;
}

function slotOf(parts: SlotParts, t: CitationsTranslate): MeasureSlot {
  const hint = [parts.what, parts.context === null ? null : `${capitalised(parts.context)}.`, parts.tip, parts.how]
    .filter((part): part is string => part !== null && part !== '')
    .join(' ');
  return {
    id: parts.id,
    label: parts.label,
    value: parts.value,
    unknown: parts.value === EMPTY_VALUE,
    delta: parts.delta,
    hint,
    spoken: t('measures.aria', { label: parts.label, value: parts.value, hint }),
  };
}

export function measureSlots(input: MeasureInput, t: CitationsTranslate): MeasureSlot[] {
  const { overview, allPlatforms, ownDomain, previous } = input;
  const { engines, window } = overview;
  const answersNow = rateOf(engines, (engine) => ({ k: engine.answers_citing, n: engine.answers }));
  const answersBefore = rateOf(engines, (engine) => ({
    k: engine.previous_answers_citing,
    n: engine.previous_answers,
  }));
  const promptsNow = rateOf(engines, (engine) => ({ k: engine.prompts_citing, n: engine.prompts }));
  const promptsBefore = rateOf(engines, (engine) => ({
    k: engine.previous_prompts_citing,
    n: engine.previous_prompts,
  }));

  const rate = (id: 'frequency' | 'coverage', current: RateCell, before: RateCell): MeasureSlot => {
    const k = formatInteger(current.pooled.k);
    const n = formatInteger(current.pooled.n);
    const known = current.value !== null;
    const words =
      id === 'frequency'
        ? {
            label: t('measures.frequency.label'),
            what: t('measures.frequency.what'),
            how: t('measures.frequency.how'),
            one: t('measures.frequency.contextOne', { k, n }),
            tip: allPlatforms
              ? t('measures.frequency.tipAll', { k, n, previous: previous.full })
              : t('measures.frequency.tipOne', { k, n, previous: previous.full }),
          }
        : {
            label: t('measures.coverage.label'),
            what: t('measures.coverage.what'),
            how: t('measures.coverage.how'),
            one: t('measures.coverage.contextOne', { k, n }),
            tip: allPlatforms
              ? t('measures.coverage.tipAll', { k, n, previous: previous.full })
              : t('measures.coverage.tipOne', { k, n, previous: previous.full }),
          };
    return slotOf(
      {
        id,
        label: words.label,
        value: known ? formatPercent(current.value, { decimals: 1 }) : EMPTY_VALUE,
        delta: known ? trendDelta(current, before, t) : null,
        what: words.what,
        context: !known
          ? t('measures.noAnswers')
          : allPlatforms
            ? t('measures.average', { count: current.used })
            : words.one,
        tip: known ? words.tip : null,
        how: words.how,
      },
      t,
    );
  };

  const growth =
    overview.previous_citations > 0
      ? formatRelativeChange((overview.citations - overview.previous_citations) / overview.previous_citations)
      : EMPTY_VALUE;

  return [
    slotOf(
      {
        id: 'citations',
        label: t('measures.citations.label'),
        value: formatInteger(overview.citations),
        delta: null,
        what: t('measures.citations.what'),
        context: t('measures.citations.context', { answers: window.answers }),
        tip: t('measures.citations.tip', { domain: ownDomain, answers: window.answers, prompts: window.prompts }),
        how: t('measures.citations.how'),
      },
      t,
    ),
    rate('frequency', answersNow, answersBefore),
    rate('coverage', promptsNow, promptsBefore),
    slotOf(
      {
        id: 'urls',
        label: t('measures.urls.label'),
        value: formatInteger(overview.own_urls),
        delta: countDelta(overview.own_urls, overview.previous_own_urls, t),
        what: t('measures.urls.what'),
        context: t('measures.urls.context', { domain: ownDomain }),
        tip: null,
        how: t('measures.urls.how', { domain: ownDomain }),
      },
      t,
    ),
    slotOf(
      {
        id: 'domains',
        label: t('measures.domains.label'),
        value: formatInteger(overview.domains),
        delta: countDelta(overview.domains, overview.previous_domains, t),
        what: t('measures.domains.what'),
        context: t('measures.domains.context'),
        tip: null,
        how: t('measures.domains.how'),
      },
      t,
    ),
    slotOf(
      {
        id: 'growth',
        label: t('measures.growth.label'),
        value: growth,
        delta: null,
        what: t('measures.growth.what'),
        context: t('measures.growth.context', {
          change: formatSignedInteger(overview.citations - overview.previous_citations),
          previous: previous.short,
        }),
        tip: t('measures.growth.tip', {
          now: formatInteger(overview.citations),
          before: formatInteger(overview.previous_citations),
          previous: previous.full,
        }),
        how: t('measures.growth.how'),
      },
      t,
    ),
  ];
}
