import type { MetricDeltaInput } from '@/lib/format';
import type { Schemas } from '@/lib/api/types';

/**
 * What the AI referral visits card knows how to say about the `fp/ai-referrals` answer, as pure functions (WP-69,
 * docs/ai-visibility/contracts/fp-ai-referrals.md): which situation the answer is in, the bars of one classifier,
 * and the change of a row against the compared period. Nothing here reads the page.
 */

export type ReferralsResponse = Schemas['AiReferralsResponse'];
export type ReferralRow = Schemas['AiReferralRow'];

/** The two ways a visit is counted as coming from an AI platform; the card shows both and calls neither right. */
export const CLASSIFIERS = ['own_rules', 'ga4_ai_assistant_channel'] as const;
export type Classifier = (typeof CLASSIFIERS)[number];
export const DEFAULT_CLASSIFIER: Classifier = 'own_rules';

/** The numbers of one classifier; a count the API leaves null is unknown, never 0. */
interface CountsLike {
  sessions: number | null;
  engaged_sessions: number | null;
}
interface ValueLike extends CountsLike {
  previous: CountsLike | null;
}

/**
 * Where the answer stands. `zero` is the only place the card says there were no visits: Google Analytics was read for
 * the whole period and no row is an AI platform's. Anything less than the whole period is not zero.
 * - `not_connected`: the project has no live GA4 property.
 * - `not_collected`: a property is linked and no sync run has finished.
 * - `before_period_end`: nothing is listed, and the period is not collected in full: what is collected stops at `through`.
 * - `rows`: visits to show; `through` is the last collected day when the period is not collected in full, else `null`.
 */
export type ReferralsStanding =
  | { kind: 'not_connected' }
  | { kind: 'not_collected' }
  | { kind: 'zero' }
  | { kind: 'before_period_end'; through: string }
  | { kind: 'rows'; through: string | null };

/**
 * The one place that decides between a real zero and visits not collected: the route's `meta.window_collected` (every
 * day of the period is stored; a period that ends today needs yesterday, as a pull ends yesterday).
 */
export function referralsStanding(response: ReferralsResponse): ReferralsStanding {
  const { meta, data } = response;
  if (!meta.connected) return { kind: 'not_connected' };
  const through = meta.collected_through;
  if (through === null) return { kind: 'not_collected' };
  if (data.length === 0) return meta.window_collected ? { kind: 'zero' } : { kind: 'before_period_end', through };
  return { kind: 'rows', through: meta.window_collected ? null : through };
}

/** The platforms Google Analytics tells apart, by the code the API sends (docs/18 section 7.4). */
const NAMES: Readonly<Record<string, string>> = {
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
  claude: 'Claude',
  perplexity: 'Perplexity',
  copilot: 'Copilot',
  deepseek: 'DeepSeek',
  grok: 'Grok',
  meta_ai: 'Meta AI',
  mistral: 'Mistral',
  you: 'You.com',
  duckassist: 'DuckAssist',
};

/** The engine code whose mark the platform shows; a platform without one shows its name alone. */
const MARKS: Readonly<Record<string, string>> = { chatgpt: 'chatgpt_web', gemini: 'gemini_web' };

const titleCase = (code: string): string =>
  code
    .split(/[_\s]+/)
    .filter((part) => part !== '')
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');

/** The name of a platform code; a code the map does not know is its words in title case. */
export const assistantName = (code: string): string =>
  Object.hasOwn(NAMES, code) ? (NAMES[code] ?? code) : titleCase(code);

/** The engine code of the mark a platform shows, or `null`. */
export const assistantMark = (code: string): string | null =>
  Object.hasOwn(MARKS, code) ? (MARKS[code] ?? null) : null;

/** One bar: a platform with its visits under the chosen classifier, and the change against the compared period. */
export interface ReferralBar {
  key: string;
  name: string;
  sessions: number;
  /** The same count over the compared period; `null` when it is not known (never 0). */
  previous: number | null;
}

/** The count of a value, `null` when the classifier has no row or the count is unknown. */
export const sessionsOf = (value: CountsLike | null): number | null => (value === null ? null : value.sessions);

const valueOf = (row: ReferralRow, classifier: Classifier): ValueLike | null => row[classifier];

/** Largest first, then by name, so equal counts keep a steady order. */
export function referralBars(rows: readonly ReferralRow[], classifier: Classifier): ReferralBar[] {
  const bars = rows.flatMap((row): ReferralBar[] => {
    const value = valueOf(row, classifier);
    const sessions = sessionsOf(value);
    if (value === null || sessions === null) return [];
    return [{ key: row.key, name: assistantName(row.key), sessions, previous: sessionsOf(value.previous) }];
  });
  return bars.sort((first, second) => second.sessions - first.sessions || first.name.localeCompare(second.name));
}

/** The change of a bar in visits; no input when nothing is compared, so no change is drawn. */
export function referralChange(bar: ReferralBar): MetricDeltaInput | null {
  if (bar.previous === null) return null;
  return { value: bar.sessions - bar.previous, unit: 'count', polarity: 'higher_is_better', isDetectable: null };
}
