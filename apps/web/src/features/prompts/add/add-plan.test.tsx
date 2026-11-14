import { useQuery } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { useState, type ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { AddPromptsDialog } from '../add-prompts-dialog';
import { enginesQuery, usePromptList, type PromptScope } from '../prompt-queries';
import type { ProjectEngine, Role, Schemas } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { mswPath } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The Fynix project fixture is missing');
const SCOPE: PromptScope = { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: fynix.project_id };
const TRACKED = 'Which SEO agency is best for a SaaS startup in Germany?';
const FIRST = 'First question?';
const SECOND = 'Second question?';

const lintRoute = mswPath(`${P}/prompts/lint`);
const bulkCreate = mswPath(`${P}/prompts/bulk-create`);
const limitsRoute = mswPath(`${P}/ai/limits`);
const schedulesRoute = mswPath(`${P}/schedules`);

afterEach(() => {
  server.events.removeAllListeners();
});

interface HarnessProps {
  engines?: readonly ProjectEngine[];
  countryIso?: string | null;
  /** Takes these permissions away from an editor. */
  without?: readonly string[];
}

function Harness({ engines: given, countryIso = 'DE' }: Omit<HarnessProps, 'without'>): ReactElement {
  const engines = useQuery(enginesQuery(SCOPE));
  const list = usePromptList(SCOPE);
  const [open, setOpen] = useState(false);
  if (engines.data === undefined || list.loading) return <p>Loading</p>;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Add prompts
      </button>
      <AddPromptsDialog
        scope={SCOPE}
        open={open}
        onOpenChange={setOpen}
        engines={given ?? engines.data.data.filter((engine) => engine.is_enabled)}
        existing={list.rows}
        defaults={{ languageCode: 'en', countryIso }}
      />
    </>
  );
}

function asEditor({ without = [], ...props }: HarnessProps = {}): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('editor' satisfies Role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  const membership = membershipFactory('editor');
  return (
    <PermissionProvider
      membership={{ ...membership, permissions: membership.permissions.filter((key) => !without.includes(key)) }}
    >
      <Harness {...props} />
    </PermissionProvider>
  );
}

type User = ReturnType<typeof renderWithProviders>['user'];

async function openDialog(user: User): Promise<HTMLElement> {
  await user.click(await screen.findByRole('button', { name: 'Add prompts' }));
  return screen.findByRole('dialog', { name: 'Add prompts' });
}

async function typeList(user: User, dialog: HTMLElement, text: string): Promise<void> {
  await user.click(within(dialog).getByRole('textbox', { name: 'Prompts' }));
  await user.paste(text);
}

const engine = (
  code: Schemas['EngineEstimate']['engine_code'],
  cost: string | null,
  runNowCost: string | null,
  fit = 1,
): Schemas['EngineEstimate'] => ({
  engine_code: code,
  prompts_fit: fit,
  answers_per_month: Math.floor((fit * 2 * 52) / 12),
  monthly_cost_usd: cost,
  run_now_answers: fit,
  run_now_cost_usd: runNowCost,
});

interface Answer {
  limit?: number;
  used?: number;
  estimate?: Schemas['LintEstimate'];
  /** What the lint counts as created, when it is not the lines typed (a near duplicate, a prompt it leaves out). */
  wouldCreate?: number;
}

/** A lint answer that finds nothing wrong, with the places and the estimate the test names. */
function lintAnswer(texts: readonly string[], { limit = 150, used = 24, estimate, wouldCreate }: Answer): Response {
  const distinct = [...new Set(texts)];
  return HttpResponse.json({
    data: distinct.map((text) => ({
      text,
      is_branded: false,
      matched_aliases: [],
      warnings: [],
      suggested_prompt_type: 'question',
    })),
    quota: { limit, used, would_create: wouldCreate ?? distinct.length },
    ...(estimate === undefined ? {} : { estimate }),
  });
}

const textsOf = async (request: Request): Promise<string[]> => {
  const body = (await request.json()) as { items?: { text: string }[]; texts?: string[] };
  return body.items?.map((item) => item.text) ?? body.texts ?? [];
};

const lintWith = (answer: Answer): ReturnType<typeof http.post> =>
  http.post(lintRoute, async ({ request }) => lintAnswer(await textsOf(request), answer));

const PRICED: Schemas['LintEstimate'] = {
  engines: [engine('chatgpt_web', '0.03', '0.010800'), engine('gemini_web', '0.03', '0.010800')],
  total_monthly_cost_usd: '0.06',
};

const limitsWith = (used: number): ReturnType<typeof http.get> =>
  http.get(limitsRoute, () =>
    HttpResponse.json({
      data: {
        prompts: { limit: 150, used: 24 },
        ai_observations_month: { limit: 20000, used: 0 },
        manual_runs_today: { used, limit: 20 },
      },
    }),
  );

const NOT_CHECKED = 'The list could not be checked. You can still add it; the server checks it.';
const BUTTON_1 = { name: 'Add 1 prompt' };

describe('Add prompts: the plan', () => {
  it('turns Add off with the reason when the add needs more places than the workspace has, and on again when lines are removed', async () => {
    server.use(lintWith({ limit: 150, used: 149 }));
    const { user } = renderWithProviders(asEditor());
    const dialog = await openDialog(user);
    await typeList(user, dialog, `${FIRST}\n${SECOND}`);
    expect(
      await within(dialog).findByText(
        'This add needs 2 places and the workspace has 1. Remove 1 line, or archive prompts you no longer need.',
      ),
    ).toBeInTheDocument();
    const add = within(dialog).getByRole('button', { name: 'Add 2 prompts' });
    expect(add).toHaveAttribute('aria-disabled', 'true');
    expect(add).toHaveAccessibleDescription(/This add needs 2 places and the workspace has 1/);
    // Remove a line: it fits, and the same button is on
    await user.clear(within(dialog).getByRole('textbox', { name: 'Prompts' }));
    await user.paste(FIRST);
    const fits = await within(dialog).findByRole('button', BUTTON_1);
    await waitFor(() => expect(fits).not.toHaveAttribute('aria-disabled', 'true'));
    // The lint answers for the shorter list: the places fit exactly, and the over line is gone
    expect(
      await within(dialog).findByText('Workspace prompts: 149 of 150 used, 150 after this add.'),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText(/This add needs/)).toBeNull();
    expect(fits).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('counts the places by the number the lint gives, not by the lines typed', async () => {
    // Two lines, one of which the lint does not create: 149 used and one place makes the add fit exactly
    server.use(lintWith({ limit: 150, used: 149, wouldCreate: 1 }));
    const { user } = renderWithProviders(asEditor());
    const dialog = await openDialog(user);
    await typeList(user, dialog, `${FIRST}\n${SECOND}`);
    expect(
      await within(dialog).findByText('Workspace prompts: 149 of 150 used, 150 after this add.'),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText(/This add needs/)).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Add 2 prompts' })).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('shows the answers a month and the cost of each engine from the estimate', async () => {
    server.use(lintWith({ estimate: PRICED }));
    const { user } = renderWithProviders(asEditor());
    const dialog = await openDialog(user);
    await typeList(user, dialog, FIRST);
    expect(
      await within(dialog).findByText('About 16 answers a month: 1 prompt x 2 engines x 2 runs a week.'),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText('About $0.06 a month: ChatGPT $0.03 and Gemini $0.03 (standard queue).'),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('Workspace prompts: 24 of 150 used, 25 after this add.')).toBeInTheDocument();
  });

  it('writes under one cent as under $0.01 and an engine without a price as no price, never $0.00', async () => {
    server.use(
      lintWith({
        estimate: {
          engines: [engine('chatgpt_web', '0.00', '0.001200'), engine('gemini_web', null, null)],
          total_monthly_cost_usd: '0.00',
        },
      }),
    );
    const { user } = renderWithProviders(asEditor());
    const dialog = await openDialog(user);
    await typeList(user, dialog, FIRST);
    expect(
      await within(dialog).findByText('Under $0.01 a month: ChatGPT under $0.01 (standard queue).'),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('Gemini: no price in the price book.')).toBeInTheDocument();
    expect(within(dialog).queryByText(/\$0\.00/)).toBeNull();
  });

  it('keeps the last numbers at full strength while the lint is out, says it is checking, and leaves Add on', async () => {
    let calls = 0;
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post(lintRoute, async ({ request }) => {
        calls += 1;
        // The first answer says the add does not fit; the next one is held back
        if (calls > 1) await held;
        return lintAnswer(await textsOf(request), { limit: 150, used: 149 });
      }),
    );
    const { user } = renderWithProviders(asEditor());
    const dialog = await openDialog(user);
    await typeList(user, dialog, `${FIRST}\n${SECOND}`);
    const over = await within(dialog).findByText(/This add needs 2 places and the workspace has 1/);
    const block = within(dialog).getByRole('group', { name: 'What this add takes' });
    expect(block).toHaveAttribute('aria-busy', 'false');
    await user.type(within(dialog).getByRole('textbox', { name: 'Prompts' }), '{Enter}Third question?');
    expect(await within(dialog).findByText('Checking...')).toBeInTheDocument();
    expect(block).toHaveAttribute('aria-busy', 'true');
    // The last numbers stay, undimmed, and the API has the last word: Add is on while it checks
    expect(over).toBeInTheDocument();
    expect(block.querySelector('[class*="opacity"]')).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Add 3 prompts' })).not.toHaveAttribute('aria-disabled', 'true');
    release();
    await waitFor(() => expect(within(dialog).queryByText('Checking...')).toBeNull());
    expect(await within(dialog).findByText(/This add needs 3 places and the workspace has 1/)).toBeInTheDocument();
    expect(block).toHaveAttribute('aria-busy', 'false');
  });

  it('says the list could not be checked, shows no numbers, and still adds it', async () => {
    server.use(http.post(lintRoute, () => HttpResponse.json({ code: 'internal' }, { status: 500 })));
    const { user } = renderWithProviders(asEditor());
    const dialog = await openDialog(user);
    await typeList(user, dialog, FIRST);
    expect(await within(dialog).findByText(NOT_CHECKED)).toBeInTheDocument();
    expect(within(dialog).queryByText(/answers a month/)).toBeNull();
    expect(within(dialog).queryByText(/Workspace prompts/)).toBeNull();
    const add = within(dialog).getByRole('button', BUTTON_1);
    expect(add).not.toHaveAttribute('aria-disabled', 'true');
    await user.click(add);
    expect(await screen.findByText('1 prompt added')).toBeInTheDocument();
  });

  it('says what asking now adds, costs and uses of the day, from the run values and the manual runs today', async () => {
    server.use(lintWith({ estimate: PRICED }), limitsWith(4));
    const { user } = renderWithProviders(asEditor());
    const dialog = await openDialog(user);
    await typeList(user, dialog, FIRST);
    expect(
      await within(dialog).findByText(
        "Asking them now adds 2 answers, about $0.02, and uses 1 of today's 20 manual runs (4 used).",
      ),
    ).toBeInTheDocument();
  });

  it('says why asking now is off beside its cost when the day has no manual runs left, and nothing while it fits', async () => {
    server.use(lintWith({ estimate: PRICED }), limitsWith(20));
    const { user } = renderWithProviders(asEditor());
    const dialog = await openDialog(user);
    await typeList(user, dialog, FIRST);
    expect(
      await within(dialog).findByText("Today's 20 manual runs are used. They reset at 00:00 UTC."),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/Asking them now adds 2 answers/)).toBeInTheDocument();
    // Asking being off does not turn Add off
    expect(within(dialog).getByRole('button', BUTTON_1)).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('leaves the ask line out without the right to run and without an engine on', async () => {
    server.use(lintWith({ estimate: PRICED }), limitsWith(4));
    const first = renderWithProviders(asEditor({ without: ['runs:trigger'] }));
    const dialog = await openDialog(first.user);
    await typeList(first.user, dialog, FIRST);
    await within(dialog).findByText(/About 16 answers a month/);
    expect(within(dialog).queryByText(/Asking them now/)).toBeNull();
    first.unmount();
    const second = renderWithProviders(asEditor({ engines: [] }));
    const none = await openDialog(second.user);
    await typeList(second.user, none, FIRST);
    await within(none).findByText(/Workspace prompts/);
    expect(within(none).queryByText(/Asking them now/)).toBeNull();
    expect(within(none).queryByText(/Scheduled answers/)).toBeNull();
  });

  it('shows no estimate and no zero before a country is chosen, and leaves Add on', async () => {
    const { user } = renderWithProviders(asEditor({ countryIso: null }));
    const dialog = await openDialog(user);
    await typeList(user, dialog, `${FIRST}\n${SECOND}`);
    expect(await within(dialog).findByText('Choose a country to check what is tracked.')).toBeInTheDocument();
    expect(within(dialog).queryByText(/answers a month/)).toBeNull();
    expect(within(dialog).queryByText(/Workspace prompts/)).toBeNull();
    expect(within(dialog).queryByText(/\$/)).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Add 2 prompts' })).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('says scheduled answers are paused when no schedule is active, and never a date', async () => {
    server.use(
      lintWith({}),
      http.get(schedulesRoute, () => HttpResponse.json({ data: [], page: { offset: 0, limit: 50, total: 0 } })),
    );
    const { user } = renderWithProviders(asEditor());
    const dialog = await openDialog(user);
    await typeList(user, dialog, FIRST);
    expect(
      await within(dialog).findByText(
        'Scheduled answers are paused, so these are asked only when someone asks them now.',
      ),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText(/First scheduled answers/)).toBeNull();
  });

  it('names the time of the first scheduled answers in the time zone of that schedule when one is active', async () => {
    server.use(
      lintWith({}),
      http.get(schedulesRoute, () =>
        HttpResponse.json({
          data: [
            {
              schedule_id: '0192d1a8-e000-7a10-8e00-000000000501',
              project_id: SCOPE.projectId,
              name: 'AI answers',
              workload: 'ai_prompt',
              cadence: 'weekly',
              cron_expr: null,
              weekday: 4,
              month_day: null,
              window_start_local: '01:00:00',
              window_hours: 8,
              timezone: 'UTC',
              priority: 'standard',
              provider_mode: 'standard_queue',
              selector: { all: true },
              is_active: true,
              created_at: '2026-11-01T00:00:00Z',
              last_run_id: null,
              next_run_at: '2026-11-19T01:00:00Z',
            },
          ],
          page: { offset: 0, limit: 50, total: 1 },
        }),
      ),
    );
    const { user } = renderWithProviders(asEditor());
    const dialog = await openDialog(user);
    await typeList(user, dialog, FIRST);
    expect(await within(dialog).findByText('First scheduled answers: Nov 19, 2026 · 01:00 UTC.')).toBeInTheDocument();
  });

  it('keeps a disabled Add focusable and describes its reason, and sends nothing on Enter', async () => {
    const sent: string[] = [];
    server.use(
      http.post(bulkCreate, () => {
        sent.push('bulk-create');
        return HttpResponse.json({ data: { created: [], skipped: [], rejected: [] } });
      }),
    );
    const { user } = renderWithProviders(asEditor());
    const dialog = await openDialog(user);
    await typeList(user, dialog, TRACKED);
    const add = await within(dialog).findByRole('button', { name: 'Add prompts' });
    await waitFor(() => expect(add).toHaveAttribute('aria-disabled', 'true'));
    expect(add).toHaveAccessibleDescription(/Every line is already tracked\./);
    // The reason is read from the plan block the button points at
    expect(add).toHaveAttribute(
      'aria-describedby',
      within(dialog).getByRole('group', { name: 'What this add takes' }).id,
    );
    add.focus();
    expect(add).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(sent).toEqual([]);
  });

  it('puts the plan in one line in the footer for a phone', async () => {
    server.use(lintWith({ estimate: PRICED }));
    const { user } = renderWithProviders(asEditor());
    const dialog = await openDialog(user);
    await typeList(user, dialog, FIRST);
    await within(dialog).findByText(/About 16 answers a month/);
    const footer = dialog.querySelector('[data-slot="dialog-footer"]');
    if (!(footer instanceof HTMLElement)) throw new Error('The dialog has no footer');
    expect(within(footer).getByText('1 prompt, about $0.06 a month, and 25 of 150')).toHaveClass('sm:hidden');
  });

  it('has no accessibility violations with the whole plan shown', async () => {
    server.use(lintWith({ estimate: PRICED }), limitsWith(4));
    const { user } = renderWithProviders(asEditor());
    const dialog = await openDialog(user);
    await typeList(user, dialog, FIRST);
    await within(dialog).findByText(/Asking them now adds/);
    await within(dialog).findByText(/Scheduled answers are paused|First scheduled answers/);
    expect(await axe(document.body)).toHaveNoViolations();
  });
});
