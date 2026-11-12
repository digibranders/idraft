'use client';

import { Columns3, Rows3, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, type ReactElement, type ReactNode } from 'react';

import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { InputGroup } from '@/components/ui/input-group';
import { Menu } from '@/components/ui/menu';
import { Spinner } from '@/components/ui/spinner';
import { useShortcut } from '@/lib/a11y/use-shortcut';
import { DENSITIES, type Density } from '@/lib/tables/table-state';
import { cn } from '@/lib/utils';

/** The longest search the box takes: the API's text filters take 200 characters (`QueryText`). */
const SEARCH_MAX_LENGTH = 200;

export interface DataTableToolbarProps {
  caption: string;
  search: string;
  onSearchChange: (search: string) => void;
  searchPlaceholder: string;
  /** "1,000 keywords"; `null` while the first rows load, when no count is known yet. */
  countText: string | null;
  /** "Sorted by Volume descending, then Keyword ascending", only for two keys. */
  sortSummary: string | null;
  updating: boolean;
  density: Density;
  onDensityChange: (density: Density) => void;
  /** The column chooser, opened from its own trigger. */
  columns: (trigger: ReactElement) => ReactNode;
  /** The view switch, at the end of the bar before density and columns. */
  end?: ReactNode;
  /** A bar with more in its end slot than a view switch: the sort summary is read, not shown, below 1440 px. */
  compact?: boolean | undefined;
}

/**
 * The 48 px bar above a table's header (12-tables.md section 1): search (`/` focuses it), the count, the
 * sort summary for two keys, "Updating" while a refetch runs past 400 ms, density and columns.
 */
export function DataTableToolbar({
  caption,
  search,
  onSearchChange,
  searchPlaceholder,
  countText,
  sortSummary,
  updating,
  density,
  onDensityChange,
  columns,
  end,
  compact = false,
}: DataTableToolbarProps): ReactElement {
  const t = useTranslations('dataTable');
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
    // 48 px on one line; on a narrow table the bar wraps rather than scrolling the page sideways
    <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border-subtle px-3 py-2">
      <InputGroup leadingIcon={Search} size="sm" className="w-64 max-w-full min-w-0">
        <Input
          ref={input}
          size="sm"
          // The group draws the border and the focus ring, so the field inside draws neither
          variant="bare"
          type="search"
          value={search}
          onValueChange={onSearchChange}
          placeholder={searchPlaceholder}
          maxLength={SEARCH_MAX_LENGTH}
          aria-label={t('search')}
          aria-keyshortcuts="/"
        />
      </InputGroup>
      {/* The table announces a new count itself, so it is heard while the bulk bar is up as well */}
      {countText === null ? null : <p className="shrink-0 num type-meta whitespace-nowrap">{countText}</p>}
      {/* Shown from 1280 px (compact: from 1440 px, so the bar stays on one row), and always readable, since aria-sort names only the first key */}
      {sortSummary === null ? null : (
        <p className={cn('sr-only type-meta', compact ? '2xl:not-sr-only' : 'xl:not-sr-only')}>{sortSummary}</p>
      )}
      {updating ? (
        <p className="flex items-center gap-1.5 type-meta">
          <Spinner size="sm" />
          {t('updating')}
        </p>
      ) : null}
      {/* The end slot and the controls go to a second line together when the bar is too narrow for one */}
      <div className="ml-auto flex items-center gap-1">
        {end}
        <div role="toolbar" aria-label={t('toolbar', { caption })} className="flex items-center gap-1">
          <Menu
            align="end"
            trigger={<IconButton icon={Rows3} variant="ghost" label={t('density')} />}
            items={DENSITIES.map((value) => ({
              id: value,
              kind: 'radio' as const,
              group: t('density'),
              label: value === 'compact' ? t('densityCompact') : t('densityDefault'),
              checked: density === value,
              onSelect: () => onDensityChange(value),
            }))}
          />
          {columns(<IconButton icon={Columns3} variant="ghost" label={t('columns')} />)}
        </div>
      </div>
    </div>
  );
}
