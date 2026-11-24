import type { AlertRule, AlertRuleInput, AlertRuleUpdate, RuleType } from '@/lib/api/types';

export const RULE_TYPES = [
  'ai_mention_gained',
  'ai_mention_lost',
  'ai_competitor_appeared',
  'rank_drop',
] as const satisfies readonly RuleType[];

/** The platforms a rule of an AI type can be narrowed to. */
export const PLATFORM_CODES = ['chatgpt_web', 'gemini_web', 'google_ai_mode'] as const;
export type PlatformCode = (typeof PLATFORM_CODES)[number];

/** The message key of each rule type, since a message key is camelCase. */
export const RULE_TYPE_KEY = {
  ai_mention_gained: 'aiMentionGained',
  ai_mention_lost: 'aiMentionLost',
  ai_competitor_appeared: 'aiCompetitorAppeared',
  rank_drop: 'rankDrop',
} as const satisfies Record<RuleType, string>;

/** The message key of each platform. */
export const PLATFORM_KEY = {
  chatgpt_web: 'chatgptWeb',
  gemini_web: 'geminiWeb',
  google_ai_mode: 'googleAiMode',
} as const satisfies Record<PlatformCode, string>;

export const MAX_NAME_LENGTH = 120;
export const POSITIONS_MIN = 1;
export const POSITIONS_MAX = 50;
export const POSITIONS_DEFAULT = 5;

/** The form's values; the number is text until it is checked. */
export interface RuleValues {
  name: string;
  rule_type: RuleType;
  groups: string[];
  platforms: string[];
  positions: string;
}

export const isRankDrop = (type: RuleType): boolean => type === 'rank_drop';

/** A whole number in the range, from text; `null` when it is anything else. */
export function wholeNumber(text: string, min: number, max: number): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= min && value <= max ? value : null;
}

/** The positions a rank rule drops by, as the API stores them. */
export function positionsOf(rule: Pick<AlertRule, 'params'>): number {
  const { positions } = rule.params;
  return typeof positions === 'number' && Number.isInteger(positions) ? positions : POSITIONS_DEFAULT;
}

export const newRuleValues = (): RuleValues => ({
  name: '',
  rule_type: 'ai_mention_lost',
  groups: [],
  platforms: [],
  positions: String(POSITIONS_DEFAULT),
});

export const valuesOfRule = (rule: AlertRule): RuleValues => ({
  name: rule.name,
  rule_type: rule.rule_type,
  groups: [...(rule.scope.group_ids ?? [])],
  platforms: [...(rule.scope.engine_codes ?? [])],
  positions: String(positionsOf(rule)),
});

/** The scope and params of the values: a rank rule has no platform, and an AI rule no positions. */
function scopeAndParams(values: RuleValues): Required<Pick<AlertRuleInput, 'scope' | 'params'>> {
  const rank = isRankDrop(values.rule_type);
  return {
    scope: { group_ids: values.groups, engine_codes: rank ? [] : values.platforms },
    params: rank ? { positions: wholeNumber(values.positions, POSITIONS_MIN, POSITIONS_MAX) ?? POSITIONS_DEFAULT } : {},
  };
}

export const createBodyOf = (values: RuleValues): AlertRuleInput => ({
  name: values.name.trim(),
  rule_type: values.rule_type,
  is_active: true,
  ...scopeAndParams(values),
});

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');

/** Only what differs from the rule; empty when nothing changed. */
export function updateBodyOf(values: RuleValues, rule: AlertRule): AlertRuleUpdate {
  const next = scopeAndParams(values);
  const sameScope =
    sameList(next.scope.group_ids ?? [], rule.scope.group_ids ?? []) &&
    sameList(next.scope.engine_codes ?? [], rule.scope.engine_codes ?? []);
  const sameParams = JSON.stringify(next.params) === JSON.stringify(rule.params);
  const name = values.name.trim();
  return {
    ...(name === rule.name ? {} : { name }),
    ...(sameScope ? {} : { scope: next.scope }),
    ...(sameParams ? {} : { params: next.params }),
  };
}
