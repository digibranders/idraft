import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { test, type Page } from '@playwright/test';

import {
  EDITOR,
  EXISTING_TOPIC,
  NEW_LINES,
  NEW_TOPIC,
  chooseExistingTopic,
  chooseNewTopic,
  fillLines,
  installAddFaults,
  openAddDialog,
  openCheckList,
  openPromptsTab,
  setAddFault,
  startIn,
  topicField,
} from '../support/add-prompts';
import { signIn } from '../support';

/**
 * A visual pass over the Add prompts dialog, not a test: it takes pictures for a person to look at. Off unless
 * `WP27_SHOTS=1`; the pictures go to `WP27_SHOTS_DIR` (outside the repository), never into it.
 */
const DIR = process.env.WP27_SHOTS_DIR ?? path.join(tmpdir(), 'wp27-shots');
const WIDTHS = [390, 768, 1024, 1280] as const;

test.describe('Add prompts, visual pass', () => {
  test.skip(process.env.WP27_SHOTS !== '1', 'Set WP27_SHOTS=1 to take the pictures');

  test.beforeAll(() => {
    mkdirSync(DIR, { recursive: true });
  });

  /** Lets the animations of a popup or a dialog end, so a picture is not taken half faded. */
  const settle = async (page: Page): Promise<void> => {
    await page.waitForTimeout(600);
  };

  const shot = async (page: Page, name: string): Promise<void> => {
    await page.screenshot({ path: path.join(DIR, `${name}.png`) });
  };

  for (const theme of ['light', 'dark'] as const) {
    for (const width of WIDTHS) {
      for (const density of ['default', 'compact'] as const) {
        // The dialog does not change with the density of the table behind it: Compact is taken at the two ends only
        if (density === 'compact' && width !== 390 && width !== 1280) continue;
        test(`the filled dialog at ${String(width)} px, ${theme}, ${density}`, async ({ page }) => {
          await startIn(page, theme);
          await signIn(page, EDITOR);
          await openPromptsTab(page, width, density === 'compact' ? '&density=compact' : '');
          const dialog = await openAddDialog(page);
          await fillLines(dialog, NEW_LINES);
          await chooseExistingTopic(dialog, EXISTING_TOPIC);
          await openCheckList(dialog);
          const name = `${theme}-${String(width)}-${density}`;
          await shot(page, `${name}-top`);
          if (density === 'compact') return;
          // The plan block and the footer sit at the bottom of the body
          await dialog.getByLabel('What this add takes').scrollIntoViewIfNeeded();
          await shot(page, `${name}-bottom`);
        });
      }

      // The states that need the topic list or a failure, at the two ends only
      if (width !== 390 && width !== 1280) continue;

      test(`the topic list with a new name typed at ${String(width)} px, ${theme}`, async ({ page }) => {
        await startIn(page, theme);
        await signIn(page, EDITOR);
        await openPromptsTab(page, width);
        const dialog = await openAddDialog(page);
        await fillLines(dialog, NEW_LINES);
        await topicField(dialog).fill(NEW_TOPIC);
        await page.getByRole('option', { name: `Create topic “${NEW_TOPIC}”` }).waitFor();
        await settle(page);
        await shot(page, `${theme}-${String(width)}-topic-list`);
      });

      test(`the topic list left open after a topic is picked at ${String(width)} px, ${theme}`, async ({ page }) => {
        await startIn(page, theme);
        await signIn(page, EDITOR);
        await openPromptsTab(page, width);
        const dialog = await openAddDialog(page);
        await fillLines(dialog, NEW_LINES);
        await chooseExistingTopic(dialog, EXISTING_TOPIC, { keepOpen: true });
        await settle(page);
        await shot(page, `${theme}-${String(width)}-topic-picked`);
      });

      test(`the failed add after a topic was made at ${String(width)} px, ${theme}`, async ({ page }) => {
        await startIn(page, theme);
        await installAddFaults(page);
        await signIn(page, EDITOR);
        await openPromptsTab(page, width);
        const dialog = await openAddDialog(page);
        await fillLines(dialog, NEW_LINES);
        await chooseNewTopic(dialog, NEW_TOPIC);
        await setAddFault(page, 'create-500');
        await dialog.getByRole('button', { name: 'Add 3 prompts' }).click();
        await dialog.getByRole('alert').waitFor();
        await settle(page);
        await shot(page, `${theme}-${String(width)}-failed-add`);
      });
    }
  }
});
