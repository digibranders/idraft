'use client';

import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import { promptTextsQuery } from '@/lib/citations/prompt-texts-query';
import type { SourceScope } from '@/lib/citations/types';
import { useCountries } from '@/lib/locations/countries';
import { countryChoices } from '@/lib/locations/country-scope';

export interface PromptCountries {
  /** The countries the project's prompts are set in, and the chosen one, sorted. */
  isos: readonly string[];
  /** The name of a country by its ISO code; a code the list does not know is written as it is. */
  nameOf: (iso: string) => string;
}

/**
 * What the country control chooses between: the countries of the project's prompts (one page of 200, the read the
 * Citations page shares) with the chosen one kept. A failed read leaves the chosen country alone, so a link's
 * country can still be left.
 */
export function usePromptCountries(source: SourceScope, country: string | null): PromptCountries {
  const prompts = useQuery(promptTextsQuery(source));
  const { countries } = useCountries();
  const isos = useMemo(() => countryChoices(prompts.data?.data ?? [], country), [prompts.data, country]);
  const names = useMemo(() => new Map(countries.map((entry) => [entry.country_iso, entry.name])), [countries]);
  const nameOf = useCallback((iso: string): string => names.get(iso) ?? iso, [names]);
  return { isos, nameOf };
}
