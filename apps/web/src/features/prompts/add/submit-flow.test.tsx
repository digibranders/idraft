import { useQuery } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { useState, type ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { useJustAdded } from './just-added-store';
import { AddPromptsDialog } from '../add-prompts-dialog';
import { enginesQuery, usePromptList, type PromptScope } from '../prompt-queries';
import { useInspector } from '@/components/app/inspector/use-inspector';
import type { Role, Schemas } from '@/lib/api/types';
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

const lintRoute = mswPath(`${P}/prompts/lint`);
const bulkCreate = mswPath(`${P}/prompts/bulk-create`);
const bulkArchive = mswPath(`${P}/prompts/bulk-archive`);
const bulkRun = mswPath(`${P}/ai/runs`);
const limitsRoute = mswPath(`${P}/ai/limits`);

const id = (n: number): string => `0192d1a8-e000-7a10-8e00-${String(n).padStart(12, '0')}`;
const CREATED = [id(100), id(101)];
const ARCHIVED_ID = id(200);
const EXISTING_ID = id(300);

afterEach(() => {
  server.events.removeAllListeners();
});

interface Sent {
  method: string;
  path: string;
  body: unknown;
}

/** Every write the dialog sends, in order, with its body. */
function recordWrites(): Sent[] {
  const sent: Sent[] = [];
  server.events.on('request:start', ({ request }) => {
    const path = new URL(request.url).pathname.replace(/^.*\/(prompts|ai)\//, '$1/');
    // The lint is a read that happens to be a POST
    if (request.method === 'GET' || path === 'prompts/lint') return;
    void request
      .clone()
      .text()
      .then((text) =>
        sent.push({ method: request.method, path, body: text === '' ? null : (JSON.parse(text) as unknown) }),
      );
  });
  return sent;
}
const writesTo = (sent: readonly Sent[], suffix: string): Sent[] => sent.filter((entry) => entry.path.endsWith(suffix));

const estimateOf = (fit: number): Schemas['LintEstimate'] => ({
  engines: (['chatgpt_web', 'gemini_web'] as const).map((code) => ({
    engine_code: code,
    prompts_fit: fit,
    answers_per_month: Math.floor((fit * 2 * 52) / 12),
    monthly_cost_usd: '0.03',
    run_now_answers: fit,
    run_now_cost_usd: '0.010800',
  })),
  total_monthly_cost_usd: '0.06',
});

interface LintFake {
  limit?: number;
  used?: number;
  /** Texts the project has archived: the id of the prompt each one is. */
  archived?: Readonly<Record<string, string>>;
}

/** A lint that finds the texts new, but for the archived ones, with an estimate so that asking now can be priced. */
const lintWith = ({ limit = 150, used = 24, archived = {} }: LintFake = {}): ReturnType<typeof http.post> =>
  http.post(lintRoute, async ({ request }) => {
    const body = (await request.json()) as { items?: { text: string }[]; texts?: string[] };
    const texts = [...new Set(body.items?.map((item) => item.text) ?? body.texts ?? [])];
    const fresh = texts.filter((text) => archived[text] === undefined);
    return HttpResponse.json({
      data: texts.map((text) => ({
        text,
        is_branded: false,
        matched_aliases: [],
        warnings: [],
        suggested_prompt_type: 'question',
        ...(archived[text] === undefined ? {} : { tracked: { prompt_id: archived[text], is_active: false } }),
      })),
      quota: { limit, used, would_create: fresh.length },
      estimate: estimateOf(fresh.length),
    });
  });

const limitsWith = (used = 4): ReturnType<typeof http.get> =>
  http.get(limitsRoute, () =>
    HttpResponse.json({
      data: {
        prompts: { limit: 150, used: 24 },
        ai_observations_month: { limit: 20000, used: 0 },
        manual_runs_today: { used, limit: 20 },
      },
    }),
  );

const created = (
  ids: readonly string[],
  rest: Partial<Schemas['PromptBulkResult']> = {},
): ReturnType<typeof http.post> =>
  http.post(bulkCreate, () => HttpResponse.json({ data: { created: ids, skipped: [], rejected: [], ...rest } }));

const archiveAnswer = (): ReturnType<typeof http.post> =>
  http.post(bulkArchive, async ({ request }) => {
    const ids = ((await request.json()) as { ids: string[] }).ids;
    return HttpResponse.json({ data: { matched: ids.length, updated: ids.length } });
  });

const queued = (prompts: number): Response =>
  HttpResponse.json(
    {
      data: { run_id: 'run' },
      meta: {
        prompts,
        answers: prompts * 2,
        estimated_cost_usd: '0.012000',
        skipped: [],
        manual_runs_today: { used: 5, limit: 20 },
      },
    },
    { status: 202 },
  );

const refused = (status: number, code: string, extra: Record<string, unknown> = {}): Response =>
  HttpResponse.json(
    { type: `https://api.idraft.ai/problems/${code}`, title: code, status, code, ...extra },
    { status },
  );

function Probe(): ReactElement | null {
  const ids = useJustAdded();
  const { target } = useInspector();
  return (
    <>
      <p>{`just added: ${[...ids].join(',')}`}</p>
      {target === null ? null : (
        <aside aria-labelledby="probe-title">
          <h2 id="probe-title" tabIndex={-1}>{`Inspector ${target.id}`}</h2>
        </aside>
      )}
    </>
  );
}

function Harness(): ReactElement {
  const engines = useQuery(enginesQuery(SCOPE));
  const list = usePromptList(SCOPE);
  const [open, setOpen] = useState(false);
  if (engines.data === undefined || list.loading) return <p>Loading</p>;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Add prompts
      </button>
      <Probe />
      <AddPromptsDialog
        scope={SCOPE}
        open={open}
        onOpenChange={setOpen}
        engines={engines.data.data.filter((engine) => engine.is_enabled)}
        existing={list.rows}
        defaults={{ languageCode: 'en', countryIso: 'DE' }}
      />
    </>
  );
}

function asEditor(without: readonly string[] = []): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('editor' satisfies Role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  const membership = membershipFactory('editor');
  return (
    <PermissionProvider
      membership={{ ...membership, permissions: membership.permissions.filter((key) => !without.includes(key)) }}
    >
      <Harness />
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
  // The lint has answered, so what the project tracks and archives is known: the plan names the places it takes
  await within(dialog).findByText(/Workspace prompts:/);
}

const lines = (count: number): string =>
  Array.from({ length: count }, (_, index) => `Question ${String(index)}?`).join('\n');

const idsOf = (sent: Sent | undefined): unknown => (sent?.body as { ids?: unknown } | undefined)?.ids;
const promptIdsOf = (sent: Sent | undefined): string[] => (sent?.body as { prompt_ids: string[] }).prompt_ids;

describe('Add prompts: after the add', () => {
  it('the toast Undo archives exactly the created ids with a POST, and says it archives', async () => {
    server.use(
      lintWith({ archived: { 'Old one?': ARCHIVED_ID } }),
      // Line 3 was added by someone else while the dialog was open: the API skips it
      created(CREATED, { skipped: [{ index: 2, existing_id: EXISTING_ID }] }),
      archiveAnswer(),
    );
    const sent = recordWrites();
    const { user } = renderWithProviders(asEditor());
    const dialog = await openDialog(user);
    await typeList(user, dialog, 'New one?\nNew two?\nRacing one?\nOld one?');
    await user.click(await within(dialog).findByRole('button', { name: 'Add 4 prompts' }));
    expect(await screen.findByText('2 prompts added and 1 archived prompt restored')).toBeInTheDocument();
    expect(screen.getByText(/They can be undone: Undo archives them\./)).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Undo' }));
    expect(await screen.findByText('2 prompts archived')).toBeInTheDocument();
    expect(screen.getByText('They stay in Archived.')).toBeInTheDocument();
    // The add, the restore of the archived line, and the undo: which touches only what the add created
    expect(sent.map((entry) => `${entry.method} ${entry.path}`)).toEqual([
      'POST prompts/bulk-create',
      'POST prompts/bulk-archive',
      'POST prompts/bulk-archive',
    ]);
    expect(idsOf(sent[1])).toEqual([ARCHIVED_ID]);
    expect(sent[1]?.body).toMatchObject({ archive: false });
    expect(idsOf(sent[2])).toEqual(CREATED);
    expect(sent[2]?.body).toMatchObject({ archive: true });
  });

  it('asks for the count before an Undo of more than 100 prompts archives them', async () => {
    const many = Array.from({ length: 101 }, (_, index) => id(1000 + index));
    server.use(lintWith({ limit: 1000 }), created(many), archiveAnswer());
    const sent = recordWrites();
    const { user } = renderWithProviders(asEditor());
    const dialog = await openDialog(user);
    await typeList(user, dialog, lines(101));
    await user.click(await within(dialog).findByRole('button', { name: 'Add 101 prompts' }));
    await user.click(await screen.findByRole('button', { name: 'Undo' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Archive 101 prompts?' });
    expect(writesTo(sent, 'bulk-archive')).toHaveLength(0);
    await user.click(within(confirm).getByRole('button', { name: 'Archive 101 prompts' }));
    await waitFor(() => expect(writesTo(sent, 'bulk-archive')).toHaveLength(1));
    expect(idsOf(writesTo(sent, 'bulk-archive')[0])).toEqual(many);
  });

  it('asks the created prompts in runs of 150 after the dialog has closed, with the cost and the used runs in its confirm', async () => {
    const many = Array.from({ length: 160 }, (_, index) => id(2000 + index));
    server.use(
      lintWith({ limit: 1000 }),
      limitsWith(4),
      created(many),
      http.post(bulkRun, () => queued(150)),
    );
    const sent = recordWrites();
    const { user } = renderWithProviders(asEditor());
    const dialog = await openDialog(user);
    await typeList(user, dialog, lines(160));
    await user.click(await within(dialog).findByRole('checkbox', { name: /Ask them now as well/ }));
    await user.click(await within(dialog).findByRole('button', { name: 'Add 160 prompts' }));
    // More than 100 prompts to ask confirm with the count, once the dialog is out of the way
    const confirm = await screen.findByRole('alertdialog', { name: 'Ask 160 prompts now?' });
    expect(screen.queryByRole('dialog', { name: 'Add prompts' })).toBeNull();
    expect(confirm).toHaveTextContent('so this makes 2 manual runs of up to 150 prompts');
    expect(confirm).toHaveTextContent('You have used 4 of 20 manual runs today.');
    expect(confirm).toHaveTextContent('320 answers, about $0.02.');
    expect(writesTo(sent, '/runs')).toHaveLength(0);
    await user.click(within(confirm).getByRole('button', { name: 'Ask 160 prompts' }));
    await waitFor(() => expect(writesTo(sent, '/runs')).toHaveLength(2));
    const [first, second] = writesTo(sent, '/runs');
    expect(promptIdsOf(first)).toEqual(many.slice(0, 150));
    expect(promptIdsOf(second)).toEqual(many.slice(150));
    expect(first?.body).toMatchObject({ engine_codes: ['chatgpt_web', 'gemini_web'] });
    expect(await screen.findByText(/Run started/)).toBeInTheDocument();
  });

  it('asks up to 100 created prompts at once when the form asked for it, and stops with the reason at a refusal', async () => {
    server.use(
      lintWith(),
      limitsWith(4),
      created(CREATED),
      http.post(bulkRun, () => refused(429, 'manual_run_limit', { limit: 20 })),
    );
    const sent = recordWrites();
    const { user } = renderWithProviders(asEditor());
    const dialog = await openDialog(user);
    await typeList(user, dialog, 'New one?\nNew two?');
    await user.click(await within(dialog).findByRole('checkbox', { name: /Ask them now as well/ }));
    await user.click(await within(dialog).findByRole('button', { name: 'Add 2 prompts' }));
    expect(await screen.findByText('2 prompts added')).toBeInTheDocument();
    // Asked in the form, so it goes without a second question, and the refusal is said in words
    // The toast is also given to the announcer, so its title is on the page twice
    expect(await screen.findAllByText('Not queued')).not.toHaveLength(0);
    expect(screen.getAllByText(/All 20 manual runs of today \(UTC\) are used/)).not.toHaveLength(0);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(writesTo(sent, '/runs')).toHaveLength(1);
    expect(promptIdsOf(writesTo(sent, '/runs')[0])).toEqual(CREATED);
  });

  it('sends one run only when the first run of 150 is refused, and says that nothing was queued', async () => {
    const many = Array.from({ length: 160 }, (_, index) => id(3000 + index));
    server.use(
      lintWith({ limit: 1000 }),
      limitsWith(4),
      created(many),
      http.post(bulkRun, () => refused(429, 'manual_run_limit', { limit: 20 })),
    );
    const sent = recordWrites();
    const { user } = renderWithProviders(asEditor());
    const dialog = await openDialog(user);
    await typeList(user, dialog, lines(160));
    await user.click(await within(dialog).findByRole('checkbox', { name: /Ask them now as well/ }));
    await user.click(await within(dialog).findByRole('button', { name: 'Add 160 prompts' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Ask 160 prompts now?' });
    await user.click(within(confirm).getByRole('button', { name: 'Ask 160 prompts' }));
    expect(await screen.findAllByText('Not queued')).not.toHaveLength(0);
    expect(screen.getAllByText(/All 20 manual runs of today \(UTC\) are used/)).not.toHaveLength(0);
    // The second run of 10 is never tried, and no run started
    expect(writesTo(sent, '/runs')).toHaveLength(1);
    expect(promptIdsOf(writesTo(sent, '/runs')[0])).toEqual(many.slice(0, 150));
    expect(screen.queryByText(/Run started/)).toBeNull();
  });

  it('stops at the first refusal after a run went through, and says how many prompts were not asked', async () => {
    const many = Array.from({ length: 301 }, (_, index) => id(4000 + index));
    let calls = 0;
    server.use(
      lintWith({ limit: 1000 }),
      limitsWith(4),
      created(many),
      http.post(bulkRun, () => {
        calls += 1;
        return calls === 1 ? queued(150) : refused(429, 'manual_run_limit', { limit: 20 });
      }),
    );
    const sent = recordWrites();
    const { user } = renderWithProviders(asEditor());
    const dialog = await openDialog(user);
    await typeList(user, dialog, lines(301));
    await user.click(await within(dialog).findByRole('checkbox', { name: /Ask them now as well/ }));
    await user.click(await within(dialog).findByRole('button', { name: 'Add 301 prompts' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Ask 301 prompts now?' });
    await user.click(within(confirm).getByRole('button', { name: 'Ask 301 prompts' }));
    // The first run went through, the second was refused, and the third is never tried
    expect(await screen.findAllByText(/Run started: 150 prompts on 2 engines/)).not.toHaveLength(0);
    expect(screen.getAllByText(/All 20 manual runs of today \(UTC\) are used/)).not.toHaveLength(0);
    expect(screen.getAllByText(/151 prompts were not tried\./)).not.toHaveLength(0);
    expect(writesTo(sent, '/runs')).toHaveLength(2);
    expect(calls).toBe(2);
  });

  it('keeps the confirm for more than 100 prompts away from the result view until its Ask them now is pressed', async () => {
    const many = Array.from({ length: 101 }, (_, index) => id(5000 + index));
    server.use(
      lintWith({ limit: 1000 }),
      limitsWith(4),
      created(many, { skipped: [{ index: 101, existing_id: EXISTING_ID }] }),
      http.post(bulkRun, () => queued(101)),
    );
    const sent = recordWrites();
    const { user } = renderWithProviders(asEditor());
    const dialog = await openDialog(user);
    await typeList(user, dialog, `${lines(101)}\nRacing one?`);
    await user.click(await within(dialog).findByRole('checkbox', { name: /Ask them now as well/ }));
    await user.click(await within(dialog).findByRole('button', { name: 'Add 102 prompts' }));
    const result = await screen.findByRole('dialog', { name: 'Result of the add' });
    // A question cannot open over the result view, and nothing is asked before it is answered
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(writesTo(sent, '/runs')).toHaveLength(0);
    await user.click(within(result).getByRole('button', { name: 'Ask them now' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Ask 101 prompts now?' });
    await user.click(within(confirm).getByRole('button', { name: 'Ask 101 prompts' }));
    await waitFor(() => expect(writesTo(sent, '/runs')).toHaveLength(1));
    expect(promptIdsOf(writesTo(sent, '/runs')[0])).toEqual(many);
  });

  it('offers Ask now in the result view, with the confirm, when the form did not ask', async () => {
    server.use(
      lintWith(),
      limitsWith(4),
      created([CREATED[0] ?? ''], { skipped: [{ index: 1, existing_id: EXISTING_ID }] }),
      http.post(bulkRun, () => queued(1)),
    );
    const sent = recordWrites();
    const { user } = renderWithProviders(asEditor());
    const dialog = await openDialog(user);
    await typeList(user, dialog, 'New one?\nRacing one?');
    await user.click(await within(dialog).findByRole('button', { name: 'Add 2 prompts' }));
    const result = await screen.findByRole('dialog', { name: 'Result of the add' });
    await user.click(within(result).getByRole('button', { name: 'Ask them now' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Ask 1 prompt now?' });
    expect(screen.queryByRole('dialog', { name: 'Result of the add' })).toBeNull();
    expect(confirm).toHaveTextContent('You have used 4 of 20 manual runs today.');
    await user.click(within(confirm).getByRole('button', { name: 'Ask 1 prompt' }));
    await waitFor(() => expect(writesTo(sent, '/runs')).toHaveLength(1));
    expect(promptIdsOf(writesTo(sent, '/runs')[0])).toEqual([CREATED[0]]);
  });

  it('shows no Ask now for a role without runs:trigger', async () => {
    server.use(
      lintWith(),
      limitsWith(4),
      created([CREATED[0] ?? ''], { skipped: [{ index: 1, existing_id: EXISTING_ID }] }),
    );
    const { user } = renderWithProviders(asEditor(['runs:trigger']));
    const dialog = await openDialog(user);
    await typeList(user, dialog, 'New one?\nRacing one?');
    await within(dialog).findByText(/Workspace prompts/);
    expect(within(dialog).queryByRole('checkbox', { name: /Ask them now/ })).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Add 2 prompts' }));
    const result = await screen.findByRole('dialog', { name: 'Result of the add' });
    expect(within(result).queryByRole('button', { name: 'Ask them now' })).toBeNull();
  });

  it('sends the restore with the add, counts it against the quota, and leaves it out when unticked', async () => {
    server.use(
      lintWith({ limit: 150, used: 149, archived: { 'Old one?': ARCHIVED_ID } }),
      created([CREATED[0] ?? '']),
      archiveAnswer(),
    );
    const sent = recordWrites();
    const { user } = renderWithProviders(asEditor());
    const dialog = await openDialog(user);
    await typeList(user, dialog, 'New one?\nOld one?');
    await user.click(await within(dialog).findByRole('button', { name: /Check the list/ }));
    const restore = await within(dialog).findByRole('checkbox', { name: 'Restore archived (1)' });
    expect(restore).toBeChecked();
    // One new prompt and one brought back need two places, and one is left
    expect(await within(dialog).findByText(/This add needs 2 places and the workspace has 1/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Add 2 prompts' })).toHaveAttribute('aria-disabled', 'true');
    await user.click(restore);
    const fits = await within(dialog).findByRole('button', { name: 'Add 1 prompt' });
    await waitFor(() => expect(fits).not.toHaveAttribute('aria-disabled', 'true'));
    await user.click(fits);
    expect(await screen.findByText('1 prompt added')).toBeInTheDocument();
    // Unticked: the archived prompt stays archived, so nothing is sent to bring it back
    expect(sent.map((entry) => entry.path)).toEqual(['prompts/bulk-create']);
  });

  it('adds and restores in that order, sending the restore only for the archived ids left ticked', async () => {
    server.use(
      lintWith({ archived: { 'Old one?': ARCHIVED_ID, 'Older one?': id(201) } }),
      created([CREATED[0] ?? '']),
      archiveAnswer(),
    );
    const sent = recordWrites();
    const { user } = renderWithProviders(asEditor());
    const dialog = await openDialog(user);
    await typeList(user, dialog, 'New one?\nOld one?\nOlder one?');
    await user.click(await within(dialog).findByRole('button', { name: /Check the list/ }));
    expect(await within(dialog).findByRole('checkbox', { name: 'Restore archived (2)' })).toBeChecked();
    await user.click(await within(dialog).findByRole('button', { name: 'Add 3 prompts' }));
    expect(await screen.findByText('1 prompt added and 2 archived prompts restored')).toBeInTheDocument();
    expect(sent.map((entry) => entry.path)).toEqual(['prompts/bulk-create', 'prompts/bulk-archive']);
    expect((sent[0]?.body as { items: { text: string }[] }).items.map((item) => item.text)).toEqual(['New one?']);
    expect(idsOf(sent[1])).toEqual([ARCHIVED_ID, id(201)]);
    expect(sent[1]?.body).toMatchObject({ archive: false });
  });

  it('restores archived prompts alone without a create, and gives no Undo for it', async () => {
    server.use(lintWith({ archived: { 'Old one?': ARCHIVED_ID } }), archiveAnswer());
    const sent = recordWrites();
    const { user } = renderWithProviders(asEditor());
    const dialog = await openDialog(user);
    await typeList(user, dialog, 'Old one?');
    await user.click(await within(dialog).findByRole('button', { name: 'Add 1 prompt' }));
    expect(await screen.findByText('1 archived prompt restored')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    expect(sent.map((entry) => entry.path)).toEqual(['prompts/bulk-archive']);
  });

  it('says the restore failed after the create and keeps the created prompts', async () => {
    server.use(
      lintWith({ archived: { 'Old one?': ARCHIVED_ID } }),
      created([CREATED[0] ?? '']),
      http.post(bulkArchive, () => refused(422, 'quota_exceeded', { limit: 150, used: 150, requested: 1 })),
    );
    const { user, container } = renderWithProviders(asEditor());
    const dialog = await openDialog(user);
    await typeList(user, dialog, 'New one?\nOld one?');
    await user.click(await within(dialog).findByRole('button', { name: 'Add 2 prompts' }));
    const result = await screen.findByRole('dialog', { name: 'Result of the add' });
    expect(within(result).getByText('1 prompt added.')).toBeInTheDocument();
    expect(within(result).getByText('1 archived prompt could not be restored')).toBeInTheDocument();
    expect(within(result).getByText(/The workspace has 150 of 150 active prompts/)).toBeInTheDocument();
    expect(within(result).getByText('Old one?')).toBeInTheDocument();
    // The created prompt is kept, and its Undo is still there
    expect(await screen.findByRole('button', { name: 'Undo' })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows a prompt someone else added meanwhile as already tracked, and Show it opens its inspector', async () => {
    server.use(lintWith(), created([], { skipped: [{ index: 0, existing_id: EXISTING_ID }] }));
    const urls: string[] = [];
    const { user } = renderWithProviders(asEditor(), { onUrlUpdate: ({ queryString }) => urls.push(queryString) });
    const dialog = await openDialog(user);
    await typeList(user, dialog, 'Racing one?');
    await user.click(await within(dialog).findByRole('button', { name: 'Add 1 prompt' }));
    const result = await screen.findByRole('dialog', { name: 'Result of the add' });
    expect(within(result).getByText('No prompt was added.')).toBeInTheDocument();
    expect(within(result).getByText('1 already tracked')).toBeInTheDocument();
    expect(within(result).getByText('Racing one?')).toBeInTheDocument();
    await user.click(within(result).getByRole('button', { name: 'Show it, line 1' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(decodeURIComponent(urls.at(-1) ?? '')).toContain(`inspect=prompt:${EXISTING_ID}`);
    // Focus goes to the inspector, not back to the button that opened the dialog
    await waitFor(() => expect(screen.getByRole('heading', { name: `Inspector ${EXISTING_ID}` })).toHaveFocus());
  });

  it('copies the lines that were not added, in the order they were typed', async () => {
    server.use(
      lintWith(),
      created([CREATED[0] ?? ''], {
        skipped: [{ index: 1, existing_id: EXISTING_ID }],
        rejected: [
          { index: 2, code: 'location_not_supported', message: 'ChatGPT runs in no location of this country.' },
        ],
      }),
    );
    const { user } = renderWithProviders(asEditor());
    const dialog = await openDialog(user);
    await typeList(user, dialog, 'New one?\nRacing one?\nBad one?');
    await user.click(await within(dialog).findByRole('button', { name: 'Add 3 prompts' }));
    const result = await screen.findByRole('dialog', { name: 'Result of the add' });
    // The engine is named by the API's own message for this country
    expect(within(result).getByText('Line 3: ChatGPT runs in no location of this country.')).toBeInTheDocument();
    await user.click(within(result).getByRole('button', { name: 'Copy the lines not added' }));
    expect(await navigator.clipboard.readText()).toBe('Racing one?\nBad one?');
  });

  it('puts the focus on Done in the result view and returns it to the button that opened the dialog', async () => {
    server.use(lintWith(), created([], { skipped: [{ index: 0, existing_id: EXISTING_ID }] }));
    const { user } = renderWithProviders(asEditor());
    const dialog = await openDialog(user);
    await typeList(user, dialog, 'Racing one?');
    await user.click(await within(dialog).findByRole('button', { name: 'Add 1 prompt' }));
    const result = await screen.findByRole('dialog', { name: 'Result of the add' });
    await waitFor(() => expect(within(result).getByRole('button', { name: 'Done' })).toHaveFocus());
    await user.click(within(result).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add prompts' })).toHaveFocus());
  });

  it('marks the created prompts as just added for the table', async () => {
    server.use(lintWith(), created(CREATED));
    const { user } = renderWithProviders(asEditor());
    const dialog = await openDialog(user);
    await typeList(user, dialog, 'New one?\nNew two?');
    await user.click(await within(dialog).findByRole('button', { name: 'Add 2 prompts' }));
    expect(await screen.findByText(`just added: ${CREATED.join(',')}`)).toBeInTheDocument();
  });
});
