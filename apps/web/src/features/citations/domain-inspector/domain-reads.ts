'use client';

import { useQuery } from '@tanstack/react-query';

import type { CitationRead } from '../citation-reads';
import { isApiProblem } from '@/lib/api/problem';
import { useErrorId } from '@/lib/api/use-error-id';
import { sourceDomainDetailQuery, type SourceFilters } from '@/lib/citations/source-queries';
import type { SourceDomainDetail, SourceScope } from '@/lib/citations/types';

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
