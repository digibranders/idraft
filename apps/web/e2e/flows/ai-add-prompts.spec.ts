import { expect, test, type Page } from '@playwright/test';

import {
  EDITOR,
  EXISTING_TOPIC,
  FIRST_PROMPT,
  NEW_LINES,
  NEW_TOPIC,
  VIEWER,
  addButton,
  addDialog,
  chooseCountry,
  chooseExistingTopic,
  chooseNewTopic,
  closeTopicList,
  expectTopicListed,
  fillLines,
  fitsAcross,
  installAddFaults,
  openAddDialog,
  openCheckList,
  openPromptsTab,
  promptsGrid,
  setAddFault,
  settleAdd,
  startIn,
  textField,
  toastsOf,
  topicField,
  topicsGrid,
  watchWrites,
} from '../support/add-prompts';
import { expectAccessible, signIn } from '../support';

/** Add prompts (WP-27, prompt-dialogs 4): the entry points, the check, the topic, the add, the failure and Undo. */

/** The rows the add has just made are tinted for a few seconds (`rowTone`). */
const justAdded = (page: Page): ReturnType<Page['locator']> => promptsGrid(page).locator('[data-tone="own"]');

test.describe('Add prompts', () => {
  test('N opens the dialog on the Prompts page for an editor', async ({ page }) => {
    await signIn(page, EDITOR);
    await openPromptsTab(page, 1280);
    await page.keyboard.press('n');
    const dialog = addDialog(page);
    await expect(dialog).toBeVisible();
    await expect(textField(dialog)).toBeFocused();
  });

  test('a viewer has no Add prompts button and N does nothing', async ({ page }) => {
    await signIn(page, VIEWER);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/digibranders/fynix/ai/prompts?tab=prompts');
    // The table is there, so a missing button is the viewer's and not a page still loading
    await expect(promptsGrid(page).getByText(FIRST_PROMPT, { exact: true })).toBeVisible();
    await expect(addButton(page)).toHaveCount(0);
    await page.keyboard.press('n');
    await expect(addDialog(page)).toHaveCount(0);
  });

  test('pasting three lines and choosing a country fills the check list and the plan block', async ({ page }) => {
    await signIn(page, EDITOR);
    await openPromptsTab(page, 1280);
    const dialog = await openAddDialog(page);
    await chooseCountry(dialog, 'Germany');
    await fillLines(dialog, NEW_LINES);

    await expect(dialog.getByText('3 lines: 3 new')).toBeVisible();
    await openCheckList(dialog);
    await expect(dialog.getByRole('heading', { level: 3, name: 'Will be added (3)' })).toBeVisible();
    for (const line of NEW_LINES)
      await expect(
        dialog.getByRole('list', { name: 'Checks of the list' }).getByText(line, { exact: true }),
      ).toBeVisible();

    // The plan block: what the add takes in answers, cost and workspace places, and the button counts the same lines
    const plan = dialog.getByLabel('What this add takes');
    await expect(
      plan.getByText(/^About [\d,]+ answers a month: 3 prompts x \d+ engines? x 2 runs a week\.$/),
    ).toBeVisible();
    const places = /^Workspace prompts: (\d+) of 150 used, (\d+) after this add\.$/;
    await expect(plan.getByText(places)).toBeVisible();
    const [, used, after] = places.exec((await plan.getByText(places).textContent()) ?? '') ?? [];
    expect(Number(after)).toBe(Number(used) + 3);
    await expect(dialog.getByRole('button', { name: 'Add 3 prompts' })).toBeEnabled();
  });

  test('an existing topic is chosen by typing and Enter, and the new prompts appear tinted with a toast and Undo', async ({
    page,
  }) => {
    const writes = watchWrites(page);
    await signIn(page, EDITOR);
    await openPromptsTab(page, 1280);
    const dialog = await openAddDialog(page);
    await fillLines(dialog, NEW_LINES);
    await chooseExistingTopic(dialog, EXISTING_TOPIC);
    // A topic that exists is held as it is: not marked new, and nothing is written for it
    await expect(dialog.getByRole('button', { name: `Remove ${EXISTING_TOPIC} (new)` })).toHaveCount(0);

    await dialog.getByRole('button', { name: 'Add 3 prompts' }).click();
    await expect(dialog).toBeHidden();
    const toast = toastsOf(page);
    await expect(toast.getByText('3 prompts added')).toBeVisible();
    await expect(toast.getByRole('button', { name: 'Undo' })).toBeVisible();

    for (const line of NEW_LINES) await expect(promptsGrid(page).getByText(line, { exact: true })).toBeVisible();
    await expect(justAdded(page)).toHaveCount(3);

    expect(writes.terms).toEqual([]);
    expect(writes.creates).toHaveLength(1);
    const [created] = writes.creates;
    expect(created?.items.map((item) => item.text)).toEqual([...NEW_LINES]);
    // Every line carries the one chosen term
    const termIds = new Set(created?.items.flatMap((item) => item.term_ids));
    expect(termIds.size).toBe(1);
  });

  test('a new topic is made when the form is submitted and not while it is typed, and the prompts are filed under it', async ({
    page,
  }) => {
    const writes = watchWrites(page);
    await signIn(page, EDITOR);
    await openPromptsTab(page, 1280);
    const dialog = await openAddDialog(page);
    await fillLines(dialog, NEW_LINES);
    await chooseNewTopic(dialog, NEW_TOPIC);
    // Typed, chosen and held: no topic has been made, and no prompt added
    expect(writes.terms).toEqual([]);
    expect(writes.creates).toEqual([]);

    await dialog.getByRole('button', { name: 'Add 3 prompts' }).click();
    await settleAdd(page);
    // The topic first, then the prompts under it, each with the term that was made
    expect(writes.order).toEqual(['terms', 'create']);
    expect(writes.madeTermIds).toHaveLength(1);
    const [created] = writes.creates;
    expect(created?.items.map((item) => item.term_ids)).toEqual(NEW_LINES.map(() => writes.madeTermIds));

    // The topic now exists: the picker lists it as a topic to choose, not as one to create
    await expectTopicListed(await openAddDialog(page), NEW_TOPIC);
  });

  test('typing a topic and cancelling makes no topic', async ({ page }) => {
    const writes = watchWrites(page);
    await signIn(page, EDITOR);
    await openPromptsTab(page, 1280);
    const dialog = await openAddDialog(page);
    await fillLines(dialog, NEW_LINES);
    await chooseNewTopic(dialog, NEW_TOPIC);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Discard changes' }).click();
    await expect(dialog).toBeHidden();
    expect(writes.terms).toEqual([]);
    expect(writes.creates).toEqual([]);
    await page.getByRole('radio', { name: 'Topics' }).click();
    await expect(topicsGrid(page).getByText('SEO', { exact: true })).toBeVisible();
    await expect(topicsGrid(page).getByText(NEW_TOPIC, { exact: true })).toHaveCount(0);
  });

  test('a failed add says the topic was created and the prompts were not added, and a retry adds them under it once', async ({
    page,
  }) => {
    const writes = watchWrites(page);
    await installAddFaults(page);
    await signIn(page, EDITOR);
    await openPromptsTab(page, 1280);
    const dialog = await openAddDialog(page);
    await fillLines(dialog, NEW_LINES);
    await chooseNewTopic(dialog, NEW_TOPIC);
    // The topic call goes through; the add after it answers a 500
    await setAddFault(page, 'create-500');
    await dialog.getByRole('button', { name: 'Add 3 prompts' }).click();
    await expect(dialog.getByRole('alert')).toContainText(
      `Topic “${NEW_TOPIC}” was created. The prompts were not added.`,
    );
    expect(writes.terms).toHaveLength(1);
    // The dialog stays open with what was typed, and nothing was added
    await expect(textField(dialog)).toHaveValue(NEW_LINES.join('\n'));
    await expect(toastsOf(page).getByText('3 prompts added')).toHaveCount(0);
    for (const line of NEW_LINES) await expect(promptsGrid(page).getByText(line, { exact: true })).toHaveCount(0);

    // Trying again sends the add; the call that makes the topic is repeated and makes nothing, so there is one topic
    await setAddFault(page, 'none');
    await dialog.getByRole('button', { name: 'Add 3 prompts' }).click();
    await settleAdd(page);
    expect(writes.terms).toHaveLength(2);
    expect(writes.madeTermIds).toHaveLength(1);
    expect(writes.creates.at(-1)?.items.map((item) => item.term_ids)).toEqual(NEW_LINES.map(() => writes.madeTermIds));
    await expectTopicListed(await openAddDialog(page), NEW_TOPIC);
  });

  test('Undo archives exactly the prompts the add created', async ({ page }) => {
    const writes = watchWrites(page);
    await signIn(page, EDITOR);
    await openPromptsTab(page, 1280);
    const rows = promptsGrid(page).getByRole('row');
    await expect(promptsGrid(page).getByText(FIRST_PROMPT, { exact: true })).toBeVisible();
    const before = await rows.count();

    const dialog = await openAddDialog(page);
    await fillLines(dialog, NEW_LINES);
    await dialog.getByRole('button', { name: 'Add 3 prompts' }).click();
    await expect(toastsOf(page).getByText('3 prompts added')).toBeVisible();
    for (const line of NEW_LINES) await expect(promptsGrid(page).getByText(line, { exact: true })).toBeVisible();
    await expect(rows).toHaveCount(before + 3);

    await toastsOf(page).getByRole('button', { name: 'Undo' }).click();
    await expect(toastsOf(page).getByText('3 prompts archived')).toBeVisible();
    for (const line of NEW_LINES) await expect(promptsGrid(page).getByText(line, { exact: true })).toHaveCount(0);
    // The prompts that were there stay, and the request named the three created and no other
    await expect(promptsGrid(page).getByText(FIRST_PROMPT, { exact: true })).toBeVisible();
    await expect(rows).toHaveCount(before);
    expect(writes.archives).toHaveLength(1);
    const [archived] = writes.archives;
    expect(archived?.archive).toBe(true);
    expect(archived?.ids).toHaveLength(3);
  });

  test('a project with no topic vocabulary still adds the prompts, and the picker says it has no topic to offer', async ({
    page,
  }) => {
    // The mock world has no such project (every project sees the workspace's Topics vocabulary), so the list of
    // vocabularies is answered empty, as it is for a workspace that has no topic vocabulary
    const writes = watchWrites(page);
    await installAddFaults(page);
    await signIn(page, EDITOR);
    await openPromptsTab(page, 1280);
    await setAddFault(page, 'no-vocabularies');
    await page.reload();
    await expect(addButton(page)).toBeVisible();
    const dialog = await openAddDialog(page);
    await topicField(dialog).fill(NEW_TOPIC);
    // Nothing to choose, and no row that makes a topic: there is no vocabulary to make it in
    await expect(page.getByText(`No topics match “${NEW_TOPIC}”.`, { exact: false })).toBeVisible();
    await expect(page.getByRole('option')).toHaveCount(0);
    await expectAccessible(page);
    await topicField(dialog).press('Escape');
    await fillLines(dialog, NEW_LINES);
    await dialog.getByRole('button', { name: 'Add 3 prompts' }).click();
    await expect(toastsOf(page).getByText('3 prompts added')).toBeVisible();
    expect(writes.terms).toEqual([]);
    expect(writes.creates.flatMap((entry) => entry.items.flatMap((item) => item.term_ids))).toEqual([]);
  });

  test('Mod+Enter in the field adds once', async ({ page }) => {
    const writes = watchWrites(page);
    await signIn(page, EDITOR);
    await openPromptsTab(page, 1280);
    const dialog = await openAddDialog(page);
    await fillLines(dialog, NEW_LINES);
    await textField(dialog).focus();
    // Twice in a row: the second press finds the add under way or done, and sends nothing
    await page.keyboard.press('ControlOrMeta+Enter');
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(toastsOf(page).getByText('3 prompts added')).toBeVisible();
    await expect(dialog).toBeHidden();
    expect(writes.creates).toHaveLength(1);
    await expect(toastsOf(page).getByText(/prompts added$/)).toHaveCount(1);
  });
});

for (const theme of ['light', 'dark'] as const) {
  test.describe(`Add prompts in the ${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await startIn(page, theme);
    });

    for (const width of [1280, 390]) {
      test(`has no accessibility violation with the dialog open at ${String(width)} px, and no sideways scroll`, async ({
        page,
      }) => {
        await signIn(page, EDITOR);
        await openPromptsTab(page, width);
        const dialog = await openAddDialog(page);
        // Empty, then filled with a topic chosen, the check list open and the plan block showing
        await expectAccessible(page);
        await fillLines(dialog, NEW_LINES);
        // The topic list open over the dialog, then closed
        await chooseExistingTopic(dialog, EXISTING_TOPIC, { keepOpen: true });
        await expectAccessible(page);
        await closeTopicList(dialog);
        await openCheckList(dialog);
        await expectAccessible(page);
        expect(await fitsAcross(dialog)).toBe(true);
        await expect(dialog.getByRole('button', { name: 'Add 3 prompts' })).toBeInViewport();
      });
    }
  });
}
