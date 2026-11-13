import { QueryClientProvider, useQuery, type QueryClient } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { entitiesQuery } from './entities-query';
import {
  citationListQuery,
  filterParams,
  sourceChangesQuery,
  sourceDiversityQuery,
  sourceDomainsQuery,
  sourcePagesQuery,
  sourcePromptsQuery,
  type SourceFilters,
} from './source-queries';
import type { SourceScope } from './types';
import { makeQueryClient } from '@/lib/api/query-client';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';

const [fynix, cleanstart] = MOCK_PROJECTS;
if (fynix === undefined || cleanstart === undefined) throw new Error('The fixture projects are missing');
const scope: SourceScope = { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: fynix.project_id };
const other: SourceScope = { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: cleanstart.project_id };
const FILTERS: SourceFilters = { from: '2026-10-16', to: '2026-11-12' };
/** Thursday 12 November 2026, noon UTC: the Thursday run of 02:00 has answered. */
const NOW = Date.parse('2026-11-12T12:00:00Z');
const PREFIX = ['ws', scope.workspaceId, 'p', scope.projectId, 'ai'];

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

beforeEach(() => {
  vi.spyOn(Date, 'now').mockImplementation(() => NOW);
  client = makeQueryClient({ retry: false });
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('admin').user_id}.${String(NOW + 600_000)}; Path=/; Secure`;
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** The query values of a key: its last element. */
const queryOf = (key: readonly unknown[]): unknown => key.at(-1);

describe('filterParams', () => {
  it('leaves out empty and default values so the key equals the URL', () => {
    const empty = { ...FILTERS, engines: [], roles: [], includeBranded: false };
    expect(filterParams(empty)).toEqual({ from: FILTERS.from, to: FILTERS.to });
    expect(queryOf(sourceDomainsQuery(scope, empty).queryKey)).toEqual({ from: FILTERS.from, to: FILTERS.to });
    expect(sourceDomainsQuery(scope, empty).queryKey).toEqual(sourceDomainsQuery(scope, FILTERS).queryKey);
  });

  it('writes engines as filter[engine_code_in] and roles as filter[domain_role_in]', () => {
    expect(
      filterParams({
        ...FILTERS,
        engines: ['gemini_web', 'chatgpt_web'],
        roles: ['own', 'competitor'],
        promptId: 'p-1',
        term: 't-1',
        includeBranded: true,
      }),
    ).toEqual({
      from: FILTERS.from,
      to: FILTERS.to,
      'filter[engine_code_in]': ['gemini_web', 'chatgpt_web'],
      'filter[domain_role_in]': ['own', 'competitor'],
      'filter[prompt_id]': 'p-1',
      'filter[term]': 't-1',
      include_branded: true,
    });
  });

  it('country sends filter[country_iso]', () => {
    const german = { ...FILTERS, country: 'DE' } satisfies SourceFilters;
    expect(filterParams(german)).toEqual({ from: FILTERS.from, to: FILTERS.to, 'filter[country_iso]': 'DE' });
    for (const query of [
      sourceDomainsQuery(scope, german),
      sourcePagesQuery(scope, german),
      sourceDiversityQuery(scope, german),
      sourceChangesQuery(scope, german, { kind: 'new' }),
      sourcePromptsQuery(scope, german),
    ]) {
      expect(queryOf(query.queryKey)).toHaveProperty('filter[country_iso]', 'DE');
    }
  });

  it('no country sends none, and the key equals the one without the field', () => {
    for (const query of [
      sourceDomainsQuery(scope, FILTERS),
      sourcePagesQuery(scope, FILTERS),
      sourceDiversityQuery(scope, FILTERS),
      sourceChangesQuery(scope, FILTERS, { kind: 'new' }),
      sourcePromptsQuery(scope, FILTERS),
      citationListQuery(scope, FILTERS),
    ]) {
      expect(queryOf(query.queryKey)).not.toHaveProperty('filter[country_iso]');
    }
    expect(sourceDomainsQuery(scope, { ...FILTERS, country: 'DE' }).queryKey).not.toEqual(
      sourceDomainsQuery(scope, FILTERS).queryKey,
    );
  });

  it('the citations list takes it too', () => {
    const german = { ...FILTERS, country: 'DE' } satisfies SourceFilters;
    expect(queryOf(citationListQuery(scope, german, { limit: 1 }).queryKey)).toEqual({
      from: FILTERS.from,
      to: FILTERS.to,
      'filter[country_iso]': 'DE',
      limit: 1,
    });
  });

  it('does not alter the lists it is given', () => {
    const engines = ['chatgpt_web'] as const;
    expect(filterParams({ ...FILTERS, engines })['filter[engine_code_in]']).not.toBe(engines);
  });
});

describe('the builders', () => {
  it('sourceDomainsQuery asks include as a list and min_support only when set', () => {
    const plain = queryOf(sourceDomainsQuery(scope, FILTERS).queryKey);
    expect(plain).toEqual({ from: FILTERS.from, to: FILTERS.to });
    const asked = queryOf(
      sourceDomainsQuery(scope, FILTERS, {
        include: ['series', 'cited_with', 'by_role_by_engine'],
        minSupport: 2,
        compare: true,
        sort: '-observations',
        limit: 200,
        offset: 50,
      }).queryKey,
    );
    expect(asked).toEqual({
      from: FILTERS.from,
      to: FILTERS.to,
      include: ['series', 'cited_with', 'by_role_by_engine'],
      min_support: 2,
      compare: 'previous_period',
      sort: '-observations',
      limit: 200,
      offset: 50,
    });
    // The server's own defaults are not sent
    expect(
      queryOf(sourceDomainsQuery(scope, FILTERS, { sort: '-citation_units', offset: 0, include: [] }).queryKey),
    ).toEqual(plain);
  });

  it('sourcePagesQuery filters one domain and takes series alone', () => {
    expect(
      queryOf(
        sourcePagesQuery(scope, FILTERS, { registrableDomain: 'fynix.digital', include: ['series'], limit: 10 })
          .queryKey,
      ),
    ).toEqual({
      from: FILTERS.from,
      to: FILTERS.to,
      'filter[registrable_domain]': 'fynix.digital',
      include: ['series'],
      limit: 10,
    });
  });

  it('the routes that have no role filter never send one', () => {
    const roles = { ...FILTERS, roles: ['own'] } satisfies SourceFilters;
    for (const key of [
      sourceDiversityQuery(scope, roles).queryKey,
      sourcePromptsQuery(scope, roles, { ownCited: false }).queryKey,
    ]) {
      expect(queryOf(key)).not.toHaveProperty('filter[domain_role_in]');
    }
    for (const key of [
      sourceDomainsQuery(scope, roles).queryKey,
      sourcePagesQuery(scope, roles).queryKey,
      sourceChangesQuery(scope, roles, { kind: 'lost' }).queryKey,
      citationListQuery(scope, roles).queryKey,
    ]) {
      expect(queryOf(key)).toHaveProperty('filter[domain_role_in]', ['own']);
    }
  });

  it('a flag is sent only when true', () => {
    const redirects = { ...FILTERS, includeUnresolvedRedirects: true } satisfies SourceFilters;
    const internal = { ...FILTERS, includeEngineInternal: true } satisfies SourceFilters;
    const both = { ...redirects, includeEngineInternal: true } satisfies SourceFilters;
    const off = { ...FILTERS, includeUnresolvedRedirects: false, includeEngineInternal: false } satisfies SourceFilters;
    const routes = (filters: SourceFilters): (readonly unknown[])[] => [
      sourceDomainsQuery(scope, filters).queryKey,
      sourcePagesQuery(scope, filters).queryKey,
      sourceDiversityQuery(scope, filters).queryKey,
      sourceChangesQuery(scope, filters, { kind: 'new' }).queryKey,
      sourcePromptsQuery(scope, filters).queryKey,
    ];
    for (const key of routes(redirects)) {
      expect(queryOf(key)).toHaveProperty('include_unresolved_redirects', true);
      expect(queryOf(key)).not.toHaveProperty('include_engine_internal');
    }
    for (const key of routes(internal)) {
      expect(queryOf(key)).toHaveProperty('include_engine_internal', true);
      expect(queryOf(key)).not.toHaveProperty('include_unresolved_redirects');
    }
    for (const key of routes(both)) {
      expect(queryOf(key)).toMatchObject({ include_unresolved_redirects: true, include_engine_internal: true });
    }
    // false is the default, so it is left out and the key equals the URL
    expect(routes(off)).toEqual(routes(FILTERS));
  });

  it('no flag key at all by default', () => {
    for (const key of [
      sourceDomainsQuery(scope, FILTERS).queryKey,
      sourcePagesQuery(scope, FILTERS).queryKey,
      sourceDiversityQuery(scope, FILTERS).queryKey,
      sourceChangesQuery(scope, FILTERS, { kind: 'lost' }).queryKey,
      sourcePromptsQuery(scope, FILTERS).queryKey,
      citationListQuery(scope, FILTERS).queryKey,
    ]) {
      expect(queryOf(key)).not.toHaveProperty('include_unresolved_redirects');
      expect(queryOf(key)).not.toHaveProperty('include_engine_internal');
    }
  });

  it('the citation list query never sends a flag', () => {
    // The route answers 422 for both: the list keeps flagged citations whatever is asked
    const flagged = {
      ...FILTERS,
      includeUnresolvedRedirects: true,
      includeEngineInternal: true,
    } satisfies SourceFilters;
    expect(queryOf(citationListQuery(scope, flagged, { limit: 1 }).queryKey)).toEqual(
      queryOf(citationListQuery(scope, FILTERS, { limit: 1 }).queryKey),
    );
    expect(queryOf(citationListQuery(scope, flagged).queryKey)).not.toHaveProperty('include_unresolved_redirects');
    expect(queryOf(citationListQuery(scope, flagged).queryKey)).not.toHaveProperty('include_engine_internal');
  });

  it('sourcePromptsQuery keeps ownCited false, which is a filter and not an absence', () => {
    expect(queryOf(sourcePromptsQuery(scope, FILTERS, { ownCited: false }).queryKey)).toHaveProperty(
      'filter[own_cited]',
      false,
    );
    expect(queryOf(sourcePromptsQuery(scope, FILTERS).queryKey)).not.toHaveProperty('filter[own_cited]');
  });

  it('share one cache key for the same scope, and one prefix under the project and ai', () => {
    const build = (target: SourceScope): (readonly unknown[])[] => [
      sourceDomainsQuery(target, FILTERS, { limit: 1 }).queryKey,
      sourcePagesQuery(target, FILTERS).queryKey,
      sourceDiversityQuery(target, FILTERS).queryKey,
      sourceChangesQuery(target, FILTERS, { kind: 'new', minSupport: 2, limit: 1 }).queryKey,
      citationListQuery(target, FILTERS, { limit: 1 }).queryKey,
      sourcePromptsQuery(target, FILTERS, { ownCited: false, limit: 10 }).queryKey,
    ];
    const keys = build(scope);
    expect(build(scope)).toEqual(keys);
    for (const key of keys) {
      expect(key.slice(0, PREFIX.length)).toEqual(PREFIX);
      // No `undefined` in a key, in its parts or in its values
      expect(key.every((part) => part !== undefined)).toBe(true);
      expect(Object.values(queryOf(key) as Record<string, unknown>).every((value) => value !== undefined)).toBe(true);
    }
    expect(new Set(keys.map((key) => JSON.stringify(key))).size).toBe(keys.length);
    expect(build(other).map((key) => key[3])).toEqual(keys.map(() => other.projectId));
  });

  it('tell two windows and two kinds of change apart', () => {
    const later = { ...FILTERS, to: '2026-11-11' };
    expect(sourceDomainsQuery(scope, FILTERS).queryKey).not.toEqual(sourceDomainsQuery(scope, later).queryKey);
    expect(sourceChangesQuery(scope, FILTERS, { kind: 'new' }).queryKey).not.toEqual(
      sourceChangesQuery(scope, FILTERS, { kind: 'lost' }).queryKey,
    );
  });

  it('entitiesQuery is the project entities read, so its cache is shared and a prompt change does not refresh it', () => {
    expect(entitiesQuery(scope).queryKey).toEqual(['ws', scope.workspaceId, 'p', scope.projectId, 'entities', {}]);
  });
});

describe('a read answers the typed page through the mock', () => {
  it('sourceDomainsQuery', async () => {
    const { result } = renderHook(
      () => useQuery(sourceDomainsQuery(scope, FILTERS, { include: ['by_role_by_engine'], limit: 2 })),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const page = result.current.data;
    expect(page?.data).toHaveLength(2);
    expect(page?.page.total).toBeGreaterThan(2);
    expect(page?.meta.citation_units).toBeGreaterThan(0);
    expect(page?.meta.by_role_by_engine).toHaveLength(3);
    expect(page?.data[0]?.source_share.denominator).toBe(page?.meta.citation_units);
  });

  it('sourcePagesQuery', async () => {
    const { result } = renderHook(
      () => useQuery(sourcePagesQuery(scope, FILTERS, { registrableDomain: 'fynix.digital', limit: 3 })),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data.length).toBeGreaterThan(0);
    expect(result.current.data?.data.every((row) => row.registrable_domain === 'fynix.digital')).toBe(true);
  });

  it('sourceDiversityQuery', async () => {
    const { result } = renderHook(() => useQuery(sourceDiversityQuery(scope, FILTERS)), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data.map((engine) => engine.engine_code)).toEqual([
      'chatgpt_web',
      'gemini_web',
      'google_ai_mode',
    ]);
    expect(result.current.data?.meta.distinct_domains).toBeGreaterThan(0);
  });

  it('sourceChangesQuery', async () => {
    const { result } = renderHook(
      () => useQuery(sourceChangesQuery(scope, FILTERS, { kind: 'lost', minSupport: 1, limit: 5 })),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.meta.kind).toBe('lost');
    expect(result.current.data?.data.every((row) => row.current_units === 0)).toBe(true);
  });

  it('citationListQuery', async () => {
    const { result } = renderHook(() => useQuery(citationListQuery(scope, FILTERS, { limit: 4 })), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data).toHaveLength(4);
    expect(result.current.data?.page.has_more).toBe(true);
  });

  it('sourcePromptsQuery', async () => {
    const { result } = renderHook(() => useQuery(sourcePromptsQuery(scope, FILTERS, { ownCited: false, limit: 5 })), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data.every((row) => row.answers_citing_own === 0)).toBe(true);
  });

  it('entitiesQuery', async () => {
    const { result } = renderHook(() => useQuery(entitiesQuery(scope)), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data.length).toBeGreaterThan(0);
  });
});
