'use client';

import { useTranslations } from 'next-intl';
import { useMemo, useState, type ReactNode } from 'react';

import { useCollectionDaily, type CollectionDaily } from '../data/activity-reads';
import { engineDays, engineTabs, isRunDay, totalsOf, type DayCounts } from '../model/status-model';
import { EngineTabs } from './engine-tabs';
import { useErrorState, useStaleNotice, type FrameState } from './frame-state';
import type { EngineDays } from './daily-table';
import { askedEngines } from '../../../data/overview-queries';
import type { Read } from '../../../data/read-state';
import { useOverview } from '../../../overview-context';
import { engineLabel } from '../../engines/engine-role';
import { announce } from '@/lib/a11y/announcer';
import type { EngineCode } from '@/lib/api/types';
import { formatDateRange, formatInteger } from '@/lib/format';

/**
 * What the two cards of the collection days (the calendar and the status chart) do the same way: read the days once,
 * keep one engine chosen, and say what state the card is in. A card takes the facts it draws from here and adds its own
 * words. The cards share their read (one request), but each keeps its own choice of engine.
 */
export interface DailyCard {
  read: Read<CollectionDaily>;
  /** The engines of the tabs, asked ones first; the first is the one the card opens on. */
  tabs: readonly EngineCode[];
  /** The engine shown; `null` until the days are read. */
  engine: EngineCode | null;
  engineName: string;
  /** Every day of the engine in the window, oldest first. */
  days: readonly DayCounts[];
  /** The days with a schedule, an answer or a blocked run. */
  runDays: readonly DayCounts[];
  /** The run days of every engine, for the export. */
  allRunDays: readonly EngineDays[];
  totals: ReturnType<typeof totalsOf>;
  frame: FrameState;
  /** The engine tabs, once the days are read. */
  controls: ReactNode;
  /** "Nov 2 to Nov 15, 2026, ChatGPT: 2,222 of 2,250 answers collected are valid"; `null` until there are days to show. */
  meta: string | null;
  /** The days to show are of the engine chosen: the frame is ready or refetching. */
  shown: boolean;
}

const NO_DAYS: readonly DayCounts[] = [];

export function useDailyCard(live: boolean, subject: string): DailyCard {
  const t = useTranslations('aiOverview.activity.daily');
  const { scope, enabledEngines, engines } = useOverview();
  const read = useCollectionDaily({ subscribed: live });
  const [chosen, setChosen] = useState<EngineCode | null>(null);
  const response = read.data;

  const asked = useMemo(() => askedEngines({ scope, enabledEngines }), [scope, enabledEngines]);
  const tabs = useMemo(
    () => (response === undefined ? [] : engineTabs(response.meta.engine_codes, asked)),
    [response, asked],
  );
  const engine = chosen !== null && tabs.includes(chosen) ? chosen : (tabs[0] ?? null);
  const nameOf = (code: EngineCode): string => engineLabel(code) ?? code;
  const engineName = engine === null ? '' : nameOf(engine);

  const perEngine = useMemo(
    () =>
      tabs.map((code) => {
        const days = response === undefined ? NO_DAYS : engineDays(response.data, code);
        return { code, days, run: days.filter(isRunDay) };
      }),
    [tabs, response],
  );
  const current = perEngine.find((entry) => entry.code === engine);
  const days = current?.days ?? NO_DAYS;
  const runDays = current?.run ?? NO_DAYS;
  const totals = totalsOf(days);
  const allRunDays = perEngine.map((entry): EngineDays => ({ label: nameOf(entry.code), days: entry.run }));

  const error = useErrorState(engines.status === 'error' ? engines : read, subject);
  const stale = useStaleNotice(read.stale);
  const enginesKnown = engines.data !== undefined;
  let frame: FrameState;
  if (engines.status === 'error' || read.status === 'error') {
    frame = { status: 'error', error };
  } else if (enginesKnown && asked.length === 0) {
    frame = { status: 'empty', empty: { title: t('noEngineTitle'), reason: t('noEngineReason') } };
  } else if (response === undefined) {
    // A read that has not run yet (the engines are not known, or the card is paused) is loading, not empty
    frame = { status: 'loading' };
  } else if (perEngine.every((entry) => entry.run.length === 0)) {
    frame = { status: 'empty', empty: { title: t('noDaysTitle'), reason: t('noDaysReason') } };
  } else if (runDays.length === 0) {
    frame = {
      status: 'empty',
      empty: { title: t('noEngineDaysTitle', { engine: engineName }), reason: t('noEngineDaysReason') },
    };
  } else {
    frame = { status: read.status === 'refetching' ? 'refetching' : 'ready', notice: stale };
  }
  const shown = frame.status === 'ready' || frame.status === 'refetching';

  const choose = (code: EngineCode): void => {
    setChosen(code);
    const answers = totalsOf(perEngine.find((entry) => entry.code === code)?.days ?? NO_DAYS).answers;
    announce(t('announceEngine', { engine: nameOf(code), answers: formatInteger(answers) }), {
      key: 'activity-daily-engine',
    });
  };
  const controls: ReactNode =
    response === undefined || engine === null ? null : (
      <EngineTabs
        engines={perEngine.map((entry) => ({
          code: entry.code,
          label: nameOf(entry.code),
          countText: formatInteger(totalsOf(entry.days).answers),
        }))}
        value={engine}
        onChange={choose}
      />
    );
  const meta =
    response === undefined || !shown
      ? null
      : t('meta', {
          window: formatDateRange(response.meta.window.from, response.meta.window.to),
          engine: engineName,
          valid: formatInteger(totals.valid),
          answers: formatInteger(totals.answers),
        });

  return { read, tabs, engine, engineName, days, runDays, allRunDays, totals, frame, controls, meta, shown };
}
