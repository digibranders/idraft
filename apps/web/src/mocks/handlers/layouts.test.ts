import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { LAYOUTS_COOKIE } from '../session';
import { jsonCookie } from '../cookie-json';
import { MOCK_WORKSPACE, mockUser } from '../fixtures';
import { SESSION_COOKIE } from '../session';
import type { Role, Schemas } from '@/lib/api/types';
import { resolvedLayoutScreenValues } from '@/lib/api/schema';
import { TEST_API_ORIGIN } from '@/test/api-server';

/**
 * The answers are read through shapes declared against the generated types: a change to `ResolvedLayout`
 * breaks this file at compile time. Every member the API fills is required here, so a mock that leaves one
 * out (`team_document`, the null members of an item) fails the parse.
 */
const NUMBER_ITEM: z.ZodType<Schemas['NumberItem']> = z.object({
  id: z.string(),
  metric: z.string(),
  engine: z.enum(['chatgpt_web', 'gemini_web', 'google_ai_mode']).nullable(),
});
const CARD_ITEM: z.ZodType<Schemas['CardItem']> = z.object({
  id: z.string(),
  type: z.string(),
  width: z.enum(['third', 'half', 'two_thirds', 'full']).nullable(),
  options: z.record(z.string(), z.string()).nullable(),
});
const DOCUMENT: z.ZodType<Schemas['LayoutDocument']> = z.object({
  schema: z.literal(1),
  numbers: z.array(NUMBER_ITEM).nullable(),
  cards: z.array(CARD_ITEM).nullable(),
});
const RESOLVED: z.ZodType<Schemas['ResolvedLayout']> = z.object({
  screen: z.enum(resolvedLayoutScreenValues),
  source: z.enum(['personal', 'team', 'builtin']),
  document: DOCUMENT.nullable(),
  team_default_exists: z.boolean(),
  team_document: DOCUMENT.nullable(),
  updated_at: z.string().nullable(),
  updated_by: z.object({ user_id: z.string(), name: z.string() }).nullable(),
});
const RESOLVED_RESPONSE: z.ZodType<Schemas['ResolvedLayoutResponse']> = z.object({ data: RESOLVED });
const BODY = z.record(z.string(), z.unknown());
const FIELD_ERRORS = z.object({ errors: z.array(z.object({ path: z.string(), code: z.string() })).optional() });

interface Reply {
  status: number;
  body: Record<string, unknown>;
  code: string | undefined;
  etag: string | null;
  /** `path:code` of each field error of a `422`. */
  fields: string[];
}

type Jar = Map<string, string>;

/**
 * One request as `role`, with the mock cookies of `jar` (the layout state lives in a cookie) and an optional
 * `If-Match`. `mockBrowser` cannot send headers, which the layouts routes are about.
 */
async function send(
  role: Role,
  jar: Jar,
  method: string,
  path: string,
  { body, ifMatch }: { body?: unknown; ifMatch?: string | null } = {},
): Promise<Reply> {
  const session = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 10 * 60 * 1000)}`;
  const response = await fetch(`${TEST_API_ORIGIN}${path}`, {
    method,
    headers: {
      cookie: [session, ...[...jar].map(([name, value]) => `${name}=${value}`)].join('; '),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(ifMatch === undefined || ifMatch === null ? {} : { 'if-match': ifMatch }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  const parsed = text === '' ? {} : BODY.parse(JSON.parse(text));
  for (const header of response.headers.getSetCookie()) {
    const [name = '', ...value] = (header.split(';')[0] ?? '').split('=');
    jar.set(name, value.join('='));
  }
  return {
    status: response.status,
    body: parsed,
    code: typeof parsed.code === 'string' ? parsed.code : undefined,
    etag: response.headers.get('etag'),
    fields: (FIELD_ERRORS.parse(parsed).errors ?? []).map((error) => `${error.path}:${error.code}`),
  };
}

const layoutOf = (reply: Reply): Schemas['ResolvedLayout'] => RESOLVED_RESPONSE.parse(reply.body).data;

const W = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}`;
const READ = `${W}/layouts/overview`;
const ME = `${W}/me/layouts/overview`;
const TEAM = `${W}/layouts/overview/default`;

const NUMBER = { id: 'n1', metric: 'ai.mention_rate', engine: 'chatgpt_web' };
const HALF = { id: 'c1', type: 'ai.by_engine', width: 'half' };
const FULL = { id: 'c1', type: 'ai.by_engine', width: 'full' };
const docOf = (card: Record<string, unknown>): Record<string, unknown> => ({
  schema: 1,
  numbers: [NUMBER],
  cards: [card],
});
const DOC_HALF = docOf(HALF);
const DOC_FULL = docOf(FULL);
/** What the API answers for `DOC_HALF`: the members it left out come back as null. */
const SERVED_HALF = {
  schema: 1,
  numbers: [NUMBER],
  cards: [{ ...HALF, options: null }],
};
const SERVED_FULL = { schema: 1, numbers: [NUMBER], cards: [{ ...FULL, options: null }] };

/** The `ETag` of a reply, which every `GET` and `PUT` answer carries. */
function etagOf(reply: Reply): string {
  if (reply.etag === null) throw new Error('The answer has no ETag');
  return reply.etag;
}

beforeEach(() => {
  // Two saves in one millisecond would share an ETag: the tests move the clock between writes
  vi.useFakeTimers({ toFake: ['Date'] });
});

afterEach(() => {
  vi.useRealTimers();
});

const tick = (): void => {
  vi.setSystemTime(Date.now() + 1000);
};

describe('reading a layout', () => {
  it('answers the built-in default with nulls, no team default and an opaque ETag', async () => {
    const jar: Jar = new Map();
    const reply = await send('viewer', jar, 'GET', READ);
    expect(reply.status).toBe(200);
    expect(layoutOf(reply)).toEqual({
      screen: 'overview',
      source: 'builtin',
      document: null,
      team_default_exists: false,
      team_document: null,
      updated_at: null,
      updated_by: null,
    });
    expect(reply.etag).toMatch(/^".+"$/);
  });

  it('answers 404 for a screen the API does not have, 422 for a malformed key, 401 without a session', async () => {
    const jar: Jar = new Map();
    expect(await send('viewer', jar, 'GET', `${W}/layouts/nope`)).toMatchObject({ status: 404, code: 'not_found' });
    expect(await send('viewer', jar, 'GET', `${W}/layouts/Bad1`)).toMatchObject({
      status: 422,
      fields: ['screen:string_pattern_mismatch'],
    });
    const anonymous = await fetch(`${TEST_API_ORIGIN}${READ}`);
    expect(anonymous.status).toBe(401);
  });
});

describe('saving a personal layout', () => {
  it('needs the ETag once a layout exists, and moves it on every change but not on the same document', async () => {
    const jar: Jar = new Map();
    const first = await send('viewer', jar, 'PUT', ME, { body: DOC_HALF });
    expect(first.status).toBe(200);
    expect(layoutOf(first)).toMatchObject({
      source: 'personal',
      document: SERVED_HALF,
      team_default_exists: false,
      team_document: null,
      updated_by: { user_id: mockUser('viewer').user_id, name: mockUser('viewer').name },
    });
    const afterFirst = etagOf(first);
    expect(etagOf(await send('viewer', jar, 'GET', READ))).toBe(afterFirst);

    // Without If-Match the layout must not exist yet: it does
    tick();
    expect(await send('viewer', jar, 'PUT', ME, { body: DOC_FULL })).toMatchObject({
      status: 412,
      code: 'precondition_failed',
    });

    const second = await send('viewer', jar, 'PUT', ME, { body: DOC_FULL, ifMatch: afterFirst });
    expect(second.status).toBe(200);
    expect(layoutOf(second).document).toEqual(SERVED_FULL);
    const afterSecond = etagOf(second);
    expect(afterSecond).not.toBe(afterFirst);

    // The same document again writes nothing: same ETag, same time
    tick();
    const same = await send('viewer', jar, 'PUT', ME, { body: DOC_FULL, ifMatch: afterSecond });
    expect(etagOf(same)).toBe(afterSecond);
    expect(layoutOf(same).updated_at).toBe(layoutOf(second).updated_at);

    // The ETag read before the second save is stale now
    expect(await send('viewer', jar, 'PUT', ME, { body: DOC_HALF, ifMatch: afterFirst })).toMatchObject({
      status: 412,
      code: 'precondition_failed',
    });
  });

  it('reads a document whose keys come in another order as the same document, as the API does', async () => {
    const reversed = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(reversed)
        : typeof value === 'object' && value !== null
          ? Object.fromEntries(
              Object.entries(value)
                .reverse()
                .map(([key, inner]) => [key, reversed(inner)]),
            )
          : value;
    const jar: Jar = new Map();
    const saved = await send('viewer', jar, 'PUT', ME, { body: DOC_FULL });
    tick();
    const same = await send('viewer', jar, 'PUT', ME, { body: reversed(DOC_FULL), ifMatch: etagOf(saved) });
    expect(etagOf(same)).toBe(etagOf(saved));
    expect(layoutOf(same).updated_at).toBe(layoutOf(saved).updated_at);
  });

  it('keeps each person and each screen apart', async () => {
    const jar: Jar = new Map();
    await send('viewer', jar, 'PUT', ME, { body: DOC_HALF });
    expect(layoutOf(await send('editor', jar, 'GET', READ)).source).toBe('builtin');
    expect(layoutOf(await send('viewer', jar, 'GET', `${W}/layouts/ai_overview`)).source).toBe('builtin');
    expect(layoutOf(await send('viewer', jar, 'GET', READ)).source).toBe('personal');
  });

  it('removes it with a DELETE that answers 204 also when nothing is there', async () => {
    const jar: Jar = new Map();
    await send('viewer', jar, 'PUT', ME, { body: DOC_HALF });
    expect((await send('viewer', jar, 'DELETE', ME)).status).toBe(204);
    expect((await send('viewer', jar, 'DELETE', ME)).status).toBe(204);
    expect(layoutOf(await send('viewer', jar, 'GET', READ)).source).toBe('builtin');
  });
});

describe('the team default', () => {
  it('is refused to a viewer, for the save and the delete', async () => {
    const jar: Jar = new Map();
    expect(await send('viewer', jar, 'PUT', TEAM, { body: DOC_HALF })).toMatchObject({
      status: 403,
      code: 'forbidden',
    });
    expect(await send('viewer', jar, 'DELETE', TEAM)).toMatchObject({ status: 403, code: 'forbidden' });
  });

  it('makes a viewer old ETag stale, shows as the team layout, and goes away with its DELETE', async () => {
    const jar: Jar = new Map();
    const before = etagOf(await send('viewer', jar, 'GET', READ));
    tick();
    const saved = await send('admin', jar, 'PUT', TEAM, { body: DOC_HALF });
    expect(saved.status).toBe(200);
    expect(layoutOf(saved)).toMatchObject({
      source: 'team',
      document: SERVED_HALF,
      team_default_exists: true,
      team_document: SERVED_HALF,
      updated_by: { user_id: mockUser('admin').user_id },
    });

    expect(await send('viewer', jar, 'PUT', ME, { body: DOC_FULL, ifMatch: before })).toMatchObject({
      status: 412,
      code: 'precondition_failed',
    });
    const read = await send('viewer', jar, 'GET', READ);
    expect(etagOf(read)).not.toBe(before);
    expect(layoutOf(read)).toMatchObject({ source: 'team', team_default_exists: true });

    // The team save wants the ETag too, and a second admin write of the same document keeps it
    expect(await send('admin', jar, 'PUT', TEAM, { body: DOC_FULL })).toMatchObject({ status: 412 });
    const again = await send('admin', jar, 'PUT', TEAM, { body: DOC_HALF, ifMatch: etagOf(saved) });
    expect(etagOf(again)).toBe(etagOf(saved));

    expect((await send('admin', jar, 'DELETE', TEAM)).status).toBe(204);
    expect((await send('admin', jar, 'DELETE', TEAM)).status).toBe(204);
    expect(layoutOf(await send('viewer', jar, 'GET', READ))).toMatchObject({
      source: 'builtin',
      document: null,
      team_default_exists: false,
      team_document: null,
    });
  });
});

describe('team_document', () => {
  it('is the team row even when the person own layout wins, and the same for every member', async () => {
    const jar: Jar = new Map();
    await send('admin', jar, 'PUT', TEAM, { body: DOC_HALF });
    tick();
    const read = await send('viewer', jar, 'GET', READ);
    const personal = await send('viewer', jar, 'PUT', ME, { body: DOC_FULL, ifMatch: etagOf(read) });
    expect(layoutOf(personal)).toMatchObject({
      source: 'personal',
      document: SERVED_FULL,
      team_default_exists: true,
      team_document: SERVED_HALF,
    });
    const viewer = layoutOf(await send('viewer', jar, 'GET', READ));
    expect(viewer).toMatchObject({ source: 'personal', document: SERVED_FULL, team_document: SERVED_HALF });
    expect(layoutOf(await send('editor', jar, 'GET', READ)).team_document).toEqual(SERVED_HALF);
  });

  it('is null without a team default, also when the person has a layout', async () => {
    const jar: Jar = new Map();
    const personal = await send('viewer', jar, 'PUT', ME, { body: DOC_HALF });
    expect(layoutOf(personal).team_document).toBeNull();
    expect(layoutOf(await send('viewer', jar, 'GET', READ))).toMatchObject({
      source: 'personal',
      team_default_exists: false,
      team_document: null,
    });
  });

  it('is null when the stored team row is damaged, and the person falls back to the built-in layout', async () => {
    const jar: Jar = new Map();
    const damaged = {
      id: 'row-1',
      // A card type the catalog does not list on this screen
      document: { schema: 1, cards: [{ id: 'c1', type: 'inspector.key_numbers' }] },
      updated_at: '2026-11-13T10:00:00.000Z',
      updated_by: { user_id: mockUser('admin').user_id, name: mockUser('admin').name },
    };
    const cookie = jsonCookie(LAYOUTS_COOKIE, { personal: {}, team: { overview: damaged } });
    const [pair = ''] = (cookie ?? '').split(';');
    const [name = '', ...value] = pair.split('=');
    jar.set(name, value.join('='));
    expect(layoutOf(await send('viewer', jar, 'GET', READ))).toMatchObject({
      source: 'builtin',
      document: null,
      team_default_exists: false,
      team_document: null,
    });
  });

  it('comes back on both PUT answers', async () => {
    const jar: Jar = new Map();
    const team = await send('admin', jar, 'PUT', TEAM, { body: DOC_HALF });
    expect(layoutOf(team).team_document).toEqual(SERVED_HALF);
    const mine = await send('viewer', jar, 'PUT', ME, { body: DOC_FULL });
    expect(layoutOf(mine).team_document).toEqual(SERVED_HALF);
  });
});

describe('refusing a document', () => {
  const put = (body: unknown, ifMatch?: string): Promise<Reply> =>
    send('viewer', new Map(), 'PUT', ME, { body, ...(ifMatch === undefined ? {} : { ifMatch }) });

  it('reports the catalog rules with the field path of each', async () => {
    expect((await put({ schema: 1, cards: [{ id: 'c1', type: 'ai.by_engine' }] })).status).toBe(200);
    expect(
      (
        await send('viewer', new Map(), 'PUT', `${W}/me/layouts/inspector.keyword`, {
          body: { schema: 1, cards: [{ id: 'c1', type: 'ai.by_engine' }] },
        })
      ).fields,
    ).toEqual(['cards.0.type:not_in_catalog']);
    expect((await put({ schema: 1, cards: [{ id: 'c1', type: 'ai.by_engine', width: 'third' }] })).fields).toEqual([
      'cards.0.width:width_not_allowed',
    ]);
    expect(
      (await put({ schema: 1, numbers: [{ id: 'n1', metric: 'seo.top10_count', engine: 'gemini_web' }] })).fields,
    ).toEqual(['numbers.0.engine:not_applicable']);
    expect((await put({ schema: 1, numbers: [{ id: 'n1', metric: 'ai.mention_rate' }] })).fields).toEqual([
      'numbers.0.engine:required',
    ]);
    expect((await put({ schema: 1, numbers: [{ id: 'n1', metric: 'nope.metric' }] })).fields).toEqual([
      'numbers.0.metric:not_in_catalog',
    ]);
  });

  it('names every problem of one request, and a zone the screen does not have', async () => {
    const reply = await send('viewer', new Map(), 'PUT', `${W}/me/layouts/rankings`, {
      body: { schema: 1, numbers: [], cards: [{ id: 'c1', type: 'ai.by_engine' }] },
    });
    expect(reply.fields).toEqual(['cards:not_on_screen']);
    const both = await send('viewer', new Map(), 'PUT', `${W}/me/layouts/inspector.keyword`, {
      body: { schema: 1, numbers: [{ id: 'n1', metric: 'seo.top10_count' }], cards: [{ id: 'c1', type: 'nope.card' }] },
    });
    expect(both.fields).toEqual(['numbers:not_on_screen', 'cards.0.type:not_in_catalog']);
  });

  it('refuses the AI Overview engine, which the API does not accept yet', async () => {
    const reply = await put({
      schema: 1,
      numbers: [{ id: 'n1', metric: 'ai.mention_rate', engine: 'google_ai_overview' }],
    });
    expect(reply).toMatchObject({ status: 422, code: 'validation_failed', fields: ['numbers.0.engine:literal_error'] });
  });

  it('checks the shape: members, limits and tokens', async () => {
    const cards = Array.from({ length: 13 }, (_, index) => ({ id: `c${String(index)}`, type: 'ai.by_engine' }));
    expect((await put({ schema: 1, cards })).fields).toEqual(['cards:too_long']);
    expect(
      (
        await put({
          schema: 1,
          numbers: Array.from({ length: 7 }, (_, i) => ({ id: `n${String(i)}`, metric: 'seo.top10_count' })),
        })
      ).fields,
    ).toEqual(['numbers:too_long']);
    expect((await put({ schema: 1, cards: [{ id: 'bad id', type: 'ai.by_engine' }] })).fields).toEqual([
      'cards.0.id:string_pattern_mismatch',
    ]);
    expect((await put({ schema: 1, extra: true })).fields).toEqual(['extra:extra_forbidden']);
    expect((await put({ schema: 2 })).fields).toEqual(['schema:literal_error']);
    expect((await put({ cards: [] })).fields).toEqual(['schema:missing']);
    expect((await put([])).fields).toEqual([':model_attributes_type']);
    expect(
      (await put({ schema: 1, cards: [{ id: 'c1', type: 'ai.by_engine', options: { 'Bad Key': 'x' } }] })).fields,
    ).toEqual(['cards.0.options.Bad Key:string_pattern_mismatch']);
  });

  it('refuses a document over 16 KB with an empty path, before the catalog rules', async () => {
    const options = Object.fromEntries(
      Array.from({ length: 70 }, (_, index) => [`k${String(index)}`, 'x'.repeat(256)]),
    );
    const reply = await put({ schema: 1, cards: [{ id: 'c1', type: 'nope.card', options }] });
    expect(reply).toMatchObject({ status: 422, code: 'validation_failed', fields: [':too_large'] });
  });

  it('answers 404 for an unknown screen after the shape and before the catalog, and 422 before 412', async () => {
    const unknown = `${W}/me/layouts/nope`;
    expect(await send('viewer', new Map(), 'PUT', unknown, { body: DOC_HALF })).toMatchObject({ status: 404 });
    expect((await send('viewer', new Map(), 'PUT', unknown, { body: { schema: 3 } })).status).toBe(422);
    // A stale ETag does not hide a bad document
    const jar: Jar = new Map();
    await send('viewer', jar, 'PUT', ME, { body: DOC_HALF });
    const bad = await send('viewer', jar, 'PUT', ME, {
      body: { schema: 1, cards: [{ id: 'c1', type: 'nope.card' }] },
      ifMatch: '"stale"',
    });
    expect(bad).toMatchObject({ status: 422, fields: ['cards.0.type:not_in_catalog'] });
  });

  it('writes nothing when it refuses', async () => {
    const jar: Jar = new Map();
    await send('viewer', jar, 'PUT', ME, { body: { schema: 1, cards: [{ id: 'c1', type: 'nope.card' }] } });
    expect(layoutOf(await send('viewer', jar, 'GET', READ)).source).toBe('builtin');
  });

  it('answers 422 mock_state_full when what a browser changed no longer fits in its cookie', async () => {
    const options = { a: 'x'.repeat(256), b: 'y'.repeat(256) };
    const cards = Array.from({ length: 12 }, (_, index) => ({
      id: `c${String(index)}`,
      type: 'ai.by_engine',
      options,
    }));
    const reply = await send('viewer', new Map(), 'PUT', ME, { body: { schema: 1, cards } });
    expect(reply).toMatchObject({ status: 422, code: 'mock_state_full' });
  });
});
