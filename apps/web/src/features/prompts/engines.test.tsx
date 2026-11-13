import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EnginesScreen } from './engines-screen';
import type { EngineCode, ProjectEngine, Role } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { ENGINE_FACTS, monthlyCostUsd } from '@/mocks/prompt-fixtures';
import { invalidField, mswPath, problem } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

type MockProject = (typeof MOCK_PROJECTS)[number];

const [fynix, cleanstart] = MOCK_PROJECTS;
if (fynix === undefined || cleanstart === undefined) throw new Error('The fixture projects are missing');

afterEach(() => {
  server.events.removeAllListeners();
});

function enginesAs(role: Role, project: MockProject, country: string | null): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return (
    <PermissionProvider membership={membershipFactory(role)}>
      <EnginesScreen
        workspaceId={MOCK_WORKSPACE.workspace_id}
        projectId={project.project_id}
        workspaceSlug="digibranders"
        projectSlug={project.slug}
        defaultCountryIso={country}
      />
    </PermissionProvider>
  );
}

/** The bodies the screen sends to the engine routes, as they arrive. */
function recordPuts(): unknown[] {
  const bodies: unknown[] = [];
  server.events.on('request:start', ({ request }) => {
    if (request.method === 'PUT' && new URL(request.url).pathname.includes('/engines/')) {
      void request
        .clone()
        .json()
        .then((body: unknown) => bodies.push(body));
    }
  });
  return bodies;
}

const enginePath = (project: MockProject): string =>
  mswPath(`/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}/projects/${project.project_id}/engines/:engine_code`);

const enginesPath = (project: MockProject): string =>
  mswPath(`/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}/projects/${project.project_id}/engines`);

const PRICE_150 = monthlyCostUsd(150);

interface StubEngine {
  code: EngineCode;
  on: boolean;
  /** `undefined` is the price of 150 active prompts, `null` is no price on record. */
  price?: string | null;
}

const engineOf = ({ code, on, price }: StubEngine): ProjectEngine => ({
  engine: ENGINE_FACTS[code],
  is_configured: on,
  is_enabled: on,
  location_ids: on ? [2840] : [],
  replicates: 1,
  provider_code: 'dataforseo',
  active_prompts: 150,
  estimated_monthly_cost_usd: price === undefined ? PRICE_150 : price,
});

/**
 * The engines of a project with 150 active prompts each, kept as a small API: the list answers what the
 * saves left, so the screen reads back what it wrote. A save waits for `hold` when one is given.
 */
function stubEngines(project: MockProject, stubs: readonly StubEngine[], hold?: Promise<void>): void {
  const list = stubs.map(engineOf);
  server.use(
    http.get(enginesPath(project), () => HttpResponse.json({ data: list })),
    http.put(enginePath(project), async ({ request, params }) => {
      if (hold !== undefined) await hold;
      const body: unknown = await request.json();
      const index = list.findIndex((item) => item.engine.engine_code === params.engine_code);
      const current = list[index];
      if (current === undefined || !isSave(body)) return new HttpResponse(null, { status: 400 });
      const next = { ...current, is_configured: true, is_enabled: body.is_enabled, location_ids: body.location_ids };
      list[index] = next;
      return HttpResponse.json({ data: next });
    }),
  );
}

const isSave = (body: unknown): body is { location_ids: number[]; is_enabled: boolean } =>
  typeof body === 'object' &&
  body !== null &&
  'location_ids' in body &&
  Array.isArray(body.location_ids) &&
  'is_enabled' in body &&
  typeof body.is_enabled === 'boolean';

/** The cost change banner, or `null` while the screen shows none. */
const costSummary = (): HTMLElement | null => {
  const banner = screen
    .queryByText(/Estimated cost change|No price is on record, so the change/)
    ?.closest('[data-slot="banner"]');
  return banner instanceof HTMLElement ? banner : null;
};

describe('Project settings > Engines', () => {
  it('shows each engine with its switch, its monthly cost and its countries, and says it starts spend', async () => {
    const { container } = renderWithProviders(enginesAs('editor', fynix, 'DE'));
    expect(await screen.findByRole('switch', { name: 'ChatGPT' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Gemini' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Google AI Mode' })).not.toBeChecked();
    expect(screen.getAllByText('About $0.25 a month for 24 active prompts, twice a week')).toHaveLength(3);
    expect(screen.getByText(/Turning an engine on starts scheduled spend/)).toBeInTheDocument();
    const chatgptCountries = await screen.findByRole('toolbar', { name: 'Countries of ChatGPT' });
    expect(await within(chatgptCountries).findByText('Germany')).toBeInTheDocument();
    expect(within(chatgptCountries).getByText('India')).toBeInTheDocument();
    // Each field of countries is named for its engine
    for (const engine of ['ChatGPT', 'Gemini', 'Google AI Mode']) {
      expect(screen.getByText(`Countries of ${engine}`, { selector: 'label' })).toBeInTheDocument();
    }
    expect(await axe(container)).toHaveNoViolations();
  });

  it('says where the two weekly runs are paused and resumed: the Schedules section of the project', async () => {
    renderWithProviders(enginesAs('editor', fynix, 'DE'));
    await screen.findByRole('switch', { name: 'ChatGPT' });
    expect(screen.getByRole('link', { name: 'Schedules' })).toHaveAttribute(
      'href',
      `/digibranders/${fynix.slug}/settings/schedules`,
    );
  });

  it('says 1 active prompt in the singular, on the row and in the question', async () => {
    const gemini: ProjectEngine = {
      engine: ENGINE_FACTS.gemini_web,
      is_configured: false,
      is_enabled: false,
      location_ids: [],
      replicates: 1,
      provider_code: 'dataforseo',
      active_prompts: 1,
      estimated_monthly_cost_usd: '0.010000',
    };
    server.use(
      http.get(
        mswPath(`/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}/projects/${cleanstart.project_id}/engines`),
        () => HttpResponse.json({ data: [gemini] }),
      ),
    );
    const { user } = renderWithProviders(enginesAs('editor', cleanstart, 'US'));
    expect(await screen.findByText('About $0.01 a month for 1 active prompt, twice a week')).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: 'Gemini' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Turn on Gemini?' });
    expect(within(confirm).getByText(/will ask your 1 active prompt twice a week/)).toBeInTheDocument();
  });

  it('asks before an engine is turned on, with the cost, then saves it with the country of the project', async () => {
    const puts = recordPuts();
    const { user } = renderWithProviders(enginesAs('editor', cleanstart, 'US'));
    await user.click(await screen.findByRole('switch', { name: 'Gemini' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Turn on Gemini?' });
    expect(within(confirm).getByText(/starts scheduled spend from the next run/)).toBeInTheDocument();
    await user.click(within(confirm).getByRole('button', { name: 'Turn on Gemini' }));
    expect(await screen.findByText('Gemini is on')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Gemini' })).toBeChecked());
    expect(puts).toEqual([{ location_ids: [2840], is_enabled: true }]);
  });

  it('reads the schedules of the project again after an engine is switched, since the first engine makes its schedules', async () => {
    const { user, queryClient } = renderWithProviders(enginesAs('editor', cleanstart, 'US'));
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    await user.click(await screen.findByRole('switch', { name: 'Gemini' }));
    await user.click(await screen.findByRole('button', { name: 'Turn on Gemini' }));
    await screen.findByText('Gemini is on');
    // The key of the Schedules screen (features/project-settings), spelled out: features do not import each other
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['ws', MOCK_WORKSPACE.workspace_id, 'p', cleanstart.project_id, 'schedules'],
    });
  });

  it('sends nothing when the question is cancelled', async () => {
    const puts = recordPuts();
    const { user } = renderWithProviders(enginesAs('editor', cleanstart, 'US'));
    await user.click(await screen.findByRole('switch', { name: 'ChatGPT' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('switch', { name: 'ChatGPT' })).not.toBeChecked();
    expect(puts).toEqual([]);
  });

  it('turns an engine off at once, keeping its countries', async () => {
    const puts = recordPuts();
    const { user } = renderWithProviders(enginesAs('editor', fynix, 'DE'));
    const chatgpt = await screen.findByRole('switch', { name: 'ChatGPT' });
    await screen.findAllByText('Germany');
    await user.click(chatgpt);
    expect(await screen.findByText('ChatGPT is off')).toBeInTheDocument();
    expect(puts).toEqual([{ location_ids: [2276, 2356], is_enabled: false }]);
  });

  it('keeps the question open and names the country problem when the API refuses a country', async () => {
    server.use(
      http.put(enginePath(cleanstart), ({ request }) =>
        invalidField(request, 'location_ids', 'location_not_supported', 'Gemini runs in active countries only.'),
      ),
    );
    const { user } = renderWithProviders(enginesAs('editor', cleanstart, 'US'));
    await user.click(await screen.findByRole('switch', { name: 'Gemini' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Turn on Gemini?' });
    await user.click(within(confirm).getByRole('button', { name: 'Turn on Gemini' }));
    expect(
      await within(confirm).findByText('One of the countries cannot be used. Choose another.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Gemini is on')).not.toBeInTheDocument();
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('switch', { name: 'Gemini' })).not.toBeChecked();
    // The refusal belonged to the question; it does not stay on the row once the question is closed
    await waitFor(() =>
      expect(screen.queryByText('One of the countries cannot be used. Choose another.')).not.toBeInTheDocument(),
    );
  });

  it('saves the countries of an engine that is on as they change', async () => {
    const puts = recordPuts();
    const { user } = renderWithProviders(enginesAs('editor', fynix, 'DE'));
    const chatgpt = await screen.findByRole('toolbar', { name: 'Countries of ChatGPT' });
    await user.click(await within(chatgpt).findByRole('button', { name: 'Remove Germany' }));
    await waitFor(() => expect(puts).toEqual([{ location_ids: [2356], is_enabled: true }]));
  });

  it('turns an engine off with the countries it holds, not with a field the person emptied', async () => {
    const puts = recordPuts();
    const { user } = renderWithProviders(enginesAs('editor', cleanstart, 'US'));
    await user.click(await screen.findByRole('switch', { name: 'Gemini' }));
    await user.click(await screen.findByRole('button', { name: 'Turn on Gemini' }));
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Gemini' })).toBeChecked());
    const countries = await screen.findByRole('toolbar', { name: 'Countries of Gemini' });
    await user.click(within(countries).getByRole('button', { name: 'Remove United States' }));
    // Nothing is sent for an empty field, which says what is missing
    expect(await screen.findByText('Choose at least one country.')).toBeInTheDocument();
    expect(puts).toEqual([{ location_ids: [2840], is_enabled: true }]);
    await user.click(screen.getByRole('switch', { name: 'Gemini' }));
    expect(await screen.findByText('Gemini is off')).toBeInTheDocument();
    expect(puts).toEqual([
      { location_ids: [2840], is_enabled: true },
      { location_ids: [2840], is_enabled: false },
    ]);
  });

  it('turns an engine off with its saved countries after a country change was refused', async () => {
    const puts = recordPuts();
    server.use(
      http.put(
        enginePath(fynix),
        ({ request }) =>
          invalidField(request, 'location_ids', 'location_not_supported', 'ChatGPT runs in active countries only.'),
        { once: true },
      ),
    );
    const { user } = renderWithProviders(enginesAs('editor', fynix, 'DE'));
    const chatgpt = await screen.findByRole('toolbar', { name: 'Countries of ChatGPT' });
    await user.click(await within(chatgpt).findByRole('button', { name: 'Remove Germany' }));
    expect(await screen.findByText('One of the countries cannot be used. Choose another.')).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: 'ChatGPT' }));
    expect(await screen.findByText('ChatGPT is off')).toBeInTheDocument();
    expect(puts).toEqual([
      { location_ids: [2356], is_enabled: true },
      { location_ids: [2276, 2356], is_enabled: false },
    ]);
  });

  it('asks for a country only once the field was changed or turning on was tried', async () => {
    const { user } = renderWithProviders(enginesAs('editor', cleanstart, null));
    const gemini = await screen.findByRole('switch', { name: 'Gemini' });
    // Opening the list of a field shows the countries have loaded; nothing was changed in it
    const [field] = screen.getAllByRole('combobox');
    if (field === undefined) throw new Error('No field of countries');
    await user.click(field);
    expect(await screen.findByRole('option', { name: 'Germany' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.click(gemini);
    const confirm = await screen.findByRole('alertdialog', { name: 'Turn on Gemini?' });
    expect(screen.queryByText('Choose at least one country.')).not.toBeInTheDocument();
    await user.click(within(confirm).getByRole('button', { name: 'Turn on Gemini' }));
    expect(await within(confirm).findByText('Choose at least one country.')).toBeInTheDocument();
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    // The question is closed; the field itself now says what is missing, once per engine row
    await waitFor(() => expect(screen.getAllByText('Choose at least one country.')).toHaveLength(1));
  });

  it('says why when turning an engine off is refused, and leaves the switch where it was', async () => {
    server.use(http.put(enginePath(fynix), ({ request }) => problem(request, 'forbidden')));
    const { user } = renderWithProviders(enginesAs('editor', fynix, 'DE'));
    await user.click(await screen.findByRole('switch', { name: 'ChatGPT' }));
    expect(
      await screen.findByText('You do not have permission to change the engines of this project.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'ChatGPT' })).toBeChecked();
  });

  it('is read-only without projects:write', async () => {
    renderWithProviders(enginesAs('viewer', fynix, 'DE'));
    // The switch is a span with `aria-disabled`, not a form control
    expect(await screen.findByRole('switch', { name: 'ChatGPT' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Owners, admins and editors can turn engines on and off.')).toBeInTheDocument();
  });

  // WB-SET-03: the schedule the runs follow is said on the page
  it('says the runs are twice a week, on Monday and Thursday', async () => {
    renderWithProviders(enginesAs('editor', fynix, 'DE'));
    await screen.findByRole('switch', { name: 'ChatGPT' });
    expect(screen.getByText(/twice a week, on Monday and Thursday/)).toBeInTheDocument();
  });
});

const rowOf = (switchName: string): HTMLElement => {
  const row = screen.getByRole('switch', { name: switchName }).closest('li');
  if (row === null) throw new Error(`No row for ${switchName}`);
  return row;
};

/*
 * States of the additions below: the class badge, the Perplexity row and the cost summary read what the list
 * already holds, so they have no loading, empty or error state of their own (those are the screen's, above).
 * The summary is a consequence of one save: it is absent before it and after the next save starts (stale does
 * not apply: a refetch keeps the engines on screen and the summary is derived from them). Partial is the
 * missing price, tested below.
 */
describe('Project settings > Engines: class, Perplexity row and cost change summary', () => {
  it('names the class of each engine beside its name, with a hidden prefix', async () => {
    renderWithProviders(enginesAs('editor', fynix, 'DE'));
    await screen.findByRole('switch', { name: 'ChatGPT' });
    for (const [engine, label] of [
      ['ChatGPT', 'Consumer UI'],
      ['Gemini', 'Consumer UI'],
      ['Google AI Mode', 'SERP AI'],
    ] as const) {
      const row = rowOf(engine);
      expect(within(row).getByText('Class:')).toHaveClass('sr-only');
      expect(within(row).getByText(label)).toBeInTheDocument();
      expect(row).toHaveTextContent(`Class: ${label}`);
    }
  });

  it('shows the code of a class a newer API sends, never a blank', async () => {
    const gemini = { ...engineOf({ code: 'gemini_web', on: false }) };
    server.use(
      http.get(enginesPath(cleanstart), () =>
        HttpResponse.json({ data: [{ ...gemini, engine: { ...gemini.engine, observation_class: 'agent_api' } }] }),
      ),
    );
    renderWithProviders(enginesAs('editor', cleanstart, 'US'));
    await screen.findByRole('switch', { name: 'Gemini' });
    expect(within(rowOf('Gemini')).getByText('agent_api')).toBeInTheDocument();
  });

  it('lists the Perplexity API after the three engines: official API, not available yet, switch disabled', async () => {
    renderWithProviders(enginesAs('editor', fynix, 'DE'));
    await screen.findByRole('switch', { name: 'ChatGPT' });
    const perplexity = screen.getByRole('switch', { name: 'Perplexity API' });
    expect(perplexity).toHaveAttribute('aria-disabled', 'true');
    expect(perplexity).not.toBeChecked();
    const row = rowOf('Perplexity API');
    expect(within(row).getByText('Not available yet')).toBeInTheDocument();
    expect(within(row).getByText('Official API')).toBeInTheDocument();
    expect(within(row).queryByRole('combobox')).not.toBeInTheDocument();
    // After the three engines, in the same list, and one more switch than there are engines
    expect(screen.getAllByRole('switch')).toHaveLength(4);
    expect(row.previousElementSibling).toBe(rowOf('Google AI Mode'));
  });

  it('sends nothing when the Perplexity switch is clicked or used from the keyboard', async () => {
    const requests: string[] = [];
    const { user } = renderWithProviders(enginesAs('editor', fynix, 'DE'));
    const perplexity = await screen.findByRole('switch', { name: 'Perplexity API' });
    await screen.findAllByText('Germany');
    server.events.on('request:start', ({ request }) => requests.push(`${request.method} ${request.url}`));
    await user.click(perplexity);
    perplexity.focus();
    await user.keyboard(' ');
    await user.keyboard('{Enter}');
    expect(perplexity).not.toBeChecked();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(requests).toEqual([]);
  });

  it('says what turning an engine on adds to the month, with the total of the engines that are on', async () => {
    stubEngines(fynix, [
      { code: 'chatgpt_web', on: false },
      { code: 'gemini_web', on: false },
      { code: 'google_ai_mode', on: false },
    ]);
    const { user } = renderWithProviders(enginesAs('editor', fynix, 'DE'));
    await user.click(await screen.findByRole('switch', { name: 'ChatGPT' }));
    await user.click(await screen.findByRole('button', { name: 'Turn on ChatGPT' }));
    const summary = await waitFor(() => {
      const found = costSummary();
      if (found === null) throw new Error('No summary yet');
      return found;
    });
    expect(summary).toHaveTextContent(
      'Estimated cost change: about $1.56 a month more. Estimated total for 1 engine that is on: $1.56 a month. Estimate from the price book.',
    );
    // Told to assistive technology when it appears
    expect(summary).toHaveAttribute('role', 'status');
  });

  it('says what turning an engine off takes away, and a total without it', async () => {
    stubEngines(fynix, [
      { code: 'chatgpt_web', on: true },
      { code: 'gemini_web', on: true },
      { code: 'google_ai_mode', on: false },
    ]);
    const { user } = renderWithProviders(enginesAs('editor', fynix, 'DE'));
    await user.click(await screen.findByRole('switch', { name: 'ChatGPT' }));
    await waitFor(() => expect(costSummary()).not.toBeNull());
    expect(costSummary()).toHaveTextContent(
      'Estimated cost change: about $1.56 a month less. Estimated total for 1 engine that is on: $1.56 a month.',
    );
    await user.click(screen.getByRole('switch', { name: 'Gemini' }));
    await waitFor(() =>
      expect(costSummary()).toHaveTextContent('about $1.56 a month less. Estimated total for 0 engines'),
    );
    expect(costSummary()).toHaveTextContent('$0.00 a month');
  });

  it('never counts the Perplexity row in the total', async () => {
    stubEngines(fynix, [
      { code: 'chatgpt_web', on: true },
      { code: 'gemini_web', on: false },
      { code: 'google_ai_mode', on: false },
    ]);
    const { user } = renderWithProviders(enginesAs('editor', fynix, 'DE'));
    await user.click(await screen.findByRole('switch', { name: 'Gemini' }));
    await user.click(await screen.findByRole('button', { name: 'Turn on Gemini' }));
    await waitFor(() => expect(costSummary()).not.toBeNull());
    expect(costSummary()).toHaveTextContent('Estimated total for 2 engines that are on: $3.12 a month.');
  });

  it('does not estimate the change of an engine with no price, and shows no number for it', async () => {
    stubEngines(fynix, [
      { code: 'chatgpt_web', on: false, price: null },
      { code: 'gemini_web', on: false },
      { code: 'google_ai_mode', on: false },
    ]);
    const { user } = renderWithProviders(enginesAs('editor', fynix, 'DE'));
    await user.click(await screen.findByRole('switch', { name: 'ChatGPT' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Turn on ChatGPT?' });
    await user.click(within(confirm).getByRole('button', { name: 'Turn on ChatGPT' }));
    await waitFor(() => expect(costSummary()).not.toBeNull());
    const summary = costSummary();
    expect(summary).toHaveTextContent('No price is on record, so the change is not estimated.');
    expect(summary?.textContent).not.toMatch(/\$|\d/);
  });

  it('keeps the change but not the total when another engine that is on has no price', async () => {
    stubEngines(fynix, [
      { code: 'chatgpt_web', on: true, price: null },
      { code: 'gemini_web', on: false },
      { code: 'google_ai_mode', on: false },
    ]);
    const { user } = renderWithProviders(enginesAs('editor', fynix, 'DE'));
    await user.click(await screen.findByRole('switch', { name: 'Gemini' }));
    await user.click(await screen.findByRole('button', { name: 'Turn on Gemini' }));
    await waitFor(() => expect(costSummary()).not.toBeNull());
    const summary = costSummary();
    expect(summary).toHaveTextContent('Estimated cost change: about $1.56 a month more.');
    expect(summary).toHaveTextContent(
      'The total is not estimated because an engine that is on has no price on record.',
    );
    expect(summary).not.toHaveTextContent('Estimated total for');
  });

  it('shows no summary for a change of countries, and none before any save', async () => {
    const puts = recordPuts();
    const { user } = renderWithProviders(enginesAs('editor', fynix, 'DE'));
    const chatgpt = await screen.findByRole('toolbar', { name: 'Countries of ChatGPT' });
    expect(costSummary()).toBeNull();
    await user.click(await within(chatgpt).findByRole('button', { name: 'Remove Germany' }));
    await waitFor(() => expect(puts).toEqual([{ location_ids: [2356], is_enabled: true }]));
    await waitFor(() => expect(screen.getByRole('switch', { name: 'ChatGPT' })).not.toHaveAttribute('aria-busy'));
    expect(costSummary()).toBeNull();
  });

  it('removes the summary as the next save starts', async () => {
    let release: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    stubEngines(fynix, [
      { code: 'chatgpt_web', on: false },
      { code: 'gemini_web', on: true },
      { code: 'google_ai_mode', on: false },
    ]);
    const { user } = renderWithProviders(enginesAs('editor', fynix, 'DE'));
    // The first save is not held: it is the one that makes the summary
    await user.click(await screen.findByRole('switch', { name: 'ChatGPT' }));
    await user.click(await screen.findByRole('button', { name: 'Turn on ChatGPT' }));
    await waitFor(() => expect(costSummary()).not.toBeNull());
    // The next save waits on the API: the summary must be gone before it answers
    stubEngines(
      fynix,
      [
        { code: 'chatgpt_web', on: true },
        { code: 'gemini_web', on: true },
        { code: 'google_ai_mode', on: false },
      ],
      hold,
    );
    await user.click(screen.getByRole('switch', { name: 'Gemini' }));
    await waitFor(() => expect(costSummary()).toBeNull());
    release();
    await waitFor(() => expect(costSummary()).not.toBeNull());
  });

  it('is read-only for a viewer: every switch is disabled and no summary is shown', async () => {
    stubEngines(fynix, [
      { code: 'chatgpt_web', on: true },
      { code: 'gemini_web', on: false },
      { code: 'google_ai_mode', on: false },
    ]);
    const { user } = renderWithProviders(enginesAs('viewer', fynix, 'DE'));
    await screen.findByRole('switch', { name: 'ChatGPT' });
    for (const item of screen.getAllByRole('switch')) {
      expect(item).toHaveAttribute('aria-disabled', 'true');
      await user.click(item);
    }
    expect(costSummary()).toBeNull();
  });

  it('has no axe violations with the summary and the Perplexity row on screen', async () => {
    stubEngines(fynix, [
      { code: 'chatgpt_web', on: false },
      { code: 'gemini_web', on: true },
      { code: 'google_ai_mode', on: false },
    ]);
    const { user, container } = renderWithProviders(enginesAs('editor', fynix, 'DE'));
    await user.click(await screen.findByRole('switch', { name: 'ChatGPT' }));
    await user.click(await screen.findByRole('button', { name: 'Turn on ChatGPT' }));
    await waitFor(() => expect(costSummary()).not.toBeNull());
    expect(await axe(container)).toHaveNoViolations();
  });
});
