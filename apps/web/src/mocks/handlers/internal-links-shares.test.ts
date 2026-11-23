import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { MOCK_WORKSPACE } from '../fixtures';
import { EVENTUS } from '../internal-links-world';
import { RATE_LIMITED_TOKEN } from '../internal-links-shares-world';
import { TEST_API_ORIGIN } from '@/test/api-server';
import { mockBrowser } from '@/test/mock-api';

const P = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}/projects/${EVENTUS.project_id}`;
const SHARES = `${P}/internal-links/shares`;
const PUBLIC = '/api/v1/public/internal-links/summary';
const CREATED = z.object({
  data: z.object({ id: z.string(), token: z.string(), state: z.string(), expires_at: z.string() }),
});
const LIST = z.object({ data: z.array(z.object({ id: z.string(), state: z.string() })) });
const SUMMARY = z.object({
  data: z.object({
    host: z.string(),
    tiers: z.array(z.object({ code: z.string().nullable() })),
    worklists: z.array(z.object({ key: z.string(), count: z.number() })),
    lost: z.object({ state: z.string() }),
  }),
});

/** The public route needs no sign-in: no cookie goes with it. */
const publicRead = (token: string): Promise<Response> => fetch(`${TEST_API_ORIGIN}${PUBLIC}/${token}`);

describe('the client summary link mock API', () => {
  it('creates a link with the token once, lists it without the token, and opens the summary with no sign-in', async () => {
    const editor = mockBrowser('editor');
    const made = await editor.call('POST', SHARES, { expires_in_days: 7 });
    expect(made.status).toBe(201);
    const created = CREATED.parse(made.body).data;
    expect(created.state).toBe('active');
    const days = (Date.parse(created.expires_at) - Date.now()) / 86_400_000;
    expect(Math.round(days)).toBe(7);

    const list = await editor.call('GET', SHARES);
    expect(JSON.stringify(list.body)).not.toContain(created.token);
    const listed = LIST.parse(list.body).data;
    expect(listed.map((share) => share.id)).toEqual([created.id]);

    const open = await publicRead(created.token);
    expect(open.status).toBe(200);
    const summary = SUMMARY.parse(await open.json()).data;
    expect(summary.host).toBe('eventussecurity.com');
    expect(summary.worklists).toHaveLength(7);
    expect(summary.tiers.at(-1)?.code).toBeNull();
  });

  it('defaults to 30 days and refuses another number', async () => {
    const editor = mockBrowser('editor');
    const made = CREATED.parse((await editor.call('POST', SHARES, {})).body).data;
    expect(Math.round((Date.parse(made.expires_at) - Date.now()) / 86_400_000)).toBe(30);
    expect((await editor.call('POST', SHARES, { expires_in_days: 5 })).status).toBe(422);
  });

  it('revokes a link twice with the same answer, and then the token answers 404 like an unknown one', async () => {
    const editor = mockBrowser('editor');
    const { id, token } = CREATED.parse((await editor.call('POST', SHARES, {})).body).data;
    expect((await editor.call('DELETE', `${SHARES}/${id}`)).status).toBe(200);
    const again = await editor.call('DELETE', `${SHARES}/${id}`);
    expect(again.status).toBe(200);
    const states = LIST.parse((await editor.call('GET', SHARES)).body).data;
    expect(states.find((share) => share.id === id)?.state).toBe('revoked');

    const gone = await publicRead(token);
    const unknown = await publicRead('0'.repeat(48));
    expect(gone.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect((await gone.json()).code).toBe('not_found');
  });

  it('lets a viewer list the links and refuses it to create or revoke', async () => {
    const viewer = mockBrowser('viewer');
    expect((await viewer.call('GET', SHARES)).status).toBe(200);
    expect((await viewer.call('POST', SHARES, { expires_in_days: 30 })).status).toBe(403);
    expect((await viewer.call('DELETE', `${SHARES}/0192e4a0-a000-7000-8000-000000000001`)).status).toBe(403);
  });

  it('answers 429 with Retry-After for the rate limit token', async () => {
    const answer = await publicRead(RATE_LIMITED_TOKEN);
    expect(answer.status).toBe(429);
    expect(answer.headers.get('retry-after')).toBe('90');
  });
});
