'use client';

import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Crosshair } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type ReactElement } from 'react';

import { readPageRows } from './page-reads';
import { TierBadge } from '@/components/app/tier/tier-badge';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { Icon } from '@/components/ui/icon';
import { searchText } from '../url-state';
import { DEFAULT_PAGE_QUERY, pagesQuery } from '@/lib/internal-links/queries';
import type { LinksScope, PageRow } from '@/lib/internal-links/types';

const PICK_LIMIT = 50;
/** The search waits this long after the last key (the combobox's server mode, 13-filters-search.md section 6). */
const SEARCH_DELAY_MS = 250;
/** A search starts from this many characters; fewer lists the first pages by path. */
const MIN_CHARACTERS = 2;
/** The loading text shows once a request has run this long. */
const LOADING_DELAY_MS = 300;

/**
 * The focus page control (mock `pagePicker`): a search over crawled pages by path or title, each with its tier
 * badge. Nothing is read until the list is first opened. While a new text is waiting to be searched, or being
 * searched, no row of the old text can be chosen.
 */
export function FocusPicker({
  scope,
  run,
  path,
  onPick,
}: {
  scope: LinksScope;
  /** The crawl the pages are searched in: `null` for the latest. */
  run: string | null;
  path: string;
  onPick: (urlId: string) => void;
}): ReactElement {
  const t = useTranslations('internalLinks.journey');
  const [opened, setOpened] = useState(false);
  const [typed, setTyped] = useState('');
  const [settled, setSettled] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(typed), SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [typed]);
  const wanted = searchText(settled);
  const read = useQuery({
    ...pagesQuery(
      scope,
      {
        ...DEFAULT_PAGE_QUERY,
        sort: 'path',
        q: wanted !== null && wanted.length >= MIN_CHARACTERS ? wanted : null,
        limit: PICK_LIMIT,
      },
      run,
    ),
    enabled: opened,
    select: readPageRows,
  });
  // The rows are of the text that was searched: not of the one before, and not while another is on its way
  const busy = opened && (typed !== settled || read.isFetching);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!busy) return undefined;
    const timer = window.setTimeout(() => setSlow(true), LOADING_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      setSlow(false);
    };
  }, [busy]);
  const items = busy ? [] : (read.data?.data ?? []);
  return (
    <Combobox<PageRow>
      value={null}
      onValueChange={(row) => {
        if (row !== null) onPick(row.url_id);
      }}
      items={items}
      itemToString={(row) => row.path}
      itemKey={(row) => row.url_id}
      renderItem={(row) => (
        <span className="flex w-full items-center gap-2">
          <span className="min-w-0 flex-1 truncate type-table">{row.path}</span>
          <TierBadge tier={row.tier} />
        </span>
      )}
      onQueryChange={setTyped}
      loading={slow}
      loadingText={t('loadingPages')}
      emptyText={(text) => (busy ? t('loadingPages') : t('noPageMatch', { query: text }))}
      placeholder={t('searchPages')}
      clearLabel={t('clear')}
      openLabel={t('openList')}
      triggerLabel={t('focusTrigger', { path })}
      trigger={
        <Button
          variant="secondary"
          size="sm"
          className="max-w-80"
          onFocus={() => setOpened(true)}
          onClick={() => setOpened(true)}
        >
          <Icon icon={Crosshair} size="sm" className="text-foreground-tertiary" />
          <span className="truncate type-table">{path}</span>
          <Icon icon={ChevronDown} size="sm" className="text-foreground-tertiary" />
        </Button>
      }
    />
  );
}
