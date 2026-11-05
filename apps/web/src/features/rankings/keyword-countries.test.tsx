import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useKeywordCountries } from './keyword-countries';
import { refreshKeywords } from './rankings-queries';
import { makeQueryClient } from '@/lib/api/query-client';
import { MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { server } from '@/test/msw';
import { fynix } from '@/test/rankings-harness';

const SCOPE = { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: fynix.project_id } as const;
const COUNTRIES = '*/api/v1/workspaces/:w/projects/:p/tracked-keywords/countries';

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

beforeEach(() => {
  client = makeQueryClient({ retry: false });
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('viewer').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
});

describe('useKeywordCountries', () => {
  it('lists the countries the project has keywords in, the larger count first', async () => {
    const { result } = renderHook(() => useKeywordCountries(SCOPE), { wrapper });
    expect(result.current).toEqual({ countries: [], loading: true, failed: false });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.countries.map(({ locationId, name, countryIso }) => [locationId, name, countryIso])).toEqual([
      [2276, 'Germany', 'DE'],
      [2840, 'United States', 'US'],
    ]);
    expect(result.current.countries.every(({ keywordCount }) => keywordCount > 0)).toBe(true);
  });

  it('reads the countries again after an add, an archive or a delete', async () => {
    let asked = 0;
    server.use(
      http.get(COUNTRIES, () => {
        asked += 1;
        return HttpResponse.json({
          data: [
            {
              location: { location_id: 2276, name: 'Germany', country_iso: 'DE', location_type: 'Country' },
              keyword_count: asked,
            },
          ],
        });
      }),
    );
    const { result } = renderHook(() => useKeywordCountries(SCOPE), { wrapper });
    await waitFor(() => expect(result.current.countries[0]?.keywordCount).toBe(1));
    await refreshKeywords(client, SCOPE);
    await waitFor(() => expect(result.current.countries[0]?.keywordCount).toBe(2));
  });

  it('keys the countries by workspace and project', async () => {
    const { result } = renderHook(() => useKeywordCountries(SCOPE), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const [query] = client.getQueryCache().findAll({ queryKey: ['ws', SCOPE.workspaceId, 'p', SCOPE.projectId] });
    expect(query?.queryKey).toEqual([
      'ws',
      SCOPE.workspaceId,
      'p',
      SCOPE.projectId,
      'tracked-keywords',
      'countries',
      {},
    ]);
  });
});
