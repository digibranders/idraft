'use client';

import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement, type Ref } from 'react';

import { Combobox } from '@/components/ui/combobox';
import type { InputSize } from '@/components/ui/input-variants';
import { browserTimeZone, timeZoneAbbreviation } from '@/lib/format/date';
import { currentTimeZoneName, timeZoneNames } from '@/lib/format/time-zone';

export interface TimeZoneComboboxProps {
  /** An IANA name: "Europe/Berlin". */
  value: string;
  onValueChange: (value: string) => void;
  /** `lg` on the onboarding pages only, like their other controls. */
  size?: InputSize | undefined;
  name?: string | undefined;
  inputRef?: Ref<HTMLInputElement> | undefined;
  onBlur?: (() => void) | undefined;
  disabled?: boolean | undefined;
  'aria-required'?: boolean | undefined;
}

/**
 * A searchable list of every IANA time zone the browser knows, the browser's own first, each with its
 * abbreviation today ("Europe/Berlin, GMT+2"). Clearing the search keeps the zone: a project and a workspace
 * always have one.
 */
export function TimeZoneCombobox({ value, onValueChange, inputRef, ...props }: TimeZoneComboboxProps): ReactElement {
  const t = useTranslations('common');
  // The browser's own zone leads the list: it is the likeliest answer
  const zones = useMemo(() => {
    const own = currentTimeZoneName(browserTimeZone());
    const all = timeZoneNames();
    return all.includes(own) ? [own, ...all.filter((zone) => zone !== own)] : all;
  }, []);
  // The abbreviation of each zone today, worked out once: there are several hundred
  const abbreviations = useMemo(() => {
    const now = new Date();
    return new Map(zones.map((zone) => [zone, timeZoneAbbreviation(now, zone)]));
  }, [zones]);
  return (
    <Combobox<string>
      {...props}
      inputRef={inputRef}
      value={value}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next);
      }}
      items={zones}
      itemToString={(zone) => zone}
      itemKey={(zone) => zone}
      renderItem={(zone) => (
        <span className="flex min-w-0 items-center justify-between gap-3">
          <span className="truncate">{zone}</span>
          <span className="shrink-0 type-meta">{abbreviations.get(zone)}</span>
        </span>
      )}
      emptyText={(query) => t('timeZone.empty', { query })}
      placeholder={t('timeZone.search')}
      clearLabel={t('clear')}
      openLabel={t('timeZone.open')}
    />
  );
}
