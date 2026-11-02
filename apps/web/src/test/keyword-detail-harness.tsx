import { Suspense, type ReactElement } from 'react';

import { KeywordDetailScreen } from '@/features/rankings/keyword-detail/keyword-detail-screen';
import type { Role } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { mockId } from '@/mocks/mock-ids';
import { SESSION_COOKIE } from '@/mocks/session';
import { fynix } from '@/test/rankings-harness';

/**
 * What the tests of the keyword page share: the screen for a signed-in role, and the fixture keywords that
 * show each state the page tells apart. The numbers are places in the mock list (`mockId('tracked', n)`).
 */

/** A keyword that ranks, with a ranking URL and a target URL, and one that stands for each other state. */
export const DETAIL_KEYWORDS = {
  ranked: { id: mockId('tracked', 1), text: 'seo agency berlin' },
  /** Stale because no check ran for 40 hours or more. */
  stale: { id: mockId('tracked', 34), text: 'fynix reviews' },
  /** Stale because its latest checks failed, with an older good check. */
  failing: { id: mockId('tracked', 17), text: 'content marketing agency' },
  /** Every check failed. */
  failed: { id: mockId('tracked', 7), text: 'seo audit checklist' },
  /** Added a moment ago, not checked yet. */
  pending: { id: mockId('tracked', 57), text: 'generative engine optimization' },
  archived: { id: mockId('tracked', 60), text: 'seo newsletter' },
} as const;

/** A well formed id that no keyword has. */
export const UNKNOWN_KEYWORD_ID = '00000000-0000-4000-8000-000000000000';

/** The page of the keyword `trackedKeywordId` for a member of `role`, signed in through the mock session cookie. */
export function keywordDetailAs(role: Role, trackedKeywordId: string = DETAIL_KEYWORDS.ranked.id): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return (
    <PermissionProvider membership={membershipFactory(role, { projectIds: null })}>
      <Suspense fallback={null}>
        <KeywordDetailScreen
          workspaceId={MOCK_WORKSPACE.workspace_id}
          projectId={fynix.project_id}
          workspaceSlug={MOCK_WORKSPACE.slug}
          projectSlug={fynix.slug}
          trackedKeywordId={trackedKeywordId}
          timeZone="Europe/Berlin"
        />
      </Suspense>
    </PermissionProvider>
  );
}
