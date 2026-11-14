import { describe, expect, it } from 'vitest';

import { domainRows } from './domain-rows';
import { roleGroups, ROLE_ORDER } from './role-groups';
import { at, domainPage, domainRow, sourcesMeta } from './source-fixtures';
import type { DomainRole } from '@/lib/citations/types';

/** Four listed domains of 18,420 units in scope: the roles hold 3,000, 2,400 and 13,020 of them. */
function figures(byRole: Partial<Record<DomainRole, number>> = { own: 3000, competitor: 2400, third_party: 13020 }) {
  const total = 18420;
  const page = domainPage(
    [
      domainRow({ domain: 'g2.com', units: 1912, total }),
      domainRow({ domain: 'fynix.com', role: 'own', units: 1500, total }),
      domainRow({ domain: 'capterra.com', units: 1300, total }),
      domainRow({ domain: 'hubspot.com', role: 'competitor', units: 900, total, entityId: 'e-2' }),
    ],
    sourcesMeta({ units: total, byRole }),
    40,
  );
  return { rows: domainRows(page, null), meta: page.meta };
}

describe('roleGroups', () => {
  it('lists the three roles in the order own, competitor, third party, each with the rows of its role in route order', () => {
    const { rows, meta } = figures();
    const { groups } = roleGroups(rows, meta);
    expect(ROLE_ORDER).toEqual(['own', 'competitor', 'third_party']);
    expect(groups.map((group) => group.role)).toEqual(['own', 'competitor', 'third_party']);
    expect(groups.map((group) => group.rows.map((row) => row.domain))).toEqual([
      ['fynix.com'],
      ['hubspot.com'],
      ['g2.com', 'capterra.com'],
    ]);
  });

  it('takes the units of a role from the scope, its share over every unit in scope, and what the listed rows leave', () => {
    const { rows, meta } = figures();
    const { groups } = roleGroups(rows, meta);
    const third = at(groups, 2);
    expect(third.units).toBe(13020);
    expect(third.share).toEqual({ value: 13020 / 18420, units: 13020, total: 18420 });
    expect(third.listedUnits).toBe(3212);
    expect(third.remainderUnits).toBe(9808);
    expect(third.atLeast).toBe(false);
  });

  it('accounts for every citation unit of the scope: listed units and the remainders of the roles add up to the total', () => {
    const { rows, meta } = figures();
    const { groups } = roleGroups(rows, meta);
    const accounted = groups.reduce((sum, group) => sum + group.listedUnits + group.remainderUnits, 0);
    expect(accounted).toBe(meta.citation_units);
    expect(groups.reduce((sum, group) => sum + group.units, 0)).toBe(meta.citation_units);
  });

  it('says at least when the read does not give the role total: the listed units are all it shows', () => {
    const full = figures();
    const meta = { ...full.meta, by_role: full.meta.by_role.filter((entry) => entry.domain_role !== 'competitor') };
    const { groups } = roleGroups(full.rows, meta);
    expect(at(groups, 1)).toMatchObject({ units: 900, listedUnits: 900, remainderUnits: 0, atLeast: true });
    expect(at(groups, 0).atLeast).toBe(false);
  });

  it('says at least when the role total is under what its listed rows hold, and never a negative remainder', () => {
    const { rows, meta } = figures({ own: 1200, competitor: 2400, third_party: 13020 });
    const own = at(roleGroups(rows, meta).groups, 0);
    expect(own).toMatchObject({ units: 1500, remainderUnits: 0, atLeast: true });
  });

  it('keeps a domain that matched two roles under both of them', () => {
    const page = domainPage(
      [
        domainRow({ domain: 'medium.com', role: 'third_party', units: 60, total: 1000 }),
        domainRow({ domain: 'medium.com', role: 'competitor', units: 40, total: 1000, entityId: 'e-2' }),
      ],
      sourcesMeta({ units: 1000, byRole: { own: 100, competitor: 200, third_party: 700 } }),
    );
    const { groups } = roleGroups(domainRows(page, null), page.meta);
    expect(groups.map((group) => group.rows.map((row) => row.domain))).toEqual([[], ['medium.com'], ['medium.com']]);
  });

  it('gives a role that no unit belongs to as a known zero with no rows, not as unknown', () => {
    const { rows, meta } = figures({ own: 3000, competitor: 0, third_party: 15420 });
    const none = roleGroups(
      rows.filter((row) => row.role !== 'competitor'),
      meta,
    ).groups[1];
    expect(none).toMatchObject({ units: 0, listedUnits: 0, remainderUnits: 0, atLeast: false, rows: [] });
    expect(none?.share.value).toBe(0);
  });

  it('gives a share over no unit in scope as null, never 0', () => {
    const page = domainPage([], sourcesMeta({ units: 0, byRole: {} }));
    const { groups } = roleGroups([], page.meta);
    for (const group of groups) expect(group.share.value).toBeNull();
  });
});
