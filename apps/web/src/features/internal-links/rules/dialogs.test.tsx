import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mswPath } from '@/mocks/respond';
import { axe } from '@/test/axe';
import { EVENTUS_LINKS, FYNIX_LINKS, internalLinksAs } from '@/test/internal-links-harness';
import { server } from '@/test/msw';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders, type ProvidedRender } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/eventus-security/seo/internal-links',
  useSearchParams: () => new URLSearchParams(),
}));

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const RULES = mswPath(`${P}/tier-rules`);
const IMPORT = mswPath(`${P}/pages/tiers/import`);
const SITE = 'https://eventussecurity.com';

beforeEach(stubWideScreen);
afterEach(() => {
  restoreWideScreen();
  server.events.removeAllListeners();
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

describe('tier rules (spec 5.2)', () => {
  it('lists the rules with live counts and saves a new one, in order, with its tier', async () => {
    const creates = bodiesOf(RULES, 'post');
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    const dialog = await openFromMenu(user, 'Tier rules', 'Tier rules');
    expect(await within(dialog).findAllByText(/^Matches \d+ pages?\. Sets the tier of \d+ pages?\.$/)).toHaveLength(2);
    expect(within(dialog).getByRole('button', { name: 'Save rules' })).toBeDisabled();

    await user.click(within(dialog).getByRole('button', { name: 'Add rule' }));
    const path = within(dialog).getByRole('textbox', { name: 'Rule 3 path' });
    await user.clear(path);
    await user.type(path, '/industries/');
    // The count follows the typing, once the person stops
    expect(await within(dialog).findAllByText(/^Matches \d+ pages?\./)).toHaveLength(3);
    await user.click(within(dialog).getByRole('button', { name: 'Save rules' }));

    expect((await screen.findAllByText('3 rules saved.')).length).toBeGreaterThan(0);
    expect(creates).toEqual([
      { match_type: 'prefix', value: '/industries/', tier_id: expect.any(String), position: 3 },
    ]);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Tier rules' })).toBeNull());
  });

  it('refuses a path the API would refuse where it is typed, and sends nothing', async () => {
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

    await user.clear(path);
    await user.type(path, '/a*');
    await user.click(within(dialog).getByRole('button', { name: 'Save rules' }));
    expect(await within(dialog).findByText(/^A star works only in a pattern rule\. A prefix rule/)).toBeInTheDocument();
    expect(creates).toEqual([]);
    // The path is in the preview only when it is one the API takes: no request for the bad ones
    expect((await within(dialog).findAllByText('Enter a path to see how many pages match.')).length).toBeGreaterThan(0);
  });

  it('stops halfway with the reason, keeps the draft, and sends only what is left on the next save', async () => {
    let fail = true;
    const creates: unknown[] = [];
    server.use(
      http.post(RULES, async ({ request }) => {
        creates.push(await request.clone().json());
        // The first new rule works, the second does not, until the problem is gone
        if (fail && creates.length === 2) {
          return HttpResponse.json(
            { type: 'about:blank', title: 'Too many rules', status: 422, detail: 'At most 500 rules.' },
            { status: 422, headers: { 'content-type': 'application/problem+json' } },
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
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('Rule 4 could not be saved. The rules before it are saved. At most 500 rules.');
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'Rule 4 path' })).toHaveValue('/two/');

    fail = false;
    await user.click(within(dialog).getByRole('button', { name: 'Save rules' }));
    expect((await screen.findAllByText('4 rules saved.')).length).toBeGreaterThan(0);
    // /one/ went out once; the second save sent /two/ again and nothing else
    expect(creates.map((body) => (body as { value: string }).value)).toEqual(['/one/', '/two/', '/two/']);
  });

  it('asks before throwing edits away', async () => {
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    const dialog = await openFromMenu(user, 'Tier rules', 'Tier rules');
    await user.click(within(dialog).getByRole('button', { name: 'Add rule' }));
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('alertdialog', { name: 'Discard unsaved changes?' })).toBeInTheDocument();
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
    expect(dialog.textContent?.toLowerCase()).not.toContain('equity');
  });

  it('has no axe violations', async () => {
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    const dialog = await openFromMenu(user, 'Tier rules', 'Tier rules');
    await within(dialog).findAllByText(/^Matches \d+ pages?\./);
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

    await checkCsv(user, dialog, `url,tier\n${SITE}/about,T3\n${SITE}/pricing,none\n${SITE}/contact,T3`);
    expect(within(dialog).getByRole('heading', { name: '3 rows are ready' })).toBeInTheDocument();
    // Counts per tier: two on T3 and one Untiered
    expect(within(dialog).getByText('2 pages')).toBeInTheDocument();
    expect(within(dialog).getByText('1 page')).toBeInTheDocument();
    expect(within(dialog).getByText(/The server checks it again when you apply/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Apply 3 tiers' })).toBeEnabled();
    expect(dialog.textContent?.toLowerCase()).not.toContain('equity');
  });

  it('refuses a file with no header line and a text that is too big, before any request', async () => {
    const posts = bodiesOf(IMPORT, 'post');
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    const dialog = await openFromMenu(user, 'Import tiers from CSV', 'Import tiers from CSV');
    await checkCsv(user, dialog, `${SITE}/about,T3`);
    expect(within(dialog).getByText('Line 1: the first line must name the columns url and tier.')).toBeInTheDocument();
    await checkCsv(user, dialog, `url,tier\n${'x'.repeat(900_001)}`);
    expect(
      within(dialog).getByText('The text is over 900,000 characters. Split it into two imports.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Apply tiers' })).toBeDisabled();
    expect(posts).toEqual([]);
  });

  it('applies a checked file, says how many pages were tagged and how many wait, and refreshes the pages', async () => {
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
      (await screen.findAllByText('1 page tagged. 1 row waits for a crawl that finds the address.')).length,
    ).toBeGreaterThan(0);
    expect(posts).toEqual([{ csv }]);
    await waitFor(() => expect(pageReads).toBeGreaterThan(before));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Import tiers from CSV' })).toBeNull());
  });

  it('keeps the dialog and the lines when the server refuses a line, and changes nothing', async () => {
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    const dialog = await openFromMenu(user, 'Import tiers from CSV', 'Import tiers from CSV');
    // The page cannot see that this address is another site's: the server says
    await checkCsv(user, dialog, `url,tier\n${SITE}/about,T3\nhttps://other.example/x,T1`);
    await user.click(within(dialog).getByRole('button', { name: 'Apply 2 tiers' }));
    expect(await within(dialog).findByText('The server refused the import and changed nothing.')).toBeInTheDocument();
    expect(within(dialog).getByText(/^Line 3: /)).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'Tiers as CSV' })).toHaveValue(
      `url,tier\n${SITE}/about,T3\nhttps://other.example/x,T1`,
    );
    expect(screen.queryByText('Tiers imported')).toBeNull();
  });

  it('keeps the dialog on a failure, and the same file goes through when sent again', async () => {
    let fail = true;
    server.use(
      http.post(IMPORT, () =>
        fail
          ? HttpResponse.json({ type: 'about:blank', title: 'Server error', status: 500 }, { status: 500 })
          : undefined,
      ),
    );
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    const dialog = await openFromMenu(user, 'Import tiers from CSV', 'Import tiers from CSV');
    await checkCsv(user, dialog, `url,tier\n${SITE}/about,T3`);
    await user.click(within(dialog).getByRole('button', { name: 'Apply 1 tier' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'The import did not finish. Trying again is safe',
    );
    fail = false;
    await user.click(within(dialog).getByRole('button', { name: 'Apply 1 tier' }));
    expect((await screen.findAllByText('1 page tagged.')).length).toBeGreaterThan(0);
  });

  it('is not offered when the project has no write permission', async () => {
    const { user } = renderWithProviders(internalLinksAs('viewer', EVENTUS_LINKS));
    await user.click(await screen.findByRole('button', { name: 'More actions' }));
    expect(screen.queryByRole('menuitem', { name: 'Import tiers from CSV' })).toBeNull();
  });

  it('has no axe violations', async () => {
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
