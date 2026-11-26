import { describe, expect, it } from 'vitest';

import { useMonitoringColumns, type MonitoringColumnContext } from './monitoring-columns';
import type { TrackedPageRow } from '../types';
import type { PageTier } from '@/lib/internal-links/types';
import { renderWithProviders } from '@/test/render';

const tier = (tier_id: string, code: string): PageTier =>
  ({
    tier_id,
    code,
    name: 'Name',
    label: `${code} Name`,
    description: '',
    page_count: 0,
    position: 1,
    rule_count: 0,
  }) as PageTier;

const CONTEXT: MonitoringColumnContext = {
  tiers: [tier('t1', 'T1'), tier('bad', 'Tier one')],
  days: { current: 31, before: 30 },
  pending: false,
  cannibalizationHref: null,
  showCannibalization: false,
};

const pageIn = (tier_id: string | null): TrackedPageRow => ({ tier_id }) as TrackedPageRow;

function sortValueOfTier(row: TrackedPageRow): string | number | null | undefined {
  let value: string | number | null | undefined;
  function Probe(): null {
    value = useMonitoringColumns(CONTEXT)
      .find((column) => column.id === 'tier')
      ?.sortValue?.(row);
    return null;
  }
  renderWithProviders(<Probe />);
  return value;
}

describe('useMonitoringColumns', () => {
  it('sorts a tier by its number', () => {
    expect(sortValueOfTier(pageIn('t1'))).toBe(1);
  });

  it('sorts a page whose tier code is not T and a number last, without throwing', () => {
    expect(sortValueOfTier(pageIn('bad'))).toBeNull();
  });
});
