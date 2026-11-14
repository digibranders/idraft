'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useMemo, type ReactElement } from 'react';

import { useOverview } from '../overview-context';
import { usePromptCountries } from './prompt-countries';
import { CountryScopeControl, type CountryScopeLabels } from '@/components/app/scope/country-scope-control';
import { useCountries } from '@/lib/locations/countries';

/**
 * The country of the page, in the top bar after the date window: "All countries" and the countries the project's
 * prompts ask in. It is the shared `CountryScopeControl` (the plan's copy of the Prompts page's control is not
 * needed: WP-22 moved it to `components/app/scope`) with this page's words and its own country read.
 */
export function CountryControl(): ReactElement {
  const t = useTranslations('aiOverview.scope');
  const { workspaceId, project, scope, setScope } = useOverview();
  const countries = usePromptCountries({ workspaceId, projectId: project.id }, scope.country);
  const { countries: names } = useCountries();
  const nameByIso = useMemo(() => new Map(names.map((country) => [country.country_iso, country.name])), [names]);
  const nameOf = useCallback((iso: string): string => nameByIso.get(iso) ?? iso, [nameByIso]);
  const labels = useMemo(
    (): CountryScopeLabels => ({
      country: (name) => t('country', { country: name }),
      allCountries: t('allCountries'),
      search: t('countrySearch'),
      empty: (query) => t('countryEmpty', { query }),
      clear: t('clear'),
      open: t('open'),
    }),
    [t],
  );
  return (
    <CountryScopeControl
      country={scope.country}
      isos={countries.data ?? []}
      nameOf={nameOf}
      labels={labels}
      onCountryChange={(country) => setScope({ country })}
    />
  );
}
