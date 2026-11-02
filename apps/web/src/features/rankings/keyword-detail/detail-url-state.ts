'use client';

import { createParser, parseAsArrayOf, parseAsStringLiteral, useQueryState } from 'nuqs';

import { DEFAULT_WINDOW, WINDOW_KEYS, type DetailWindow } from './detail-window';
import { isUuid } from '@/lib/routes/paths';

/** The two tabs of the page (24-page-templates.md section 9.4, "Tabs, justified"). */
export const DETAIL_TABS = ['overview', 'snapshots'] as const;
export type DetailTab = (typeof DETAIL_TABS)[number];

/** The layers the chart can draw on top of the organic rank. */
export const CHART_LAYERS = ['absolute', 'events', 'deep'] as const;
export type ChartLayer = (typeof CHART_LAYERS)[number];

/** At most this many competitors on the chart (24 section 9.4: "Competitor overlays limited to 5"). */
export const MAX_CHART_COMPETITORS = 5;
/** The address says "no competitors" with this word, so that an empty choice differs from the default set. */
const NO_COMPETITORS = 'none';

/** `comp`: competitor ids (uuids only, five at most) or `none`; null (absent) is the default set. */
const parseAsCompetitors = createParser<string[]>({
  parse: (value) =>
    value === NO_COMPETITORS ? [] : [...new Set(value.split(',').filter(isUuid))].slice(0, MAX_CHART_COMPETITORS),
  serialize: (ids) => (ids.length === 0 ? NO_COMPETITORS : ids.slice(0, MAX_CHART_COMPETITORS).join(',')),
  eq: (a, b) => a.length === b.length && a.every((id, index) => id === b[index]),
});

export interface DetailUrlState {
  tab: DetailTab;
  setTab: (tab: DetailTab) => Promise<URLSearchParams>;
  win: DetailWindow;
  setWin: (win: DetailWindow) => Promise<URLSearchParams>;
  /** The chosen competitor overlays; null is the default (the first five by name). */
  comp: string[] | null;
  setComp: (ids: readonly string[] | null) => Promise<URLSearchParams>;
  show: ChartLayer[];
  setShow: (layers: readonly ChartLayer[]) => Promise<URLSearchParams>;
}

/**
 * The page's state in the URL (13-filters-search.md section 5, Decision 4 of the plan). Later tasks add
 * their keys here: all go through this one hook, so a link restores the page. An unknown value falls back to
 * the default and never throws; the default is left out of the address.
 */
export function useDetailUrlState(): DetailUrlState {
  const [tab, setTab] = useQueryState(
    'tab',
    parseAsStringLiteral(DETAIL_TABS).withDefault('overview').withOptions({ history: 'push', clearOnDefault: true }),
  );
  const [win, setWin] = useQueryState(
    'win',
    parseAsStringLiteral(WINDOW_KEYS)
      .withDefault(DEFAULT_WINDOW)
      .withOptions({ history: 'replace', clearOnDefault: true }),
  );
  const [comp, setComp] = useQueryState('comp', parseAsCompetitors.withOptions({ history: 'replace' }));
  const [show, setShow] = useQueryState(
    'show',
    parseAsArrayOf(parseAsStringLiteral(CHART_LAYERS)).withDefault([]).withOptions({
      history: 'replace',
      clearOnDefault: true,
    }),
  );
  return {
    tab,
    setTab: (next) => setTab(next),
    win,
    setWin: (next) => setWin(next),
    comp,
    setComp: (ids) => setComp(ids === null ? null : [...ids]),
    show,
    setShow: (layers) => setShow([...layers]),
  };
}
