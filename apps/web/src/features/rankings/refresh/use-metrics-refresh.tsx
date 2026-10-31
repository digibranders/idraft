'use client';

import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';

import { RefreshDialog, type RefreshTargets } from './refresh-dialog';
import {
  MAX_REFRESH_KEYWORDS,
  chosenKeywordIds,
  leftTheList,
  leftToday,
  uniqueKeywordIds,
  type SeenKeyword,
} from './refresh-model';
import {
  endedRefreshes,
  forgetOpenRefresh,
  rememberEndedRefresh,
  rememberRefreshRun,
  useOpenRefreshes,
} from './refresh-queries';
import { RefreshProgress } from './refresh-progress';
import { refreshKeywords, type KeywordList, type ProjectScope } from '../rankings-queries';
import type { MenuItemDef } from '@/components/ui/menu';
import { toast } from '@/components/ui/toast';
import type { RecordAction } from '@/components/app/data-table/types';
import { announce } from '@/lib/a11y/announcer';
import type { Run, TrackedKeywordRow } from '@/lib/api/types';
import { formatInteger } from '@/lib/format';
import { useMe } from '@/lib/session/use-me';

/** What opens the dialog: the More actions menu, or the bulk bar over the chosen keywords. */
type Source = 'menu' | 'bar';

const NO_ROWS: readonly TrackedKeywordRow[] = [];

/** No element to return focus to: the default applies, which is the bulk bar's button that opened it. */
const NO_FOCUS: RefObject<HTMLElement | null> = { current: null };

/** What the dialog shows before it has ever opened: nothing to refresh but the stale keywords. */
const CLOSED: RefreshTargets = { selection: null, matching: null, narrowed: false, allChosen: false };

export interface MetricsRefreshArgs {
  scope: ProjectScope;
  /** The member holds `runs:trigger`. Without it nothing is read and nothing is offered. */
  enabled: boolean;
  /** The Archived view: archived keywords are not refreshed. */
  archived: boolean;
  list: Pick<KeywordList, 'rows' | 'mode' | 'total' | 'loading' | 'stale' | 'fetching' | 'loadProgress' | 'incomplete'>;
  /** The table's selection, by tracked keyword id. */
  chosen: { ids: ReadonlySet<string>; allMatching: boolean };
  /** Filters or a search narrow the list. */
  narrowed: boolean;
  /** Where focus goes when the dialog closes after it was opened from the More actions menu. */
  menuButton: RefObject<HTMLElement | null>;
  /** Takes these tracked keywords out of the table's selection: they are not in the list any more. */
  onDrop: (trackedIds: ReadonlySet<string>) => void;
}

export interface MetricsRefresh {
  /** The More actions menu's item, or `null` when the member may not refresh. */
  menuItem: MenuItemDef | null;
  /** Said at the top of the menu while the day's manual runs are used up. */
  menuHeader: ReactNode;
  /** Reads the day's count again whenever the menu opens. */
  onMenuOpenChange: (open: boolean) => void;
  /** The bulk bar's action, or `null` outside the active view. */
  barAction: RecordAction<TrackedKeywordRow> | null;
  /** The runs the header follows, one bar each. */
  progress: ReactNode;
  dialog: ReactNode;
}

/** The tracked keywords seen so far by id, to the keyword each tracks: a chosen row may sit on another page. */
function useKeywordIndex(rows: readonly TrackedKeywordRow[]): ReadonlyMap<string, SeenKeyword> {
  const [seen, setSeen] = useState<{ rows: readonly TrackedKeywordRow[]; ids: ReadonlyMap<string, SeenKeyword> }>({
    rows: [],
    ids: new Map(),
  });
  // An empty list is made anew by every render of the list, so it never counts as a change
  if (rows.length > 0 && seen.rows !== rows) {
    const ids = new Map(seen.ids);
    for (const row of rows)
      ids.set(row.tracked_keyword_id, { keywordId: row.keyword.keyword_id, active: row.is_active });
    setSeen({ rows, ids });
  }
  return seen.ids;
}

/** Whether two sets of targets say the same, so the ones kept for the closing dialog are not replaced by an equal copy. */
function sameTargets(a: RefreshTargets, b: RefreshTargets): boolean {
  const sameList = (x: readonly string[] | null, y: readonly string[] | null): boolean =>
    x === y || (x !== null && y !== null && x.length === y.length && x.every((id, index) => id === y[index]));
  return (
    a.narrowed === b.narrowed &&
    a.allChosen === b.allChosen &&
    sameList(a.selection, b.selection) &&
    (a.matching === b.matching ||
      (a.matching !== null &&
        b.matching !== null &&
        a.matching.count === b.matching.count &&
        a.matching.why === b.matching.why &&
        sameList(a.matching.ids, b.matching.ids)))
  );
}

/** A list read to its end, which holds every keyword the filters match. */
const holdsEveryKeyword = (list: MetricsRefreshArgs['list']): boolean =>
  list.mode === 'client' && !list.loading && !list.stale && list.loadProgress === null && list.incomplete === null;

/**
 * Refresh metrics for Rankings (backend plan D9): the More actions item with the day's count, the dialog,
 * the header progress of each refresh under way (also those a reload found), and the bulk bar's action.
 */
export function useMetricsRefresh({
  scope,
  enabled,
  archived,
  list,
  chosen,
  narrowed,
  menuButton,
  onDrop,
}: MetricsRefreshArgs): MetricsRefresh {
  const t = useTranslations('rankings.refresh');
  const queryClient = useQueryClient();
  const { user } = useMe();
  const open = useOpenRefreshes(scope, user.user_id, enabled, 'keyword_metrics');
  const { refetch } = open;
  const manual = open.data?.manual ?? null;
  const left = manual === null ? null : leftToday(manual);
  const exhausted = left === 0;

  // The runs the header follows: those this page started, and those a read found open. A run that ended is
  // remembered, here and in the cache, so no later read of the open runs brings it back, nor does leaving
  // Rankings and coming back.
  const [started, setStarted] = useState<readonly string[]>([]);
  const [ended, setEnded] = useState<ReadonlySet<string>>(() => endedRefreshes(queryClient, scope, 'keyword_metrics'));
  const followed = [...started, ...(open.data?.runs ?? []).map((run) => run.run_id)].filter(
    (runId, index, all) => !ended.has(runId) && all.indexOf(runId) === index,
  );
  const onSettled = useCallback(
    (runId: string): void => {
      rememberEndedRefresh(queryClient, scope, runId, 'keyword_metrics');
      setEnded((previous) => new Set(previous).add(runId));
      setStarted((previous) => previous.filter((candidate) => candidate !== runId));
      forgetOpenRefresh(queryClient, scope, runId, 'keyword_metrics');
    },
    [queryClient, scope],
  );
  const onStarted = useCallback(
    (run: Run): void => {
      // The day's count has moved on, whatever became of the run
      void refetch();
      if (run.status === 'budget_blocked') {
        toast({ type: 'info', title: t('errors.budgetBlocked') });
        return;
      }
      rememberRefreshRun(queryClient, scope, run, 'keyword_metrics');
      setStarted((previous) => (previous.includes(run.run_id) ? previous : [...previous, run.run_id]));
      // The bar that shows the run says nothing when it first appears, only when its status changes
      announce(t('progress.started'));
    },
    [queryClient, scope, refetch, t],
  );

  const [opened, setOpened] = useState(false);
  const wasChosenRef = useRef(false);
  useEffect(() => {
    const isChosen = chosen.ids.size > 0;
    if (isChosen && !wasChosenRef.current && enabled) {
      void refetch();
    }
    wasChosenRef.current = isChosen;
  }, [chosen.ids.size, enabled, refetch]);
  // What opened the dialog last: kept after it closes, since the close is when focus goes back
  const [from, setFrom] = useState<Source>('menu');
  // A member who may not refresh keeps no index
  const keywordOf = useKeywordIndex(enabled ? list.rows : NO_ROWS);
  const live = useMemo((): RefreshTargets | null => {
    if (!opened) return null;
    const chosenKeywords = chosen.allMatching || chosen.ids.size === 0 ? null : chosenKeywordIds(chosen.ids, keywordOf);
    // Rows of the previous filters stay on screen while the new ones load: they name nothing to send
    const settled = !list.loading && !list.stale && list.loadProgress === null;
    const listed = holdsEveryKeyword(list);
    const ids = listed ? uniqueKeywordIds(list.rows) : null;
    const count = ids?.length ?? list.total ?? list.rows.length;
    return {
      selection: chosenKeywords,
      matching: {
        count,
        ids: ids !== null && ids.length <= MAX_REFRESH_KEYWORDS ? ids : null,
        why: !settled ? 'loading' : list.incomplete !== null ? 'incomplete' : ids === null ? 'too-many' : null,
      },
      narrowed,
      allChosen: chosen.allMatching,
    };
  }, [opened, chosen, narrowed, keywordOf, list]);
  // The dialog keeps what it showed while it closes: with the targets gone it would offer only the stale
  // keywords during the exit animation
  const [kept, setKept] = useState<RefreshTargets>(CLOSED);
  // Only a change of what is shown replaces what is kept: `live` is made anew by every render
  if (live !== null && !sameTargets(kept, live)) setKept(live);
  const targets = live ?? kept;

  // A keyword the API no longer knows: the list is read again, and the chosen keywords that left it are
  // dropped from the selection once it has answered, so a second try is not refused for the same keyword
  // The rows the list held when the API refused, and whether the list has been read again since. It is
  // looked at when the list has answered (`answers` moves the effect on), and only then.
  const rechecking = useRef<{ before: readonly TrackedKeywordRow[]; answered: boolean } | null>(null);
  const [answers, setAnswers] = useState(0);
  const onKeywordsUnknown = useCallback(
    (keywordIds: readonly string[]): void => {
      const named = new Set(keywordIds);
      const tracked = [...chosen.ids].filter((id) => named.has(keywordOf.get(id)?.keywordId ?? ''));
      if (tracked.length > 0) onDrop(new Set(tracked));
      const pending = { before: list.rows, answered: false };
      rechecking.current = pending;
      void refreshKeywords(queryClient, scope).then(() => {
        pending.answered = true;
        setAnswers((count) => count + 1);
      });
    },
    [chosen.ids, keywordOf, list.rows, onDrop, queryClient, scope],
  );
  useEffect(() => {
    const pending = rechecking.current;
    if (pending === null || !pending.answered || list.fetching) return;
    rechecking.current = null;
    // A list of one page can tell only about the rows that were on it; one that failed to load tells nothing
    const complete = holdsEveryKeyword(list);
    const gone =
      complete || (list.mode === 'server' && !list.loading)
        ? leftTheList(chosen.ids, pending.before, list.rows, complete)
        : [];
    if (gone.length > 0) onDrop(new Set(gone));
  }, [answers, list, chosen.ids, onDrop]);

  // Focus goes back to the More actions button after a dialog opened from its menu; the bulk bar stays where
  // it is, so the default applies to a dialog opened from there
  const finalFocus = from === 'menu' ? menuButton : NO_FOCUS;
  const openFrom = (source: Source) => (): void => {
    void refetch();
    setFrom(source);
    setOpened(true);
  };

  const limitText =
    manual === null ? null : t('left', { left: formatInteger(left ?? 0), limit: formatInteger(manual.limit) });
  const menuItem: MenuItemDef | null = enabled
    ? {
        id: 'refresh-metrics',
        label: t('menuItem'),
        icon: RefreshCw,
        ...(archived
          ? { disabledReason: t('archivedView') }
          : exhausted && limitText !== null
            ? // The menu header says when the limit resets, and is not focusable: the item says it too
              { disabledReason: limitText, description: t('limitReached') }
            : limitText !== null
              ? { detail: limitText }
              : {}),
        onSelect: openFrom('menu'),
      }
    : null;

  return {
    menuItem,
    menuHeader: enabled && exhausted && !archived ? <p className="type-meta">{t('limitReached')}</p> : undefined,
    onMenuOpenChange: (isOpen) => {
      if (isOpen && enabled) void refetch();
    },
    barAction:
      enabled && !archived
        ? {
            id: 'refresh-metrics',
            label: t('menuItem'),
            icon: RefreshCw,
            group: 'object',
            disabledReason: exhausted ? t('limitReached') : null,
            onSelect: openFrom('bar'),
          }
        : null,
    progress: followed.map((runId) => (
      <RefreshProgress key={runId} scope={scope} runId={runId} workload="keyword_metrics" onSettled={onSettled} />
    )),
    dialog: enabled ? (
      <RefreshDialog
        scope={scope}
        open={opened}
        onOpenChange={setOpened}
        finalFocus={finalFocus}
        targets={targets}
        manual={manual}
        onStart={() => void refetch()}
        onStarted={onStarted}
        onLimitReached={() => void refetch()}
        onKeywordsUnknown={onKeywordsUnknown}
      />
    ) : null,
  };
}
