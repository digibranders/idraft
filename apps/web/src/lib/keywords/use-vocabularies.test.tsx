import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { createElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { useVocabularies } from './taxonomy-reads';
import { server } from '@/test/msw';

describe('useVocabularies with no vocabulary', () => {
  it('keeps the same list across renders, so a screen that builds filters from it does not render for ever', async () => {
    server.use(
      http.get('*/api/v1/workspaces/:workspaceId/vocabularies', () =>
        HttpResponse.json({ data: [], page: { has_more: false, next_cursor: null, limit: 200 } }),
      ),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }): ReactElement =>
      createElement(QueryClientProvider, { client }, children);
    const { result, rerender } = renderHook(() => useVocabularies({ workspaceId: 'w', projectId: 'p' }), { wrapper });
    await waitFor(() => expect(result.current.pending).toBe(false));
    const first = result.current.loaded;
    rerender();
    rerender();
    expect(result.current.loaded).toBe(first);
  });
});
