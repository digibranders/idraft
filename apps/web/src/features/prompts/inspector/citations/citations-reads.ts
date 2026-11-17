'use client';

import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useState } from 'react';

import { ALL_ENGINES, MIN_SUPPORT, TOP_LIMIT } from './citations-model';
import { useCompare, type CompareMode } from '../../compare/use-compare';
import { observationsQuery } from '../../prompt-queries';
import type { PromptTabContext } from '../../seams/inspector-tabs';
import {
  citationListQuery,
  sourceChangesQuery,
  sourceDomainsQuery,
  sourcePagesQuery,
  type SourceFilters,
} from '@/lib/citations/source-queries';
import type {
  CitationPage,
  EngineCode,
  SourceChangePage,
  SourceDomainPage,
  SourcePagePage,
} from '@/lib/citations/types';
import type { Schemas } from '@/lib/api/types';
import { useErrorId, type ErrorIdWords } from '@/lib/api/use-error-id';

/** One read of the tab: what it has, and how to say so (the shape of `PromptAnswers`). */
export interface CitationRead<TPage> {
  status: 'loading' | 'error' | 'ready';
  data: TPage | undefined;
  errorId: ErrorIdWords | null;
  retry: () => void;
  retrying: boolean;
  /** The rows on screen are the last ones, while the read for the new choice is on its way. */
  refreshing: boolean;
}

export interface CitationReads {
  domains: CitationRead<SourceDomainPage>;
  pages: CitationRead<SourcePagePage>;
  /** The own pages cited by the prompt: `page.total` is their count (limit 1, only the total is used). */
  ownPages: CitationRead<SourcePagePage>;
  lost: CitationRead<SourceChangePage>;
  /** What the New markers are against, as the rows on screen were read: it turns when they do, not when the page's choice does. */
  compareMode: CompareMode;
}

export interface CitationChoice {
  /** `ALL_ENGINES` or an engine code. */
  engine: string;
}

function useRead<TPage>(query: UseQueryResult<TPage>): CitationRead<TPage> {
  const errorId = useErrorId(query.error);
  return {
    // An error with rows in hand keeps the rows: a failed refetch is not an empty tab
    status: query.isError && query.data === undefined ? 'error' : query.isPending ? 'loading' : 'ready',
    data: query.data,
    errorId,
    retry: () => void query.refetch(),
    retrying: query.isFetching,
    refreshing: query.isPlaceholderData,
  };
}

/**
 * The four reads of the Citations tab, for one prompt over the window of the inspector: the top domains and pages
 * (each with the period before, for the New markers), the own pages the prompt cites, and the lost domains. They
 * run only while the tab is mounted (the tabs unmount the panels that are not shown) and for a prompt that exists.
 * A branded prompt is read with `include_branded`, or its own answers would be left out (plan Q11). Every read
 * loads and fails alone.
 */
export function useCitationReads(context: PromptTabContext, { engine }: CitationChoice): CitationReads {
  const minSupport = MIN_SUPPORT;
  const { scope, promptId, range, exists, prompt } = context;
  const filters: SourceFilters = {
    from: range.from,
    to: range.to,
    promptId,
    ...(engine === ALL_ENGINES ? {} : { engines: [engine as EngineCode] }),
    ...(prompt?.is_branded === true ? { includeBranded: true } : {}),
  };
  const options = { placeholderData: keepPreviousData, enabled: exists } as const;
  // The New markers are against the period before, the one comparison the sources routes have (backend request 23 asks
  // for the same dates a year earlier): while the page compares with last year the tab reads none and says so
  const { mode } = useCompare();
  const asked = { limit: TOP_LIMIT, minSupport, compare: mode === 'previous', sort: '-observations' } as const;
  // The lists are ranked by the answers that cite a row, the number each row shows
  const domains = useQuery({ ...sourceDomainsQuery(scope, filters, asked), ...options });
  const pages = useQuery({ ...sourcePagesQuery(scope, filters, asked), ...options });
  // While the read for a new choice loads, the rows held are of the old one, so the words keep saying that
  const [compareMode, setCompareMode] = useState(mode);
  if (!domains.isPlaceholderData && compareMode !== mode) setCompareMode(mode);
  const ownPages = useQuery({
    ...sourcePagesQuery(scope, { ...filters, roles: ['own'] }, { limit: 1, minSupport: 1 }),
    ...options,
  });
  const lost = useQuery({
    ...sourceChangesQuery(scope, filters, { kind: 'lost', minSupport, limit: TOP_LIMIT }),
    ...options,
  });
  return {
    domains: useRead(domains),
    pages: useRead(pages),
    ownPages: useRead(ownPages),
    lost: useRead(lost),
    compareMode,
  };
}

export interface AnswerReads {
  /** The prompt's answers in the window: the read History shares (one cache entry). */
  answers: CitationRead<Schemas['ObservationPage']>;
  /** The first page of the citation rows of those answers, newest answer first. */
  citations: CitationRead<CitationPage>;
}

/** The most citation rows one read holds; the answers past them read n/a (the list is cut by rows, not by answers). */
const CITATION_ROWS = 200;

/**
 * The two reads of the answers section: the answers, and the citation rows to join to them by answer. Neither
 * follows the engine choice (every answer lists its engine) and they fail apart. A branded prompt is read with
 * `include_branded`, as the top lists are (plan Q11).
 */
export function useAnswerReads(context: PromptTabContext): AnswerReads {
  const { scope, promptId, range, exists, prompt } = context;
  const filters: SourceFilters = {
    from: range.from,
    to: range.to,
    promptId,
    ...(prompt?.is_branded === true ? { includeBranded: true } : {}),
  };
  const options = { placeholderData: keepPreviousData, enabled: exists } as const;
  const answers = useQuery({ ...observationsQuery(scope, promptId, range), ...options });
  const citations = useQuery({ ...citationListQuery(scope, filters, { limit: CITATION_ROWS }), ...options });
  return { answers: useRead(answers), citations: useRead(citations) };
}
