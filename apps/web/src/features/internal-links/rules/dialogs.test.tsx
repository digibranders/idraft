import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MOCK_WORKSPACE } from '@/mocks/fixtures';
import { EVENTUS } from '@/mocks/internal-links-world';
import { mswPath } from '@/mocks/respond';
import { announce } from '@/lib/a11y/announcer';
import { axe } from '@/test/axe';
import { mockBrowser } from '@/test/mock-api';
import { EVENTUS_LINKS, FYNIX_LINKS, internalLinksAs } from '@/test/internal-links-harness';
import { server } from '@/test/msw';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders, type ProvidedRender } from '@/test/render';

// The real announcer with a spy on it, so a test counts what the dialog says
vi.mock('@/lib/a11y/announcer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/a11y/announcer')>();
  return { ...actual, announce: vi.fn(actual.announce) };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/eventus-security/seo/internal-links',
  useSearchParams: () => new URLSearchParams(),
}));

const W = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}`;
const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const RULES = mswPath(`${P}/tier-rules`);
const RULE = mswPath(`${P}/tier-rules/{rule_id}`);
const IMPORT = mswPath(`${P}/pages/tiers/import`);
const SITE = 'https://eventussecurity.com';
const PROBLEM = { 'content-type': 'application/problem+json' };

beforeEach(stubWideScreen);
afterEach(() => {
  restoreWideScreen();
  server.events.removeAllListeners();
  document.documentElement.classList.remove('dark');
  vi.mocked(announce).mockClear();
});

type User = ProvidedRender['user'];

async function openFromMenu(user: User, item: string, dialogName: string): Promise<HTMLElement> {
  await user.click(await screen.findByRole('button', { name: 'More actions' }));
  await user.click(await screen.findByRole('menuitem', { name: item }));
  return screen.findByRole('dialog', { name: dialogName });
}

/** The JSON body of each write to `path`, with the mock still answering it. */
function bodiesOf(path: string, method: 'post' | 'patch' | 'delete'): unknown[] {
  const seen: unknown[] = [];
  server.use(
    http[method](path, async ({ request }) => {
      seen.push(method === 'delete' ? request.url : await request.clone().json());
      return undefined;
    }),
  );
  return seen;
}

/** The rules the API holds, read as another member would. */
async function savedRules(): Promise<{ rule_id: string; value: string }[]> {
  const answer = await mockBrowser('viewer').call('GET', `${EVENTUS_PATH}/tier-rules`);
  return (answer.body as { data: { rule_id: string; value: string }[] }).data;
}
const EVENTUS_PATH = `${W}/projects/${EVENTUS.project_id}`;

/** Adds rules to the project as a teammate would, through the API. */
async function seedRules(count: number): Promise<void> {
  const editor = mockBrowser('editor');
  const tiers = await editor.call('GET', `${W}/page-tiers`);
  const tierId = (tiers.body as { data: { tier_id: string }[] }).data[0]?.tier_id ?? '';
  for (let index = 0; index < count; index += 1) {
    await editor.call('POST', `${EVENTUS_PATH}/tier-rules`, {
      match_type: 'exact',
      value: `/seed-${String(index)}`,
      tier_id: tierId,
    });
  }
}

describe('tier rules (spec 5.2)', () => {
  it('counts pages only for a rule the person asks about, edits or adds, not for every rule on open', async () => {
    let previews = 0;
    server.events.on('request:start', ({ request }) => {
      if (request.method === 'POST' && request.url.endsWith('/tier-rules/preview')) previews += 1;
    });
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    const dialog = await openFromMenu(user, 'Tier rules', 'Tier rules');
    expect(await within(dialog).findAllByRole('button', { name: /^Count pages for rule/ })).toHaveLength(2);
    expect(previews).toBe(0);

    await user.click(within(dialog).getByRole('button', { name: 'Count pages for rule 1' }));
    expect(
      await within(dialog).findByText(/^Matches \d+ pages?\. Sets the tier of \d+ pages? with the saved rules\.$/),
    ).toBeInTheDocument();
    expect(previews).toBe(1);

    // An added rule counts as it is typed, once
    await user.click(within(dialog).getByRole('button', { name: 'Add rule' }));
    expect(await within(dialog).findAllByText(/^Matches \d+ pages?\./)).toHaveLength(2);
    expect(within(dialog).getAllByRole('button', { name: /^Count pages for rule/ })).toHaveLength(1);
  });

  it('saves a new rule, in order, with its tier', async () => {
    const creates = bodiesOf(RULES, 'post');
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    const dialog = await openFromMenu(user, 'Tier rules', 'Tier rules');
    expect(await within(dialog).findByRole('button', { name: 'Save rules' })).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: 'Add rule' }));
    const path = within(dialog).getByRole('textbox', { name: 'Rule 3 path' });
    await user.clear(path);
    await user.type(path, '/industries/');
    await user.click(within(dialog).getByRole('button', { name: 'Save rules' }));

    expect((await screen.findAllByText('3 rules saved.')).length).toBeGreaterThan(0);
    expect(creates).toEqual([
      { match_type: 'prefix', value: '/industries/', tier_id: expect.any(String), position: 3 },
    ]);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Tier rules' })).toBeNull());
  });

  it('refuses a path the API would refuse where it is typed, focuses it, speaks it, and sends nothing', async () => {
    const creates = bodiesOf(RULES, 'post');
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    const dialog = await openFromMenu(user, 'Tier rules', 'Tier rules');
    await user.click(within(dialog).getByRole('button', { name: 'Add rule' }));
    const path = within(dialog).getByRole('textbox', { name: 'Rule 3 path' });
    await user.clear(path);
    await user.type(path, 'pricing');
    await user.click(within(dialog).getByRole('button', { name: 'Save rules' }));
    expect(await within(dialog).findByText('Start the path with a slash.')).toBeInTheDocument();
    expect(path).toHaveAttribute('aria-invalid', 'true');
    expect(path).toHaveFocus();
    expect(announce).toHaveBeenCalledWith(
      '1 rule has a path to fix',
      expect.objectContaining({ key: 'internal-links-rules' }),
    );

    await user.clear(path);
    await user.type(path, '/a*');
    await user.click(within(dialog).getByRole('button', { name: 'Save rules' }));
    expect(await within(dialog).findByText(/^A star works only in a pattern rule\. A prefix rule/)).toBeInTheDocument();
    expect(creates).toEqual([]);
    expect((await within(dialog).findAllByText('Enter a path to see how many pages match.')).length).toBeGreaterThan(0);
  });

  it('shows the reason the API gives in its field error, not the count in its detail', async () => {
    server.use(
      http.post(RULES, () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Validation failed',
            status: 422,
            code: 'validation_failed',
            detail: '1 field is invalid.',
            errors: [{ location: 'body', path: 'position', code: 'rule_limit', message: 'At most 500 rules.' }],
          },
          { status: 422, headers: PROBLEM },
        ),
      ),
    );
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    const dialog = await openFromMenu(user, 'Tier rules', 'Tier rules');
    await user.click(within(dialog).getByRole('button', { name: 'Add rule' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save rules' }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent(
      'Rule 3 could not be saved. The changes sent before it are saved. At most 500 rules.',
    );
    expect(alert).not.toHaveTextContent('1 field is invalid');
  });

  it('stops halfway with the reason, keeps the draft, and sends only what is left on the next save', async () => {
    let fail = true;
    const creates: unknown[] = [];
    server.use(
      http.post(RULES, async ({ request }) => {
        creates.push(await request.clone().json());
        if (fail && creates.length === 2) {
          return HttpResponse.json(
            { type: 'about:blank', title: 'Server error', status: 500, detail: 'Try later.' },
            { status: 500, headers: PROBLEM },
          );
        }
        return undefined;
      }),
    );
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    const dialog = await openFromMenu(user, 'Tier rules', 'Tier rules');
    for (const [position, value] of [
      [3, '/one/'],
      [4, '/two/'],
    ] as const) {
      await user.click(within(dialog).getByRole('button', { name: 'Add rule' }));
      const path = within(dialog).getByRole('textbox', { name: `Rule ${String(position)} path` });
      await user.clear(path);
      await user.type(path, value);
    }
    await user.click(within(dialog).getByRole('button', { name: 'Save rules' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Rule 4 could not be saved.');
    expect(within(dialog).getByRole('textbox', { name: 'Rule 4 path' })).toHaveValue('/two/');

    fail = false;
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Save rules' })).toBeEnabled());
    await user.click(within(dialog).getByRole('button', { name: 'Save rules' }));
    expect((await screen.findAllByText('4 rules saved.')).length).toBeGreaterThan(0);
    // /one/ went out once; the second save sent /two/ again and nothing else
    expect(creates.map((body) => (body as { value: string }).value)).toEqual(['/one/', '/two/', '/two/']);
  });

  it('converges when the third of seven edits fails: the retry sends the rest and nothing twice', async () => {
    await seedRules(5);
    const patches: { id: string; value: string | undefined; ok: boolean }[] = [];
    let fail = true;
    server.use(
      http.patch(RULE, async ({ request, params }) => {
        const body = (await request.clone().json()) as { value?: string };
        const failing = fail && patches.length === 2;
        patches.push({ id: String(params.rule_id), value: body.value, ok: !failing });
        return failing
          ? HttpResponse.json(
              { type: 'about:blank', title: 'Server error', status: 500 },
              { status: 500, headers: PROBLEM },
            )
          : undefined;
      }),
    );
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    const dialog = await openFromMenu(user, 'Tier rules', 'Tier rules');
    expect(await within(dialog).findByRole('textbox', { name: 'Rule 7 path' })).toBeInTheDocument();
    for (const position of [1, 2, 3, 4]) {
      const path = within(dialog).getByRole('textbox', { name: `Rule ${String(position)} path` });
      await user.clear(path);
      await user.type(path, `/edited-${String(position)}/`);
    }
    await user.click(within(dialog).getByRole('button', { name: 'Save rules' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Rule 3 could not be saved.');
    expect(patches.map((patch) => patch.ok)).toEqual([true, true, false]);

    fail = false;
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Save rules' })).toBeEnabled());
    await user.click(within(dialog).getByRole('button', { name: 'Save rules' }));
    expect((await screen.findAllByText('7 rules saved.')).length).toBeGreaterThan(0);
    // Four edits, four successful patches: the two done before the failure were not sent again
    expect(patches.filter((patch) => patch.ok).map((patch) => patch.value)).toEqual([
      '/edited-1/',
      '/edited-2/',
      '/edited-3/',
      '/edited-4/',
    ]);
    expect(patches.map((patch) => patch.value)).toEqual([
      '/edited-1/',
      '/edited-2/',
      '/edited-3/',
      '/edited-3/',
      '/edited-4/',
    ]);
    expect((await savedRules()).slice(0, 4).map((rule) => rule.value)).toEqual([
      '/edited-1/',
      '/edited-2/',
      '/edited-3/',
      '/edited-4/',
    ]);
  });

  it('moves one rule with one PATCH', async () => {
    await seedRules(3);
    const patches = bodiesOf(RULE, 'patch');
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    const dialog = await openFromMenu(user, 'Tier rules', 'Tier rules');
    await within(dialog).findByRole('textbox', { name: 'Rule 5 path' });
    for (let step = 0; step < 4; step += 1) {
      await user.click(within(dialog).getByRole('button', { name: `Move rule ${String(1 + step)} down` }));
    }
    await user.click(within(dialog).getByRole('button', { name: 'Save rules' }));
    expect((await screen.findAllByText('5 rules saved.')).length).toBeGreaterThan(0);
    expect(patches).toEqual([{ position: 5 }]);
  });

  it('does not save over a teammate: the rules changed meanwhile, so nothing is sent and the draft reloads', async () => {
    const creates = bodiesOf(RULES, 'post');
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    const dialog = await openFromMenu(user, 'Tier rules', 'Tier rules');
    await user.click(await within(dialog).findByRole('button', { name: 'Delete rule 1' }));
    // A teammate adds a rule while this one is being edited
    await seedRules(1);
    expect(creates).toHaveLength(1);
    await user.click(within(dialog).getByRole('button', { name: 'Save rules' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'The rules changed while you were editing. Review them and save again.',
    );
    // Nothing was sent by this dialog, and no rule was removed: the teammate's rule and the first rule stand
    expect(creates).toHaveLength(1);
    const values = (await savedRules()).map((rule) => rule.value);
    expect(values).toEqual(['/services/', '/blog/*', '/seed-0']);
    // The draft is gone: the dialog shows the rules as they are now
    await waitFor(() => expect(within(dialog).getByRole('textbox', { name: 'Rule 3 path' })).toHaveValue('/seed-0'));
    expect(within(dialog).getByRole('button', { name: 'Save rules' })).toBeDisabled();
  });

  it('keeps the draft and says why when a rule cannot be removed, and removes it when sent again', async () => {
    let fail = true;
    server.use(
      http.delete(RULE, () =>
        fail
          ? HttpResponse.json(
              { type: 'about:blank', title: 'Server error', status: 500 },
              { status: 500, headers: PROBLEM },
            )
          : undefined,
      ),
    );
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    const dialog = await openFromMenu(user, 'Tier rules', 'Tier rules');
    await user.click(await within(dialog).findByRole('button', { name: 'Delete rule 1' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save rules' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'A rule could not be removed. Rules after it were not changed.',
    );
    expect(await savedRules()).toHaveLength(2);
    fail = false;
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Save rules' })).toBeEnabled());
    await user.click(within(dialog).getByRole('button', { name: 'Save rules' }));
    expect((await screen.findAllByText('1 rule saved.')).length).toBeGreaterThan(0);
    expect(await savedRules()).toHaveLength(1);
  });

  it('asks before throwing edits away, on Cancel and on Escape, and ignores a press on the scrim', async () => {
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    const dialog = await openFromMenu(user, 'Tier rules', 'Tier rules');
    await user.click(await within(dialog).findByRole('button', { name: 'Add rule' }));
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('alertdialog', { name: 'Discard unsaved changes?' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());

    await user.keyboard('{Escape}');
    expect(await screen.findByRole('alertdialog', { name: 'Discard unsaved changes?' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());

    const scrim = document.querySelector('[data-slot="dialog-scrim"]');
    if (scrim === null) throw new Error('no scrim');
    await user.click(scrim);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Tier rules' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    await user.click(await screen.findByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Tier rules' })).toBeNull());
  });

  it('shows the rules read only to a viewer, with no way to change them or import', async () => {
    const { user } = renderWithProviders(internalLinksAs('viewer', EVENTUS_LINKS));
    await user.click(await screen.findByRole('button', { name: 'More actions' }));
    expect(screen.queryByRole('menuitem', { name: 'Import tiers from CSV' })).toBeNull();
    await user.click(await screen.findByRole('menuitem', { name: 'Tier rules' }));
    const dialog = await screen.findByRole('dialog', { name: 'Tier rules' });
    expect(await within(dialog).findByText('/services/')).toBeInTheDocument();
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(2);
    expect(within(dialog).queryByRole('button', { name: 'Add rule' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Save rules' })).toBeNull();
    expect(within(dialog).queryByRole('textbox')).toBeNull();
    // A viewer may count a rule's pages, one at a time
    await user.click(within(dialog).getByRole('button', { name: 'Count pages for rule 1' }));
    expect(await within(dialog).findByText(/^Matches \d+ pages?\./)).toBeInTheDocument();
    expect(dialog.textContent?.toLowerCase()).not.toContain('equity');
  });

  it.each(['light', 'dark'])('has no axe violations in the %s theme', async (theme) => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    const dialog = await openFromMenu(user, 'Tier rules', 'Tier rules');
    await within(dialog).findAllByRole('button', { name: /^Count pages for rule/ });
    await user.click(within(dialog).getByRole('button', { name: 'Count pages for rule 1' }));
    await within(dialog).findByText(/^Matches \d+ pages?\./);
    expect(await axe(dialog)).toHaveNoViolations();
  });
});

async function checkCsv(user: User, dialog: HTMLElement, csv: string): Promise<void> {
  const field = within(dialog).getByRole('textbox', { name: 'Tiers as CSV' });
  await user.clear(field);
  // `type` treats braces and brackets as keys: a paste puts the text in whole
  await user.click(field);
  await user.paste(csv);
  await user.click(within(dialog).getByRole('button', { name: 'Check' }));
}

describe('the CSV import (spec 5.2)', () => {
  it('names each bad line and offers nothing to apply, then previews a good file by tier', async () => {
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    const dialog = await openFromMenu(user, 'Import tiers from CSV', 'Import tiers from CSV');
    expect(within(dialog).getByRole('button', { name: 'Apply tiers' })).toBeDisabled();

    await checkCsv(user, dialog, `url,tier\n/about,T3\n${SITE}/pricing,T9\n${SITE}/a,\nftp://x.test/b,T1`);
    expect(
      within(dialog).getByText('4 lines need fixing. Nothing is imported until every line is fixed.'),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText('Line 2: use a full address that starts with http:// or https://.'),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText('Line 5: use a full address that starts with http:// or https://.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/^Line 3: “T9” is not a tier of this workspace\.$/)).toBeInTheDocument();
    expect(within(dialog).getByText('Line 4: give a URL and a tier.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Apply tiers' })).toBeDisabled();
    // Spoken once, by the page's announcer, not by a second live alert
    expect(announce).toHaveBeenCalledWith(
      '4 lines need fixing. Nothing is imported until every line is fixed.',
      expect.objectContaining({ key: 'internal-links-import' }),
    );

    await checkCsv(user, dialog, `url,tier\n${SITE}/about,T3\n${SITE}/pricing,none\n${SITE}/contact,T3`);
    expect(within(dialog).getByRole('heading', { name: '3 rows are ready' })).toBeInTheDocument();
    expect(announce).toHaveBeenCalledWith(
      '3 rows are ready',
      expect.objectContaining({ key: 'internal-links-import' }),
    );
    // Counts per tier: two on T3 and one Untiered
    expect(within(dialog).getByText('2 rows')).toBeInTheDocument();
    expect(within(dialog).getByText('1 row')).toBeInTheDocument();
    expect(within(dialog).getByText(/The server checks it again when you apply/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Apply 3 tiers' })).toBeEnabled();
    expect(dialog.textContent?.toLowerCase()).not.toContain('equity');
  });

  it('lists at most 20 lines, turns only those into text, and cuts a long tier name short', async () => {
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    const dialog = await openFromMenu(user, 'Import tiers from CSV', 'Import tiers from CSV');
    const long = 'Z'.repeat(100);
    const lines = Array.from({ length: 25 }, (_, index) => `${SITE}/p${String(index)},${index === 0 ? long : 'T9'}`);
    await checkCsv(user, dialog, ['url,tier', ...lines].join('\n'));
    expect(
      within(dialog).getByText('25 lines need fixing. Nothing is imported until every line is fixed.'),
    ).toBeInTheDocument();
    expect(within(dialog).getAllByText(/^Line \d+: /)).toHaveLength(20);
    expect(within(dialog).getByText('And 5 more lines.')).toBeInTheDocument();
    expect(
      within(dialog).getByText(`Line 2: “${'Z'.repeat(40)}…” is not a tier of this workspace.`),
    ).toBeInTheDocument();
  });

  it('refuses a file with no header line, a blank first line and a text that is too big, before any request', async () => {
    const posts = bodiesOf(IMPORT, 'post');
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    const dialog = await openFromMenu(user, 'Import tiers from CSV', 'Import tiers from CSV');
    await checkCsv(user, dialog, `${SITE}/about,T3`);
    expect(within(dialog).getByText('Line 1: the first line must name the columns url and tier.')).toBeInTheDocument();
    await checkCsv(user, dialog, `\nurl,tier\n${SITE}/about,T3`);
    expect(within(dialog).getByText('Line 1: the first line must name the columns url and tier.')).toBeInTheDocument();
    await checkCsv(user, dialog, `url,tier\n${'x'.repeat(900_001)}`);
    expect(
      within(dialog).getByText('The text is over 900,000 characters. Split it into two imports.'),
    ).toBeInTheDocument();
    // Under the character cap, over the byte cap of the request body
    await checkCsv(user, dialog, `url,tier\n${'😀'.repeat(300_000)}`);
    expect(
      within(dialog).getByText('The text is over 1 MB once it is sent. Split it into two imports.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Apply tiers' })).toBeDisabled();
    expect(posts).toEqual([]);
  });

  it('applies a checked file, says how many rows were applied and how many wait, and refreshes the pages', async () => {
    const posts = bodiesOf(IMPORT, 'post');
    let pageReads = 0;
    server.events.on('request:start', ({ request }) => {
      if (request.method === 'GET' && new URL(request.url).pathname.endsWith('/internal-links/pages')) pageReads += 1;
    });
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    const dialog = await openFromMenu(user, 'Import tiers from CSV', 'Import tiers from CSV');
    const csv = `url,tier\n${SITE}/about,T3\n${SITE}/nowhere-yet,T2`;
    await checkCsv(user, dialog, csv);
    await waitFor(() => expect(pageReads).toBeGreaterThan(0));
    const before = pageReads;
    await user.click(within(dialog).getByRole('button', { name: 'Apply 2 tiers' }));
    expect(
      (await screen.findAllByText('1 row applied. 1 row waits for a crawl that finds the address.')).length,
    ).toBeGreaterThan(0);
    expect(posts).toEqual([{ csv }]);
    await waitFor(() => expect(pageReads).toBeGreaterThan(before));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Import tiers from CSV' })).toBeNull());
  });

  it('keeps the dialog and the lines when the server refuses a line, and changes nothing', async () => {
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    const dialog = await openFromMenu(user, 'Import tiers from CSV', 'Import tiers from CSV');
    // The page cannot see that this address is another site's: the server says
    const csv = `url,tier\n${SITE}/about,T3\nhttps://other.example/x,T1`;
    await checkCsv(user, dialog, csv);
    await user.click(within(dialog).getByRole('button', { name: 'Apply 2 tiers' }));
    expect(await within(dialog).findByText('The server refused the import and changed nothing.')).toBeInTheDocument();
    expect(within(dialog).getByText('Line 3: Not a page of this site.')).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'Tiers as CSV' })).toHaveValue(csv);
    expect(screen.queryByText('Tiers imported')).toBeNull();
  });

  it('shows the reason of a 422 from its field error', async () => {
    server.use(
      http.post(IMPORT, () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Validation failed',
            status: 422,
            code: 'validation_failed',
            detail: '1 field is invalid.',
            errors: [{ location: 'body', path: 'csv', code: 'string_too_long', message: 'Over 900,000 characters.' }],
          },
          { status: 422, headers: PROBLEM },
        ),
      ),
    );
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    const dialog = await openFromMenu(user, 'Import tiers from CSV', 'Import tiers from CSV');
    await checkCsv(user, dialog, `url,tier\n${SITE}/about,T3`);
    await user.click(within(dialog).getByRole('button', { name: 'Apply 1 tier' }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('The server refused the import and changed nothing. Over 900,000 characters.');
    expect(alert).not.toHaveTextContent('1 field is invalid');
  });

  it('says a 413 changed nothing, and does not claim that trying again is safe', async () => {
    server.use(
      http.post(IMPORT, () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Payload too large', status: 413, code: 'payload_too_large' },
          { status: 413, headers: PROBLEM },
        ),
      ),
    );
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    const dialog = await openFromMenu(user, 'Import tiers from CSV', 'Import tiers from CSV');
    await checkCsv(user, dialog, `url,tier\n${SITE}/about,T3`);
    await user.click(within(dialog).getByRole('button', { name: 'Apply 1 tier' }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent(
      'The server refused the text as too large and changed nothing. Split it into two imports.',
    );
    expect(alert).not.toHaveTextContent(/safe/);
  });

  it('on a lost connection says some pages may already have their tiers, and goes through when sent again', async () => {
    let fail = true;
    server.use(http.post(IMPORT, () => (fail ? HttpResponse.error() : undefined)));
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    const dialog = await openFromMenu(user, 'Import tiers from CSV', 'Import tiers from CSV');
    await checkCsv(user, dialog, `url,tier\n${SITE}/about,T3`);
    await user.click(within(dialog).getByRole('button', { name: 'Apply 1 tier' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'The import did not finish, so some pages may already have their new tiers.',
    );
    expect(within(dialog).getByRole('textbox', { name: 'Tiers as CSV' })).toHaveValue(`url,tier\n${SITE}/about,T3`);
    fail = false;
    await user.click(within(dialog).getByRole('button', { name: 'Apply 1 tier' }));
    expect((await screen.findAllByText('1 row applied.')).length).toBeGreaterThan(0);
  });

  it('keeps the dialog on a server error, and the same file goes through when sent again', async () => {
    let fail = true;
    server.use(
      http.post(IMPORT, () =>
        fail
          ? HttpResponse.json(
              { type: 'about:blank', title: 'Server error', status: 500 },
              { status: 500, headers: PROBLEM },
            )
          : undefined,
      ),
    );
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    const dialog = await openFromMenu(user, 'Import tiers from CSV', 'Import tiers from CSV');
    await checkCsv(user, dialog, `url,tier\n${SITE}/about,T3`);
    await user.click(within(dialog).getByRole('button', { name: 'Apply 1 tier' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('The import did not finish');
    fail = false;
    await user.click(within(dialog).getByRole('button', { name: 'Apply 1 tier' }));
    expect((await screen.findAllByText('1 row applied.')).length).toBeGreaterThan(0);
  });

  it('asks before throwing the text away, and ignores a press on the scrim', async () => {
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    const dialog = await openFromMenu(user, 'Import tiers from CSV', 'Import tiers from CSV');
    await user.click(within(dialog).getByRole('textbox', { name: 'Tiers as CSV' }));
    await user.paste('url,tier');
    const scrim = document.querySelector('[data-slot="dialog-scrim"]');
    if (scrim === null) throw new Error('no scrim');
    await user.click(scrim);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await user.keyboard('{Escape}');
    expect(await screen.findByRole('alertdialog', { name: 'Discard the CSV text?' })).toBeInTheDocument();
  });

  it('is not offered when the project has no write permission', async () => {
    const { user } = renderWithProviders(internalLinksAs('viewer', EVENTUS_LINKS));
    await user.click(await screen.findByRole('button', { name: 'More actions' }));
    expect(screen.queryByRole('menuitem', { name: 'Import tiers from CSV' })).toBeNull();
  });

  it.each(['light', 'dark'])('has no axe violations in the %s theme', async (theme) => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    const dialog = await openFromMenu(user, 'Import tiers from CSV', 'Import tiers from CSV');
    await checkCsv(user, dialog, `url,tier\n${SITE}/about,T3\n/bad,T1`);
    expect(await axe(dialog)).toHaveNoViolations();
  });
});

describe('the first crawl panel', () => {
  it('offers the rules and the import to a member who may write, while the first crawl runs', async () => {
    const { user } = renderWithProviders(internalLinksAs('editor', FYNIX_LINKS));
    await user.click(await screen.findByRole('button', { name: 'Crawl now' }));
    await screen.findByRole('heading', { name: 'Mapping fynix.digital' });
    expect(screen.getByRole('button', { name: 'Import tiers from CSV' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Set up tier rules' }));
    expect(await screen.findByRole('dialog', { name: 'Tier rules' })).toBeInTheDocument();
  });
});
