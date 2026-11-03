'use client';

import { createParser, parseAsArrayOf, parseAsStringLiteral, useQueryState } from 'nuqs';

import { DEFAULT_WINDOW, WINDOW_KEYS, type DetailWindow } from './detail-window';
import { EVENT_KINDS, type EventKind } from './events-model';
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

/**
 * `obs` and `vs`: a SERP snapshot id. The API types the id in a path as a number, so only decimal integer
 * text that a number holds exactly is read; anything else is dropped like an unknown tab.
 * shortcut: ids above 2^53 are refused, when the ids grow that far the path parameter must go as text.
 */
const parseAsSnapshotId = createParser<string>({
  parse: (value) => (/^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) ? value : null),
  serialize: (id) => id,
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
  /** The SERP snapshot shown; null is the latest check. */
  obs: string | null;
  setObs: (id: string | null) => Promise<URLSearchParams>;
  /** The snapshot it is compared with; null is no comparison. */
  vs: string | null;
  setVs: (id: string | null) => Promise<URLSearchParams>;
  /** The kinds of the events feed; every kind (the default, no key in the address) when none is chosen. */
  events: EventKind[];
  setEvents: (kinds: readonly EventKind[]) => Promise<URLSearchParams>;
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
  const [obs, setObs] = useQueryState('obs', parseAsSnapshotId.withOptions({ history: 'push' }));
  const [vs, setVs] = useQueryState('vs', parseAsSnapshotId.withOptions({ history: 'push' }));
  const [events, setEvents] = useQueryState(
    'events',
    parseAsArrayOf(parseAsStringLiteral(EVENT_KINDS))
      .withDefault([...EVENT_KINDS])
      .withOptions({
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
    obs,
    setObs: (id) => setObs(id),
    vs,
    setVs: (id) => setVs(id),
    // Nothing chosen (an address with only unknown kinds) shows every kind: an empty feed would be a lie
    events: events.length === 0 ? [...EVENT_KINDS] : events,
    setEvents: (kinds) => setEvents(kinds.length === 0 ? [...EVENT_KINDS] : [...kinds]),
  };
}
