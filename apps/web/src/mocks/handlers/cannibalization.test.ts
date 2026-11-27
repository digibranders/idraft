import { describe, expect, it } from 'vitest';

import { mockKeywordRows, mockPeriod } from './cannibalization';

describe('the Cannibalization mock', () => {
  const desktop = { device: 'desktop', days: 30, group: null } as const;

  it('gives a strip as long as the period', () => {
    for (const days of [14, 30, 90] as const) {
      const rows = mockKeywordRows({ ...desktop, days });
      expect(rows.every((row) => row.strip.length === days)).toBe(true);
    }
    expect(mockPeriod(14)).toEqual({ from: '2026-11-13', to: '2026-11-26' });
  });

  it('differs between desktop and mobile', () => {
    const desk = mockKeywordRows(desktop);
    const phone = mockKeywordRows({ ...desktop, device: 'mobile' });
    expect(phone.map((row) => row.verdict)).not.toEqual(desk.map((row) => row.verdict));
    expect(phone[0]?.current_rank).not.toBe(desk[0]?.current_rank);
    expect(phone.every((row) => row.device === 'mobile')).toBe(true);
  });

  it('keeps fewer keywords for a group', () => {
    const all = mockKeywordRows(desktop);
    const grouped = mockKeywordRows({ ...desktop, group: '11111111-1111-4111-8111-111111111111' });
    expect(grouped.length).toBeGreaterThan(0);
    expect(grouped.length).toBeLessThan(all.length);
  });
});
