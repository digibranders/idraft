import type { MatchType } from './rule-changes';

/** A project holds at most this many rules (`RULES_MAX` of the backend). */
export const MAX_RULES = 500;
const VALUE_MAX = 500;
const STARS_MAX = 10;

export type RuleValueProblem =
  'empty' | 'starts_with_slash' | 'too_long' | 'star_in_exact' | 'star_in_prefix' | 'too_many_stars';

/**
 * What the API would say about a rule's path (`check_rule_value` of `backend/src/idraft/crawl/tiers.py`, in its
 * order), so a rule is refused where it is typed. The API trims the value first, so this does too.
 */
export function checkRuleValue(matchType: MatchType, value: string): RuleValueProblem | null {
  const path = value.trim();
  if (path === '') return 'empty';
  if (!path.startsWith('/')) return 'starts_with_slash';
  if (path.length > VALUE_MAX) return 'too_long';
  if (matchType !== 'pattern' && path.includes('*')) return matchType === 'exact' ? 'star_in_exact' : 'star_in_prefix';
  if (path.split('*').length - 1 > STARS_MAX) return 'too_many_stars';
  return null;
}
