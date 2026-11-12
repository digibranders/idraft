'use client';

import { ChevronDown, MapPin } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useMemo, type ReactElement } from 'react';

import { DEFAULT_WINDOW, WINDOW_DAYS, type WindowDays } from './prompt-model';
import { buttonVariants } from '@/components/ui/button-variants';
import { Combobox } from '@/components/ui/combobox';
import { Icon } from '@/components/ui/icon';
import { Select } from '@/components/ui/select';
import { Tooltip } from '@/components/ui/tooltip';
import { MEDIA, useMediaQuery } from '@/lib/dom/use-media-query';
import { cn } from '@/lib/utils';

/**
 * The scope of the page, drawn in the top bar beside the theme switch (11-navigation.md section 4): the window
 * of days and the country. Like the Keywords page's country, they are never cleared with the filters.
 */

export interface PromptsWindowControlProps {
  days: WindowDays;
  onDaysChange: (days: WindowDays) => void;
  /** "Answers from Oct 16 to Nov 12, 2026": the window in dates, in a tooltip and as the select's description. */
  caption: string;
}

/**
 * The window select. Below 640 px the top bar has no room for "Last 28 days", so it reads "28d" and the dates of
 * the window stay in the tooltip and the select's description.
 */
export function PromptsWindowControl({ days, onDaysChange, caption }: PromptsWindowControlProps): ReactElement {
  const t = useTranslations('prompts');
  const roomy = useMediaQuery(MEDIA.sm);
  const captionId = useId();
  return (
    <>
      <span id={captionId} className="sr-only">
        {caption}
      </span>
      <Tooltip content={caption} purpose="label" side="bottom">
        <span className={cn('inline-flex', roomy ? 'w-40' : 'w-18')}>
          <Select<string>
            aria-label={t('window')}
            aria-describedby={captionId}
            size="sm"
            value={String(days)}
            onValueChange={(next) =>
              onDaysChange(WINDOW_DAYS.find((value) => String(value) === next) ?? DEFAULT_WINDOW)
            }
            placeholder={t('window')}
            options={WINDOW_DAYS.map((value) => ({
              value: String(value),
              label: roomy ? t('windowOption', { days: value }) : t('windowOptionShort', { days: value }),
            }))}
          />
        </span>
      </Tooltip>
    </>
  );
}

/** A choice of the country control: a market, or every one (`iso` is `null`). */
interface CountryChoice {
  iso: string | null;
  name: string;
}

export interface PromptsCountryControlProps {
  /** The market chosen, or `null` for every country. */
  country: string | null;
  /** The countries the prompts carry (and the chosen one), as `countryChoices` lists them. */
  isos: readonly string[];
  /** The name of a country by its ISO code; an unknown code is written as it is. */
  nameOf: (iso: string) => string;
  onCountryChange: (iso: string | null) => void;
}

/**
 * The country control: "All countries" and the countries of the project's prompts. From 1024 px it shows the
 * country's name; below, the room is short and it shows the ISO code (the pin alone for all countries). With
 * nothing to choose between it is a label.
 */
export function PromptsCountryControl({
  country,
  isos,
  nameOf,
  onCountryChange,
}: PromptsCountryControlProps): ReactElement {
  const t = useTranslations('prompts.scope');
  const everywhere = useMemo((): CountryChoice => ({ iso: null, name: t('allCountries') }), [t]);
  const options = useMemo(
    (): readonly CountryChoice[] => [everywhere, ...isos.map((iso) => ({ iso, name: nameOf(iso) }))],
    [everywhere, isos, nameOf],
  );
  const current = options.find((option) => option.iso === country) ?? everywhere;
  const shown = (
    <>
      <span aria-hidden className="hidden max-w-40 truncate lg:inline">
        {current.name}
      </span>
      <span aria-hidden className="uppercase lg:hidden">
        {current.iso}
      </span>
    </>
  );
  const name = t('country', { country: current.name });
  // A link may name a country the prompts do not have: the person must be able to leave it for all of them
  const choosable = isos.length > 1 || (isos.length === 1 && country !== null);
  if (!choosable) {
    return (
      <span className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'pointer-events-none')}>
        <Icon icon={MapPin} size="sm" className="text-foreground-tertiary" />
        <span className="sr-only">{name}</span>
        {shown}
      </span>
    );
  }
  return (
    <Combobox<CountryChoice>
      value={current}
      onValueChange={(next) => {
        if (next !== null) onCountryChange(next.iso);
      }}
      items={options}
      itemToString={(choice) => choice.name}
      itemKey={(choice) => choice.iso ?? ''}
      emptyText={(query) => t('countryEmpty', { query })}
      placeholder={t('countrySearch')}
      clearLabel={t('clear')}
      openLabel={t('open')}
      trigger={
        <button type="button" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
          <Icon icon={MapPin} size="sm" className="text-foreground-tertiary" />
          {shown}
          <Icon icon={ChevronDown} size="sm" className="text-foreground-tertiary" />
        </button>
      }
      triggerLabel={name}
    />
  );
}
