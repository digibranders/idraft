import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { EnginesScreen } from './engines-screen';
import type { ProjectEngine, Role } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { ENGINE_FACTS } from '@/mocks/prompt-fixtures';
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
});
