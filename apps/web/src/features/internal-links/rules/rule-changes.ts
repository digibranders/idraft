import type { TierRuleView } from '@/lib/internal-links/types';

export type MatchType = TierRuleView['match_type'];

/** A row of the rules dialog. `key` is stable while the person edits; `ruleId` is `null` for a new rule. */
export interface DraftRule {
  key: string;
  ruleId: string | null;
  matchType: MatchType;
  value: string;
  tierId: string;
}

export interface RuleChanges {
  deletes: string[];
  patches: {
    ruleId: string;
    body: Partial<{ match_type: MatchType; value: string; tier_id: string; position: number }>;
  }[];
  creates: { match_type: MatchType; value: string; tier_id: string; position: number }[];
}

/**
 * The calls that turn the saved rules into the draft (gap G7 asks for one bulk save): delete the removed rules,
 * patch the changed ones, then create the new ones at their positions. A patch is sent when a field changed or
 * when the rule is not where the draft wants it after the patches before it (the API moves a rule to a position
 * and shifts the others, and clamps a position to the rules it holds). Sent in that order, the rules end in the
 * draft's order. The calls are idempotent against a fresh read: what a failed save already did is not asked again.
 */
export function ruleChanges(
  saved: readonly Pick<TierRuleView, 'rule_id' | 'position' | 'match_type' | 'value' | 'tier'>[],
  draft: readonly DraftRule[],
): RuleChanges {
  const kept = new Set(draft.flatMap((rule) => (rule.ruleId === null ? [] : [rule.ruleId])));
  const ordered = [...saved].sort((a, b) => a.position - b.position);
  const deletes = ordered.filter((rule) => !kept.has(rule.rule_id)).map((rule) => rule.rule_id);
  // The order the API holds as the patches are applied one after the other
  const current = ordered.filter((rule) => kept.has(rule.rule_id)).map((rule) => rule.rule_id);
  const patches: RuleChanges['patches'] = [];
  const creates: RuleChanges['creates'] = [];
  draft.forEach((rule, index) => {
    const position = index + 1;
    const value = rule.value.trim();
    if (rule.ruleId === null) {
      creates.push({ match_type: rule.matchType, value, tier_id: rule.tierId, position });
      return;
    }
    const before = ordered.find((candidate) => candidate.rule_id === rule.ruleId);
    if (before === undefined) return;
    const body = {
      ...(before.match_type === rule.matchType ? {} : { match_type: rule.matchType }),
      ...(before.value === value ? {} : { value }),
      ...(before.tier.tier_id === rule.tierId ? {} : { tier_id: rule.tierId }),
    };
    const at = current.indexOf(rule.ruleId);
    const target = Math.min(position, current.length);
    const moved = at + 1 !== target;
    if (moved) {
      current.splice(at, 1);
      current.splice(target - 1, 0, rule.ruleId);
    }
    if (Object.keys(body).length > 0 || moved) patches.push({ ruleId: rule.ruleId, body: { ...body, position } });
  });
  return { deletes, patches, creates };
}
