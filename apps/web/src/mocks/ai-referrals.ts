import { daysBetween, shiftIsoDate } from './serp-views';
import type { Schemas } from '@/lib/api/types';

/**
 * WP-69: the visits from AI platforms that a project's GA4 property reports, as the mock answers
 * `fp/ai-referrals` (docs/ai-visibility/contracts/fp-ai-referrals.md). There is no Google Analytics here: every
 * platform has a steady number of visits a day under each way of counting, so a period of n days holds n times it,
 * and the figures are the same on every reload. One platform has no earlier figure (its previous is null), one is
 * counted only by our rules, and the GA4 property is collected through yesterday, as the sync leaves it.
 */

interface Daily {
  key: string;
  /** Visits a day under our rules; `null` when only the GA4 channel counts the platform. */
  own: number | null;
  /** Visits a day under the AI Assistant channel of GA4; `null` when only our rules count it. */
  ga4: number | null;
  /** The share of the visits that were engaged. */
  engaged: number;
  /** The earlier period's visits a day as a share of this one's; `null` when the platform has no earlier figure. */
  earlier: number | null;
}

const DAILY: readonly Daily[] = [
  { key: 'chatgpt', own: 14.6, ga4: 12.8, engaged: 0.74, earlier: 0.82 },
  { key: 'perplexity', own: 4.3, ga4: 4.1, engaged: 0.69, earlier: 1.1 },
  { key: 'gemini', own: 3.4, ga4: 2.2, engaged: 0.71, earlier: 0.6 },
  { key: 'claude', own: 1.9, ga4: 1.6, engaged: 0.77, earlier: 0.9 },
  { key: 'copilot', own: 0.8, ga4: 0.7, engaged: 0.62, earlier: null },
  { key: 'grok', own: 0.4, ga4: null, engaged: 0.58, earlier: null },
];

/** The three fixed sentences of `meta.notes`, in the order the route sends them. */
const FIXED_NOTES = [
  'Google AI Mode and Google AI Overview are not counted: Google Analytics files their sessions under organic search.',
  'The figures are a lower bound: visits without a referrer, such as clicks from native apps, are filed under direct.',
  'The two classifiers are shown side by side and neither is labelled correct.',
] as const;

/** The first pull covers this many days back from today, as the sync does. */
const FIRST_PULL_DAYS = 90;

export type ReferralClassifier = 'both' | 'ga4_ai_assistant_channel' | 'own_rules';

export interface ReferralsAsk {
  /** The days the figures are for, both included. */
  from: string;
  to: string;
  /** The days they are compared with, or `null`. */
  compare: { from: string; to: string } | null;
  classifier: ReferralClassifier;
  timezone: string;
  /** Whether the project has a live GA4 property. */
  connected: boolean;
  /** The project's today. */
  today: string;
  now: number;
}

/** The same dates a year earlier; 29 February becomes 28 February. */
export function yearEarlier(isoDate: string): string {
  const [year = 0, month = 1, day = 1] = isoDate.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year - 1, month, 0)).getUTCDate();
  return `${String(year - 1)}-${isoDate.slice(5, 7)}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

/** The days the period before covers: as many days just before `from`, or the same dates a year earlier. */
export function comparedPeriod(
  kind: 'previous_period' | 'previous_year',
  from: string,
  to: string,
): { from: string; to: string } {
  if (kind === 'previous_year') return { from: yearEarlier(from), to: yearEarlier(to) };
  const days = daysBetween(from, to);
  return { from: shiftIsoDate(from, -days), to: shiftIsoDate(from, -1) };
}

const visits = (perDay: number, days: number): number => Math.round(perDay * days);

function valueOf(
  perDay: number | null,
  days: number,
  daily: Daily,
  previousDays: number | null,
): Schemas['AiReferralValue'] | null {
  if (perDay === null || days === 0) return null;
  const sessions = visits(perDay, days);
  const counts = (n: number): Schemas['AiReferralCounts'] => ({
    sessions: n,
    engaged_sessions: Math.round(n * daily.engaged),
    key_events: `${String(Math.round(n * 0.08))}.00`,
  });
  return {
    ...counts(sessions),
    previous:
      previousDays === null || daily.earlier === null ? null : counts(visits(perDay * daily.earlier, previousDays)),
  };
}

/** The answer of the route for one ask; every figure follows the rules of the contract's "Null versus zero". */
export function aiReferralsAnswer(ask: ReferralsAsk): Schemas['AiReferralsResponse'] {
  const window = { from: ask.from, to: ask.to, timezone: ask.timezone };
  const compareWindow = ask.compare === null ? null : { ...ask.compare, timezone: ask.timezone };
  const through = ask.connected ? shiftIsoDate(ask.today, -1) : null;
  const since = ask.connected ? shiftIsoDate(ask.today, -FIRST_PULL_DAYS) : null;
  const notes: string[] = [...FIXED_NOTES];
  const base: Schemas['AiReferralsMeta'] = {
    connected: ask.connected,
    collected_through: through,
    collected_since: since,
    last_success_at: through === null ? null : new Date(ask.now).toISOString(),
    window,
    compare_window: compareWindow,
    window_collected: false,
    rules_version: null,
    lower_bound: true,
    notes,
  };
  if (through === null || since === null) return { data: [], meta: base };
  // A pull ends yesterday, so a period that ends today needs yesterday and not its own last day (the route's rule)
  const collected = (from: string, to: string): boolean =>
    since <= from && through >= (to >= ask.today ? shiftIsoDate(ask.today, -1) : to);
  // Days of the period that are stored: from the first pulled day up to the last collected one
  const first = since > ask.from ? since : ask.from;
  const last = through < ask.to ? through : ask.to;
  const days = last < first ? 0 : daysBetween(first, last);
  if (through < ask.from) {
    notes.push(`Collected up to ${through}, before the start of this window, so nothing is shown for it.`);
  } else if (through < (ask.to >= ask.today ? shiftIsoDate(ask.today, -1) : ask.to)) {
    notes.push(`Collected up to ${through}: the days after it are not in these figures.`);
  }
  if (since > ask.from) {
    notes.push(`The figures start on ${since}: the days of this window before it were not collected.`);
  }
  // A compared period counts only when it is collected in full
  const previousDays =
    ask.compare === null || !collected(ask.compare.from, ask.compare.to)
      ? null
      : daysBetween(ask.compare.from, ask.compare.to);
  if (ask.compare !== null && previousDays === null) {
    notes.push('The compared window is not fully collected, so no comparison is shown.');
  }
  const wanted = (classifier: Exclude<ReferralClassifier, 'both'>): boolean =>
    ask.classifier === 'both' || ask.classifier === classifier;
  const data = DAILY.flatMap((daily): Schemas['AiReferralRow'][] => {
    const own = wanted('own_rules') ? valueOf(daily.own, days, daily, previousDays) : null;
    const ga4 = wanted('ga4_ai_assistant_channel') ? valueOf(daily.ga4, days, daily, previousDays) : null;
    if (own === null && ga4 === null) return [];
    const ours = own?.sessions ?? null;
    const theirs = ga4?.sessions ?? null;
    return [
      {
        key: daily.key,
        own_rules: own,
        ga4_ai_assistant_channel: ga4,
        difference: ours === null || theirs === null ? null : ours - theirs,
      },
    ];
  });
  const size = (row: Schemas['AiReferralRow']): number =>
    Math.max(row.own_rules?.sessions ?? 0, row.ga4_ai_assistant_channel?.sessions ?? 0);
  data.sort((a, b) => size(b) - size(a) || a.key.localeCompare(b.key));
  return {
    data,
    meta: {
      ...base,
      window_collected: collected(ask.from, ask.to),
      rules_version: data.some((row) => row.own_rules !== null) ? 1 : null,
    },
  };
}
