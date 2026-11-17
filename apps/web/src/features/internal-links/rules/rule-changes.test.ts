import { describe, expect, it } from 'vitest';

import { ruleChanges, type DraftRule, type RuleChanges } from './rule-changes';

const saved = [
  {
    rule_id: 'a',
    position: 1,
    match_type: 'prefix' as const,
    value: '/services/',
    tier: { tier_id: 't1', code: 'T1', name: 'Money pages' },
  },
  {
    rule_id: 'b',
    position: 2,
    match_type: 'pattern' as const,
    value: '/blog/*',
    tier: { tier_id: 't3', code: 'T3', name: 'Content pages' },
  },
];
const draft = (rule: Partial<DraftRule> & Pick<DraftRule, 'key'>): DraftRule => ({
  ruleId: null,
  matchType: 'exact',
  value: '/',
  tierId: 't1',
  ...rule,
});

describe('ruleChanges (decision W15)', () => {
  it('finds nothing to do for an unchanged list', () => {
    const same = saved.map((rule) =>
      draft({
        key: rule.rule_id,
        ruleId: rule.rule_id,
        matchType: rule.match_type,
        value: rule.value,
        tierId: rule.tier.tier_id,
      }),
    );
    expect(ruleChanges(saved, same)).toEqual({ deletes: [], patches: [], creates: [] });
  });

  it('deletes, then patches with the new positions, then creates', () => {
    const next = [
      draft({ key: 'n', matchType: 'exact', value: '/pricing', tierId: 't1' }),
      draft({ key: 'b', ruleId: 'b', matchType: 'pattern', value: '/blog/*', tierId: 't2' }),
    ];
    expect(ruleChanges(saved, next)).toEqual({
      deletes: ['a'],
      patches: [{ ruleId: 'b', body: { tier_id: 't2', position: 2 } }],
      creates: [{ match_type: 'exact', value: '/pricing', tier_id: 't1', position: 1 }],
    });
  });

  it('trims the value it sends', () => {
    const next = [draft({ key: 'n', matchType: 'prefix', value: '  /x/ ', tierId: 't1' })];
    expect(ruleChanges([], next).creates).toEqual([{ match_type: 'prefix', value: '/x/', tier_id: 't1', position: 1 }]);
  });

  it('does not send a rule whose only difference is spaces around the path', () => {
    const next = [draft({ key: 'a', ruleId: 'a', matchType: 'prefix', value: ' /services/ ', tierId: 't1' })];
    expect(ruleChanges(saved.slice(0, 1), next)).toEqual({ deletes: [], patches: [], creates: [] });
  });
});

/** The API's rules as the backend keeps them: delete closes the gap, create inserts, a move shifts the others. */
function replay(start: readonly string[], changes: RuleChanges, created: readonly string[]): string[] {
  let list = start.filter((id) => !changes.deletes.includes(id));
  for (const patch of changes.patches) {
    const at = list.indexOf(patch.ruleId);
    list.splice(at, 1);
    const target = Math.min(Math.max((patch.body.position ?? at + 1) - 1, 0), list.length);
    list.splice(target, 0, patch.ruleId);
  }
  changes.creates.forEach((create, index) => {
    const target = Math.min(create.position - 1, list.length);
    list = [...list.slice(0, target), created[index] ?? '?', ...list.slice(target)];
  });
  return list;
}

function* permutations<T>(items: readonly T[]): Generator<T[]> {
  if (items.length <= 1) {
    yield [...items];
    return;
  }
  for (const [index, item] of items.entries()) {
    for (const rest of permutations([...items.slice(0, index), ...items.slice(index + 1)])) yield [item, ...rest];
  }
}

describe('ruleChanges replayed against the API order', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const savedList = ids.map((id, index) => ({
    rule_id: id,
    position: index + 1,
    match_type: 'prefix' as const,
    value: `/${id}/`,
    tier: { tier_id: 't1', code: 'T1', name: 'x' },
  }));

  it('ends in the draft order for every order, with rules removed and added', () => {
    const everything = ['a', 'b', 'c', 'd', 'n1', 'n2'];
    for (const order of permutations(everything)) {
      // The draft keeps a, b, c (and d on half of the orders) and adds n1 and n2
      for (const dropD of [false, true]) {
        const kept = order.filter((id) => !(dropD && id === 'd'));
        const next = kept.map((id) =>
          draft({ key: id, ruleId: id.startsWith('n') ? null : id, matchType: 'prefix', value: `/${id}/` }),
        );
        const changes = ruleChanges(savedList, next);
        const created = changes.creates.map((create) => create.value);
        const result = replay(ids, changes, created).map((id) => (id.startsWith('/') ? id.slice(1, -1) : id));
        expect(result).toEqual(kept);
      }
    }
  });
});
