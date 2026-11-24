import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { DayCompareScreen } from './day-compare-screen';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { FIXTURE_PROMPTS } from '@/mocks/prompt-fixtures';
import { mswPath, problem } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The Fynix project fixture is missing');
const PROJECT_ID = fynix.project_id;
const [prompt] = FIXTURE_PROMPTS.get(PROJECT_ID) ?? [];
if (prompt === undefined) throw new Error('The fixture prompts are missing');

function screenFor(promptId: string): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('viewer').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return (
    <PermissionProvider membership={membershipFactory('viewer')}>
      <DayCompareScreen
        workspaceId={MOCK_WORKSPACE.workspace_id}
        projectId={PROJECT_ID}
        workspaceSlug={MOCK_WORKSPACE.slug}
        projectSlug="fynix"
        promptId={promptId}
        timeZone="Europe/Berlin"
      />
    </PermissionProvider>
  );
}

const DETAIL = mswPath(`${P}/ai/observations/{observation_id}`);

describe('Compare days', () => {
  it('shows the prompt, a platform select and one card for each day with a valid answer', async () => {
    renderWithProviders(screenFor(prompt.prompt_id));

    expect(await screen.findByRole('heading', { level: 2, name: 'Compare days' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 1, name: prompt.text })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to prompts' })).toHaveAttribute(
      'href',
      '/digibranders/fynix/ai/prompts',
    );
    const days = await screen.findAllByRole('article');
    expect(days.length).toBeGreaterThan(0);
    expect(days.length).toBeLessThanOrEqual(4);
    for (const day of days) {
      expect(within(day).getByRole('region', { name: 'Brands mentioned' })).toBeInTheDocument();
      expect(within(day).getByRole('region', { name: 'Cited domains' })).toBeInTheDocument();
    }
    expect(screen.getByRole('combobox', { name: /^Platform: / })).toBeInTheDocument();
  });

  it('says so when the platform has no valid answer in the last 90 days', async () => {
    server.use(
      http.get(mswPath(`${P}/ai/observations`), () =>
        HttpResponse.json({ data: [], meta: { limit: 200, offset: 0, total: 0 } }),
      ),
    );
    renderWithProviders(screenFor(prompt.prompt_id));

    expect(await screen.findByRole('heading', { level: 3, name: /^No valid answer on .* yet$/ })).toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  it('is the not found state for a prompt that does not exist', async () => {
    renderWithProviders(screenFor('00000000-0000-4000-8000-000000000000'));

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'This prompt does not exist or you do not have access to it',
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to the prompts' })).toHaveAttribute(
      'href',
      '/digibranders/fynix/ai/prompts',
    );
  });
  it('shows the platform the address names and falls back to the first one that is on for a stale value', async () => {
    const named = renderWithProviders(screenFor(prompt.prompt_id), { searchParams: '?engine=gemini_web' });
    expect(await screen.findByRole('combobox', { name: 'Platform: Gemini' })).toBeInTheDocument();
    named.unmount();

    renderWithProviders(screenFor(prompt.prompt_id), { searchParams: '?engine=not_a_platform' });
    expect(await screen.findByRole('combobox', { name: 'Platform: ChatGPT' })).toBeInTheDocument();
  });

  it('gives each card its own day', async () => {
    renderWithProviders(screenFor(prompt.prompt_id));
    const days = await screen.findAllByRole('article');
    const headings = days.map((day) => within(day).getByRole('heading', { level: 3 }).textContent);
    expect(new Set(headings).size).toBe(headings.length);
  });

  it('says the answers could not be loaded, and loads them again on Try again', async () => {
    let reads = 0;
    server.use(
      http.get(mswPath(`${P}/ai/observations`), ({ request }) => {
        reads += 1;
        return reads === 1
          ? problem(request, 'internal_error')
          : HttpResponse.json({ data: [], meta: { limit: 200, offset: 0, total: 0 } });
      }),
    );
    const { user } = renderWithProviders(screenFor(prompt.prompt_id));

    expect(await screen.findByText('The answers could not be loaded')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 3, name: /^No valid answer on .* yet$/ })).toBeInTheDocument();
  });

  it('leaves out the day of an answer the API no longer has, without calling it a failure', async () => {
    server.use(http.get(DETAIL, ({ request }) => problem(request, 'not_found')));
    renderWithProviders(screenFor(prompt.prompt_id));

    expect(await screen.findByRole('heading', { level: 3, name: /^No valid answer on .* yet$/ })).toBeInTheDocument();
    expect(screen.queryByText('The answers could not be loaded')).not.toBeInTheDocument();
  });
});
