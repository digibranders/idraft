import { screen, waitFor, within } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { Suspense, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PromptsScreen } from './prompts-screen';
import type { Role } from '@/lib/api/types';
import * as csv from '@/lib/csv/csv-write';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { promptId, versionId } from '@/mocks/prompt-fixtures';
import { promptsOf } from '@/mocks/prompts-state';
import { mswPath } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { server } from '@/test/msw';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders, type ProvidedRender } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/ai/prompts',
}));

// The file is not written: the call is what the test reads
vi.mock('@/lib/csv/csv-write', async (importOriginal) => ({
  ...(await importOriginal<typeof csv>()),
  downloadBlob: vi.fn(),
}));

/** Thursday 12 November 2026, noon UTC: the 02:00 run has answered. */
const NOW = new Date('2026-11-12T12:00:00Z');
const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const RUN_NOW = mswPath(`${P}/prompts/{prompt_id}/run-now`);
const BULK_RUN = mswPath(`${P}/ai/runs`);
const BULK_ARCHIVE = mswPath(`${P}/prompts/bulk-archive`);

const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The Fynix project fixture is missing');

const FIRST = 'Which SEO agency is best for a SaaS startup in Germany?';
const SECOND = 'How do I run a technical SEO audit on a large site?';
const THIRD = 'What does a local SEO agency do for a shop in Berlin?';

/** A queued run of one prompt, as the API answers one (only its status matters here). */
const accepted = (): Response => HttpResponse.json({ data: { run_id: 'run' } }, { status: 202 });
/** A bulk run as the API answers it: the prompts it asks, and the pairs it left out. */
const queued = (prompts: number, skipped: Record<string, unknown>[] = [], used = 1): Response =>
  HttpResponse.json(
    {
      data: { run_id: 'run' },
      meta: {
        prompts,
        answers: prompts * 2,
        estimated_cost_usd: '0.012000',
        skipped,
        manual_runs_today: { used, limit: 20 },
      },
    },
    { status: 202 },
  );
/** A refusal as the API writes it (RFC 9457 problem JSON). */
const refused = (
  status: number,
  code: string,
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Response =>
  HttpResponse.json(
    { type: `https://api.idraft.ai/problems/${code}`, title: code, status, code, ...extra },
    { status, headers },
  );
/** The prompts a bulk request names. */
const idsOf = async (request: Request): Promise<string[]> =>
  ((await request.json()) as { prompt_ids: string[] }).prompt_ids;

beforeEach(() => {
  vi.setSystemTime(NOW);
  stubWideScreen();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  restoreWideScreen();
  server.events.removeAllListeners();
});

function promptsAs(role: Role): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return (
    <PermissionProvider membership={membershipFactory(role)}>
      <Suspense fallback={null}>
        <PromptsScreen
          workspaceId={MOCK_WORKSPACE.workspace_id}
          workspaceSlug={MOCK_WORKSPACE.slug}
          project={{
            id: fynix?.project_id ?? '',
            slug: 'fynix',
            name: 'Fynix',
            timeZone: 'Europe/Berlin',
            defaultLanguage: 'en',
            defaultCountryIso: 'DE',
          }}
        />
      </Suspense>
    </PermissionProvider>
  );
}

const renderOn = (role: Role, searchParams: string): ProvidedRender =>
  renderWithProviders(promptsAs(role), { searchParams });
const prompts = (): Promise<HTMLElement> => screen.findByRole('grid', { name: 'Prompts' });
const topics = (): Promise<HTMLElement> => screen.findByRole('treegrid', { name: 'Topics' });
const bar = (): HTMLElement => screen.getByRole('group', { name: /^Bulk actions/ });
/** A toast is also written for assistive technology, so its text is found more than once. */
const said = async (text: string | RegExp): Promise<void> => {
  expect(await screen.findAllByText(text)).not.toHaveLength(0);
};

async function tick(user: ProvidedRender['user'], texts: readonly string[]): Promise<void> {
  const table = await prompts();
  for (const text of texts) {
    await user.click(await within(table).findByRole('checkbox', { name: `Select ${text}` }));
  }
}

/** Opens the confirm of Run now for the prompts chosen, and presses its button. */
async function confirmRun(user: ProvidedRender['user'], count: number): Promise<void> {
  await user.click(within(bar()).getByRole('button', { name: 'Run now' }));
  await user.click(await screen.findByRole('button', { name: `Run ${String(count)} prompts` }));
}

/** More prompts than one bulk run takes: 160 more than the 23 of the fixtures, in the mocks' memory. */
function addPrompts(count: number): void {
  const state = promptsOf(fynix?.project_id ?? '');
  const [base] = state.prompts;
  if (base === undefined) throw new Error('The fixture prompts are missing');
  for (let at = 0; at < count; at += 1) {
    state.prompts.push({
      ...base,
      prompt_id: promptId(500 + at),
      version_id: versionId(500 + at),
      index: 500 + at,
      text: `Extra prompt number ${String(at)}?`,
      term_ids: [],
      is_branded: false,
    });
  }
}

describe('the bulk bar of the Prompts tab, by permission', () => {
  it('offers a viewer Export CSV and Clear, and no action that changes anything', async () => {
    const { user } = renderOn('viewer', '?tab=prompts');
    await tick(user, [FIRST]);
    expect(within(bar()).getByRole('button', { name: 'Export CSV' })).toBeInTheDocument();
    expect(within(bar()).queryByRole('button', { name: 'Run now' })).toBeNull();
    expect(within(bar()).queryByRole('button', { name: 'Archive' })).toBeNull();
    expect(within(bar()).queryByRole('button', { name: /Add to panel/ })).toBeNull();
  });

  it('offers an analyst Run now, and an editor Archive as well, with Archive after the other actions', async () => {
    const analyst = renderOn('analyst', '?tab=prompts');
    await tick(analyst.user, [FIRST]);
    expect(within(bar()).getByRole('button', { name: 'Run now' })).toBeInTheDocument();
    expect(within(bar()).queryByRole('button', { name: 'Archive' })).toBeNull();
    analyst.unmount();
    const editor = renderOn('editor', '?tab=prompts');
    await tick(editor.user, [FIRST]);
    const names = within(bar())
      .getAllByRole('button')
      .map((button) => button.textContent);
    expect(names.indexOf('Archive')).toBeGreaterThan(names.indexOf('Export CSV'));
  });
});

describe('Export CSV', () => {
  it('writes the chosen prompts as the table shows them, and nothing else', async () => {
    const download = vi.mocked(csv.downloadBlob);
    download.mockClear();
    const { user } = renderOn('viewer', '?tab=prompts');
    await tick(user, [FIRST, SECOND]);
    await user.click(within(bar()).getByRole('button', { name: 'Export CSV' }));
    expect(download).toHaveBeenCalledOnce();
    const [blob, name] = download.mock.calls[0] ?? [];
    expect(name).toBe('prompts-2026-10-16-to-2026-11-12.csv');
    const text = await (blob as Blob).text();
    const lines = text.trim().split('\r\n');
    expect(lines[0]).toContain(
      'Prompt,Topic,Country,Branded,Mention rate (%),Mention answers,Citation rate (%),Citation answers',
    );
    expect(lines).toHaveLength(3);
    expect(text).toContain(FIRST);
    expect(text).toContain(SECOND);
    expect(text).not.toContain('What does a local SEO agency do');
    await said('2 prompts exported');
  });
});

describe('Run now for the chosen prompts', () => {
  it('asks first, sends one request for every prompt with the engines left to the API, and says what started', async () => {
    const bulk: { prompt_ids: string[]; engine_codes?: string[] }[] = [];
    const single: string[] = [];
    server.events.on('request:start', async ({ request }) => {
      if (request.method !== 'POST') return;
      if (request.url.endsWith('/ai/runs')) bulk.push((await request.clone().json()) as (typeof bulk)[number]);
      if (request.url.endsWith('/run-now')) single.push(request.url);
    });
    const { user } = renderOn('editor', '?tab=prompts');
    await tick(user, [FIRST, SECOND]);
    await user.click(within(bar()).getByRole('button', { name: 'Run now' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Run 2 prompts now?' });
    // The day's runs used are not known before the first run
    expect(
      within(dialog).getByText('This is one manual run of 2 prompts. It counts as one of your 20 manual runs a day.'),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Run 2 prompts' }));
    // The title is one line of the toast, so the cost is the first words of its description
    await said('Run started: 2 prompts on 2 engines');
    await said(/^About \$\d/);
    expect(bulk).toHaveLength(1);
    expect(bulk[0]?.prompt_ids).toHaveLength(2);
    expect(bulk[0]?.engine_codes).toBeUndefined();
    expect(single).toEqual([]);
    // The choice is dropped once the runs are in
    await waitFor(() => expect(screen.queryByRole('group', { name: /^Bulk actions/ })).toBeNull());
  });

  it('runs one chosen prompt at once, through the prompt own route and with no confirm', async () => {
    const bulk: string[] = [];
    const single: string[] = [];
    server.events.on('request:start', ({ request }) => {
      if (request.method !== 'POST') return;
      if (request.url.endsWith('/ai/runs')) bulk.push(request.url);
      if (request.url.endsWith('/run-now')) single.push(request.url);
    });
    const { user } = renderOn('editor', '?tab=prompts');
    await tick(user, [FIRST]);
    await user.click(within(bar()).getByRole('button', { name: 'Run now' }));
    await said('Run queued');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(single).toHaveLength(1);
    expect(bulk).toEqual([]);
  });

  it('says what the API left out, and why in words, keeps those chosen, and counts the day in the next confirm', async () => {
    server.use(
      http.post(BULK_RUN, async ({ request }) => {
        const [first, second] = await idsOf(request);
        // One prompt too long on both engines, and the other with no location on one of them
        return queued(
          1,
          [
            { prompt_id: second, engine_code: 'chatgpt_web', reason: 'prompt_too_long' },
            { prompt_id: second, engine_code: 'gemini_web', reason: 'prompt_too_long' },
            { prompt_id: first, engine_code: 'gemini_web', reason: 'location_not_enabled' },
          ],
          4,
        );
      }),
    );
    const { user } = renderOn('editor', '?tab=prompts');
    await tick(user, [FIRST, SECOND]);
    await confirmRun(user, 2);
    await said('Run started: 1 prompt on 1 engine');
    await said('About $0.01. 3 prompt and engine pairs were left out: 2 too long and 1 with no location.');
    // Only the prompt that was asked leaves the choice; the other is kept to be tried again
    await waitFor(() => expect(within(bar()).getByText('1 selected')).toBeInTheDocument());
    // The confirm now knows how many runs of the day were used
    await tick(user, [THIRD]);
    await user.click(within(bar()).getByRole('button', { name: 'Run now' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Run 2 prompts now?' });
    expect(
      within(dialog).getByText('This is one manual run of 2 prompts. You have used 4 of 20 manual runs today.'),
    ).toBeInTheDocument();
  });

  it.each([
    [
      'a paused provider, with the minutes',
      () => refused(503, 'provider_paused', { retry_after_seconds: 600 }),
      'Not queued',
      /Collection from the provider is paused\. Try again in 10 minutes\./,
    ],
    [
      'the limit of manual runs of the day',
      () => refused(429, 'manual_run_limit', { limit: 20 }),
      'Not queued',
      /All 20 manual runs of today \(UTC\) are used, keyword refreshes included\. Try again tomorrow\./,
    ],
    [
      'the month of AI answers used up, with the numbers',
      () => refused(422, 'quota_exceeded', { limit: 100, used: 99, requested: 2 }),
      'Not queued',
      /The workspace has used 99 of 100 AI answers this month\. This run needs 2 more\./,
    ],
    [
      'that nothing started when every pair was left out, and why',
      () =>
        refused(422, 'nothing_to_run', {
          skipped: [
            { prompt_id: 'a', engine_code: 'chatgpt_web', reason: 'prompt_too_long' },
            { prompt_id: 'b', engine_code: 'gemini_web', reason: 'location_not_enabled' },
          ],
        }),
      'Nothing started',
      /Nothing was started: none of the prompts can be asked on an enabled engine\. 2 prompt and engine pairs were left out: 1 too long and 1 with no location\./,
    ],
    [
      'that nothing started when every prompt has an answer on its way',
      () => refused(409, 'check_pending', { prompt_ids: ['a', 'b'], skipped: [] }),
      'Nothing started',
      /Nothing was started: every prompt has an answer on its way already\./,
    ],
    [
      'the engine that is not turned on, by name',
      () =>
        refused(422, 'validation_failed', {
          errors: [
            {
              location: 'body',
              path: 'engine_codes',
              code: 'engine_not_enabled',
              message: 'gemini_web: The engine is not turned on for the project.',
            },
          ],
        }),
      'Not queued',
      /Gemini is not turned on for this project\./,
    ],
    [
      'a missing price',
      () => refused(422, 'price_unavailable'),
      'Not queued',
      /No price is known for ChatGPT and Gemini today, so they cannot be asked\./,
    ],
    [
      'too many requests, with the minutes',
      () => refused(429, 'rate_limited', {}, { 'retry-after': '120' }),
      'Not queued',
      /Too many requests\. Try again in 2 minutes\./,
    ],
    [
      'no permission',
      () => refused(403, 'forbidden'),
      'Not queued',
      /You do not have permission to run prompts in this project\./,
    ],
  ])('says %s and starts nothing', async (_name, respond, title, text) => {
    let calls = 0;
    server.use(
      http.post(BULK_RUN, () => {
        calls += 1;
        return respond();
      }),
    );
    const { user } = renderOn('editor', '?tab=prompts');
    await tick(user, [FIRST, SECOND]);
    await confirmRun(user, 2);
    await said(title);
    await said(text);
    // One request, no retry loop, and the choice stays to be tried again
    expect(calls).toBe(1);
    expect(within(bar()).getByText('2 selected')).toBeInTheDocument();
  });

  it('says that some prompts are archived or gone, and reads the list again', async () => {
    server.use(
      http.post(BULK_RUN, () =>
        refused(422, 'validation_failed', {
          errors: [{ location: 'body', path: 'prompt_ids', code: 'prompt_unknown', message: 'Unknown prompt' }],
        }),
      ),
    );
    let lists = 0;
    server.events.on('request:start', ({ request }) => {
      if (request.method === 'GET' && new URL(request.url).pathname.endsWith('/prompts')) lists += 1;
    });
    const { user } = renderOn('editor', '?tab=prompts');
    await tick(user, [FIRST, SECOND]);
    const before = lists;
    await confirmRun(user, 2);
    await said(/Nothing was started: some of the selected prompts are archived or gone\. The list is read again\./);
    await waitFor(() => expect(lists).toBeGreaterThan(before));
  });

  it('does not send a second request when the button is pressed again while the first goes on', async () => {
    let calls = 0;
    server.use(
      http.post(BULK_RUN, async () => {
        calls += 1;
        await delay(400);
        return queued(2);
      }),
    );
    const { user } = renderOn('editor', '?tab=prompts');
    await tick(user, [FIRST, SECOND]);
    await user.click(within(bar()).getByRole('button', { name: 'Run now' }));
    const confirm = await screen.findByRole('button', { name: 'Run 2 prompts' });
    await user.click(confirm);
    await waitFor(() => expect(calls).toBe(1));
    expect(confirm).toHaveAttribute('aria-busy', 'true');
    await user.click(confirm);
    await said(/^Run started: 2 prompts/);
    expect(calls).toBe(1);
  });

  it('leaves the choice alone when a row menu runs another prompt', async () => {
    const { user } = renderOn('editor', '?tab=prompts');
    const table = await prompts();
    await tick(user, [FIRST, SECOND]);
    await user.click(within(table).getByRole('button', { name: `Actions for ${THIRD}` }));
    await user.click(await screen.findByRole('menuitem', { name: 'Run now' }));
    await said('Run queued');
    expect(within(bar()).getByText('2 selected')).toBeInTheDocument();
  });

  it('does not start a second run while one goes on: the Run now of other rows waits, and says why', async () => {
    let calls = 0;
    server.use(
      http.post(RUN_NOW, async () => {
        calls += 1;
        await delay(500);
        return accepted();
      }),
    );
    const { user } = renderOn('editor', '?tab=prompts');
    const table = await prompts();
    await user.click(await within(table).findByRole('button', { name: `Actions for ${FIRST}` }));
    await user.click(await screen.findByRole('menuitem', { name: 'Run now' }));
    await waitFor(() => expect(calls).toBe(1));
    await user.click(within(table).getByRole('button', { name: `Actions for ${SECOND}` }));
    const second = await screen.findByRole('menuitem', { name: /Run now/ });
    expect(second).toHaveAttribute('aria-disabled', 'true');
    expect(second).toHaveTextContent('Another action is running.');
    await user.click(second);
    expect(calls).toBe(1);
  });
});

describe('Run now for more prompts than one run takes', () => {
  it('splits them into runs of 150, says so in the confirm, and stops at the first refusal with the rest kept chosen', async () => {
    addPrompts(160);
    const sizes: number[] = [];
    server.use(
      http.post(BULK_RUN, async ({ request }) => {
        const ids = await idsOf(request);
        sizes.push(ids.length);
        return sizes.length === 1 ? queued(ids.length) : refused(429, 'manual_run_limit', { limit: 20 });
      }),
    );
    const { user } = renderOn('editor', '?tab=prompts');
    const table = await prompts();
    await user.click(await within(table).findByRole('checkbox', { name: 'Select all 183 prompts loaded' }));
    await user.click(within(bar()).getByRole('button', { name: 'Run now' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Run 183 prompts now?' });
    expect(
      within(dialog).getByText(
        '183 prompts are more than one run takes, so this makes 2 manual runs of up to 150 prompts. They count as 2 of your 20 manual runs a day.',
      ),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Run 183 prompts' }));
    await said('Run started: 150 prompts on 2 engines');
    await said(
      /All 20 manual runs of today \(UTC\) are used, keyword refreshes included\. Try again tomorrow\. 33 prompts were not tried\.$/,
    );
    // The second run was the last one asked
    expect(sizes).toEqual([150, 33]);
    await waitFor(() => expect(within(bar()).getByText('33 selected')).toBeInTheDocument());
  }, 60_000);

  it('asks no run after the page was left in the middle of the first', async () => {
    addPrompts(160);
    let calls = 0;
    server.use(
      http.post(BULK_RUN, async ({ request }) => {
        calls += 1;
        const ids = await idsOf(request);
        await delay(150);
        return queued(ids.length);
      }),
    );
    const { user, unmount } = renderOn('editor', '?tab=prompts');
    const table = await prompts();
    await user.click(await within(table).findByRole('checkbox', { name: 'Select all 183 prompts loaded' }));
    await confirmRun(user, 183);
    await waitFor(() => expect(calls).toBe(1));
    unmount();
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(calls).toBe(1);
  }, 60_000);
});

describe('Archive for the chosen prompts', () => {
  it('archives the prompts in one request, says so once, and brings back exactly those with Undo', async () => {
    const sent: { ids: string[]; archive: boolean }[] = [];
    const single: string[] = [];
    server.events.on('request:start', async ({ request }) => {
      if (request.method === 'POST' && request.url.endsWith('/prompts/bulk-archive')) {
        sent.push((await request.clone().json()) as (typeof sent)[number]);
      } else if (request.url.includes('/prompts/') && (request.method === 'DELETE' || request.method === 'PATCH')) {
        single.push(request.method);
      }
    });
    const { user } = renderOn('editor', '?tab=prompts');
    await tick(user, [FIRST, SECOND]);
    await user.click(within(bar()).getByRole('button', { name: 'Archive' }));
    await said('2 prompts archived');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.archive).toBe(true);
    expect(sent[0]?.ids).toHaveLength(2);
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: `Select ${FIRST}` })).toBeNull());
    await user.click((await screen.findAllByRole('button', { name: 'Undo' }))[0] as HTMLElement);
    await said('2 prompts restored');
    expect(sent).toHaveLength(2);
    expect(sent[1]?.archive).toBe(false);
    expect([...(sent[1]?.ids ?? [])].sort()).toEqual([...(sent[0]?.ids ?? [])].sort());
    expect(single).toEqual([]);
    expect(await screen.findByRole('checkbox', { name: `Select ${FIRST}` })).toBeInTheDocument();
  });

  it('says how many of the prompts were archived when some were gone, and keeps Undo, which brings back those it found', async () => {
    server.use(http.post(BULK_ARCHIVE, () => HttpResponse.json({ data: { matched: 1, updated: 1 } })));
    const { user } = renderOn('editor', '?tab=prompts');
    await tick(user, [FIRST, SECOND]);
    await user.click(within(bar()).getByRole('button', { name: 'Archive' }));
    await said('Archived 1 of 2 prompts');
    await said('1 prompt was not changed: gone or archived already.');
    expect((await screen.findAllByRole('button', { name: 'Undo' })).length).toBeGreaterThan(0);
  });

  it('offers no Undo when some of the prompts it found were archived already, for it cannot tell which it changed', async () => {
    server.use(http.post(BULK_ARCHIVE, () => HttpResponse.json({ data: { matched: 2, updated: 1 } })));
    const { user } = renderOn('editor', '?tab=prompts');
    await tick(user, [FIRST, SECOND]);
    await user.click(within(bar()).getByRole('button', { name: 'Archive' }));
    await said('Archived 1 of 2 prompts');
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('says nothing was archived, and keeps the choice, when no prompt was changed', async () => {
    server.use(http.post(BULK_ARCHIVE, () => HttpResponse.json({ data: { matched: 0, updated: 0 } })));
    const { user } = renderOn('editor', '?tab=prompts');
    await tick(user, [FIRST, SECOND]);
    await user.click(within(bar()).getByRole('button', { name: 'Archive' }));
    await said('Not archived');
    await said('2 prompts were not changed: gone or archived already.');
    expect(within(bar()).getByText('2 selected')).toBeInTheDocument();
  });

  it.each([
    [
      'too many requests, with the minutes',
      () => refused(429, 'rate_limited', {}, { 'retry-after': '120' }),
      /Too many requests\. Try again in 2 minutes\./,
    ],
    [
      'no permission',
      () => refused(403, 'forbidden'),
      /You do not have permission to archive prompts in this project\./,
    ],
    [
      'a failure of the server',
      () => HttpResponse.json({ code: 'boom', title: 'boom', status: 500, type: 'x' }, { status: 500 }),
      /Try again in a moment\./,
    ],
  ])('says %s once, and keeps the prompts chosen', async (_name, respond, text) => {
    let calls = 0;
    server.use(
      http.post(BULK_ARCHIVE, () => {
        calls += 1;
        return respond();
      }),
    );
    const { user } = renderOn('editor', '?tab=prompts');
    await tick(user, [FIRST, SECOND, THIRD]);
    await user.click(within(bar()).getByRole('button', { name: 'Archive' }));
    await said('Not archived');
    await said(text);
    expect(calls).toBe(1);
    await waitFor(() => expect(within(bar()).getByText('3 selected')).toBeInTheDocument());
  });

  it('says when the workspace has no room to bring the prompts back, with the numbers', async () => {
    server.use(
      http.post(BULK_ARCHIVE, async ({ request }) => {
        const { archive } = (await request.json()) as { archive: boolean };
        return archive
          ? HttpResponse.json({ data: { matched: 2, updated: 2 } })
          : refused(422, 'quota_exceeded', { limit: 150, used: 149, requested: 2 });
      }),
    );
    const { user } = renderOn('editor', '?tab=prompts');
    await tick(user, [FIRST, SECOND]);
    await user.click(within(bar()).getByRole('button', { name: 'Archive' }));
    await said('2 prompts archived');
    await user.click((await screen.findAllByRole('button', { name: 'Undo' }))[0] as HTMLElement);
    await said('Not brought back');
    await said(
      'The workspace has 149 of 150 active prompts, so 2 prompts do not fit. None was brought back. Archive other prompts first.',
    );
  });

  it('says how many were brought back when Undo found fewer', async () => {
    server.use(
      http.post(BULK_ARCHIVE, async ({ request }) => {
        const { archive } = (await request.json()) as { archive: boolean };
        return HttpResponse.json({ data: archive ? { matched: 2, updated: 2 } : { matched: 2, updated: 1 } });
      }),
    );
    const { user } = renderOn('editor', '?tab=prompts');
    await tick(user, [FIRST, SECOND]);
    await user.click(within(bar()).getByRole('button', { name: 'Archive' }));
    await user.click((await screen.findAllByRole('button', { name: 'Undo' }))[0] as HTMLElement);
    await said('Restored 1 of 2 prompts');
  });

  it('does not send a second request while the first goes on: the Archive of other rows waits, and says why', async () => {
    let calls = 0;
    server.use(
      http.post(BULK_ARCHIVE, async () => {
        calls += 1;
        await delay(500);
        return HttpResponse.json({ data: { matched: 1, updated: 1 } });
      }),
    );
    const { user } = renderOn('editor', '?tab=prompts');
    const table = await prompts();
    await user.click(await within(table).findByRole('button', { name: `Actions for ${FIRST}` }));
    await user.click(await screen.findByRole('menuitem', { name: 'Archive' }));
    await waitFor(() => expect(calls).toBe(1));
    await user.click(within(table).getByRole('button', { name: `Actions for ${SECOND}` }));
    const archive = await screen.findByRole('menuitem', { name: /Archive/ });
    expect(archive).toHaveAttribute('aria-disabled', 'true');
    expect(archive).toHaveTextContent('Another action is running.');
    await user.click(archive);
    expect(calls).toBe(1);
  });
});

describe('the bulk bar of the Topics tab', () => {
  it('runs the prompts of a topic through the same confirm, with the run named', async () => {
    const { user } = renderOn('editor', '');
    const tree = await topics();
    await user.click(await within(tree).findByRole('checkbox', { name: 'Select SEO' }));
    expect(within(bar()).getByText('1 topic selected, 12 prompts')).toBeInTheDocument();
    await user.click(within(bar()).getByRole('button', { name: 'Run now' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Run 12 prompts now?' });
    expect(within(dialog).getByText(/This is one manual run of 12 prompts\./)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });
});
