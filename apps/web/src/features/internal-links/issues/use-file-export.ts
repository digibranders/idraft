'use client';

import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';

import { toast } from '@/components/ui/toast';
import { isApiProblem } from '@/lib/api/problem';

/**
 * One download at a time: a second press while the file is being made would start the same file again. A failure is
 * reported as a toast with what the API said, when it said something (a problem's detail, else its title).
 */
export function useFileExport(): { exporting: boolean; start: (download: () => Promise<void>) => void } {
  const t = useTranslations('issues.list');
  const [exporting, setExporting] = useState(false);
  const running = useRef(false);
  const start = (download: () => Promise<void>): void => {
    if (running.current) return;
    running.current = true;
    setExporting(true);
    download()
      .catch((error: unknown) => {
        const reason = isApiProblem(error) ? (error.detail ?? error.string('title')) : null;
        toast({
          type: 'error',
          title: t('exportFailed'),
          ...(reason === null ? {} : { description: reason }),
        });
      })
      .finally(() => {
        running.current = false;
        setExporting(false);
      });
  };
  return { exporting, start };
}
