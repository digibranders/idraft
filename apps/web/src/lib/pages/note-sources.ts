'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { apiAllPagesQuery, type ApiQueryOptions } from '@/lib/api/query';
import { useDebouncedValue } from '@/lib/dom/use-debounced-value';
import type { LinkScope } from '@/lib/internal-links/scopes';
import { DEFAULT_PAGE_QUERY, isPageRowPage, pageDetailQuery, pagesQuery } from '@/lib/internal-links/queries';
import type { LinksScope } from '@/lib/internal-links/types';
import { checkLabel, usePageIssues } from '@/lib/pages/issue-source';
import { MAX_SUGGESTIONS, type SuggestionSources } from '@/lib/pages/note-mentions';

/** How long the typing rests before the page search is sent. */
const SEARCH_DELAY_MS = 250;

/** The crawl and the link scope the drawer shows: the page detail and the issues are read for them. */
export interface NoteSourceView {
  run: string | null;
  linkScope: LinkScope;
}

export interface NoteSources {
  sources: SuggestionSources;
  /** A source is still being read (nothing shows for it yet). */
  loading: boolean;
}

const MEMBERS = '/api/v1/workspaces/{workspace_id}/members';

/**
 * The members of the workspace: the same read, and so the same cache entry, as the Members screen of the workspace
 * settings (a feature, which `lib` may not import).
 */
const membersRead = (workspaceId: string): ApiQueryOptions<typeof MEMBERS> =>
  apiAllPagesQuery(MEMBERS, (member) => member.user.user_id, { params: { path: { workspace_id: workspaceId } } });

const NONE: SuggestionSources = { teammates: [], pages: [], issues: [], keywords: [] };

/**
 * What the note box can mention (spec 9.8.2): the teammates of the workspace, the live pages of the crawl that match
 * `query`, the issues found on this page and the keywords tracked for it. Nothing is asked while `enabled` is false
 * (the list of suggestions is closed), the page search waits for the typing to rest, and a source that fails leaves
 * the others. The issues come only through the seam of the Issues session; the keywords come from the page's detail,
 * which the drawer has already read.
 */
export function useNoteSources(
  scope: LinksScope,
  urlId: string,
  query: string,
  enabled: boolean,
  view: NoteSourceView,
): NoteSources {
  const typed = useDebouncedValue(query.trim(), SEARCH_DELAY_MS);
  const members = useQuery({ ...membersRead(scope.workspaceId), enabled });
  const pages = useQuery({
    ...pagesQuery(
      scope,
      { ...DEFAULT_PAGE_QUERY, view: 'live', q: typed === '' ? null : typed, limit: MAX_SUGGESTIONS },
      view.run,
    ),
    enabled,
    placeholderData: keepPreviousData,
  });
  const detail = useQuery({ ...pageDetailQuery(scope, urlId, view.linkScope, view.run), enabled });
  const issues = usePageIssues(scope, view.run, urlId);
  const found = issues.state === 'ready' ? issues.data : null;

  const sources = useMemo<SuggestionSources>(
    () => ({
      teammates: (members.data?.data ?? []).map(({ user }) => ({ id: user.user_id, name: user.name })),
      // The list's answer is typed `unknown` (it declares a JSON and a CSV body): checked here, at the boundary
      pages: (isPageRowPage(pages.data) ? pages.data.data : []).slice(0, MAX_SUGGESTIONS).map((row) => ({
        id: row.url_id,
        path: row.path,
        title: row.title,
      })),
      issues: (found ?? []).map(({ checkId }) => ({ checkId, name: checkLabel(checkId) ?? checkId })),
      keywords: (detail.data?.data.extras.keywords ?? []).map((row) => row.keyword),
    }),
    [members.data, pages.data, found, detail.data],
  );
  if (!enabled) return { sources: NONE, loading: false };
  return { sources, loading: members.isPending || pages.isPending || detail.isPending };
}
