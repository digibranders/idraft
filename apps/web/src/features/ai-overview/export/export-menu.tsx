'use client';

import { Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState, type ReactElement } from 'react';

import { buildAggregates, type OverviewAggregates } from '../data/aggregates';
import { askedEngines } from '../data/overview-queries';
import type { Read } from '../data/read-state';
import { useOverview, useOverviewFanout, useOverviewSources, useOverviewSummary } from '../overview-context';
import { buildNumbersTable, exportFileName, numbersCsv } from './export-model';
import { useExportBlocks } from './export-registry';
import { usePageShortcuts } from '@/components/app/shell/page-shortcuts';
import { Button } from '@/components/ui/button';
import { Menu } from '@/components/ui/menu';
import { toast } from '@/components/ui/toast';
import { useShortcut } from '@/lib/a11y/use-shortcut';
import { csvBlob, downloadBlob } from '@/lib/csv/csv-write';

const NUMBERS_ITEM = 'numbers';
/** The key of the Export menu in the shortcuts dialog. */
const EXPORT_SHORTCUT = 'ai-overview-export';

type Unavailable = 'waiting' | 'unavailable' | 'noEngine';
/** The words of the note for a read that failed: its rows are `unread` and empty, and the note says why. */
type FailedRead = 'citationShareFailed' | 'fanoutFailed';

/** The data of a read for this scope: not what the last scope left behind while this one is read. */
const dataOf = <T,>(read: Read<T>): T | null => (read.placeholder ? null : (read.data ?? null));
const pending = (read: Read<unknown>): boolean => read.status === 'loading' || read.placeholder;

/**
 * The aggregates the strip is made from, for the file: the same summary read (one request), and the sources and the
 * fan-out. The strip only reads those two while the layout has a number that needs them, so the menu reads them
 * itself once it is open (`subscribed: open`; the cache answers when the strip asked): the item waits until they
 * have settled, and a read that failed leaves its rows `unread` and empty with a note that says so, so a person
 * can tell a number that failed from one that was not loaded.
 */
function useExportAggregates(open: boolean): {
  aggregates: OverviewAggregates | null;
  unavailable: Unavailable | null;
  failed: readonly FailedRead[];
} {
  const { scope, engines, enabledEngines } = useOverview();
  const summary = useOverviewSummary();
  const sources = useOverviewSources({ subscribed: open });
  const fanout = useOverviewFanout({ subscribed: open });
  const sourcesData = dataOf(sources);
  const fanoutData = dataOf(fanout);
  const aggregates = useMemo(
    () =>
      summary.data === undefined || engines.data === undefined
        ? null
        : buildAggregates({
            current: summary.data,
            previous: null,
            engines: engines.data,
            chosenEngines: scope.engines,
            // Only the count of topics depends on it, and the file has no count of topics
            topicsKept: null,
            sources: sourcesData,
            fanout: fanoutData,
          }),
    [summary.data, engines.data, scope.engines, sourcesData, fanoutData],
  );
  let unavailable: Unavailable | null = null;
  if (engines.status === 'error') unavailable = 'unavailable';
  else if (engines.status === 'loading') unavailable = 'waiting';
  else if (askedEngines({ scope, enabledEngines }).length === 0) unavailable = 'noEngine';
  else if (summary.status === 'error') unavailable = 'unavailable';
  // The last scope's figures are kept on screen while this one is read: they are not this scope's numbers
  else if (aggregates === null || summary.placeholder || !aggregates.rowsRead) unavailable = 'waiting';
  else if (open && (pending(sources) || pending(fanout))) unavailable = 'waiting';
  const failed: FailedRead[] = [];
  if (sources.status === 'error') failed.push('citationShareFailed');
  if (fanout.status === 'error') failed.push('fanoutFailed');
  return { aggregates, unavailable, failed };
}

/**
 * Export in the page header (WP-33 plan T11): a secondary button with a menu whose one item, Numbers (CSV), writes
 * the strip as the page reads it, followed by the table of every card that has told the page of one
 * (`useExportBlock`). The cards are read when the item runs, not while the page renders. The toast counts the rows
 * of data (the numbers and the rows of the cards), not the blank lines, the headers of the blocks or the notes. `e`
 * opens the menu.
 */
export function ExportMenu(): ReactElement {
  const t = useTranslations('aiOverview.export');
  const shortcuts = useTranslations('aiOverview.shortcuts');
  const { project, scope } = useOverview();
  const readBlocks = useExportBlocks();
  const [open, setOpen] = useState(false);
  const { aggregates, unavailable, failed } = useExportAggregates(open);
  useShortcut('e', () => setOpen(true), { kind: 'single-key' });
  const shortcutEntries = useMemo(
    () => [{ id: EXPORT_SHORTCUT, label: shortcuts('export'), keys: ['e'] }],
    [shortcuts],
  );
  usePageShortcuts(shortcutEntries);

  const exportNumbers = (): void => {
    if (aggregates === null) return;
    try {
      const { blocks, loading } = readBlocks();
      const table = numbersCsv(aggregates, scope, project, {
        notes: { unknownIsEmpty: t('notes.unknownIsEmpty'), pooledCounts: t('notes.pooledCounts') },
        blocks,
        extraNotes: [...failed.map((key) => t(key)), ...(loading > 0 ? [t('partial', { count: loading })] : [])],
      });
      downloadBlob(csvBlob(table), exportFileName(project, scope));
      const rows =
        buildNumbersTable(aggregates, scope, project).rows.length +
        blocks.reduce((total, block) => total + block.rows.length, 0);
      toast({ type: 'success', title: t('exported', { count: rows }) });
    } catch {
      toast({ type: 'error', title: t('exportFailed') });
    }
  };

  return (
    <Menu
      align="end"
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="secondary" icon={Download}>
          {t('menu')}
        </Button>
      }
      items={[
        {
          id: NUMBERS_ITEM,
          label: t('numbers'),
          ...(unavailable === null ? {} : { disabledReason: t(unavailable) }),
          onSelect: exportNumbers,
        },
      ]}
    />
  );
}
