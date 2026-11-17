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

/** The indexes (into `values`) of a longest strictly increasing subsequence. Quadratic: a project has 500 rules at most. */
function longestIncreasing(values: readonly number[]): Set<number> {
  const length: number[] = [];
  const before: number[] = [];
  let best = -1;
  for (const [index, value] of values.entries()) {
    length[index] = 1;
    before[index] = -1;
    for (let earlier = 0; earlier < index; earlier += 1) {
      const known = length[earlier] ?? 0;
      if ((values[earlier] ?? 0) < value && known + 1 > (length[index] ?? 0)) {
        length[index] = known + 1;
        before[index] = earlier;
      }
    }
    if (best < 0 || (length[index] ?? 0) > (length[best] ?? 0)) best = index;
  }
  const keep = new Set<number>();
  for (let at = best; at >= 0; at = before[at] ?? -1) keep.add(at);
  return keep;
}

/**
 * The calls that turn the saved rules into the draft (gap G7 asks for one bulk save): delete the removed rules,
 * patch the changed ones, then create the new ones at their positions.
 *
 * Every patch runs the rules over all pages and writes an audit row, and a rule moves with its own call, so the
 * rules that already stand in the draft's relative order (a longest such run) are left where they are and only the
 * others move: moving one rule among 500 is one patch. A moved rule is put right after the rule before it in the
 * draft (the API moves a rule to a position and shifts the others), in the draft's order, so the rules end in the
 * draft's order, and new rules then go in at their positions. A field change is a patch of its own, with no position
 * when the rule does not move.
 *
 * `known` are the ids the draft started from: only those can be deleted, so a rule a teammate added while the dialog
 * was open is never removed by a draft that never showed it. The calls are idempotent against a fresh read: what a
 * failed save already did is not asked again.
 */
export function ruleChanges(
  saved: readonly Pick<TierRuleView, 'rule_id' | 'position' | 'match_type' | 'value' | 'tier'>[],
  draft: readonly DraftRule[],
  known?: ReadonlySet<string>,
): RuleChanges {
  const kept = new Set(draft.flatMap((rule) => (rule.ruleId === null ? [] : [rule.ruleId])));
  const ordered = [...saved].sort((a, b) => a.position - b.position);
  const deletes = ordered
    .filter((rule) => !kept.has(rule.rule_id) && (known === undefined || known.has(rule.rule_id)))
    .map((rule) => rule.rule_id);
  // The order the API holds as the patches are applied one after the other
  const current = ordered.filter((rule) => !deletes.includes(rule.rule_id)).map((rule) => rule.rule_id);
  const existing = draft.filter((rule) => rule.ruleId !== null && current.includes(rule.ruleId));
  const stay = longestIncreasing(existing.map((rule) => current.indexOf(rule.ruleId ?? '')));
  const patches: RuleChanges['patches'] = [];
  const creates: RuleChanges['creates'] = [];
  for (const [at, rule] of existing.entries()) {
    const ruleId = rule.ruleId ?? '';
    const before = ordered.find((candidate) => candidate.rule_id === ruleId);
    if (before === undefined) continue;
    const value = rule.value.trim();
    const body = {
      ...(before.match_type === rule.matchType ? {} : { match_type: rule.matchType }),
      ...(before.value === value ? {} : { value }),
      ...(before.tier.tier_id === rule.tierId ? {} : { tier_id: rule.tierId }),
    };
    let position: number | null = null;
    if (!stay.has(at)) {
      const others = current.filter((id) => id !== ruleId);
      const previous = existing[at - 1]?.ruleId ?? null;
      position = previous === null ? 1 : others.indexOf(previous) + 2;
      others.splice(position - 1, 0, ruleId);
      current.splice(0, current.length, ...others);
    }
    if (position !== null || Object.keys(body).length > 0) {
      patches.push({ ruleId, body: { ...body, ...(position === null ? {} : { position }) } });
    }
  }
  draft.forEach((rule, index) => {
    if (rule.ruleId === null) {
      creates.push({ match_type: rule.matchType, value: rule.value.trim(), tier_id: rule.tierId, position: index + 1 });
    }
  });
  return { deletes, patches, creates };
}
