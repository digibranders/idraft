'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useMemo, type ReactElement, type Ref } from 'react';

import { Combobox } from '@/components/ui/combobox';
import type { InputSize } from '@/components/ui/input-variants';
import type { components } from '@/lib/api/schema';

/** What the field needs of a location: a search result, or the one a project already names. */
type Location = components['schemas']['LocationRef'];

export interface LocationComboboxProps {
  value: Location | null;
  onValueChange: (value: Location | null) => void;
  /** The current answer of the location search (`useLocationSearch`), which the feature runs. */
  items: readonly Location[];
  loading: boolean;
  onQueryChange: (query: string) => void;
  size?: InputSize | undefined;
  name?: string | undefined;
  inputRef?: Ref<HTMLInputElement> | undefined;
  onBlur?: (() => void) | undefined;
  disabled?: boolean | undefined;
  'aria-required'?: boolean | undefined;
}

/**
 * A rank-check location, found by typing (10-forms.md section 6.3): each row has the location's name and,
 * below it, its type and country ("City, Germany"). The list comes from the server, so this component only
 * shows what the feature's search returns.
 */
export function LocationCombobox({
  value,
  onValueChange,
  items,
  loading,
  onQueryChange,
  inputRef,
  ...props
}: LocationComboboxProps): ReactElement {
  const t = useTranslations('common.location');
  const locale = useLocale();
  const countries = useMemo(() => new Intl.DisplayNames([locale], { type: 'region', fallback: 'code' }), [locale]);
  return (
    <Combobox<Location>
      {...props}
      inputRef={inputRef}
      value={value}
      onValueChange={onValueChange}
      items={items}
      itemToString={(location) => location.name}
      itemKey={(location) => String(location.location_id)}
      renderItem={(location) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate">{location.name}</span>
          <span className="truncate type-meta">
            {t('detail', {
              type: location.location_type,
              country: countries.of(location.country_iso.toUpperCase()) ?? location.country_iso,
            })}
          </span>
        </span>
      )}
      onQueryChange={onQueryChange}
      loading={loading}
      loadingText={t('searching')}
      emptyText={(query) => t('empty', { query })}
      placeholder={t('placeholder')}
      clearLabel={t('clear')}
      openLabel={t('open')}
    />
  );
}
