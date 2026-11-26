'use client';

import { parseAsString, parseAsStringLiteral, useQueryStates } from 'nuqs';
import { useCallback, useMemo } from 'react';

import type { CompareParam, MetricKey } from '../types';
import type { DateRangeValue } from '@/components/app/date-range/range-model';

/** The address keys of the panel (spec D20). The shell hands them to `useInspector({ entryKeys })`, so closing the drawer removes them. */
export const PAGE_SEARCH_KEYS = ['sp_win', 'sp_from', 'sp_to', 'sp_cmp', 'sp_m', 'sp_tab'] as const;

export const METRICS: readonly MetricKey[] = ['clicks', 'impressions', 'ctr', 'position'];
export const DEFAULT_METRICS: readonly MetricKey[] = ['clicks', 'impressions'];
export const PANEL_TABS = ['queries', 'locations', 'devices'] as const;
export type PanelTab = (typeof PANEL_TABS)[number];

const COMPARE_VALUES = ['year', 'off'] as const;
const PARSERS = {
  sp_win: parseAsString,
  sp_from: parseAsString,
  sp_to: parseAsString,
  sp_cmp: parseAsStringLiteral(COMPARE_VALUES),
  sp_m: parseAsString,
  sp_tab: parseAsStringLiteral(PANEL_TABS),
};

const compareOf = (value: (typeof COMPARE_VALUES)[number] | null): CompareParam =>
  value === 'year' ? 'previous_year' : value === 'off' ? 'none' : 'previous_period';

const compareKey = (compare: CompareParam): (typeof COMPARE_VALUES)[number] | null =>
  compare === 'previous_year' ? 'year' : compare === 'none' ? 'off' : null;

/** The ticked metrics of an address value, in the order of `METRICS`; anything unreadable is the default. */
export function metricsOf(text: string | null): readonly MetricKey[] {
  if (text === null) return DEFAULT_METRICS;
  const asked = text.split(',');
  const ticked = METRICS.filter((metric) => asked.includes(metric));
  return ticked.length === 0 ? DEFAULT_METRICS : ticked;
}

export interface PanelState {
  /** `sp_win`, `sp_from` or `sp_to` is in the address: the period is the person's, not the default month. */
  hasPeriod: boolean;
  address: { win: string | null; from: string | null; to: string | null };
  /** Writes `sp_win` for a preset (the 28 day one too: the default of this panel is a month, not 28 days) or `sp_from` and `sp_to`. */
  setPeriod: (value: DateRangeValue) => void;
  compare: CompareParam;
  setCompare: (compare: CompareParam) => void;
  metrics: readonly MetricKey[];
  /** Ticks or unticks a metric; the last ticked one stays. */
  toggleMetric: (metric: MetricKey) => void;
  tab: PanelTab;
  setTab: (tab: PanelTab) => void;
}

/** What the panel keeps in the address; defaults write nothing. */
export function usePanelState(): PanelState {
  const [state, setState] = useQueryStates(PARSERS, { history: 'replace' });
  const metrics = useMemo(() => metricsOf(state.sp_m), [state.sp_m]);

  const setPeriod = useCallback(
    (value: DateRangeValue): void => {
      void setState(
        value.kind === 'preset'
          ? { sp_win: value.preset, sp_from: null, sp_to: null }
          : { sp_win: null, sp_from: value.from, sp_to: value.to },
      );
    },
    [setState],
  );
  const setCompare = useCallback(
    (compare: CompareParam): void => {
      void setState({ sp_cmp: compareKey(compare) });
    },
    [setState],
  );
  const toggleMetric = useCallback(
    (metric: MetricKey): void => {
      const next = metrics.includes(metric)
        ? metrics.filter((one) => one !== metric)
        : METRICS.filter((one) => one === metric || metrics.includes(one));
      if (next.length === 0) return;
      const isDefault = next.length === DEFAULT_METRICS.length && next.every((one, i) => one === DEFAULT_METRICS[i]);
      void setState({ sp_m: isDefault ? null : next.join(',') });
    },
    [metrics, setState],
  );
  const setTab = useCallback(
    (tab: PanelTab): void => {
      void setState({ sp_tab: tab === 'queries' ? null : tab });
    },
    [setState],
  );

  return {
    hasPeriod: state.sp_win !== null || state.sp_from !== null || state.sp_to !== null,
    address: { win: state.sp_win, from: state.sp_from, to: state.sp_to },
    setPeriod,
    compare: compareOf(state.sp_cmp),
    setCompare,
    metrics,
    toggleMetric,
    tab: state.sp_tab ?? 'queries',
    setTab,
  };
}
