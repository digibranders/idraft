import { useQuery } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { useState, type ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { AddPromptsDialog } from './add-prompts-dialog';
import { enginesQuery, usePromptList, type PromptScope } from './prompt-queries';
import type { Role } from '@/lib/api/types';
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
const TAB = String.fromCharCode(9);
const ZERO_WIDTH_JOINER = String.fromCodePoint(0x200d);

afterEach(() => {
  server.events.removeAllListeners();
});

/** What the screen gives the dialog: the enabled engines and the active prompts, read as the screen reads them. */
function Harness(): ReactElement {
  const engines = useQuery(enginesQuery(SCOPE));
  const list = usePromptList(SCOPE);
  const [open, setOpen] = useState(false);
  if (engines.data === undefined || list.loading) return <p>Loading</p>;
  return (
    <>
      <p>{`${String(list.rows.length)} tracked`}</p>
      <button type="button" onClick={() => setOpen(true)}>
        Add prompts
      </button>
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

function asEditor(): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('editor' satisfies Role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return (
    <PermissionProvider membership={membershipFactory('editor')}>
      <Harness />
    </PermissionProvider>
  );
}

async function openDialog(user: ReturnType<typeof renderWithProviders>['user']): Promise<HTMLElement> {
  await user.click(await screen.findByRole('button', { name: 'Add prompts' }));
  return screen.findByRole('dialog', { name: 'Add prompts' });
}

/** The JSON bodies sent to a route of the prompts, as they arrive. */
function recordBodies(suffix: string): unknown[] {
  const bodies: unknown[] = [];
  server.events.on('request:start', ({ request }) => {
    if (request.method === 'POST' && new URL(request.url).pathname.endsWith(suffix)) {
      void request
        .clone()
        .json()
        .then((body: unknown) => bodies.push(body));
    }
  });
  return bodies;
}

const bulkCreate = mswPath(`${P}/prompts/bulk-create`);
const lintRoute = mswPath(`${P}/prompts/lint`);

describe('Add prompts', () => {
  it('reads a pasted list, leaves out repeats and tracked prompts, shows the quota, and adds the rest', async () => {
    const created = recordBodies('/prompts/bulk-create');
    const { user, container } = renderWithProviders(asEditor());
    const dialog = await openDialog(user);
    expect(await screen.findByText('24 tracked')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('textbox', { name: 'Prompts' }));
    await user.paste(
      `Which agency audits shop sites in Munich?\n${TRACKED}\nWhich agency audits shop sites in Munich?`,
    );
    expect(await within(dialog).findByText('Line 2 is already tracked and is left out.')).toBeInTheDocument();
    expect(within(dialog).getByText('Line 3 repeats line 1 and is left out.')).toBeInTheDocument();
    expect(await within(dialog).findByText('Adds 1 prompt of your remaining 126.')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    await user.click(within(dialog).getByRole('button', { name: 'Add 1 prompt' }));
    expect(await screen.findByText('1 prompt added')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add prompts' })).toBeNull());
    // The screen's list is read again
    expect(await screen.findByText('25 tracked')).toBeInTheDocument();
    expect(created).toEqual([
      {
        items: [
          {
            text: 'Which agency audits shop sites in Munich?',
            language_code: 'en',
            country_iso: 'DE',
            term_ids: [],
            // What the API fills in for a prompt added by hand
            intent: 'unknown',
            funnel_stage: 'unknown',
            prompt_type: 'question',
            importance: 3,
          },
        ],
        on_duplicate: 'skip',
      },
    ]);
  });

  it('asks the lint about the enabled engines only, and notes a branded line', async () => {
    const linted = recordBodies('/prompts/lint');
    const { user } = renderWithProviders(asEditor());
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('textbox', { name: 'Prompts' }));
    await user.paste('Is Fynix any good?');
    expect(
      await within(dialog).findByText(
        'Line 1 names Fynix, so it counts as branded and stays out of the rates unless branded prompts are included.',
      ),
    ).toBeInTheDocument();
    // AI Mode is off for Fynix: its length limit is not asked about
    expect(linted).toEqual([{ texts: ['Is Fynix any good?'], engine_codes: ['chatgpt_web', 'gemini_web'] }]);
  });

  it('refuses a line over the limit before it sends anything, and keeps it out of the lint', async () => {
    const linted = recordBodies('/prompts/lint');
    const created = recordBodies('/prompts/bulk-create');
    const { user } = renderWithProviders(asEditor());
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('textbox', { name: 'Prompts' }));
    await user.paste(`Is Fynix any good?\n${'x'.repeat(2100)}`);
    expect(
      await within(dialog).findByText('Line 2 is longer than 2,000 characters and cannot be added.'),
    ).toBeInTheDocument();
    await waitFor(() => expect(linted).toHaveLength(1));
    expect(linted).toEqual([{ texts: ['Is Fynix any good?'], engine_codes: ['chatgpt_web', 'gemini_web'] }]);
    await user.click(within(dialog).getByRole('button', { name: 'Add 2 prompts' }));
    expect(
      await within(dialog).findByText('Some lines cannot be added. Fix or remove them first.'),
    ).toBeInTheDocument();
    expect(created).toEqual([]);
  });

  it('names a line with a character the API refuses, and does not let it fail the checks of the others', async () => {
    const linted = recordBodies('/prompts/lint');
    const { user } = renderWithProviders(asEditor());
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('textbox', { name: 'Prompts' }));
    await user.paste(`Joined${ZERO_WIDTH_JOINER}words?\nA plain question?`);
    expect(await within(dialog).findByText('Line 1 has a character that cannot be saved.')).toBeInTheDocument();
    expect(await within(dialog).findByText('Adds 2 prompts of your remaining 126.')).toBeInTheDocument();
    expect(linted).toEqual([{ texts: ['A plain question?'], engine_codes: ['chatgpt_web', 'gemini_web'] }]);
  });

  it('cleans a list pasted from a spreadsheet before it checks and adds it', async () => {
    const linted = recordBodies('/prompts/lint');
    const created = recordBodies('/prompts/bulk-create');
    const { user } = renderWithProviders(asEditor());
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('textbox', { name: 'Prompts' }));
    await user.paste(`Which agency${TAB}audits shop sites?\n\n  Second   question?  `);
    // The lint answers a moment after the typing stops
    expect(await within(dialog).findByText('Adds 2 prompts of your remaining 126.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Add 2 prompts' }));
    expect(await screen.findByText('2 prompts added')).toBeInTheDocument();
    // Once asked after the typing, and again after the add, for the quota it used
    expect(linted[0]).toEqual({
      texts: ['Which agency audits shop sites?', 'Second question?'],
      engine_codes: ['chatgpt_web', 'gemini_web'],
    });
    expect(created).toMatchObject([
      { items: [{ text: 'Which agency audits shop sites?' }, { text: 'Second question?' }] },
    ]);
  });

  it('says what the list would take of the quota, and that it does not fit', async () => {
    server.use(
      http.post(lintRoute, async ({ request }) => {
        const body = (await request.json()) as { texts: string[] };
        return HttpResponse.json({
          data: body.texts.map((text) => ({ text, is_branded: false, matched_aliases: [], warnings: [] })),
          quota: { limit: 150, used: 149 },
        });
      }),
    );
    const { user } = renderWithProviders(asEditor());
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('textbox', { name: 'Prompts' }));
    await user.paste('First question?\nSecond question?');
    expect(
      await within(dialog).findByText(
        'That is 2 prompts, and the workspace has room for 1. Remove lines or archive prompts you no longer need.',
      ),
    ).toBeInTheDocument();
  });

  it('refuses a list of more than 1,000 lines without asking the lint', async () => {
    const linted = recordBodies('/prompts/lint');
    const { user } = renderWithProviders(asEditor());
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('textbox', { name: 'Prompts' }));
    await user.paste(Array.from({ length: 1001 }, (_, index) => `Question number ${String(index)}?`).join('\n'));
    await user.click(await within(dialog).findByRole('button', { name: 'Add 1,001 prompts' }));
    expect(
      await within(dialog).findByText('Add at most 1,000 prompts at once. This list has 1,001.'),
    ).toBeInTheDocument();
    expect(linted).toEqual([]);
  });

  it('lists what the API skipped and refused, with the line numbers the person sees', async () => {
    server.use(
      http.post(bulkCreate, () =>
        HttpResponse.json({
          data: {
            created: ['0192d1a8-e000-7a10-8e00-000000000100'],
            skipped: [{ index: 1, existing_id: '0192d1a8-e000-7a10-8e00-000000000001' }],
            rejected: [
              { index: 2, code: 'location_not_supported', message: 'ChatGPT runs in no location of this country.' },
            ],
          },
        }),
      ),
    );
    const { user } = renderWithProviders(asEditor());
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('textbox', { name: 'Prompts' }));
    // A blank line and a tracked line sit between the lines that are sent: item 2 is line 5
    await user.paste(`First question?\n\nSecond question?\n${TRACKED}\nThird question?`);
    await user.click(await within(dialog).findByRole('button', { name: 'Add 3 prompts' }));
    const result = await screen.findByRole('dialog', { name: 'Prompts added' });
    expect(within(result).getByText('1 prompt was added.')).toBeInTheDocument();
    expect(within(result).getByText('1 was already tracked.')).toBeInTheDocument();
    expect(within(result).getByText('Line 5: an enabled engine does not ask in this country.')).toBeInTheDocument();
    await user.click(within(result).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('shows a prompt the API already tracks, an archived one for example, as already tracked and not as an error', async () => {
    server.use(
      http.post(bulkCreate, () =>
        HttpResponse.json({
          data: {
            created: [],
            skipped: [{ index: 0, existing_id: '0192d1a8-e000-7a10-8e00-000000000001' }],
            rejected: [],
          },
        }),
      ),
    );
    const { user, container } = renderWithProviders(asEditor());
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('textbox', { name: 'Prompts' }));
    await user.paste('An archived question?');
    await user.click(await within(dialog).findByRole('button', { name: 'Add 1 prompt' }));
    const result = await screen.findByRole('dialog', { name: 'Prompts added' });
    expect(within(result).getByText('No prompt was added.')).toBeInTheDocument();
    expect(within(result).getByText('1 was already tracked.')).toBeInTheDocument();
    expect(within(result).queryByText(/could not be added/)).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('names the line of a field error the API answers the whole request with', async () => {
    server.use(
      http.post(bulkCreate, () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Validation failed',
            status: 422,
            code: 'validation_failed',
            errors: [
              {
                location: 'body',
                path: 'items.1.text',
                code: 'prompt_too_long',
                message: 'A prompt has at most 2000 characters.',
              },
            ],
          },
          { status: 422, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    const { user } = renderWithProviders(asEditor());
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('textbox', { name: 'Prompts' }));
    await user.paste('Fine question?\n\nAnother question?');
    await user.click(await within(dialog).findByRole('button', { name: 'Add 2 prompts' }));
    expect(
      await within(dialog).findByText('Line 3 is longer than 2,000 characters and cannot be added.'),
    ).toBeInTheDocument();
    // Nothing was added: the dialog stays on the list
    expect(screen.queryByRole('dialog', { name: 'Prompts added' })).toBeNull();
  });

  it('says the workspace is out of room when the API refuses the add for the quota', async () => {
    server.use(
      http.post(bulkCreate, () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Workspace limit reached',
            status: 422,
            code: 'quota_exceeded',
            limit: 150,
            used: 150,
            requested: 1,
          },
          { status: 422, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    const { user } = renderWithProviders(asEditor());
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('textbox', { name: 'Prompts' }));
    await user.paste('One more question?');
    await user.click(await within(dialog).findByRole('button', { name: 'Add 1 prompt' }));
    expect(
      await within(dialog).findByText(
        'The workspace has 150 of 150 active prompts, so these do not fit. Archive prompts you no longer need, then try again.',
      ),
    ).toBeInTheDocument();
  });

  it('sends the topic, language and country the person chose', async () => {
    const created = recordBodies('/prompts/bulk-create');
    const { user } = renderWithProviders(asEditor());
    const dialog = await openDialog(user);
    // The country the project works in, among those every enabled engine asks in
    expect(within(dialog).getByRole('combobox', { name: /Country/ })).toHaveTextContent('Germany');
    await user.click(within(dialog).getByRole('textbox', { name: 'Prompts' }));
    await user.paste('One more question?');
    await user.click(within(dialog).getByRole('combobox', { name: /Country/ }));
    await user.click(await screen.findByRole('option', { name: 'India' }));
    await user.click(await within(dialog).findByRole('button', { name: 'Add 1 prompt' }));
    expect(await screen.findByText('1 prompt added')).toBeInTheDocument();
    expect(created).toMatchObject([{ items: [{ country_iso: 'IN', language_code: 'en', term_ids: [] }] }]);
  });
});
