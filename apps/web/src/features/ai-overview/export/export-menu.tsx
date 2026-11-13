'use client';

import { Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState, type ReactElement } from 'react';

import { buildAggregates, type OverviewAggregates } from '../data/aggregates';
import { askedEngines } from '../data/overview-queries';
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

/**
 * The aggregates the strip is made from, for the file: the same summary read (one request), and the sources and the
 * fan-out as the strip has them. Those two are only read while the layout has a number that needs them, so here
 * they are not asked (`subscribed: false`): the cache answers when the strip asked, and a number nobody sees is
 * `unread` in the file, never a figure the page does not show.
 */
function useExportAggregates(): {
  aggregates: OverviewAggregates | null;
  unavailable: Unavailable | null;
} {
  const { scope, engines, enabledEngines } = useOverview();
  const summary = useOverviewSummary();
  const sources = useOverviewSources({ subscribed: false });
  const fanout = useOverviewFanout({ subscribed: false });
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
            sources: sources.data ?? null,
            fanout: fanout.data ?? null,
          }),
    [summary.data, engines.data, scope.engines, sources.data, fanout.data],
  );
  let unavailable: Unavailable | null = null;
  if (engines.status === 'error') unavailable = 'unavailable';
  else if (engines.status === 'loading') unavailable = 'waiting';
  else if (askedEngines({ scope, enabledEngines }).length === 0) unavailable = 'noEngine';
  else if (summary.status === 'error') unavailable = 'unavailable';
  // The last scope's figures are kept on screen while this one is read: they are not this scope's numbers
  else if (aggregates === null || summary.placeholder || !aggregates.rowsRead) unavailable = 'waiting';
  return { aggregates, unavailable };
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
  const { aggregates, unavailable } = useExportAggregates();
  const [open, setOpen] = useState(false);
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
        extraNotes: loading > 0 ? [t('partial', { count: loading })] : [],
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
