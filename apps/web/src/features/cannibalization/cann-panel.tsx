'use client';

import { Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, type ReactElement, type ReactNode } from 'react';

import { MAX_SEARCH } from './cann-model';
import { RefetchBar } from '@/components/app/status/refetch-bar';
import { Input } from '@/components/ui/input';
import { InputGroup } from '@/components/ui/input-group';
import { useShortcut } from '@/lib/a11y/use-shortcut';

export interface CannPanelProps {
  /** The tabs: a segmented `TabNav`. */
  tabs: ReactNode;
  search: string;
  onSearchChange: (search: string) => void;
  searchPlaceholder: string;
  /** The view switch and the filters. */
  controls: ReactNode;
  /** At the right of the toolbar: the page filter chip, or a hint. */
  summary?: ReactNode;
  /** Between the toolbar and the table: the weekly chart. */
  above?: ReactNode;
  refetching: boolean;
  footerText: string | null;
  updated: string | null;
  /** The table, its empty state, its error or its skeleton. */
  children: ReactNode;
}

/**
 * The table panel (docs/33 section 7.2): at least 384 px tall, so a phone still shows rows. Its toolbar holds the tabs,
 * a hairline, the search (`/` focuses it), the controls and the summary; its footer the count and the freshness.
 */
export function CannPanel({
  tabs,
  search,
  onSearchChange,
  searchPlaceholder,
  controls,
  summary,
  above,
  refetching,
  footerText,
  updated,
  children,
}: CannPanelProps): ReactElement {
  const t = useTranslations('cannibalization.search');
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
        {/* A hairline keeps the tabs (what the table is) apart from the filters (what it shows) */}
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
            aria-label={t('label')}
            aria-keyshortcuts="/"
          />
        </InputGroup>
        <div className="flex flex-wrap items-center gap-3">{controls}</div>
        <div className="ml-auto flex items-center gap-3">{summary}</div>
      </div>
      {above}
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
