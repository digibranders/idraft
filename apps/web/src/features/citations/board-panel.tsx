'use client';

import { Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, type ReactElement, type ReactNode } from 'react';

import { MAX_SEARCH } from './board-state';
import { RefetchBar } from '@/components/app/status/refetch-bar';
import { Input } from '@/components/ui/input';
import { InputGroup } from '@/components/ui/input-group';
import { useShortcut } from '@/lib/a11y/use-shortcut';

export interface BoardPanelProps {
  /** The view tabs, a segmented `TabNav` (C 263 to 285). */
  tabs: ReactNode;
  search: string;
  onSearchChange: (search: string) => void;
  searchPlaceholder: string;
  /** The tab's own controls: the owner filter, or Only gaps. */
  controls: ReactNode;
  /** The tab's summary at the right (C 675 to 677). */
  summary?: ReactNode;
  refetching: boolean;
  /** "278 pages · 405 citations"; `null` while the first rows load. */
  footerText: string | null;
  /** "Updated Sep 28, 02:15 · run 48" (C 189); `null` before any answer. */
  updated: string | null;
  /** The table, its empty state, its error or its skeleton. */
  children: ReactNode;
}

/**
 * The table panel (C 287 to 330): at least 384 px tall, so a phone, where the strip takes the screen, still shows rows
 * and the page scrolls. Its toolbar holds the views, a hairline, the search (`/` focuses it), the tab's controls and
 * its summary; its footer the count and the freshness.
 */
export function BoardPanel({
  tabs,
  search,
  onSearchChange,
  searchPlaceholder,
  controls,
  summary,
  refetching,
  footerText,
  updated,
  children,
}: BoardPanelProps): ReactElement {
  const t = useTranslations('citations.board');
  const input = useRef<HTMLInputElement>(null);
  useShortcut(
    '/',
    (event) => {
      event.preventDefault();
      input.current?.focus();
    },
    { kind: 'single-key' },
  );
  return (
    <section className="relative flex min-h-96 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border-subtle px-3 py-2">
        {tabs}
        {/* A hairline keeps the views (what the table is) apart from the filters (what it shows) (C 313) */}
        <span aria-hidden="true" className="hidden h-5 border-l border-border md:block" />
        <InputGroup leadingIcon={Search} size="sm" className="w-64 max-w-full min-w-0">
          <Input
            ref={input}
            size="sm"
            variant="bare"
            type="search"
            value={search}
            onValueChange={onSearchChange}
            placeholder={searchPlaceholder}
            maxLength={MAX_SEARCH}
            aria-label={t('search')}
            aria-keyshortcuts="/"
          />
        </InputGroup>
        <div className="flex flex-wrap items-center gap-3">{controls}</div>
        <div className="ml-auto flex items-center gap-3">{summary}</div>
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <RefetchBar active={refetching} position="under-table-header" />
        {children}
      </div>
      <div className="flex h-12 shrink-0 items-center gap-3 border-t border-border-subtle px-3">
        <span className="num type-meta">{footerText}</span>
        {updated === null ? null : <span className="ml-auto type-meta whitespace-nowrap">{updated}</span>}
      </div>
    </section>
  );
}
