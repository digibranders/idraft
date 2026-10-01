'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { PAGE_SIZES, type ServerPaging } from './types';
import { IconButton } from '@/components/ui/icon-button';
import { Select } from '@/components/ui/select';

export interface TableFooterProps {
  /** "1,000 keywords", or the loading progress in client mode. */
  countText: string;
  /** "Updated 12m ago" */
  note?: string | undefined;
  server?: ServerPaging | undefined;
}

/**
 * The 48 px footer of a table (12-tables.md sections 1 and 12): the count and freshness, and in server mode
 * the range, previous and next, and the page size. Paging is by cursor, so there are no page numbers.
 */
export function TableFooter({ countText, note, server }: TableFooterProps): ReactElement {
  const t = useTranslations('dataTable');
  return (
    <div className="flex h-12 shrink-0 items-center gap-3 border-t border-border-subtle px-3">
      <p className="num type-meta">
        {server?.rangeText ?? countText}
        {note === undefined ? null : <span> · {note}</span>}
      </p>
      {server === undefined ? null : (
        <div className="ml-auto flex items-center gap-2">
          <Select<string>
            size="sm"
            aria-label={t('pageSize')}
            value={String(server.pageSize)}
            placeholder={t('pageSize')}
            onValueChange={(value) => {
              const size = PAGE_SIZES.find((candidate) => String(candidate) === value);
              if (size !== undefined) server.onPageSizeChange(size);
            }}
            options={PAGE_SIZES.map((size) => ({ value: String(size), label: t('pageSizeValue', { size }) }))}
          />
          <IconButton
            icon={ChevronLeft}
            variant="secondary"
            label={t('previous')}
            disabled={!server.hasPrevious}
            onClick={server.onPrevious}
          />
          <IconButton
            icon={ChevronRight}
            variant="secondary"
            label={t('next')}
            disabled={!server.hasNext}
            onClick={server.onNext}
          />
        </div>
      )}
    </div>
  );
}
