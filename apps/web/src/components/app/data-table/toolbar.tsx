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
    <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border-subtle px-3">
      <InputGroup leadingIcon={Search} size="sm" className="w-64 max-w-full">
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
      {countText === null ? null : <p className="num type-meta">{countText}</p>}
      {/* Shown from 1280 px, and always readable, since aria-sort names only the first key */}
      {sortSummary === null ? null : <p className="sr-only type-meta xl:not-sr-only">{sortSummary}</p>}
      {updating ? (
        <p className="flex items-center gap-1.5 type-meta">
          <Spinner size="sm" />
          {t('updating')}
        </p>
      ) : null}
      <div role="toolbar" aria-label={t('toolbar', { caption })} className="ml-auto flex items-center gap-1">
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
  );
}
