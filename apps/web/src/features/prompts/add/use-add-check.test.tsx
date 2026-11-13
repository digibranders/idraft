import { useQuery } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { useState, type ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { disabledReason, linesToSend } from './add-model';
import { CheckList } from './check-list';
import { useAddCheck } from './use-add-check';
import { enginesQuery, usePromptList, type PromptScope } from '../prompt-queries';
import type { Role, Schemas } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The Fynix project fixture is missing');
const SCOPE: PromptScope = { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: fynix.project_id };

interface CheckHarnessProps {
  initialCountry?: string;
  onShow?: (target: string) => void;
}

/**
 * What the Add prompts dialog gives the check: a field, a country, the engines and the loaded prompts as the screen
 * reads them. It prints what the dialog would use: the counter, the lines that would be sent and why Add is off.
 */
function CheckHarness({ initialCountry = 'DE', onShow }: CheckHarnessProps): ReactElement {
  const engines = useQuery(enginesQuery(SCOPE));
  const list = usePromptList(SCOPE);
  const [text, setText] = useState('');
  const [country, setCountry] = useState(initialCountry);
  const [restore, setRestore] = useState(true);
  const check = useAddCheck({
    scope: SCOPE,
    text,
    languageCode: 'en',
    countryIso: country,
    engines: engines.data?.data.filter((engine) => engine.is_enabled) ?? [],
    existing: list.rows,
    promptType: null,
  });
  if (engines.data === undefined || list.loading) return <p>Loading</p>;
  return (
    <>
      <textarea aria-label="Prompts" value={text} onChange={(event) => setText(event.target.value)} />
      <select aria-label="Country" value={country} onChange={(event) => setCountry(event.target.value)}>
        <option value="">None</option>
        <option value="DE">DE</option>
        <option value="FR">FR</option>
      </select>
      <p data-testid="counter">{check.counter}</p>
      <p data-testid="sent">{JSON.stringify(linesToSend(check.lines).map((line) => line.text))}</p>
      <p data-testid="blocked">{String(disabledReason(check.counts, null, 0))}</p>
      <CheckList
        rows={check.rows}
        checking={check.checking}
        failed={check.failed}
        needsCountry={check.needsCountry}
        restore={{ checked: restore, onCheckedChange: setRestore }}
        onShow={onShow ?? null}
      />
    </>
  );
}

const LINT = '*/api/v1/workspaces/:w/projects/:p/prompts/lint';
const TRACKED = 'Which SEO agency is best for a SaaS startup in Germany?';
const ID_ARCHIVED = '00000000-0000-4000-8000-00000000000b';
const ID_NEAR = '00000000-0000-4000-8000-00000000000c';

const lintRow = (text: string, extra: Partial<Schemas['PromptLint']> = {}): Schemas['PromptLint'] => ({
  text,
  is_branded: false,
  matched_aliases: [],
  warnings: [],
  suggested_prompt_type: 'question',
  ...extra,
});
const answer = (data: Schemas['PromptLint'][]): Response =>
  HttpResponse.json({ data, quota: { limit: 150, used: 24, would_create: data.length } });

function asEditor(props: CheckHarnessProps = {}): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('editor' satisfies Role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return (
    <PermissionProvider membership={membershipFactory('editor')}>
      <CheckHarness {...props} />
    </PermissionProvider>
  );
}

async function paste(text: string, props: CheckHarnessProps = {}): Promise<ReturnType<typeof renderWithProviders>> {
  const view = renderWithProviders(asEditor(props));
  await view.user.click(await screen.findByRole('textbox', { name: 'Prompts' }));
  await view.user.paste(text);
  return view;
}

describe('the check of a pasted list', () => {
  it('counts an archived duplicate that is not on the loaded page as tracked, not new, and keeps it out of what is sent', async () => {
    server.use(
      http.post(LINT, () =>
        answer([
          lintRow('Archived question here?', { tracked: { prompt_id: ID_ARCHIVED, is_active: false } }),
          lintRow('A new question for the list?'),
        ]),
      ),
    );
    await paste('Archived question here?\nA new question for the list?');
    expect(await screen.findByText('2 lines: 1 new and 1 already tracked (1 archived)')).toBeInTheDocument();
    expect(screen.getByTestId('sent')).toHaveTextContent(JSON.stringify(['A new question for the list?']));
  });

  it('lets a lint answer of not tracked win over the loaded page for the market that was asked', async () => {
    server.use(http.post(LINT, () => answer([lintRow(TRACKED, { tracked: null })])));
    await paste(TRACKED);
    // The loaded page holds this text, but the lint answered for the market and says the project has none
    expect(await screen.findByText('1 line: 1 new')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Check the list/ })).not.toHaveTextContent('Checking'),
    );
    expect(screen.getByTestId('counter')).toHaveTextContent('1 line: 1 new');
  });

  it('decides what is tracked by the lint answer, an active prompt past the loaded page included', async () => {
    server.use(
      http.post(LINT, () =>
        answer([lintRow('Past the first page?', { tracked: { prompt_id: ID_NEAR, is_active: true } })]),
      ),
    );
    await paste('Past the first page?');
    expect(await screen.findByText('1 line: 1 already tracked')).toBeInTheDocument();
  });

  it('splits new, already tracked and a repeat from the text and the answer of the lint', async () => {
    server.use(
      http.post(LINT, async ({ request }) => {
        const body = (await request.json()) as { items: { text: string; country_iso: string }[] };
        return answer(
          body.items.map(({ text }) =>
            lintRow(text, text === TRACKED ? { tracked: { prompt_id: ID_NEAR, is_active: true } } : {}),
          ),
        );
      }),
    );
    await paste(`Fresh one for the list?\n${TRACKED}\nFresh one for the list?`);
    expect(await screen.findByText('3 lines: 1 new, 1 already tracked, and 1 repeat')).toBeInTheDocument();
  });

  it('shows a near duplicate as a note, and sends both texts', async () => {
    server.use(
      http.post(LINT, () =>
        answer([
          lintRow('best crm for startups', {
            near_duplicate_of: { prompt_id: ID_NEAR, text: 'Best CRM for Startups' },
          }),
        ]),
      ),
    );
    const { user } = await paste('best crm for startups');
    await waitFor(() => expect(screen.getByTestId('counter')).toHaveTextContent('1 line: 1 new'));
    await user.click(await screen.findByRole('button', { name: /Check the list/ }));
    expect(
      await screen.findByText(
        'Differs from a tracked prompt only in case or spacing: “Best CRM for Startups”. Both will be asked.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId('sent')).toHaveTextContent(JSON.stringify(['best crm for startups']));
    expect(screen.queryByRole('heading', { level: 3, name: /^Warnings/ })).not.toBeInTheDocument();
  });

  it('does not call the same text a duplicate in another country, and never shows the answer of the first as the second', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post(LINT, async ({ request }) => {
        const body = (await request.json()) as { items: { text: string; country_iso: string }[] };
        const inGermany = body.items.every((item) => item.country_iso === 'DE');
        // The answer for France waits, so the list is read while it is on its way
        if (!inGermany) await gate;
        return answer(
          body.items.map(({ text }) =>
            lintRow(text, inGermany ? { tracked: { prompt_id: ID_NEAR, is_active: true } } : {}),
          ),
        );
      }),
    );
    const { user } = await paste('Tracked in Germany only?');
    expect(await screen.findByText('1 line: 1 already tracked')).toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Country' }), 'FR');
    // While France is checked, Germany's answer is not shown as France's
    await screen.findByRole('button', { name: /Checking the list/ });
    expect(screen.getByTestId('counter')).toHaveTextContent('1 line: 1 new');
    expect(screen.getByTestId('counter')).not.toHaveTextContent('already tracked');
    release();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Check the list/ })).not.toHaveTextContent('Checking'),
    );
    expect(screen.getByTestId('counter')).toHaveTextContent('1 line: 1 new');
  });

  it('asks for a country before it says what is tracked, and counts nothing as zero', async () => {
    const { user } = await paste('A question without a market?', { initialCountry: '' });
    expect(await screen.findByText('1 line: 1 new')).toBeInTheDocument();
    const toggle = await screen.findByRole('button', { name: /Check the list/ });
    await waitFor(() => expect(toggle).not.toHaveTextContent('Checking'));
    await user.click(toggle);
    expect(screen.getByText('Choose a country to check what is tracked.')).toBeInTheDocument();
    expect(screen.queryByText(/already tracked/)).not.toBeInTheDocument();
  });

  it('falls back to the loaded prompts and says so when the lint fails, and the add stays possible', async () => {
    server.use(http.post(LINT, () => HttpResponse.json({ code: 'internal_error' }, { status: 500 })));
    const { user } = await paste(`${TRACKED}\nA question the lint never saw?`);
    // The loaded active prompts decide while the lint cannot
    expect(await screen.findByText('2 lines: 1 new and 1 already tracked')).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /Check the list/ }));
    expect(
      await screen.findByText('The list could not be checked. You can still add it; the server checks it.'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('blocked')).toHaveTextContent('null');
  });

  it('calls Show it with the prompt the lint named', async () => {
    server.use(
      http.post(LINT, () =>
        answer([lintRow('Past the first page?', { tracked: { prompt_id: ID_NEAR, is_active: true } })]),
      ),
    );
    const shown: string[] = [];
    const { user } = await paste('Past the first page?', { onShow: (target) => shown.push(target) });
    await user.click(await screen.findByRole('button', { name: /Check the list/ }));
    await user.click(await screen.findByRole('button', { name: 'Show it, line 1' }));
    expect(shown).toEqual([ID_NEAR]);
    expect(within(screen.getByRole('list', { name: 'Checks of the list' })).getByText('Line 1')).toBeInTheDocument();
  });
});

/** The five rules of the lint that read a text (PD-LINT-03 to 07), through the mock that answers as the API does. */
describe('the lint rules in the check list', () => {
  async function check(text: string): Promise<{ container: HTMLElement; list: HTMLElement }> {
    const { user, container } = await paste(text);
    const toggle = await screen.findByRole('button', { name: /Check the list/ });
    // The answer of the lint is what these cases are about, so it is waited for
    await waitFor(() => expect(toggle).not.toHaveTextContent('Checking the list'));
    if (toggle.getAttribute('aria-expanded') === 'false') await user.click(toggle);
    return { container, list: screen.getByRole('list', { name: 'Checks of the list' }) };
  }

  it.each([
    ['word_count', 'Best CRM tool', 'Has 3 words. Prompts of 5 to 60 words read like real questions.'],
    [
      'multiple_questions',
      'What is a CRM? And why would a small team need one?',
      'Asks more than one question. Answers to it will mix them.',
    ],
    [
      'leading_wording',
      'Why is Fynix the best choice for a small agency in Berlin?',
      'The wording leads the answer. It measures agreement, not visibility.',
    ],
    [
      'contains_competitor_alias',
      'Does Rankforge work well for a small agency in Berlin?',
      'Names Rankforge. A competitor named in the prompt is likely to be named in the answer.',
    ],
    [
      'language_mismatch',
      'Quelle est la meilleure solution de facturation pour une petite equipe ?',
      'Reads as French, and the prompt is set to English.',
    ],
  ])('shows the wording of %s on its line, and does not stop the add', async (_rule, text, wording) => {
    const { list } = await check(text);
    const warnings = within(list)
      .getByRole('heading', { level: 3, name: /^Warnings/ })
      .closest('li');
    if (warnings === null) throw new Error('The Warnings group is missing');
    expect(within(warnings).getByText('Line 1')).toBeInTheDocument();
    expect(within(warnings).getByText(wording)).toBeInTheDocument();
    // The line is still one that will be added, and Add is not off
    expect(screen.getByRole('heading', { level: 3, name: 'Will be added (1)' })).toBeInTheDocument();
    expect(screen.getByTestId('blocked')).toHaveTextContent('null');
    expect(screen.getByTestId('sent')).toHaveTextContent(JSON.stringify([text]));
  });

  it('counts a line with a warning once: the counter says 1 line, 1 new', async () => {
    await check('Best CRM tool');
    expect(screen.getByRole('heading', { level: 3, name: 'Warnings (1)' })).toBeInTheDocument();
    expect(screen.getByTestId('counter')).toHaveTextContent(/^1 line: 1 new$/);
  });

  it('notes the own brand without a warning, and the competitor as a comparison when the wording compares', async () => {
    await check('Rankforge vs Fynix for a small agency in Berlin');
    expect(
      screen.getByText(
        'Names Fynix, so it counts as branded and stays out of the rates unless branded prompts are included.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Type: comparison (from wording)')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 3, name: /^Warnings/ })).not.toBeInTheDocument();
  });

  it('has nothing to say about a plain prompt, and has no accessibility violations with the warnings shown', async () => {
    const { container } = await check('Best CRM tool\nWhich agency audits shop sites in Munich?');
    expect(screen.getByRole('heading', { level: 3, name: 'Will be added (2)' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Warnings (1)' })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});
