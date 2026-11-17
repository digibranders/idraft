'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronDown, Crosshair } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ReactElement } from 'react';

import { readPageRows } from './page-reads';
import { TierBadge } from '@/components/app/tier/tier-badge';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { Icon } from '@/components/ui/icon';
import { searchText } from '../url-state';
import { DEFAULT_PAGE_QUERY, pagesQuery } from '@/lib/internal-links/queries';
import type { LinksScope, PageRow } from '@/lib/internal-links/types';

const PICK_LIMIT = 50;

/** The focus page control (mock `pagePicker`): a search over crawled pages by path or title, each with its tier badge. */
export function FocusPicker({
  scope,
  path,
  onPick,
}: {
  scope: LinksScope;
  path: string;
  onPick: (urlId: string) => void;
}): ReactElement {
  const t = useTranslations('internalLinks.journey');
  const [query, setQuery] = useState('');
  const read = useQuery({
    ...pagesQuery(scope, { ...DEFAULT_PAGE_QUERY, sort: 'path', q: searchText(query), limit: PICK_LIMIT }),
    placeholderData: keepPreviousData,
    select: readPageRows,
  });
  return (
    <Combobox<PageRow>
      value={null}
      onValueChange={(row) => {
        if (row !== null) onPick(row.url_id);
      }}
      items={read.data?.data ?? []}
      itemToString={(row) => row.path}
      itemKey={(row) => row.url_id}
      renderItem={(row) => (
        <span className="flex w-full items-center gap-2">
          <span className="min-w-0 flex-1 truncate type-table">{row.path}</span>
          <TierBadge tier={row.tier} />
        </span>
      )}
      onQueryChange={setQuery}
      loading={read.isFetching}
      loadingText={t('loadingPages')}
      emptyText={(text) => t('noPageMatch', { query: text })}
      placeholder={t('searchPages')}
      clearLabel={t('clear')}
      openLabel={t('openList')}
      triggerLabel={t('focusTrigger', { path })}
      trigger={
        <Button variant="secondary" size="sm" className="max-w-80">
          <Icon icon={Crosshair} size="sm" className="text-foreground-tertiary" />
          <span className="truncate type-table">{path}</span>
          <Icon icon={ChevronDown} size="sm" className="text-foreground-tertiary" />
        </Button>
      }
    />
  );
}
