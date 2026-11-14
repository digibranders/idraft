import { Download } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { buildPromptExport, exportFileName } from '../export-rows';
import type { PromptRow } from '../prompt-columns';
import type { DateRange } from '../prompt-model';
import { usePromptExportLabels } from './export-labels';
import { buildPromptWorkbook, workbookFileName } from './prompts-workbook';
import type { MenuItemDef } from '@/components/ui/menu';
import { toast } from '@/components/ui/toast';
import type { ProjectEngine } from '@/lib/api/types';
import { csvBlob, downloadBlob } from '@/lib/csv/csv-write';

export interface ScopeExport {
  /** `export-csv` and `export-xlsx`, for the page's More menu. */
  items: MenuItemDef[];
}

export interface ScopeExportInput {
  /** The prompts in scope, in the order of the list: after the filters, not after the search or the selection. */
  rows: readonly PromptRow[];
  engines: readonly ProjectEngine[];
  range: DateRange;
  /** Why the list cannot be exported yet, as a sentence, or null once it is whole. */
  waiting: string | null;
}

/**
 * Export of every prompt in scope as CSV or XLSX (D5). Both files hold what the bulk export holds for a selection. No
 * file is written for a header alone, and the XLSX writer is loaded only when that item is chosen.
 */
export function useScopeExport({ rows, engines, range, waiting }: ScopeExportInput): ScopeExport {
  const t = useTranslations('prompts');
  const labels = usePromptExportLabels();
  const disabledReason = waiting ?? (rows.length === 0 ? t('facets.export.none') : undefined);

  /** Writes the file `make` builds, and says how many prompts it holds or that it could not be made. */
  const write = async (make: () => Promise<{ blob: Blob; name: string }>): Promise<void> => {
    // A menu that lets a disabled item through must not write a file of a header alone
    if (rows.length === 0) {
      toast({ type: 'error', title: t('bulk.exportNone') });
      return;
    }
    try {
      const { blob, name } = await make();
      downloadBlob(blob, name);
      toast({ type: 'success', title: t('bulk.exported', { count: rows.length }) });
    } catch {
      toast({ type: 'error', title: t('bulk.exportFailed') });
    }
  };

  return {
    items: [
      {
        id: 'export-csv',
        label: t('facets.export.csv'),
        icon: Download,
        group: 'export',
        disabledReason,
        onSelect: () =>
          void write(() =>
            Promise.resolve({ blob: csvBlob(buildPromptExport(rows, engines, labels)), name: exportFileName(range) }),
          ),
      },
      {
        id: 'export-xlsx',
        label: t('facets.export.xlsx'),
        icon: Download,
        group: 'export',
        disabledReason,
        onSelect: () =>
          void write(async () => ({
            blob: await buildPromptWorkbook(buildPromptExport(rows, engines, labels), t('facets.export.sheet')),
            name: workbookFileName(range),
          })),
      },
    ],
  };
}
