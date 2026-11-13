'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { useRead, type CitationRead } from '../citation-reads';
import { isApiProblem } from '@/lib/api/problem';
import { useErrorId } from '@/lib/api/use-error-id';
import { promptTextsById, promptTextsQuery } from '@/lib/citations/prompt-texts-query';
import { citationListQuery, sourceDomainDetailQuery, type SourceFilters } from '@/lib/citations/source-queries';
import type { CitationPage, SourceDomainDetail, SourceScope } from '@/lib/citations/types';

/** The read of one domain: the shape of the Citations strip's reads, and whether the API says it is not there. */
export interface DomainDetailRead extends CitationRead<SourceDomainDetail> {
  notFound: boolean;
}

/**
 * `ai/sources/domains/{registrable_domain}` for the inspector's domain over the page's scope. Another window or
 * filter keeps the last answer on screen while it reads (the figures are of the same domain); another domain does
 * not, so the figures of one domain are never drawn under the name of the next. A role filter changes nothing: the
 * detail is of the whole domain.
 */
export function useDomainDetail(source: SourceScope, registrable: string, filters: SourceFilters): DomainDetailRead {
  const name = registrable.toLowerCase();
  const query = useQuery({
    ...sourceDomainDetailQuery(source, name, filters),
    placeholderData: (previous) => (previous?.data.registrable_domain === name ? previous : undefined),
  });
  const errorId = useErrorId(query.error);
  return {
    // A failed refetch with data in hand keeps the data: it is not an empty inspector
    status: query.isError && query.data === undefined ? 'error' : query.isPending ? 'loading' : 'ready',
    data: query.data,
    errorId,
    retry: () => void query.refetch(),
    retrying: query.isFetching,
    // A name the API refuses (a hand-typed address) is a domain that is not there, as the prompt inspector reads it
    notFound:
      query.data === undefined &&
      (isApiProblem(query.error, 'not_found') || isApiProblem(query.error, 'validation_failed')),
  };
}

/** The most citations the Prompts tab reads to name each prompt's engines: one page, the most the route gives. */
export const DOMAIN_CITATIONS_LIMIT = 100;

/**
 * The latest citations of one domain, one page, whatever role the page filters to (the detail is of the whole
 * domain). Another window keeps the last rows on screen; the Prompts tab is keyed by the domain, so another domain
 * never shows these. It takes neither flag: the citation list keeps what the aggregates leave out.
 */
export function useDomainCitations(
  source: SourceScope,
  filters: SourceFilters,
  registrable: string,
): CitationRead<CitationPage> {
  return useRead(
    useQuery({
      ...citationListQuery(
        source,
        { ...filters, roles: [] },
        { limit: DOMAIN_CITATIONS_LIMIT, registrableDomain: registrable.toLowerCase() },
      ),
      placeholderData: keepPreviousData,
    }),
  );
}

/** The text of the project's prompts by id, from the prompts read (one page of 200); empty while there is none. */
export function usePromptTexts(source: SourceScope): CitationRead<ReadonlyMap<string, string>> {
  return useRead(useQuery({ ...promptTextsQuery(source), placeholderData: keepPreviousData, select: promptTextsById }));
}
