import { useQuery } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { useState, type ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { AddPromptsDialog } from '../add-prompts-dialog';
import { enginesQuery, usePromptList, type PromptScope } from '../prompt-queries';
import type { ProjectEngine, Role } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { MOCK_TERMS } from '@/mocks/entity-fixtures';
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
const CONTENT_MARKETING = MOCK_TERMS.find((term) => term.name === 'Content Marketing')?.term_id ?? '';
const QUESTION = 'Which agency audits shop sites in Munich?';

afterEach(() => {
  server.events.removeAllListeners();
});

interface Created {
  items: Record<string, unknown>[];
}

/** The JSON bodies sent to a route, and the paths of every write in the order they arrive. */
function record(suffix: string): { bodies: unknown[]; writes: string[] } {
  const seen: { bodies: unknown[]; writes: string[] } = { bodies: [], writes: [] };
  server.events.on('request:start', ({ request }) => {
    if (request.method !== 'POST') return;
    const path = new URL(request.url).pathname;
    seen.writes.push(path.replace(/^.*\/(?=[^/]+\/[^/]+$)/, ''));
    if (path.endsWith(suffix)) {
      void request
        .clone()
        .json()
        .then((body: unknown) => seen.bodies.push(body));
    }
  });
  return seen;
}

interface HarnessProps {
  /** Replaces the project's enabled engines, for the sentence about them. */
  engines?: readonly ProjectEngine[];
  termId?: string | null;
}

function Harness({ engines: given, termId = null }: HarnessProps): ReactElement {
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
        defaults={{ languageCode: 'en', countryIso: 'DE', termId }}
      />
    </>
  );
}

function asEditor(props: HarnessProps = {}): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('editor' satisfies Role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return (
    <PermissionProvider membership={membershipFactory('editor')}>
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

async function openDetails(user: User, dialog: HTMLElement): Promise<void> {
  await user.click(within(dialog).getByRole('button', { name: /^Details/ }));
}

async function choose(user: User, dialog: HTMLElement, field: RegExp | string, option: string): Promise<void> {
  await user.click(within(dialog).getByRole('combobox', { name: field }));
  await user.click(await screen.findByRole('option', { name: option }));
}

const bulkCreate = mswPath(`${P}/prompts/bulk-create`);

describe('Add prompts: shell and fields', () => {
  it('starts with the focus on the Prompts field and names the enabled engines in its description', async () => {
    const { user } = renderWithProviders(asEditor());
    const dialog = await openDialog(user);
    expect(within(dialog).getByRole('textbox', { name: 'Prompts' })).toHaveFocus();
    expect(
      within(dialog).getByText('Asked on ChatGPT and Gemini twice a week (Monday and Thursday).'),
    ).toBeInTheDocument();
  });

  it('says no engine is on, as a warning that does not block the add', async () => {
    const created = record('/prompts/bulk-create');
    const { user } = renderWithProviders(asEditor({ engines: [] }));
    const dialog = await openDialog(user);
    expect(within(dialog).getByText('No engine is on, so these prompts are not asked yet.')).toBeInTheDocument();
    expect(
      within(dialog).getAllByText('No engine is on, so these prompts will not be asked until one is.'),
    ).not.toHaveLength(0);
    await typeList(user, dialog, QUESTION);
    await user.click(await within(dialog).findByRole('button', { name: 'Add 1 prompt' }));
    expect(await screen.findByText('1 prompt added')).toBeInTheDocument();
    expect(created.bodies).toHaveLength(1);
  });

  it('puts Country before Language, names how many countries each engine asks in, and is axe clean', async () => {
    const { user, container } = renderWithProviders(asEditor());
    const dialog = await openDialog(user);
    const boxes = within(dialog)
      .getAllByRole('combobox')
      .map((box) => box.getAttribute('aria-label') ?? box.textContent);
    expect(boxes.findIndex((name) => /Germany/.test(name ?? ''))).toBeLessThan(
      boxes.findIndex((name) => /English/.test(name ?? '')),
    );
    expect(within(dialog).getByText(/ChatGPT asks in \d+ countries? and Gemini asks in \d+ countries?/)).toBeVisible();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows an inline error under Country with a retry when the countries cannot be read', async () => {
    let failing = true;
    server.use(
      http.get(mswPath('/api/v1/locations'), () =>
        failing
          ? HttpResponse.json(
              { type: 'about:blank', title: 'Server error', status: 500, code: 'internal_error', request_id: 'r' },
              { status: 500 },
            )
          : undefined,
      ),
    );
    const { user } = renderWithProviders(asEditor());
    const dialog = await openDialog(user);
    expect(await within(dialog).findByText('Countries could not be loaded.')).toBeInTheDocument();
    failing = false;
    await user.click(within(dialog).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(within(dialog).queryByText('Countries could not be loaded.')).toBeNull());
    await waitFor(() => expect(within(dialog).getByRole('combobox', { name: /Country/ })).toHaveTextContent('Germany'));
  });

  it('sends no prompt_type for "Set from wording" and the type when one is chosen', async () => {
    const created = record('/prompts/bulk-create');
    const { user } = renderWithProviders(asEditor());
    const dialog = await openDialog(user);
    await openDetails(user, dialog);
    expect(within(dialog).getByRole('combobox', { name: 'Type' })).toHaveTextContent('Set from wording');
    await typeList(user, dialog, QUESTION);
    await user.click(await within(dialog).findByRole('button', { name: 'Add 1 prompt' }));
    expect(await screen.findByText('1 prompt added')).toBeInTheDocument();
    expect(created.bodies).toHaveLength(1);
    expect(Object.keys((created.bodies[0] as Created).items[0] ?? {})).not.toContain('prompt_type');

    await user.click(await screen.findByRole('button', { name: 'Add prompts' }));
    const again = await screen.findByRole('dialog', { name: 'Add prompts' });
    await openDetails(user, again);
    await choose(user, again, 'Type', 'Comparison');
    await typeList(user, again, 'Fynix or Muster for audits?');
    await user.click(await within(again).findByRole('button', { name: 'Add 1 prompt' }));
    await waitFor(() => expect(created.bodies).toHaveLength(2));
    expect((created.bodies[1] as Created).items[0]).toMatchObject({ prompt_type: 'comparison' });
  });

  it('sends intent, stage and importance as chosen, and the branded override only when it was chosen', async () => {
    const created = record('/prompts/bulk-create');
    const { user } = renderWithProviders(asEditor());
    const dialog = await openDialog(user);
    await typeList(user, dialog, QUESTION);
    await user.click(await within(dialog).findByRole('button', { name: 'Add 1 prompt' }));
    await screen.findByText('1 prompt added');
    const [plain] = (created.bodies[0] as Created).items;
    expect(plain).toMatchObject({ intent: 'unknown', funnel_stage: 'unknown', importance: 3 });
    expect(Object.keys(plain ?? {})).not.toContain('is_branded');

    await user.click(await screen.findByRole('button', { name: 'Add prompts' }));
    const again = await screen.findByRole('dialog', { name: 'Add prompts' });
    await openDetails(user, again);
    await choose(user, again, 'Intent', 'Commercial');
    await choose(user, again, 'Stage', 'Bottom (bofu)');
    await choose(user, again, 'Importance', '1, highest');
    await user.click(within(again).getByRole('radio', { name: 'Always branded' }));
    await typeList(user, again, 'Which tool audits shop sites?');
    await user.click(await within(again).findByRole('button', { name: 'Add 1 prompt' }));
    await waitFor(() => expect(created.bodies).toHaveLength(2));
    expect((created.bodies[1] as Created).items[0]).toMatchObject({
      intent: 'commercial',
      funnel_stage: 'bofu',
      importance: 1,
      is_branded: true,
    });
  });

  it('sends is_branded false for never branded, and the closed summary names what was changed', async () => {
    const created = record('/prompts/bulk-create');
    const { user } = renderWithProviders(asEditor());
    const dialog = await openDialog(user);
    const toggle = within(dialog).getByRole('button', { name: /^Details/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveTextContent('Type: set from wording');
    await user.click(toggle);
    await user.click(within(dialog).getByRole('radio', { name: 'Never branded' }));
    await user.click(toggle);
    expect(toggle).toHaveTextContent('Type: set from wording, Branded: never');
    await typeList(user, dialog, QUESTION);
    await user.click(await within(dialog).findByRole('button', { name: 'Add 1 prompt' }));
    await waitFor(() => expect(created.bodies).toHaveLength(1));
    expect((created.bodies[0] as Created).items[0]).toMatchObject({ is_branded: false });
  });

  it('warns on a line that names the own brand when "Never branded" is chosen', async () => {
    const { user } = renderWithProviders(asEditor());
    const dialog = await openDialog(user);
    await openDetails(user, dialog);
    await user.click(within(dialog).getByRole('radio', { name: 'Never branded' }));
    await typeList(user, dialog, 'Is Fynix any good for audits?');
    expect(
      await within(dialog).findByText(
        'Line 1 names Fynix but is marked not branded. Its answers will count in the rates.',
      ),
    ).toBeInTheDocument();
  });

  it('submits once on Mod+Enter in the textarea, also when it is pressed twice', async () => {
    const created = record('/prompts/bulk-create');
    const { user } = renderWithProviders(asEditor());
    const dialog = await openDialog(user);
    await typeList(user, dialog, QUESTION);
    await user.keyboard('{Control>}{Enter}{Enter}{/Control}');
    expect(await screen.findByText('1 prompt added')).toBeInTheDocument();
    expect(created.bodies).toHaveLength(1);
  });

  it('asks to discard on Escape and on Cancel once something is typed, and not before', async () => {
    const { user } = renderWithProviders(asEditor());
    await openDialog(user);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add prompts' })).toBeNull());

    const again = await openDialog(user);
    await typeList(user, again, QUESTION);
    await user.keyboard('{Escape}');
    expect(await screen.findByRole('alertdialog', { name: 'Discard unsaved changes?' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(within(again).getByRole('textbox', { name: 'Prompts' })).toHaveValue(QUESTION);
    await user.click(within(again).getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('alertdialog', { name: 'Discard unsaved changes?' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add prompts' })).toBeNull());
  });

  it('asks to discard when only a Details field changed', async () => {
    const { user } = renderWithProviders(asEditor());
    const dialog = await openDialog(user);
    await openDetails(user, dialog);
    await choose(user, dialog, 'Intent', 'Local');
    await user.keyboard('{Escape}');
    expect(await screen.findByRole('alertdialog', { name: 'Discard unsaved changes?' })).toBeInTheDocument();
  });

  it('counts the lines under the field from the check, and opens the list for a line that cannot be added', async () => {
    const { user } = renderWithProviders(asEditor());
    const dialog = await openDialog(user);
    await typeList(user, dialog, `${QUESTION}\n${QUESTION}\n${'x'.repeat(2100)}`);
    expect(await within(dialog).findByText('3 lines: 1 new, 1 repeat, and 1 cannot be added')).toBeInTheDocument();
    expect(await within(dialog).findByRole('button', { name: /Check the list/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(await within(dialog).findByRole('heading', { level: 3, name: 'Cannot be added (1)' })).toBeInTheDocument();
  });

  it('asks the lint for the items of the market chosen, and sends only the lines it does not track', async () => {
    const linted = record('/prompts/lint');
    const created = record('/prompts/bulk-create');
    const { user } = renderWithProviders(asEditor());
    const dialog = await openDialog(user);
    await typeList(user, dialog, `${QUESTION}\nWhich SEO agency is best for a SaaS startup in Germany?`);
    // The loaded page already tells the second line is tracked; the lint is what the add waits for
    await waitFor(() => expect(linted.bodies).toHaveLength(1));
    await user.click(await within(dialog).findByRole('button', { name: 'Add 1 prompt' }));
    await screen.findByText('1 prompt added');
    expect(linted.bodies.at(-1)).toEqual({
      items: [
        { text: QUESTION, language_code: 'en', country_iso: 'DE' },
        { text: 'Which SEO agency is best for a SaaS startup in Germany?', language_code: 'en', country_iso: 'DE' },
      ],
      engine_codes: ['chatgpt_web', 'gemini_web'],
    });
    expect((created.bodies[0] as Created).items.map((item) => item.text)).toEqual([QUESTION]);
  });

  it('chooses the topic it was opened from and sends it', async () => {
    const created = record('/prompts/bulk-create');
    const { user } = renderWithProviders(asEditor({ termId: CONTENT_MARKETING }));
    const dialog = await openDialog(user);
    expect(await within(dialog).findByText('Content Marketing')).toBeInTheDocument();
    await typeList(user, dialog, QUESTION);
    await user.click(await within(dialog).findByRole('button', { name: 'Add 1 prompt' }));
    await screen.findByText('1 prompt added');
    expect((created.bodies[0] as Created).items[0]).toMatchObject({ term_ids: [CONTENT_MARKETING] });
  });

  it('makes a typed topic when the form is saved and not when it is typed, then files the prompts under it', async () => {
    const seen = record('/prompts/bulk-create');
    // The prompts mock knows only the fixture terms, so it would refuse a term the taxonomy mock just made
    server.use(
      http.post(bulkCreate, () =>
        HttpResponse.json({ data: { created: ['0192d1a8-e000-7a10-8e00-000000000100'], skipped: [], rejected: [] } }),
      ),
    );
    const { user } = renderWithProviders(asEditor());
    const dialog = await openDialog(user);
    const field = within(dialog).getByRole('combobox', { name: /Topics/ });
    await waitFor(() => expect(field).toBeEnabled());
    await user.click(field);
    await user.type(field, 'Startups');
    await user.click(await screen.findByRole('option', { name: /Create topic/ }));
    await user.keyboard('{Escape}');
    await typeList(user, dialog, QUESTION);
    expect(seen.writes.filter((path) => path.endsWith('terms'))).toEqual([]);
    await user.click(await within(dialog).findByRole('button', { name: 'Add 1 prompt' }));
    await screen.findByText('1 prompt added');
    const writes = seen.writes.filter((path) => path.endsWith('terms') || path.endsWith('bulk-create'));
    expect(writes.map((path) => path.split('/').at(-1))).toEqual(['terms', 'bulk-create']);
    const [item] = (seen.bodies[0] as Created).items;
    expect(item?.term_ids).toHaveLength(1);
  });

  it('says the topic was created and the prompts were not added when the add fails after it', async () => {
    server.use(http.post(bulkCreate, () => HttpResponse.error()));
    const { user } = renderWithProviders(asEditor());
    const dialog = await openDialog(user);
    const field = within(dialog).getByRole('combobox', { name: /Topics/ });
    await waitFor(() => expect(field).toBeEnabled());
    await user.click(field);
    await user.type(field, 'Startups');
    await user.click(await screen.findByRole('option', { name: /Create topic/ }));
    await user.keyboard('{Escape}');
    await typeList(user, dialog, QUESTION);
    await user.click(await within(dialog).findByRole('button', { name: 'Add 1 prompt' }));
    expect(
      await within(dialog).findByText('Topic “Startups” was created. The prompts were not added.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'Prompts' })).toHaveValue(QUESTION);
  });
});
