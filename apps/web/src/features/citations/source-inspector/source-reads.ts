'use client';

import { useQuery } from '@tanstack/react-query';

import { useRead, useScopeMeta, type CitationRead } from '../citation-reads';
import { identityOf } from './source-model';
import { isApiProblem } from '@/lib/api/problem';
import { citationListQuery, sourcePagesQuery, type SourceFilters } from '@/lib/citations/source-queries';
import type { CitationPage, SourceDomainPage, SourcePagePage, SourceScope } from '@/lib/citations/types';

/**
 * The reads of the source inspector (plan D8, F10). No route reads one cited URL, so the page is read twice: the
 * citations of its `url_id` say who it is (and are what the Prompts and Answers tabs list), then the pages of its
 * domain give its row (units, share, engines, weekly series). The inspector is of the whole page: no read takes the
 * role filter, and the citation list takes neither flag (it answers 422 for them).
 */

/** The most citations of one page the inspector reads: one page, the most the route gives. */
export const SOURCE_CITATIONS_LIMIT = 100;
/** The most pages of its domain read to find the row: the route's page, as the Pages tab reads. */
const SOURCE_PAGES_LIMIT = 200;

const wholePage = (filters: SourceFilters): SourceFilters => ({ ...filters, roles: [] });

/** The citations of one page, and whether the API says the page is not there. */
export interface SourceCitationsRead extends CitationRead<CitationPage> {
  notFound: boolean;
}

/**
 * The newest citations of the page. Another window or filter keeps the last rows on screen while it reads (they are
 * of the same page); another page does not, so the rows of one page are never drawn under the next one's name. An id
 * that is no `url_id` (`null`, a hand-typed address) asks nothing and is a page that is not there.
 */
export function useSourceCitations(
  source: SourceScope,
  filters: SourceFilters,
  urlId: number | null,
): SourceCitationsRead {
  const query = useQuery({
    ...citationListQuery(source, wholePage(filters), { limit: SOURCE_CITATIONS_LIMIT, urlId: urlId ?? 0 }),
    enabled: urlId !== null,
    placeholderData: (previous) => (previous?.data[0]?.url_id === urlId ? previous : undefined),
  });
  return {
    ...useRead(query),
    notFound:
      urlId === null ||
      (query.data === undefined &&
        (isApiProblem(query.error, 'not_found') || isApiProblem(query.error, 'validation_failed'))),
  };
}

/**
 * The pages of one domain with their weekly series, the 200 most cited, for the row of the page. It asks nothing
 * until the first read has named the domain. Another window keeps the last rows; another domain does not.
 */
export function useSourcePageRow(
  source: SourceScope,
  filters: SourceFilters,
  registrable: string | null,
): CitationRead<SourcePagePage> {
  return useRead(
    useQuery({
      ...sourcePagesQuery(source, wholePage(filters), {
        include: ['series'],
        limit: SOURCE_PAGES_LIMIT,
        ...(registrable === null ? {} : { registrableDomain: registrable }),
      }),
      enabled: registrable !== null,
      placeholderData: (previous) => (previous?.data[0]?.registrable_domain === registrable ? previous : undefined),
    }),
  );
}

export interface SourceReads {
  citations: SourceCitationsRead;
  /** The pages of the page's domain: `loading` until the citations have named the domain. */
  page: CitationRead<SourcePagePage>;
  /**
   * The scope read, which has the units of each engine the share of an engine is of. It is the page's own read
   * (the same key), so with the Citations page open it is not asked again.
   */
  totals: CitationRead<SourceDomainPage>;
}

/** The three reads of the inspector, the second and third waiting for the first. */
export function useSourceReads(source: SourceScope, filters: SourceFilters, urlId: number | null): SourceReads {
  const citations = useSourceCitations(source, filters, urlId);
  const registrable = identityOf(citations.data?.data ?? [])?.registrable ?? null;
  return {
    citations,
    page: useSourcePageRow(source, filters, registrable),
    totals: useScopeMeta(source, filters, registrable !== null),
  };
}
