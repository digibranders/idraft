'use client';

import { useQuery } from '@tanstack/react-query';
import { ChevronDown, MapPin } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { parseAsInteger, parseAsStringLiteral, useQueryStates } from 'nuqs';
import { useMemo, type ReactElement } from 'react';

import type { DeviceScope } from './keyword-pairs';
import type { ProjectDefaults } from './add-keywords/add-keywords-dialog';
import { readCountries, type Country } from './keyword-filters';
import { buttonVariants } from '@/components/ui/button-variants';
import { Combobox } from '@/components/ui/combobox';
import { Icon } from '@/components/ui/icon';
import { SegmentedControl } from '@/components/ui/segmented-control';

/**
 * The scope of the Rankings table (13-filters-search.md section 2): which devices show their rank column, and
 * which country the keywords are tracked in. They sit beside the filters and are never cleared with them.
 * Both devices show unless one is chosen; the country is India until another is chosen, as a keyword is
 * tracked at country level. The URL keys are `dev` (`desktop` or `mobile`, absent for both) and `loc` (a
 * country's location id, absent for the default).
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
  device: DeviceScope;
  /** The country the table shows: a location id, India unless the project's own default is a country. */
  countryId: number;
  setDevice: (device: DeviceScope) => void;
  setCountry: (countryId: number) => void;
}

/**
 * The scope read from the URL. Without a choice the table shows the country of the project's default
 * location (the location itself when it is a country, the country of a city by its ISO code once the list of
 * countries is in) and India when the project has none.
 */
export function useKeywordScope(
  projectLocation: ProjectDefaults['location'],
  countries: readonly Country[],
  /** A country (or `ALL_COUNTRIES`) the table opens on instead of the project's own. */
  opensOn?: number | undefined,
): KeywordScope {
  const [state, setState] = useQueryStates(SCOPE_STATE, { history: 'replace' });
  const own =
    projectLocation === null
      ? undefined
      : projectLocation.location_type === 'Country'
        ? projectLocation.location_id
        : countries.find((country) => country.country_iso === projectLocation.country_iso)?.location_id;
  const fallback = opensOn ?? own ?? DEFAULT_COUNTRY_ID;
  return {
    device: state.dev ?? 'both',
    countryId: state.loc ?? fallback,
    setDevice: (device) => void setState({ dev: device === 'both' ? null : device }),
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

/** The two controls, side by side. */
export function KeywordScopeControls({
  scope,
  countries,
}: {
  scope: KeywordScope;
  countries: readonly Country[];
}): ReactElement {
  const t = useTranslations('rankings.scope');
  const columns = useTranslations('rankings.columns');
  const everywhere = useMemo(
    (): Country => ({
      location_id: ALL_COUNTRIES,
      name: t('allCountries'),
      country_iso: '',
      location_type: 'Country',
      parent_id: null,
      supports: ['serp'],
    }),
    [t],
  );
  const current = useMemo(
    (): Country =>
      scope.countryId === ALL_COUNTRIES
        ? everywhere
        : (countries.find((country) => country.location_id === scope.countryId) ?? {
            location_id: scope.countryId,
            name: scope.countryId === DEFAULT_COUNTRY_ID ? t('defaultCountry') : String(scope.countryId),
            country_iso: '',
            location_type: 'Country',
            parent_id: null,
            supports: ['serp'],
          }),
    [countries, everywhere, scope.countryId, t],
  );
  // "All countries" first, then the countries; the current one alone until the list is in
  const options = useMemo(
    (): readonly Country[] => [everywhere, ...(countries.length === 0 ? [current] : countries)],
    [countries, current, everywhere],
  );
  const trigger = (
    <button type="button" className={buttonVariants({ variant: 'secondary', size: 'md' })}>
      <Icon icon={MapPin} size="sm" className="text-foreground-tertiary" />
      <span className="max-w-40 truncate">{current.name}</span>
      <Icon icon={ChevronDown} size="sm" className="text-foreground-tertiary" />
    </button>
  );
  return (
    <div className="flex flex-wrap items-center gap-2">
      <SegmentedControl<DeviceScope>
        semantics="view"
        label={t('device')}
        value={scope.device}
        onValueChange={scope.setDevice}
        items={[
          { value: 'both', label: t('both') },
          { value: 'desktop', label: columns('desktop') },
          { value: 'mobile', label: columns('mobile') },
        ]}
      />
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
    </div>
  );
}
