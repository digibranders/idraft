'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { col } from '@/components/app/data-table/columns';
import type { DataTableColumn } from '@/components/app/data-table/types';
import { Badge } from '@/components/ui/badge';
import type { Prompt, PromptSummaryRow } from '@/lib/api/types';
import type { SortKey } from '@/lib/tables/table-state';

/** A row of the Prompts tab: the prompt, its counts when the summary has them, and its facts in words. */
export interface PromptRow {
  prompt: Prompt;
  summary: PromptSummaryRow | undefined;
  /** The prompt's topics, joined; `null` without one. */
  topics: string | null;
  /** The country's name; `null` for a prompt without a country. */
  country: string | null;
}

/** A to Z by the prompt's text. */
export const DEFAULT_SORT: readonly SortKey[] = [{ id: 'prompt', desc: false }];

export interface PromptColumns {
  columns: readonly DataTableColumn<PromptRow>[];
  /** The ids `?sort=` may name. */
  sortFields: ReadonlySet<string>;
  searchText: (row: PromptRow) => string;
  rowName: (row: PromptRow) => string;
}

/** The columns of the Prompts tab (ADR-DS-022 decision 9): Prompt, Topic and Country. */
export function usePromptColumns(): PromptColumns {
  const t = useTranslations('prompts');
  const locale = useLocale();
  return useMemo(() => {
    const columns: DataTableColumn<PromptRow>[] = [
      col.keyword<PromptRow>('prompt', (row) => row.prompt.current_version.text, {
        header: t('columns.prompt'),
        trailing: (row) => (row.prompt.is_branded ? <Badge>{t('branded')}</Badge> : null),
      }),
      col.text<PromptRow>('topic', (row) => row.topics, {
        header: t('columns.topic'),
        priority: 2,
        unknown: () => ({ label: t('columns.noTopic') }),
      }),
      col.text<PromptRow>('country', (row) => row.country, { header: t('columns.country'), priority: 3, width: 136 }),
    ];
    return {
      columns,
      sortFields: new Set(columns.flatMap((column) => (column.sortValue === undefined ? [] : [column.id]))),
      searchText: (row) => `${row.prompt.current_version.text} ${row.topics ?? ''}`.toLocaleLowerCase(locale),
      rowName: (row) => row.prompt.current_version.text,
    };
  }, [t, locale]);
}
