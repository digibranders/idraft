'use client';

import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo, useState, type ReactNode, type RefObject } from 'react';

import { RefreshDialog, type RefreshTargets } from './refresh-dialog';
import { MAX_REFRESH_KEYWORDS, leftToday, uniqueKeywordIds } from './refresh-model';
import { forgetOpenRefresh, rememberRefreshRun, useOpenRefreshes } from './refresh-queries';
import { RefreshProgress } from './refresh-progress';
import type { KeywordList, ProjectScope } from '../rankings-queries';
import type { MenuItemDef } from '@/components/ui/menu';
import { toast } from '@/components/ui/toast';
import type { RecordAction } from '@/components/app/data-table/types';
import type { Run, TrackedKeywordRow } from '@/lib/api/types';
import { formatInteger } from '@/lib/format';

/** What opens the dialog: the More actions menu, or the bulk bar over the chosen keywords. */
type Source = 'menu' | 'bar';

const NO_ROWS: readonly TrackedKeywordRow[] = [];

/** No element to return focus to: the default applies, which is the bulk bar's button that opened it. */
const NO_FOCUS: RefObject<HTMLElement | null> = { current: null };

export interface MetricsRefreshArgs {
  scope: ProjectScope;
  /** The member holds `runs:trigger`. Without it nothing is read and nothing is offered. */
  enabled: boolean;
  /** The Archived view: archived keywords are not refreshed. */
  archived: boolean;
  list: Pick<KeywordList, 'rows' | 'mode' | 'total' | 'loading' | 'loadProgress' | 'incomplete'>;
  /** The table's selection, by tracked keyword id. */
  chosen: { ids: ReadonlySet<string>; allMatching: boolean };
  /** Filters or a search narrow the list. */
  narrowed: boolean;
  /** Where focus goes when the dialog closes after it was opened from the More actions menu. */
  menuButton: RefObject<HTMLElement | null>;
}

export interface MetricsRefresh {
  /** The More actions menu's item, or `null` when the member may not refresh. */
  menuItem: MenuItemDef | null;
  /** Said at the top of the menu while the day's refreshes are used up. */
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
function useKeywordIndex(rows: readonly TrackedKeywordRow[]): ReadonlyMap<string, string> {
  const [seen, setSeen] = useState<{ rows: readonly TrackedKeywordRow[]; ids: ReadonlyMap<string, string> }>({
    rows: [],
    ids: new Map(),
  });
  // An empty list is made anew by every render of the list, so it never counts as a change
  if (rows.length > 0 && seen.rows !== rows) {
    const ids = new Map(seen.ids);
    for (const row of rows) ids.set(row.tracked_keyword_id, row.keyword.keyword_id);
    setSeen({ rows, ids });
  }
  return seen.ids;
}

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
}: MetricsRefreshArgs): MetricsRefresh {
  const t = useTranslations('rankings.refresh');
  const queryClient = useQueryClient();
  const open = useOpenRefreshes(scope, enabled);
  const { refetch } = open;
  const manual = open.data?.manual ?? null;
  const left = manual === null ? null : leftToday(manual);
  const exhausted = left === 0;

  // The runs the header follows: those this page started, and those a read found open. A run that ended is
  // remembered, so no later read of the open runs brings it back.
  const [started, setStarted] = useState<readonly string[]>([]);
  const [ended, setEnded] = useState<ReadonlySet<string>>(new Set());
  const followed = [...started, ...(open.data?.runs ?? []).map((run) => run.run_id)].filter(
    (runId, index, all) => !ended.has(runId) && all.indexOf(runId) === index,
  );
  const onSettled = useCallback(
    (runId: string): void => {
      setEnded((previous) => new Set(previous).add(runId));
      setStarted((previous) => previous.filter((candidate) => candidate !== runId));
      forgetOpenRefresh(queryClient, scope, runId);
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
      rememberRefreshRun(queryClient, scope, run);
      setStarted((previous) => (previous.includes(run.run_id) ? previous : [...previous, run.run_id]));
    },
    [queryClient, scope, refetch, t],
  );

  const [opened, setOpened] = useState(false);
  // What opened the dialog last: kept after it closes, since the close is when focus goes back
  const [from, setFrom] = useState<Source>('menu');
  // A member who may not refresh keeps no index
  const keywordOf = useKeywordIndex(enabled ? list.rows : NO_ROWS);
  const targets = useMemo((): RefreshTargets => {
    if (!opened) return { selection: null, matching: null, narrowed, allChosen: false };
    const chosenKeywords =
      chosen.allMatching || chosen.ids.size === 0
        ? null
        : [...new Set([...chosen.ids].flatMap((id) => keywordOf.get(id) ?? []))];
    const listed = list.mode === 'client' && !list.loading && list.loadProgress === null && list.incomplete === null;
    const ids = listed ? uniqueKeywordIds(list.rows) : null;
    const count = ids?.length ?? list.total ?? list.rows.length;
    return {
      selection: chosenKeywords,
      matching: {
        count,
        ids: ids !== null && ids.length <= MAX_REFRESH_KEYWORDS ? ids : null,
        why: ids === null ? (list.mode === 'server' ? 'too-many' : 'loading') : null,
      },
      narrowed,
      allChosen: chosen.allMatching,
    };
  }, [opened, chosen, narrowed, keywordOf, list]);

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
            ? { disabledReason: limitText }
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
      <RefreshProgress key={runId} scope={scope} runId={runId} onSettled={onSettled} />
    )),
    dialog: enabled ? (
      <RefreshDialog
        scope={scope}
        open={opened}
        onOpenChange={setOpened}
        finalFocus={finalFocus}
        targets={targets}
        manual={manual}
        onStarted={onStarted}
        onLimitReached={() => void refetch()}
      />
    ) : null,
  };
}
