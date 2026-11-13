import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { EnginesScreen } from './engines-screen';
import { LIVE_REGION_ID } from '@/lib/a11y/announcer';
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
  /** The device Google AI Mode holds; the other engines take none. `undefined` is desktop. */
  device?: 'desktop' | 'mobile';
  /** The countries of an engine that is on; `undefined` is the United States. */
  locations?: number[];
}

const engineOf = ({ code, on, price, device, locations }: StubEngine): ProjectEngine => ({
  engine: ENGINE_FACTS[code],
  is_configured: on,
  is_enabled: on,
  location_ids: on ? (locations ?? [2840]) : [],
  replicates: 1,
  provider_code: 'dataforseo',
  active_prompts: 150,
  estimated_monthly_cost_usd: price === undefined ? PRICE_150 : price,
  provider_params: { device: code === 'google_ai_mode' ? (device ?? 'desktop') : null },
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
      const body = SAVE.safeParse(await request.json());
      const index = list.findIndex((item) => item.engine.engine_code === params.engine_code);
      const current = list[index];
      if (current === undefined || !body.success) return new HttpResponse(null, { status: 400 });
      const { location_ids, is_enabled, provider_params } = body.data;
      // A save without provider_params keeps the saved device, as the API does
      const device = provider_params?.device ?? current.provider_params?.device ?? null;
      const next = { ...current, is_configured: true, is_enabled, location_ids, provider_params: { device } };
      list[index] = next;
      return HttpResponse.json({ data: next });
    }),
  );
}

const SAVE = z.object({
  location_ids: z.array(z.number()),
  is_enabled: z.boolean(),
  provider_params: z.object({ device: z.enum(['desktop', 'mobile']) }).optional(),
});

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

const DEVICE_LABEL = 'Device of Google AI Mode';

/** The device control of an engine, the group named for it, or `null` while the row shows none. */
const deviceGroup = (engine = 'Google AI Mode'): HTMLElement | null =>
  screen.queryByRole('group', { name: `Device of ${engine}` });

/** The segment of the device control that is chosen is the one named `name`. */
const expectDevice = (name: string): void => {
  const group = deviceGroup();
  if (group === null) throw new Error('No device control');
  expect(within(group).getByRole('radio', { checked: true })).toHaveAccessibleName(name);
};

const stubAiMode = (on: boolean, device?: 'desktop' | 'mobile', locations?: number[], hold?: Promise<void>): void =>
  stubEngines(
    fynix,
    [
      { code: 'chatgpt_web', on: true },
      { code: 'gemini_web', on: true },
      {
        code: 'google_ai_mode',
        on,
        ...(device === undefined ? {} : { device }),
        ...(locations === undefined ? {} : { locations }),
      },
    ],
    hold,
  );

/** A promise that settles when `release` is called: the API's answer to a save the test holds back. */
function held(): { hold: Promise<void>; release: () => void } {
  let release: () => void = () => undefined;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { hold, release };
}

/*
 * States of the device control: it reads the engine list the screen already holds, so it has no loading, empty
 * or error state of its own (those are the screen's, above). Partial: an engine that takes no device (no
 * `provider_params.device`) shows no control. Stale: a refetch keeps the control on screen with what the list
 * says. A save that fails keeps the old value and says so on the row. Phone width is not asserted here (class
 * checks prove nothing about overflow): the reviewer opens the page at 390 px.
 */
describe('Project settings > Engines: device of Google AI Mode', () => {
  it('shows the control on Google AI Mode only, with the device it holds and what the choice changes', async () => {
    stubAiMode(true, 'mobile');
    renderWithProviders(enginesAs('editor', fynix, 'DE'));
    await screen.findByRole('switch', { name: 'Google AI Mode' });
    expect(await screen.findByRole('group', { name: DEVICE_LABEL })).toBeInTheDocument();
    expect(screen.getAllByRole('group', { name: /^Device of / })).toHaveLength(1);
    expect(deviceGroup('ChatGPT')).toBeNull();
    expect(deviceGroup('Gemini')).toBeNull();
    expectDevice('Mobile');
    expect(
      screen.getByText('Applies from the next run. Answers already collected keep the device they were collected on.'),
    ).toBeInTheDocument();
  });

  it('shows desktop for an engine that was never set up, and also while it is off', async () => {
    renderWithProviders(enginesAs('editor', fynix, 'DE'));
    await screen.findByRole('group', { name: DEVICE_LABEL });
    expect(screen.getByRole('switch', { name: 'Google AI Mode' })).not.toBeChecked();
    expectDevice('Desktop');
  });

  it('shows no control for an engine whose row carries no device', async () => {
    const gemini = engineOf({ code: 'gemini_web', on: true });
    server.use(
      http.get(enginesPath(cleanstart), () =>
        HttpResponse.json({ data: [{ ...gemini, provider_params: { device: null } }] }),
      ),
    );
    renderWithProviders(enginesAs('editor', cleanstart, 'US'));
    await screen.findByRole('switch', { name: 'Gemini' });
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  it('saves a change of an engine that is on at once, once, with its countries and the switch on', async () => {
    stubAiMode(true, 'desktop', [2276, 2356]);
    const puts = recordPuts();
    const { user } = renderWithProviders(enginesAs('editor', fynix, 'DE'));
    const group = await screen.findByRole('group', { name: DEVICE_LABEL });
    await user.click(within(group).getByRole('radio', { name: 'Mobile' }));
    await waitFor(() => expectDevice('Mobile'));
    expect(puts).toEqual([{ location_ids: [2276, 2356], is_enabled: true, provider_params: { device: 'mobile' } }]);
    // The save did not move the engine: it is on, and no cost summary says otherwise
    expect(screen.getByRole('switch', { name: 'Google AI Mode' })).toBeChecked();
    expect(costSummary()).toBeNull();
    // Said once the save has landed, not before
    await waitFor(() =>
      expect(document.getElementById(LIVE_REGION_ID.polite)).toHaveTextContent(
        'Device of Google AI Mode set to Mobile.',
      ),
    );
  });

  it('holds the choice of an engine that is off and sends nothing until it is turned on, then sends it once', async () => {
    const puts = recordPuts();
    const { user } = renderWithProviders(enginesAs('editor', fynix, 'DE'));
    const group = await screen.findByRole('group', { name: DEVICE_LABEL });
    await user.click(within(group).getByRole('radio', { name: 'Mobile' }));
    expectDevice('Mobile');
    expect(document.getElementById(LIVE_REGION_ID.polite)).toHaveTextContent(
      'Device of Google AI Mode set to Mobile. It applies once the engine is turned on.',
    );
    expect(puts).toEqual([]);
    await user.click(screen.getByRole('switch', { name: 'Google AI Mode' }));
    await user.click(await screen.findByRole('button', { name: 'Turn on Google AI Mode' }));
    expect(await screen.findByText('Google AI Mode is on')).toBeInTheDocument();
    await waitFor(() => expectDevice('Mobile'));
    expect(puts).toEqual([{ location_ids: [2276], is_enabled: true, provider_params: { device: 'mobile' } }]);
  });

  it('turns an engine on without provider_params when the device was not touched', async () => {
    const puts = recordPuts();
    const { user } = renderWithProviders(enginesAs('editor', fynix, 'DE'));
    await screen.findByRole('group', { name: DEVICE_LABEL });
    await user.click(screen.getByRole('switch', { name: 'Google AI Mode' }));
    await user.click(await screen.findByRole('button', { name: 'Turn on Google AI Mode' }));
    expect(await screen.findByText('Google AI Mode is on')).toBeInTheDocument();
    expect(puts).toEqual([{ location_ids: [2276], is_enabled: true }]);
  });

  it('sends no provider_params when the countries change or the engine is turned off, and keeps the device', async () => {
    stubAiMode(true, 'mobile', [2276, 2356]);
    const puts = recordPuts();
    const { user } = renderWithProviders(enginesAs('editor', fynix, 'DE'));
    const countries = await screen.findByRole('toolbar', { name: 'Countries of Google AI Mode' });
    await user.click(await within(countries).findByRole('button', { name: 'Remove Germany' }));
    await waitFor(() => expect(puts).toEqual([{ location_ids: [2356], is_enabled: true }]));
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Google AI Mode' })).not.toHaveAttribute('aria-busy'),
    );
    expectDevice('Mobile');
    await user.click(screen.getByRole('switch', { name: 'Google AI Mode' }));
    expect(await screen.findByText('Google AI Mode is off')).toBeInTheDocument();
    expect(puts).toEqual([
      { location_ids: [2356], is_enabled: true },
      { location_ids: [2356], is_enabled: false },
    ]);
    expectDevice('Mobile');
  });

  it('keeps the old device and says the change was not saved when the save fails', async () => {
    stubAiMode(true, 'desktop');
    server.use(
      http.put(enginePath(fynix), ({ request }) =>
        invalidField(request, 'provider_params.device', 'device_not_supported', 'Google AI Mode takes no device.'),
      ),
    );
    const { user } = renderWithProviders(enginesAs('editor', fynix, 'DE'));
    const group = await screen.findByRole('group', { name: DEVICE_LABEL });
    await user.click(within(group).getByRole('radio', { name: 'Mobile' }));
    expect(await screen.findByText('The change was not saved. Try again in a moment.')).toBeInTheDocument();
    expectDevice('Desktop');
    expect(screen.getByRole('switch', { name: 'Google AI Mode' })).toBeChecked();
  });

  it('is disabled without projects:write and sends nothing when it is clicked', async () => {
    stubAiMode(true, 'desktop');
    const puts = recordPuts();
    const { user } = renderWithProviders(enginesAs('viewer', fynix, 'DE'));
    const group = await screen.findByRole('group', { name: DEVICE_LABEL });
    for (const radio of within(group).getAllByRole('radio')) {
      expect(radio).toHaveAttribute('aria-disabled', 'true');
      await user.click(radio);
    }
    expectDevice('Desktop');
    expect(puts).toEqual([]);
  });

  it('moves with the arrow keys, saves once for the change and announces it', async () => {
    stubAiMode(true, 'desktop');
    const puts = recordPuts();
    const { user } = renderWithProviders(enginesAs('editor', fynix, 'DE'));
    const group = await screen.findByRole('group', { name: DEVICE_LABEL });
    within(group).getByRole('radio', { name: 'Desktop' }).focus();
    await user.keyboard('{ArrowRight}');
    await waitFor(() => expectDevice('Mobile'));
    expect(puts).toEqual([{ location_ids: [2840], is_enabled: true, provider_params: { device: 'mobile' } }]);
    expect(within(group).getByRole('radio', { name: 'Mobile' })).toHaveFocus();
    await waitFor(() =>
      expect(document.getElementById(LIVE_REGION_ID.polite)).toHaveTextContent(
        'Device of Google AI Mode set to Mobile.',
      ),
    );
    await user.keyboard('{ArrowLeft}');
    await waitFor(() => expectDevice('Desktop'));
    expect(puts).toHaveLength(2);
  });

  it('ignores a device click while a switch-off is still being saved, so it cannot turn the engine back on', async () => {
    const { hold, release } = held();
    stubAiMode(true, 'desktop', undefined, hold);
    const puts = recordPuts();
    const { user } = renderWithProviders(enginesAs('editor', fynix, 'DE'));
    const group = await screen.findByRole('group', { name: DEVICE_LABEL });
    await user.click(screen.getByRole('switch', { name: 'Google AI Mode' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    // The list still says the engine is on: the click must not save from that stale row
    await user.click(within(group).getByRole('radio', { name: 'Mobile' }));
    expectDevice('Desktop');
    release();
    expect(await screen.findByText('Google AI Mode is off')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Google AI Mode' })).not.toBeChecked());
    expect(screen.getByRole('switch', { name: 'Google AI Mode' })).not.toBeChecked();
    expectDevice('Desktop');
    expect(puts).toEqual([{ location_ids: [2840], is_enabled: false }]);
  });

  it('ignores a device click while a change of countries is still being saved, and keeps those countries', async () => {
    const { hold, release } = held();
    stubAiMode(true, 'desktop', [2276, 2356], hold);
    const puts = recordPuts();
    const { user } = renderWithProviders(enginesAs('editor', fynix, 'DE'));
    const countries = await screen.findByRole('toolbar', { name: 'Countries of Google AI Mode' });
    const group = screen.getByRole('group', { name: DEVICE_LABEL });
    await user.click(await within(countries).findByRole('button', { name: 'Remove Germany' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    await user.click(within(group).getByRole('radio', { name: 'Mobile' }));
    expectDevice('Desktop');
    release();
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Google AI Mode' })).not.toHaveAttribute('aria-busy'),
    );
    expect(puts).toEqual([{ location_ids: [2356], is_enabled: true }]);
    expectDevice('Desktop');
    // Once the save has landed the control works again, from the countries it saved
    await user.click(within(group).getByRole('radio', { name: 'Mobile' }));
    await waitFor(() => expectDevice('Mobile'));
    expect(puts).toEqual([
      { location_ids: [2356], is_enabled: true },
      { location_ids: [2356], is_enabled: true, provider_params: { device: 'mobile' } },
    ]);
  });

  it('has no axe violations with the device control on screen, the engine off', async () => {
    stubAiMode(false);
    const { container } = renderWithProviders(enginesAs('editor', fynix, 'DE'));
    await screen.findByRole('group', { name: DEVICE_LABEL });
    expect(await axe(container)).toHaveNoViolations();
  });

  it('has no axe violations with the device control on screen, the engine on', async () => {
    stubAiMode(true, 'mobile');
    const { container } = renderWithProviders(enginesAs('editor', fynix, 'DE'));
    await screen.findByRole('group', { name: DEVICE_LABEL });
    expect(await axe(container)).toHaveNoViolations();
  });
});
