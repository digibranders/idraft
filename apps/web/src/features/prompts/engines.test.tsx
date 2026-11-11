import { screen, waitFor, within } from '@testing-library/react';
import { http } from 'msw';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { EnginesScreen } from './engines-screen';
import type { Role } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
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

function enginesAs(role: Role, project: MockProject, country: string): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return (
    <PermissionProvider membership={membershipFactory(role)}>
      <EnginesScreen
        workspaceId={MOCK_WORKSPACE.workspace_id}
        projectId={project.project_id}
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
    expect(await axe(container)).toHaveNoViolations();
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
