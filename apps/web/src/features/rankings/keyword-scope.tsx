'use client';

import { useQuery } from '@tanstack/react-query';
import { ChevronDown, MapPin, Monitor, Smartphone } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { parseAsInteger, parseAsStringLiteral, useQueryStates } from 'nuqs';
import { useMemo, type ReactElement } from 'react';

import type { Device } from './keyword-pairs';
import type { ProjectDefaults } from './add-keywords/add-keywords-dialog';
import type { KeywordCountries, KeywordCountry } from './keyword-countries';
import { readCountries, type Country } from './keyword-filters';
import { buttonVariants } from '@/components/ui/button-variants';
import { Combobox } from '@/components/ui/combobox';
import { Icon } from '@/components/ui/icon';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { cn } from '@/lib/utils';

/**
 * The scope of the Rankings table (13-filters-search.md section 2): which device the table shows, and which
 * country the keywords are tracked in. They sit beside the filters and are never cleared with them.
 * Desktop shows unless mobile is chosen; the country is India until another is chosen, as a keyword is
 * tracked at country level. The URL keys are `dev` (`mobile`, absent for desktop) and `loc` (a country's
 * location id, absent for the default).
 */

/** India, by DataForSEO's location code, which is the location id here. */
export const DEFAULT_COUNTRY_ID = 2356;
/** The choice that shows the keywords of every country. */
export const ALL_COUNTRIES = 0;

const SCOPE_STATE = {
  dev: parseAsStringLiteral(['desktop', 'mobile'] as const),
  loc: parseAsInteger,
};

export interface KeywordScope {
  device: Device;
  /** The country the table shows: a location id, India unless the project's own default is a country. */
  countryId: number;
  /** Whether `countryId` is settled: queries for the table wait until it is, so none is made for a guess. */
  ready: boolean;
  setDevice: (device: Device) => void;
  setCountry: (countryId: number) => void;
}

/**
 * The scope read from the URL. Without a choice the table shows the project's own country when it has
 * keywords there, else the country with most keywords, else the country of the project's default location
 * (the location itself when it is a country, the country of a city by its ISO code), else India. A `loc` in
 * the URL is kept whatever the project tracks: a country without keywords shows an empty table.
 */
export function useKeywordScope(
  projectLocation: ProjectDefaults['location'],
  /** The countries the project has keywords in, and whether that read is still under way. */
  { countries: inUse, loading }: Pick<KeywordCountries, 'countries' | 'loading'>,
  /** A country (or `ALL_COUNTRIES`) the table opens on instead of the project's own. */
  opensOn?: number | undefined,
  /** Every country, which names the country of a project whose default location is a city and has no keywords. */
  known: readonly Country[] = [],
): KeywordScope {
  const [state, setState] = useQueryStates(SCOPE_STATE, { history: 'replace' });
  const own =
    projectLocation === null
      ? undefined
      : projectLocation.location_type === 'Country'
        ? projectLocation.location_id
        : (inUse.find((country) => country.countryIso === projectLocation.country_iso)?.locationId ??
          known.find((country) => country.country_iso === projectLocation.country_iso)?.location_id);
  const biggest = inUse.reduce<KeywordCountry | undefined>(
    (most, country) => (most === undefined || country.keywordCount > most.keywordCount ? country : most),
    undefined,
  );
  const ownHasKeywords = own !== undefined && inUse.some((country) => country.locationId === own);
  const fallback = opensOn ?? (ownHasKeywords ? own : (biggest?.locationId ?? own ?? DEFAULT_COUNTRY_ID));
  return {
    device: state.dev ?? 'desktop',
    countryId: state.loc ?? fallback,
    // The default is a guess until the countries in use are read (a failed read ends the wait: the guess stands)
    ready: state.loc !== null || opensOn !== undefined || !loading,
    // Desktop is the default and is kept out of the URL
    setDevice: (device) => void setState({ dev: device === 'desktop' ? null : device }),
    // The default country is kept out of the URL, so a link without `loc` follows the project's default
    setCountry: (countryId) => void setState({ loc: countryId === fallback ? null : countryId }),
  };
}

export function useCountries(): readonly Country[] {
  const countries = useQuery({
    queryKey: ['locations', 'countries', 'all'],
    queryFn: ({ signal }) => readCountries(signal),
    staleTime: Number.POSITIVE_INFINITY,
  });
  return countries.data ?? [];
}

/** A country as the combobox holds it, with only what the control uses. */
const countryOf = (locationId: number, name: string, countryIso: string): Country => ({
  location_id: locationId,
  name,
  country_iso: countryIso,
  location_type: 'Country',
  parent_id: null,
  supports: ['serp'],
});

/** The Desktop and Mobile switch: one device at a time, in the page's toolbar. */
export function KeywordDeviceControl({ scope }: { scope: KeywordScope }): ReactElement {
  const t = useTranslations('rankings.scope');
  const columns = useTranslations('rankings.columns');
  return (
    <SegmentedControl<Device>
      semantics="view"
      label={t('device')}
      value={scope.device}
      onValueChange={scope.setDevice}
      size="sm"
      iconOnly
      items={[
        { value: 'desktop', label: columns('desktop'), icon: Monitor },
        { value: 'mobile', label: columns('mobile'), icon: Smartphone },
      ]}
    />
  );
}

/**
 * The country control, drawn in the top bar beside the theme switch (11-navigation.md section 4). It lists the
 * countries the project has keywords in, with "All countries" when there is more than one; when the scope is
 * the only one or there is none it is a label, as there is nothing to choose. From 1024 px it shows the
 * country's name; below, the room is short and it shows the ISO code (the pin alone for all countries).
 */
export function KeywordCountryControl({
  scope,
  inUse,
  countries,
}: {
  scope: KeywordScope;
  inUse: readonly KeywordCountry[];
  /** Every country, for the name of the scope country when the project has no keywords in it. */
  countries: readonly Country[];
}): ReactElement {
  const t = useTranslations('rankings.scope');
  const everywhere = useMemo((): Country => countryOf(ALL_COUNTRIES, t('allCountries'), ''), [t]);
  const used = useMemo(
    (): readonly Country[] =>
      inUse.map(
        (entry) =>
          countries.find((country) => country.location_id === entry.locationId) ??
          countryOf(entry.locationId, entry.name, entry.countryIso),
      ),
    [countries, inUse],
  );
  const current = useMemo(
    (): Country =>
      scope.countryId === ALL_COUNTRIES
        ? everywhere
        : (used.find((country) => country.location_id === scope.countryId) ??
          countries.find((country) => country.location_id === scope.countryId) ??
          countryOf(
            scope.countryId,
            scope.countryId === DEFAULT_COUNTRY_ID ? t('defaultCountry') : String(scope.countryId),
            '',
          )),
    [countries, everywhere, scope.countryId, t, used],
  );
  const options = useMemo((): readonly Country[] => [everywhere, ...used], [everywhere, used]);
  const shown = (
    <>
      <span aria-hidden className="hidden max-w-40 truncate lg:inline">
        {current.name}
      </span>
      <span aria-hidden className="uppercase lg:hidden">
        {current.country_iso}
      </span>
    </>
  );
  const trigger = (
    <button type="button" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
      <Icon icon={MapPin} size="sm" className="text-foreground-tertiary" />
      {shown}
      <Icon icon={ChevronDown} size="sm" className="text-foreground-tertiary" />
    </button>
  );
  // There is a choice unless the scope is the only country in use (or none is): a link may name another
  // country or all of them, and the person must be able to leave it for the one with keywords
  const choosable = inUse.length > 1 || (inUse.length === 1 && inUse[0]?.locationId !== scope.countryId);
  const label = (
    <span className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'pointer-events-none')}>
      <Icon icon={MapPin} size="sm" className="text-foreground-tertiary" />
      <span className="sr-only">{t('country', { country: current.name })}</span>
      {shown}
    </span>
  );
  return choosable ? (
    <Combobox<Country>
      value={current}
      onValueChange={(country) => {
        if (country !== null) scope.setCountry(country.location_id);
      }}
      items={options}
      itemToString={(country) => country.name}
      itemKey={(country) => String(country.location_id)}
      emptyText={(query) => t('countryEmpty', { query })}
      placeholder={t('countrySearch')}
      clearLabel={t('clear')}
      openLabel={t('open')}
      trigger={trigger}
      triggerLabel={t('country', { country: current.name })}
    />
  ) : (
    label
  );
}
