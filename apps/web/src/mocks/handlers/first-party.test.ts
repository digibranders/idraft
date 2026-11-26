import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { MOCK_PROJECTS, MOCK_WORKSPACE } from '../fixtures';
import type { Schemas } from '@/lib/api/types';
import { mockBrowser, type Answer, type MockBrowser } from '@/test/mock-api';

/**
 * The route `fp/ai-referrals` of the mock (WP-69). The answer is read through a strict shape declared against the
 * generated type, so a member the mock leaves out or adds that the schema does not have fails the parse.
 */
const COUNTS = z.strictObject({
  sessions: z.number().nullable(),
  engaged_sessions: z.number().nullable(),
  key_events: z.string().nullable(),
});
const VALUE: z.ZodType<Schemas['AiReferralValue']> = z.strictObject({
  sessions: z.number().nullable(),
  engaged_sessions: z.number().nullable(),
  key_events: z.string().nullable(),
  previous: COUNTS.nullable(),
});
const WINDOW = z.strictObject({ from: z.string(), to: z.string(), timezone: z.string() });
const RESPONSE: z.ZodType<Schemas['AiReferralsResponse']> = z.strictObject({
  data: z.array(
    z.strictObject({
      key: z.string(),
      ga4_ai_assistant_channel: VALUE.nullable(),
      own_rules: VALUE.nullable(),
      difference: z.number().nullable(),
    }),
  ),
  meta: z.strictObject({
    connected: z.boolean(),
    collected_through: z.string().nullable(),
    collected_since: z.string().nullable(),
    last_success_at: z.string().nullable(),
    window: WINDOW,
    compare_window: WINDOW.nullable(),
    window_collected: z.boolean(),
    rules_version: z.number().nullable(),
    lower_bound: z.boolean(),
    notes: z.array(z.string()),
  }),
});

/** Thursday 12 November 2026, noon UTC: Berlin's day is the 12th, so GA4 is collected through the 11th. */
const NOW = Date.parse('2026-11-12T12:00:00Z');
const fynix = MOCK_PROJECTS.find((project) => project.slug === 'fynix');
if (fynix === undefined) throw new Error('The fixture project Fynix is missing');
const PROJECT = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}/projects/${fynix.project_id}`;
const PERIOD = 'from=2026-10-15&to=2026-11-11';

async function read(browser: MockBrowser, query: string): Promise<Schemas['AiReferralsResponse']> {
  const answer = await browser.call('GET', `${PROJECT}/fp/ai-referrals?${query}`);
  expect(answer.status, JSON.stringify(answer.body)).toBe(200);
  return RESPONSE.parse(answer.body);
}

/** The owner links a GA4 property of Fynix, through the same routes the integrations page uses. */
async function linkGa4(browser: MockBrowser): Promise<void> {
  const started = await browser.call('POST', `${PROJECT}/integrations/google/authorize`, {});
  expect(started.status, JSON.stringify(started.body)).toBe(200);
  const data = z.object({ authorization_url: z.string() }).parse(started.body.data);
  const connectionId = new URL(data.authorization_url).searchParams.get('connection_id');
  const linked = await browser.call('POST', `${PROJECT}/integrations`, {
    connection_id: connectionId,
    kind: 'ga4',
    external_property: 'properties/398844007',
  });
  expect(linked.status, JSON.stringify(linked.body)).toBe(201);
}

const problemOf = (answer: Answer): string | undefined => answer.code;

beforeEach(() => {
  vi.spyOn(Date, 'now').mockImplementation(() => NOW);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('the AI referrals route of the mock', () => {
  it('says the project is not connected, with no row and the three fixed notes, until GA4 is linked', async () => {
    const answer = await read(mockBrowser('owner'), PERIOD);
    expect(answer.data).toEqual([]);
    expect(answer.meta).toMatchObject({ connected: false, collected_through: null, last_success_at: null });
    expect(answer.meta.notes).toHaveLength(3);
    expect(answer.meta.lower_bound).toBe(true);
  });

  it('answers what the schema says once GA4 is linked: collected through yesterday, ChatGPT first', async () => {
    const browser = mockBrowser('owner');
    await linkGa4(browser);
    const answer = await read(browser, `${PERIOD}&compare=previous_period`);
    expect(answer.meta).toMatchObject({
      connected: true,
      collected_through: '2026-11-11',
      window: { from: '2026-10-15', to: '2026-11-11', timezone: fynix.timezone },
      compare_window: { from: '2026-09-17', to: '2026-10-14' },
      rules_version: 1,
    });
    expect(answer.meta.notes).toHaveLength(3);
    expect(answer.data.map((row) => row.key).slice(0, 4)).toEqual(['chatgpt', 'perplexity', 'gemini', 'claude']);
    const [chatgpt] = answer.data;
    expect(chatgpt?.own_rules?.sessions).toBeGreaterThan(chatgpt?.ga4_ai_assistant_channel?.sessions ?? Infinity);
    expect(chatgpt?.difference).toBe(
      (chatgpt?.own_rules?.sessions ?? 0) - (chatgpt?.ga4_ai_assistant_channel?.sessions ?? 0),
    );
    expect(chatgpt?.own_rules?.previous).not.toBeNull();
  });

  it('leaves the previous null for the platform with no earlier figure, and the classifier it lacks null', async () => {
    const browser = mockBrowser('owner');
    await linkGa4(browser);
    const answer = await read(browser, `${PERIOD}&compare=previous_period`);
    const copilot = answer.data.find((row) => row.key === 'copilot');
    expect(copilot?.own_rules?.previous).toBeNull();
    const grok = answer.data.find((row) => row.key === 'grok');
    expect(grok?.ga4_ai_assistant_channel).toBeNull();
    expect(grok?.difference).toBeNull();
  });

  it('has no previous at all when nothing is compared, and the other classifier null when one is asked', async () => {
    const browser = mockBrowser('owner');
    await linkGa4(browser);
    const plain = await read(browser, PERIOD);
    expect(plain.meta.compare_window).toBeNull();
    for (const row of plain.data) expect(row.own_rules?.previous ?? null).toBeNull();
    const own = await read(browser, `${PERIOD}&classifier=own_rules`);
    for (const row of own.data) {
      expect(row.ga4_ai_assistant_channel).toBeNull();
      expect(row.difference).toBeNull();
    }
  });

  it('calls a period that ends today collected when yesterday is, and one that starts before the first pulled day not', async () => {
    const browser = mockBrowser('owner');
    await linkGa4(browser);
    const today = await read(browser, 'from=2026-11-05&to=2026-11-12&compare=previous_period');
    expect(today.meta).toMatchObject({ collected_since: '2026-08-14', window_collected: true });
    expect(today.meta.notes).toHaveLength(3);
    // The first pull reaches 90 days back: the days of this period before 14 August were never read
    const early = await read(browser, 'from=2026-07-20&to=2026-08-30&compare=previous_period');
    expect(early.meta.window_collected).toBe(false);
    expect(early.meta.notes.some((note) => note.startsWith('The figures start on 2026-08-14'))).toBe(true);
    expect(early.meta.notes.some((note) => note.includes('compared window is not fully collected'))).toBe(true);
    for (const row of early.data) expect(row.own_rules?.previous ?? null).toBeNull();
    const after = await read(browser, 'from=2026-11-13&to=2026-11-20');
    expect(after.data).toEqual([]);
    expect(after.meta.notes.some((note) => note.includes('before the start of this window'))).toBe(true);
  });

  it('refuses a group_by it does not build, a bad choice and a period of more than 92 days', async () => {
    const browser = mockBrowser('owner');
    expect(problemOf(await browser.call('GET', `${PROJECT}/fp/ai-referrals?group_by=landing_page`))).toBe(
      'not_available',
    );
    expect(problemOf(await browser.call('GET', `${PROJECT}/fp/ai-referrals?compare=weekly`))).toBe('validation_failed');
    expect(problemOf(await browser.call('GET', `${PROJECT}/fp/ai-referrals?compare_from=2026-10-01`))).toBe(
      'validation_failed',
    );
    expect(problemOf(await browser.call('GET', `${PROJECT}/fp/ai-referrals?from=2026-01-01&to=2026-11-11`))).toBe(
      'window_too_large',
    );
    expect(problemOf(await browser.call('GET', `${PROJECT}/fp/ai-referrals?surprise=1`))).toBe('validation_failed');
  });
});
