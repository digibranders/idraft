import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import {
  deletePersonalLayout,
  deleteTeamLayout,
  fetchLayout,
  ifMatchOf,
  layoutQueryKey,
  putPersonalLayout,
  putTeamLayout,
  toResolved,
  type ApiResolvedLayout,
} from './layout-api';
import { ApiProblem } from '@/lib/api/problem';
import { createApiClient, type ApiClient } from '@/lib/api/client';
import type { Role } from '@/lib/api/types';
import { SCREENS, type LayoutDocument, type ScreenKey } from '@/lib/layouts';
import { MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { mswPath } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { TEST_API_ORIGIN } from '@/test/api-server';
import { server } from '@/test/msw';

const WORKSPACE = MOCK_WORKSPACE.workspace_id;
const W = `/api/v1/workspaces/${WORKSPACE}`;

/** A client signed in as `role` through the mock session cookie (Node has no cookie jar). */
function clientAs(role: Role): ApiClient {
  const session = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 600_000)}`;
  return createApiClient({ baseUrl: TEST_API_ORIGIN, headers: { cookie: session } });
}

const DOCUMENT: LayoutDocument = {
  schema: 1,
  numbers: [],
  cards: [{ id: 'c1', type: 'seo.rank_distribution', width: 'half' }],
};

/** An answer of the API as it sends it: the members a layout leaves out come as null. */
function answer(overrides: Partial<ApiResolvedLayout> = {}): ApiResolvedLayout {
  return {
    screen: 'overview',
    source: 'builtin',
    document: null,
    team_default_exists: false,
    team_document: null,
    updated_at: null,
    updated_by: null,
    ...overrides,
  };
}

const SERVED: ApiResolvedLayout = answer({
  source: 'personal',
  document: {
    schema: 1,
    numbers: [],
    cards: [{ id: 'c1', type: 'seo.rank_distribution', width: 'half', options: null }],
  },
  updated_at: '2026-11-10T09:12:44Z',
  updated_by: { user_id: 'u-1', name: 'Mara Voss' },
});

describe('ifMatchOf', () => {
  it('gives no header without an ETag', () => {
    expect(ifMatchOf(null)).toBeUndefined();
  });

  it('keeps a strong ETag as it is', () => {
    expect(ifMatchOf('"a"')).toBe('"a"');
  });

  it('removes the weak prefix a compressing proxy adds', () => {
    expect(ifMatchOf('W/"a"')).toBe('"a"');
  });
});

describe('layoutQueryKey', () => {
  it('starts with the workspace, then the screen, so a screen is invalidated by its own key', () => {
    expect(layoutQueryKey(WORKSPACE, 'overview').slice(0, 4)).toEqual(['ws', WORKSPACE, 'layouts', 'overview']);
    expect(layoutQueryKey(WORKSPACE, 'overview')).not.toEqual(layoutQueryKey(WORKSPACE, 'rankings'));
  });
});

describe('fetchLayout', () => {
  it('answers the layout with its ETag', async () => {
    const read = await fetchLayout(clientAs('viewer'), WORKSPACE, 'overview');
    expect(read.layout.screen).toBe('overview');
    expect(read.layout.source).toBe('builtin');
    expect(read.etag).toMatch(/^".+"$/);
  });

  it('answers a null ETag when the answer has none', async () => {
    server.use(http.get(mswPath(`${W}/layouts/:screen`), () => HttpResponse.json({ data: answer() })));
    const read = await fetchLayout(clientAs('viewer'), WORKSPACE, 'overview');
    expect(read.etag).toBeNull();
  });

  it('rejects an unknown screen with the problem the API answered', async () => {
    const rejection = fetchLayout(clientAs('viewer'), WORKSPACE, 'nope' as ScreenKey);
    await expect(rejection).rejects.toBeInstanceOf(ApiProblem);
    await expect(rejection).rejects.toMatchObject({ status: 404, code: 'not_found' });
  });
});

describe('the writes', () => {
  it('putPersonalLayout sends the ETag as If-Match and the document as the body, and answers the new ETag', async () => {
    const sent: { ifMatch: string | null; body: unknown }[] = [];
    server.use(
      http.put(mswPath(`${W}/me/layouts/:screen`), async ({ request }) => {
        sent.push({ ifMatch: request.headers.get('if-match'), body: await request.json() });
        return HttpResponse.json({ data: SERVED }, { headers: { etag: '"new"' } });
      }),
    );
    const read = await putPersonalLayout(clientAs('viewer'), WORKSPACE, 'overview', DOCUMENT, 'W/"old"');
    expect(sent).toEqual([{ ifMatch: '"old"', body: DOCUMENT }]);
    expect(read).toEqual({ layout: SERVED, etag: '"new"' });
  });

  it('sends no If-Match for a first save', async () => {
    const sent: (string | null)[] = [];
    server.use(
      http.put(mswPath(`${W}/me/layouts/:screen`), ({ request }) => {
        sent.push(request.headers.get('if-match'));
        return HttpResponse.json({ data: SERVED }, { headers: { etag: '"new"' } });
      }),
    );
    await putPersonalLayout(clientAs('viewer'), WORKSPACE, 'overview', DOCUMENT, null);
    expect(sent).toEqual([null]);
  });

  it('putTeamLayout writes the team default route and needs layouts:manage', async () => {
    const read = await putTeamLayout(clientAs('admin'), WORKSPACE, 'overview', DOCUMENT, null);
    expect(read.layout.source).toBe('team');
    expect(read.layout.team_document?.cards?.[0]?.type).toBe('seo.rank_distribution');
    const refused = putTeamLayout(clientAs('viewer'), WORKSPACE, 'overview', DOCUMENT, null);
    await expect(refused).rejects.toMatchObject({ status: 403, code: 'forbidden' });
  });

  it('rejects a stale ETag with a precondition_failed problem', async () => {
    const rejection = putPersonalLayout(clientAs('viewer'), WORKSPACE, 'overview', DOCUMENT, '"stale"');
    await expect(rejection).rejects.toBeInstanceOf(ApiProblem);
    await expect(rejection).rejects.toMatchObject({ status: 412, code: 'precondition_failed' });
  });

  it('rejects a document the API refuses with its field errors', async () => {
    const wrong: LayoutDocument = { schema: 1, cards: [{ id: 'c1', type: 'inspector.key_numbers' }] };
    const rejection = putPersonalLayout(clientAs('viewer'), WORKSPACE, 'overview', wrong, null);
    await expect(rejection).rejects.toMatchObject({
      status: 422,
      errors: [expect.objectContaining({ path: 'cards.0.type', code: 'not_in_catalog' })],
    });
  });

  it('delete routes resolve with nothing, also when nothing was saved', async () => {
    await expect(deletePersonalLayout(clientAs('viewer'), WORKSPACE, 'overview')).resolves.toBeUndefined();
    await expect(deleteTeamLayout(clientAs('admin'), WORKSPACE, 'overview')).resolves.toBeUndefined();
  });

  it('deleteTeamLayout is refused without layouts:manage', async () => {
    const refused = deleteTeamLayout(clientAs('viewer'), WORKSPACE, 'overview');
    await expect(refused).rejects.toMatchObject({ status: 403, code: 'forbidden' });
  });
});

describe('toResolved', () => {
  it('gives a copy of the built-in layout of the screen when the API holds none', () => {
    const view = toResolved(answer(), 'overview');
    expect(view.source).toBe('builtin');
    expect(view.document).toEqual(SCREENS.overview.builtin);
    expect(view.document).not.toBe(SCREENS.overview.builtin);
    expect(view.repaired).toBe(false);
    expect(view.teamDefaultExists).toBe(false);
    expect(view.teamDocument).toBeNull();
    expect(view.updatedAt).toBeNull();
    expect(view.updatedBy).toBeNull();
  });

  it('reads who saved the layout and when', () => {
    const view = toResolved(SERVED, 'overview');
    expect(view.source).toBe('personal');
    expect(view.updatedAt).toBe('2026-11-10T09:12:44Z');
    expect(view.updatedBy).toEqual({ userId: 'u-1', name: 'Mara Voss' });
  });

  it('does not count a zone the API sends as null as a repair, for a screen with it or without it', () => {
    const stored = (cards: ApiResolvedLayout['document']): ApiResolvedLayout =>
      answer({ source: 'personal', document: cards, updated_at: '2026-11-10T09:12:44Z' });
    // An overview document with no numbers (null) and a rankings document with no cards at all
    expect(toResolved(stored({ schema: 1, numbers: null, cards: [] }), 'overview').repaired).toBe(false);
    expect(toResolved(stored({ schema: 1, numbers: [], cards: [] }), 'rankings').repaired).toBe(false);
  });

  it('does not count the null members of the API as a repair', () => {
    const view = toResolved(SERVED, 'overview');
    expect(view.document.cards).toEqual([{ id: 'c1', type: 'seo.rank_distribution', width: 'half' }]);
    expect(view.repaired).toBe(false);
  });

  it('drops a card the catalog does not know and says it repaired the layout', () => {
    const view = toResolved(
      answer({
        source: 'personal',
        document: {
          schema: 1,
          numbers: null,
          cards: [
            { id: 'gone', type: 'seo.not_a_card', width: 'half', options: null },
            { id: 'c1', type: 'seo.rank_distribution', width: 'half', options: null },
          ],
        },
      }),
      'overview',
    );
    expect(view.document.cards?.map((card) => card.id)).toEqual(['c1']);
    expect(view.repaired).toBe(true);
  });

  it('turns a null width, options and engine into the defaults of the type', () => {
    const view = toResolved(
      answer({
        source: 'personal',
        document: {
          schema: 1,
          numbers: [
            { id: 'n1', metric: 'ai.mention_rate', engine: null },
            { id: 'n2', metric: 'ai.mention_rate', engine: 'gemini_web' },
            { id: 'n3', metric: 'seo.top10_count', engine: null },
          ],
          cards: [{ id: 'c1', type: 'seo.top_movers', width: null, options: null }],
        },
      }),
      'overview',
    );
    // An AI number without an engine cannot be shown; an SEO number carries none
    expect(view.document.numbers).toEqual([
      { id: 'n2', metric: 'ai.mention_rate', engine: 'gemini_web' },
      { id: 'n3', metric: 'seo.top10_count' },
    ]);
    expect(view.document.cards).toEqual([
      { id: 'c1', type: 'seo.top_movers', width: 'half', options: { direction: 'all', rows: '5' } },
    ]);
    expect(view.repaired).toBe(true);
  });

  it('fills the zones of the screen that a stored document leaves out', () => {
    const view = toResolved(
      answer({ source: 'team', document: { schema: 1, numbers: null, cards: null }, team_default_exists: true }),
      'rankings',
    );
    expect(view.source).toBe('team');
    expect(view.document).toEqual({ schema: 1, numbers: [] });
  });

  describe('teamDocument', () => {
    const TEAM: ApiResolvedLayout['team_document'] = {
      schema: 1,
      numbers: null,
      cards: [
        { id: 't1', type: 'seo.top_movers', width: 'third', options: { direction: 'improved', rows: '10' } },
        { id: 'gone', type: 'seo.not_a_card', width: null, options: null },
      ],
    };

    it('is the team default sanitized, also when the personal layout wins', () => {
      const view = toResolved({ ...SERVED, team_default_exists: true, team_document: TEAM }, 'overview');
      expect(view.source).toBe('personal');
      expect(view.document.cards?.map((card) => card.id)).toEqual(['c1']);
      expect(view.teamDocument).toEqual({
        schema: 1,
        numbers: [],
        cards: [{ id: 't1', type: 'seo.top_movers', width: 'third', options: { direction: 'improved', rows: '10' } }],
      });
    });

    it('is null without a team default', () => {
      expect(toResolved(SERVED, 'overview').teamDocument).toBeNull();
      expect(toResolved(answer(), 'overview').teamDocument).toBeNull();
    });

    it('is null when the API leaves the member out (it is optional in the document)', () => {
      const without: ApiResolvedLayout = {
        screen: 'overview',
        source: 'builtin',
        document: null,
        team_default_exists: false,
        updated_at: null,
        updated_by: null,
      };
      expect(toResolved(without, 'overview').teamDocument).toBeNull();
    });
  });
});
