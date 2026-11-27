'use client';

import { Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type ReactElement } from 'react';

import type { ExportSpec } from './cann-export';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { csvBlob, downloadBlob } from '@/lib/csv/csv-write';
import { formatInteger } from '@/lib/format';

/**
 * Registers the table in view with the page, so the Export button in the toolbar can save it. The table clears it
 * when it is not showing rows (loading, empty, error) or goes away.
 */
export function useExportSpec(spec: ExportSpec | null, onChange: (spec: ExportSpec | null) => void): void {
  useEffect(() => {
    onChange(spec);
    return () => onChange(null);
  }, [spec, onChange]);
}

interface Done {
  fileName: string;
  rows: number;
}

/** Saves the table in view as CSV and says which rows the file holds, and whether the page read them all. */
export function ExportButton({ spec }: { spec: ExportSpec | null }): ReactElement {
  const t = useTranslations('cannibalization');
  const [done, setDone] = useState<Done | null>(null);
  const shown = spec !== null && done?.fileName === spec.fileName && done.rows === spec.rows;
  const truncated = shown ? spec.truncated : null;
  const units = spec?.table === 'changes' ? 'truncatedSwitches' : 'truncatedKeywords';
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      <Button
        variant="secondary"
        size="sm"
        icon={Download}
        aria-label={t('toolbar.exportLabel')}
        disabled={spec === null}
        onClick={() => {
          if (spec === null) return;
          try {
            downloadBlob(csvBlob(spec.build()), spec.fileName);
            setDone({ fileName: spec.fileName, rows: spec.rows });
          } catch {
            toast({ type: 'error', title: t('export.failedTitle'), description: t('export.failedDescription') });
          }
        }}
      >
        {t('toolbar.export')}
      </Button>
      <p role="status" className="min-w-0 type-meta">
        {shown ? (
          <>
            {t('export.done', { rows: spec.rows, file: spec.fileName })}
            {truncated === null
              ? null
              : ` ${t(`export.${units}`, { read: formatInteger(truncated.read), total: formatInteger(truncated.total) })}`}
          </>
        ) : null}
      </p>
    </div>
  );
}
