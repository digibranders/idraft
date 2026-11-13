'use client';

import { useQueries, type UseQueryResult } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';

import type { CountryRead } from './country-model';
import { askedEngines, overviewSummaryQuery } from '../../data/overview-queries';
import type { ReadStatus } from '../../data/read-state';
import { useOverview } from '../../overview-context';
import { usePromptCountries, type PromptCountries } from '../../scope/prompt-countries';
import { isApiProblem } from '@/lib/api/problem';
import type { PromptSummaryRow, Schemas } from '@/lib/api/types';

/** One country's summary read, in the vocabulary of the shell's `Read`. */
export interface CountryReadState extends CountryRead {
  /** A failed country read again is `failed` with status `refetching`: its group stays, retrying, and the card stays. */
  status: Exclude<ReadStatus, 'idle'>;
  /** The request id of a failed read, kept while it is read again; `null` when it did not fail or the failure has none. */
  errorId: string | null;
  /** The prompts are the last that were read: a later read failed. */
  stale: boolean;
  retry: () => void;
}

export interface CountryReads {
  /** The countries of the project's prompts. */
  countries: PromptCountries;
  /** One read for each country, in the order of `countries`; empty until the countries are known. */
  reads: readonly CountryReadState[];
}

/** What one country's query says, reduced to what the card reads (stable between renders when nothing changed). */
interface Raw {
  prompts: PromptSummaryRow[] | undefined;
  isFetching: boolean;
  isError: boolean;
  errorId: string | null;
  refetch: () => void;
}

const NO_COUNTRIES: readonly string[] = [];
const NOTHING_KEPT: ReadonlyMap<string, readonly PromptSummaryRow[]> = new Map();
const NO_FAILURES: ReadonlyMap<string, string | null> = new Map();

const rawOf = (result: UseQueryResult<Schemas['PromptsSummaryResponse']>): Raw => ({
  prompts: result.data?.data.prompts,
  isFetching: result.isFetching,
  isError: result.isError,
  errorId: result.isError && isApiProblem(result.error) ? result.error.requestId : null,
  refetch: () => {
    void result.refetch();
  },
});

/**
 * The summary of every country the project's prompts ask in, one request for each: the page's scope with its own
 * country replaced by that country, so the page's country filter is ignored by design (this card's job is to split by
 * country). A scope change keeps each country's last figures on screen, as `refetching`, until the new ones arrive
 * (`useQueries` matches its observers by key, so `keepPreviousData` has nothing to keep: the card keeps them), and one
 * country's failure leaves the others (its `retry` reads that country again). A read for the page's own country shares
 * its entry with the page.
 *
 * shortcut: one request per country, each with the country's full prompt rows and no cap, because `usePromptCountries`
 * gives country codes and no counts to pick the top 8 from; replaced by one `by_country` summary read once the mock
 * and the card seam serve it (plan Q4 and F1).
 */
export function useCountryReads(): CountryReads {
  const { workspaceId, project, scope, enabledEngines } = useOverview();
  // Not the page's country: this card ignores that filter, and a country no prompt has must not become a group
  const countries = usePromptCountries({ workspaceId, projectId: project.id }, null);
  const list = countries.data ?? NO_COUNTRIES;
  const runs = askedEngines({ scope, enabledEngines }).length > 0;
  const combine = useCallback(
    (results: UseQueryResult<Schemas['PromptsSummaryResponse']>[]): Raw[] => results.map(rawOf),
    [],
  );
  const raw = useQueries({
    queries: list.map((country) => ({
      ...overviewSummaryQuery({ workspaceId, projectId: project.id }, { scope: { ...scope, country }, enabledEngines }),
      enabled: runs,
    })),
    combine,
  });

  // The last prompts each country answered, set while rendering (React's way to derive state from a change of props)
  const [kept, setKept] = useState(NOTHING_KEPT);
  const answered = list.flatMap((country, index) => {
    const prompts = raw[index]?.prompts;
    return prompts !== undefined && kept.get(country) !== prompts ? [[country, prompts] as const] : [];
  });
  if (answered.length > 0) setKept(new Map([...kept, ...answered]));

  // The request id of each country whose read failed, until it answers: a query read again has no error while it
  // runs, and the group must keep its failure (and its id) on screen meanwhile
  const [failures, setFailures] = useState(NO_FAILURES);
  const nextFailures = new Map(failures);
  list.forEach((country, index) => {
    const read = raw[index];
    if (read === undefined) return;
    if (read.prompts !== undefined) nextFailures.delete(country);
    else if (read.isError && !read.isFetching) nextFailures.set(country, read.errorId);
  });
  if (
    nextFailures.size !== failures.size ||
    [...nextFailures].some(([country, errorId]) => failures.get(country) !== errorId)
  ) {
    setFailures(nextFailures);
  }

  // shortcut: this is `useRead`'s status arithmetic written out for each country, because a hook cannot run once per
  // country in a list; fold it into `useRead` if the shell gets a list form of it
  const reads = useMemo(
    () =>
      list.flatMap((country, index): CountryReadState[] => {
        const read = raw[index];
        if (read === undefined) return [];
        const common = { country, errorId: read.errorId, retry: read.refetch };
        if (read.prompts !== undefined) {
          return [
            {
              ...common,
              prompts: read.prompts,
              failed: false,
              status: read.isFetching ? 'refetching' : 'ready',
              stale: read.isError,
            },
          ];
        }
        // A failed country read again stays a failed group, retrying, so the card is not drawn as loading
        const failed = read.isError && !read.isFetching;
        const retrying = !failed && read.isFetching && failures.has(country);
        if (failed || retrying) {
          return [
            {
              ...common,
              errorId: failed ? read.errorId : (failures.get(country) ?? null),
              prompts: null,
              failed: true,
              status: failed ? 'error' : 'refetching',
              stale: false,
            },
          ];
        }
        // A read under way for a new scope shows the country's last figures
        const last = kept.get(country);
        return [
          {
            ...common,
            prompts: last ?? null,
            failed: false,
            status: last === undefined ? 'loading' : 'refetching',
            stale: false,
          },
        ];
      }),
    [list, raw, kept, failures],
  );
  return useMemo(() => ({ countries, reads }), [countries, reads]);
}
