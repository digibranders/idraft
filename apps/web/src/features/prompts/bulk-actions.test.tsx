import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { Suspense, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PromptsScreen } from './prompts-screen';
import type { Role } from '@/lib/api/types';
import * as csv from '@/lib/csv/csv-write';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { mswPath } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { server } from '@/test/msw';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders, type ProvidedRender } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/ai/prompts',
}));

// The file is not written: the call is what the test reads
vi.mock('@/lib/csv/csv-write', async (importOriginal) => ({
  ...(await importOriginal<typeof csv>()),
  downloadBlob: vi.fn(),
}));

/** Thursday 12 November 2026, noon UTC: the 02:00 run has answered. */
const NOW = new Date('2026-11-12T12:00:00Z');
const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const PROMPT = mswPath(`${P}/prompts/{prompt_id}`);
const RUN_NOW = mswPath(`${P}/prompts/{prompt_id}/run-now`);

const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The Fynix project fixture is missing');

const FIRST = 'Which SEO agency is best for a SaaS startup in Germany?';
const SECOND = 'How do I run a technical SEO audit on a large site?';

beforeEach(() => {
  vi.setSystemTime(NOW);
  stubWideScreen();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  restoreWideScreen();
  server.events.removeAllListeners();
});

function promptsAs(role: Role): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return (
    <PermissionProvider membership={membershipFactory(role)}>
      <Suspense fallback={null}>
        <PromptsScreen
          workspaceId={MOCK_WORKSPACE.workspace_id}
          workspaceSlug={MOCK_WORKSPACE.slug}
          project={{
            id: fynix?.project_id ?? '',
            slug: 'fynix',
            name: 'Fynix',
            timeZone: 'Europe/Berlin',
            defaultLanguage: 'en',
            defaultCountryIso: 'DE',
          }}
        />
      </Suspense>
    </PermissionProvider>
  );
}

const renderOn = (role: Role, searchParams: string): ProvidedRender =>
  renderWithProviders(promptsAs(role), { searchParams });
const prompts = (): Promise<HTMLElement> => screen.findByRole('grid', { name: 'Prompts' });
const topics = (): Promise<HTMLElement> => screen.findByRole('treegrid', { name: 'Topics' });
const bar = (): HTMLElement => screen.getByRole('group', { name: /^Bulk actions/ });
/** A toast is also written for assistive technology, so its text is found more than once. */
const said = async (text: string | RegExp): Promise<void> => {
  expect(await screen.findAllByText(text)).not.toHaveLength(0);
};

async function tick(user: ProvidedRender['user'], texts: readonly string[]): Promise<void> {
  const table = await prompts();
  for (const text of texts) {
    await user.click(await within(table).findByRole('checkbox', { name: `Select ${text}` }));
  }
}

describe('the bulk bar of the Prompts tab, by permission', () => {
  it('offers a viewer Export CSV and Clear, and no action that changes anything', async () => {
    const { user } = renderOn('viewer', '?tab=prompts');
    await tick(user, [FIRST]);
    expect(within(bar()).getByRole('button', { name: 'Export CSV' })).toBeInTheDocument();
    expect(within(bar()).queryByRole('button', { name: 'Run now' })).toBeNull();
    expect(within(bar()).queryByRole('button', { name: 'Archive' })).toBeNull();
    expect(within(bar()).queryByRole('button', { name: /Add to panel/ })).toBeNull();
  });

  it('offers an analyst Run now, and an editor Archive as well, with Archive after the other actions', async () => {
    const analyst = renderOn('analyst', '?tab=prompts');
    await tick(analyst.user, [FIRST]);
    expect(within(bar()).getByRole('button', { name: 'Run now' })).toBeInTheDocument();
    expect(within(bar()).queryByRole('button', { name: 'Archive' })).toBeNull();
    analyst.unmount();
    const editor = renderOn('editor', '?tab=prompts');
    await tick(editor.user, [FIRST]);
    const names = within(bar())
      .getAllByRole('button')
      .map((button) => button.textContent);
    expect(names.indexOf('Archive')).toBeGreaterThan(names.indexOf('Export CSV'));
  });
});

describe('Export CSV', () => {
  it('writes the chosen prompts as the table shows them, and nothing else', async () => {
    const download = vi.mocked(csv.downloadBlob);
    download.mockClear();
    const { user } = renderOn('viewer', '?tab=prompts');
    await tick(user, [FIRST, SECOND]);
    await user.click(within(bar()).getByRole('button', { name: 'Export CSV' }));
    expect(download).toHaveBeenCalledOnce();
    const [blob, name] = download.mock.calls[0] ?? [];
    expect(name).toBe('prompts-2026-10-16-to-2026-11-12.csv');
    const text = await (blob as Blob).text();
    const lines = text.trim().split('\r\n');
    expect(lines[0]).toContain('Prompt,Topic,Country,Branded,Mention rate,Citation rate');
    expect(lines).toHaveLength(3);
    expect(text).toContain(FIRST);
    expect(text).toContain(SECOND);
    expect(text).not.toContain('What does a local SEO agency do');
    await said('2 prompts exported');
  });
});

describe('Run now for the chosen prompts', () => {
  it('asks first, without the cap for five prompts or fewer, and says how many runs were queued', async () => {
    const asked: string[] = [];
    server.events.on('request:start', ({ request }) => {
      if (request.method === 'POST' && request.url.endsWith('/run-now')) asked.push(request.url);
    });
    const { user } = renderOn('editor', '?tab=prompts');
    await tick(user, [FIRST, SECOND]);
    await user.click(within(bar()).getByRole('button', { name: 'Run now' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Run 2 prompts now?' });
    expect(within(dialog).queryByText(/manual runs a day/)).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Run 2 prompts' }));
    await said('2 runs queued');
    expect(asked).toHaveLength(2);
    // The choice is dropped once the runs are in
    await waitFor(() => expect(screen.queryByRole('group', { name: /^Bulk actions/ })).toBeNull());
  });

  it('names the cap in the confirm above five prompts, and stops at the limit with one summary', async () => {
    const asked: string[] = [];
    server.events.on('request:start', ({ request }) => {
      if (request.method === 'POST' && request.url.endsWith('/run-now')) asked.push(request.url);
    });
    const { user } = renderOn('editor', '?tab=prompts');
    const table = await prompts();
    await user.click(await within(table).findByRole('checkbox', { name: 'Select all 23 prompts loaded' }));
    await user.click(within(bar()).getByRole('button', { name: 'Run now' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Run 23 prompts now?' });
    expect(within(dialog).getByText(/A project can make 20 manual runs a day/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Run 23 prompts' }));
    // Two runs of the test before made two of the 20 of the day: the mock refuses the 19th of this one
    await said(/^Started \d+ of 23 runs$/);
    await said(/The daily limit of 20 manual runs is reached\./);
    // The loop stopped at the first refusal: no request came after it
    expect(asked.length).toBeLessThan(23);
  }, 60_000);

  it('sends nothing for a prompt after a refusal that every prompt would get, and says why in words', async () => {
    let calls = 0;
    server.use(
      http.post(RUN_NOW, () => {
        calls += 1;
        return HttpResponse.json(
          { type: 'x', title: 'provider_paused', status: 503, code: 'provider_paused', retry_after_seconds: 600 },
          { status: 503 },
        );
      }),
    );
    const { user } = renderOn('editor', '?tab=prompts');
    await tick(user, [FIRST, SECOND]);
    await user.click(within(bar()).getByRole('button', { name: 'Run now' }));
    await user.click(await screen.findByRole('button', { name: 'Run 2 prompts' }));
    await said(/Collection from the provider is paused\. Try again in 10 minutes\./);
    expect(calls).toBe(1);
  });
});

describe('Archive for the chosen prompts', () => {
  it('archives each prompt, says so once, and brings them all back with Undo', async () => {
    const sent: string[] = [];
    server.events.on('request:start', ({ request }) => {
      if (request.url.includes('/prompts/') && (request.method === 'DELETE' || request.method === 'PATCH')) {
        sent.push(request.method);
      }
    });
    const { user } = renderOn('editor', '?tab=prompts');
    await tick(user, [FIRST, SECOND]);
    await user.click(within(bar()).getByRole('button', { name: 'Archive' }));
    await said('2 prompts archived');
    expect(sent).toEqual(['DELETE', 'DELETE']);
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: `Select ${FIRST}` })).toBeNull());
    await user.click((await screen.findAllByRole('button', { name: 'Undo' }))[0] as HTMLElement);
    await said('2 prompts restored');
    expect(sent).toEqual(['DELETE', 'DELETE', 'PATCH', 'PATCH']);
    expect(await screen.findByRole('checkbox', { name: `Select ${FIRST}` })).toBeInTheDocument();
  });

  it('says how many were archived when one is refused, and keeps Undo for those that were', async () => {
    let calls = 0;
    server.use(
      http.delete(PROMPT, () => {
        calls += 1;
        return calls === 1
          ? HttpResponse.json({ code: 'boom', title: 'boom', status: 500, type: 'x' }, { status: 500 })
          : new HttpResponse(null, { status: 204 });
      }),
    );
    const { user } = renderOn('editor', '?tab=prompts');
    await tick(user, [FIRST, SECOND]);
    await user.click(within(bar()).getByRole('button', { name: 'Archive' }));
    await said('Archived 1 of 2 prompts');
    await said('1 prompt was not archived. Try again in a moment.');
    expect((await screen.findAllByRole('button', { name: 'Undo' })).length).toBeGreaterThan(0);
  });
});

describe('the bulk bar of the Topics tab', () => {
  it('runs the prompts of a topic through the same confirm, with the cap named above five', async () => {
    const { user } = renderOn('editor', '');
    const tree = await topics();
    await user.click(await within(tree).findByRole('checkbox', { name: 'Select SEO' }));
    expect(within(bar()).getByText('1 topic selected, 12 prompts')).toBeInTheDocument();
    await user.click(within(bar()).getByRole('button', { name: 'Run now' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Run 12 prompts now?' });
    expect(within(dialog).getByText(/manual runs a day/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});
