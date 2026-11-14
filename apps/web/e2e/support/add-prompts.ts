import { expect, type Locator, type Page } from '@playwright/test';
import { z } from 'zod';

/**
 * What the Add prompts e2e of WP-27 share (apps/web/e2e/flows/ai-add-prompts.spec.ts and ai-add-prompts-shots.spec.ts):
 * the page and its people, the dialog's locators, a log of the writes the page makes, and the two faults a test
 * can switch on. The helpers live here because `e2e/support.ts` is frozen.
 */

/** An editor holds `prompts:write` and `taxonomy:write`; a viewer reads. */
export const EDITOR = 'priya@digibranders.test';
export const VIEWER = 'mei@digibranders.test';
/** The key the theme is stored under in the browser, so a test can start in either theme. */
export const THEME_KEY = 'idraft.theme';
export const FYNIX_PROMPTS = '/digibranders/fynix/ai/prompts';
/** The first fixture prompt (`src/mocks/prompt-fixtures.ts`), tracked in Fynix. */
export const FIRST_PROMPT = 'Which SEO agency is best for a SaaS startup in Germany?';
/** Three prompts the Fynix mock world does not track. */
export const NEW_LINES = [
  'Which agency audits shop sites in Munich?',
  'How much does a technical SEO audit cost in Germany?',
  'Is link building worth it for a small online shop?',
] as const;
/** A topic of the mock world that has prompts, and one that does not exist. */
export const EXISTING_TOPIC = 'Content Marketing';
export const NEW_TOPIC = 'Brand new topic';

export const addButton = (page: Page): Locator => page.getByRole('button', { name: 'Add prompts', exact: true });
export const addDialog = (page: Page): Locator => page.getByRole('dialog', { name: 'Add prompts' });
export const promptsGrid = (page: Page): Locator => page.getByRole('grid', { name: 'Prompts' });
export const topicsGrid = (page: Page): Locator => page.getByRole('treegrid', { name: 'Topics' });
/** The toasts are also spoken by a live region, so the words are looked for in the toasts themselves. */
export const toastsOf = (page: Page): Locator => page.getByRole('region', { name: 'Notifications' });
export const topicField = (dialog: Locator): Locator => dialog.getByRole('combobox', { name: 'Topics' });
export const textField = (dialog: Locator): Locator => dialog.getByRole('textbox', { name: 'Prompts' });

/** Opens the Prompts tab of Fynix, once the table and the entry that adds are there. */
export async function openPromptsTab(page: Page, width: number, query = ''): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`${FYNIX_PROMPTS}?tab=prompts${query}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Topics & Prompts' })).toBeAttached();
  await expect(addButton(page)).toBeVisible();
}

/** Opens the dialog with its button and waits until it holds the field. */
export async function openAddDialog(page: Page): Promise<Locator> {
  await addButton(page).click();
  const dialog = addDialog(page);
  await expect(textField(dialog)).toBeVisible();
  return dialog;
}

/** Chooses a country in the dialog, as a person does: the control opens a list of the countries the engines ask in. */
export async function chooseCountry(dialog: Locator, name: string): Promise<void> {
  await dialog.getByRole('combobox', { name: 'Country' }).click();
  await dialog.page().getByRole('option', { name, exact: true }).click();
  await expect(dialog.getByRole('combobox', { name: 'Country' })).toContainText(name);
}

/** Pastes the lines into the field and waits until the check has read them: the check list says nothing is wrong. */
export async function fillLines(dialog: Locator, lines: readonly string[]): Promise<void> {
  await textField(dialog).fill(lines.join('\n'));
  await expect(dialog.getByRole('button', { name: /Check the list/ })).toContainText('No problems found');
}

/** Opens the check list when it is closed. */
export async function openCheckList(dialog: Locator): Promise<void> {
  const toggle = dialog.getByRole('button', { name: /Check the list/ });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
}

/**
 * What an add comes to once it has answered: the toast that says the prompts were added, or the result view that lists
 * the lines the API refused (closed here with Done). The mock's prompt handlers know the fixtures' terms only, so they
 * refuse a term made in the same session as `term_unknown`, which the real API does not; a test that files prompts
 * under a new topic settles on either.
 */
export async function settleAdd(page: Page): Promise<'added' | 'refused'> {
  const added = toastsOf(page).getByText(/^\d+ prompts? added$/);
  const result = page.getByRole('dialog', { name: 'Result of the add' });
  await expect(added.or(result)).toBeVisible();
  const refused = await result.isVisible();
  if (refused) await result.getByRole('button', { name: 'Done' }).click();
  // Gone for good, not still fading out (the form is drawn again while the result view fades)
  await expect(page.getByRole('dialog')).toHaveCount(0);
  return refused ? 'refused' : 'added';
}

/** The topic is a row of the picker's list, once, and the picker offers no row to make it. */
export async function expectTopicListed(dialog: Locator, name: string): Promise<void> {
  await topicField(dialog).fill(name);
  await expect(dialog.page().getByRole('option', { name, exact: true })).toHaveCount(1);
  await expect(dialog.page().getByRole('option', { name: /^Create/ })).toHaveCount(0);
}

/** The submit button, found without its role: while the topic list is open the rest of the dialog is hidden from roles. */
export const submitButton = (dialog: Locator): Locator => dialog.locator('button[type="submit"]');

/** The topic list stays open after a row is chosen, so a person can choose more; Escape closes it and not the dialog. */
export async function closeTopicList(dialog: Locator): Promise<void> {
  await topicField(dialog).press('Escape');
  await expect(dialog.page().getByRole('listbox', { name: /^Topics/ })).toHaveCount(0);
  await expect(dialog).toBeVisible();
}

/**
 * Chooses a topic that exists: types its name and presses Enter on the row the list highlights. The list is closed
 * after, unless `keepOpen`, which leaves it as Enter did.
 */
export async function chooseExistingTopic(dialog: Locator, name: string, { keepOpen = false } = {}): Promise<void> {
  await topicField(dialog).fill(name);
  await expect(dialog.page().getByRole('option', { name, exact: true })).toBeVisible();
  await topicField(dialog).press('Enter');
  await expect(dialog.getByRole('button', { name: `Remove ${name}` })).toBeVisible();
  if (!keepOpen) await closeTopicList(dialog);
}

/** Holds a topic that does not exist yet: the typed name is the first row, so Enter takes it. */
export async function chooseNewTopic(dialog: Locator, name: string, { keepOpen = false } = {}): Promise<void> {
  await topicField(dialog).fill(name);
  await expect(dialog.page().getByRole('option', { name: `Create topic “${name}”` })).toBeVisible();
  await topicField(dialog).press('Enter');
  await expect(dialog.getByRole('button', { name: `Remove ${name} (new)` })).toBeVisible();
  if (!keepOpen) await closeTopicList(dialog);
}

const CREATE_BODY = z
  .object({ items: z.array(z.object({ text: z.string(), term_ids: z.array(z.string()) }).loose()) })
  .loose();
const MADE_TERMS = z.object({ data: z.array(z.object({ term_id: z.string() }).loose()) }).loose();
const ARCHIVE_BODY = z.object({ ids: z.array(z.string()), archive: z.boolean() }).loose();

/** The writes the page has made, in the order it made them. */
export interface WriteLog {
  /** `POST .../terms`: a topic made. */
  terms: string[];
  /** The ids of the terms those calls made (a path that existed makes none). */
  madeTermIds: string[];
  /** `POST .../prompts/bulk-create`, with the lines and the terms each carries. */
  creates: z.infer<typeof CREATE_BODY>[];
  /** `POST .../prompts/bulk-archive`: Undo, and a restore. */
  archives: z.infer<typeof ARCHIVE_BODY>[];
  order: ('terms' | 'create' | 'archive')[];
}

/** Records the writes of the page from its network requests. Start it before the page does what is checked. */
export function watchWrites(page: Page): WriteLog {
  const log: WriteLog = { terms: [], madeTermIds: [], creates: [], archives: [], order: [] };
  page.on('response', (response) => {
    if (response.request().method() !== 'POST' || !new URL(response.url()).pathname.endsWith('/terms')) return;
    void response.json().then((body: unknown) => {
      log.madeTermIds.push(...MADE_TERMS.parse(body).data.map((term) => term.term_id));
    });
  });
  page.on('request', (request) => {
    if (request.method() !== 'POST') return;
    const path = new URL(request.url()).pathname;
    const body = request.postData();
    if (path.endsWith('/terms')) {
      log.terms.push(path);
      log.order.push('terms');
    } else if (path.endsWith('/prompts/bulk-create') && body !== null) {
      log.creates.push(CREATE_BODY.parse(JSON.parse(body)));
      log.order.push('create');
    } else if (path.endsWith('/prompts/bulk-archive') && body !== null) {
      log.archives.push(ARCHIVE_BODY.parse(JSON.parse(body)));
      log.order.push('archive');
    }
  });
  return log;
}

const FAULT_KEY = 'e2e-add-fault';

/**
 * A fault a test can switch on: `create-500` answers every `bulk-create` with a 500 problem, `no-vocabularies` answers the
 * list of the vocabularies empty (a project with no topic vocabulary, which the mock world has none of). The mock layer
 * answers inside the page through its service worker, below the network where `page.route` listens, so the page's own
 * `fetch` answers instead. The mode is kept in `sessionStorage`, which a reload keeps; call this before the page loads.
 */
export type AddFault = 'none' | 'create-500' | 'no-vocabularies';

export async function installAddFaults(page: Page): Promise<void> {
  await page.addInitScript((key) => {
    const answer = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = input instanceof Request ? input.url : String(input);
      const method = (input instanceof Request ? input.method : (init?.method ?? 'GET')).toUpperCase();
      const mode = window.sessionStorage.getItem(key);
      if (mode === 'create-500' && method === 'POST' && /\/prompts\/bulk-create(\?|$)/.test(url)) {
        const problem = {
          type: 'about:blank',
          title: 'Server error',
          status: 500,
          code: 'internal_error',
          request_id: 'e2e',
        };
        return new Response(JSON.stringify(problem), {
          status: 500,
          headers: { 'content-type': 'application/problem+json' },
        });
      }
      const real = await answer(input, init);
      if (mode === 'no-vocabularies' && method === 'GET' && /\/vocabularies(\?|$)/.test(url)) {
        const body: unknown = await real.json();
        const emptied = typeof body === 'object' && body !== null ? { ...body, data: [] } : { data: [] };
        return new Response(JSON.stringify(emptied), { status: real.status, headers: real.headers });
      }
      return real;
    };
  }, FAULT_KEY);
}

/** Turns a fault on or off for the page's next reads and writes. */
export async function setAddFault(page: Page, fault: AddFault): Promise<void> {
  await page.evaluate(([key, value]) => window.sessionStorage.setItem(key, value), [FAULT_KEY, fault] as const);
}

/** Starts a test in a theme: the app reads it from `localStorage` before it draws. */
export async function startIn(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      localStorage.setItem(key, value);
    },
    [THEME_KEY, theme] as const,
  );
}

/**
 * Whether nothing in the dialog reaches past its right edge: the dialog itself does not scroll sideways, and no
 * element of it ends beyond the dialog's own edge (a clipped one would hide there).
 */
export async function fitsAcross(dialog: Locator): Promise<boolean> {
  return dialog.evaluate((element) => {
    const edge = element.getBoundingClientRect().right + 1;
    if (element.scrollWidth > element.clientWidth + 1) return false;
    return [...element.querySelectorAll('*')].every((child) => {
      const box = child.getBoundingClientRect();
      return box.width === 0 || box.right <= edge;
    });
  });
}
