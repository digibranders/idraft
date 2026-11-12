import { readFile } from 'node:fs/promises';

import { expect, test, type Download, type Locator, type Page } from '@playwright/test';

import { expectAccessible, waitForContent } from '../support';

/**
 * The chart platform of the AI visibility package (WP-04) on its design-system page: every part in both
 * themes at the widths the app supports, and the frame's overflow menu used as a person does, by keyboard.
 * The page is the one place every state and the menu render together.
 */
const THEME_STORAGE_KEY = 'idraft.theme';
const PAGE = '/design-system/charts';
const WIDTHS = [390, 768, 1024, 1280] as const;
const THEMES = ['light', 'dark'] as const;
type Theme = (typeof THEMES)[number];

// The line specimen of the page and what its menu is given (charts-section.tsx)
const TITLE = 'Mention rate by engine';
const FILE_NAME = 'mention-rate';
const LINK = 'https://app.idraft.test/design-system/charts#mention-rate';
const COUNT_TEXT = '4 of 10 answers';
const POLITE_REGION = '#live-region-polite';

/** The last PNG blob the page handed to the browser as a download, kept where the test can read it. */
const BLOB_KEY = '__lastPngBlob';

async function setTheme(page: Page, theme: Theme): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      localStorage.setItem(key, value);
    },
    [THEME_STORAGE_KEY, theme] as const,
  );
}

/** Keeps the last PNG blob given to `URL.createObjectURL`, which is how the page downloads the image. */
async function captureDownloadedPng(page: Page): Promise<void> {
  await page.addInitScript((key) => {
    const original = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (source: Blob | MediaSource): string => {
      if (source instanceof Blob && source.type === 'image/png') Reflect.set(window, key, source);
      return original(source);
    };
  }, BLOB_KEY);
}

const menuTrigger = (page: Page): Locator =>
  page.getByRole('button', { name: `More actions for ${TITLE}`, exact: true });

/** Focuses the menu button and opens the menu with Enter; the focus has moved into the menu when this returns. */
async function openMenuByKeyboard(page: Page): Promise<Locator> {
  const trigger = menuTrigger(page);
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(page.getByRole('menuitem').first()).toBeFocused();
  return trigger;
}

/** Moves down to the item with ArrowDown, as far as it is below the first, and chooses it with Enter. */
async function chooseByKeyboard(page: Page, name: string): Promise<void> {
  const names = await page.getByRole('menuitem').allTextContents();
  const index = names.findIndex((text) => text.trim() === name);
  expect(index, `the menu has "${name}"`).toBeGreaterThanOrEqual(0);
  for (let step = 0; step < index; step += 1) await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name, exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
}

async function downloadByKeyboard(page: Page, name: string): Promise<Download> {
  await openMenuByKeyboard(page);
  const [download] = await Promise.all([page.waitForEvent('download'), chooseByKeyboard(page, name)]);
  return download;
}

async function readDownload(download: Download): Promise<Buffer> {
  const path = await download.path();
  return readFile(path);
}

/** The byte order mark the CSV starts with, so Excel reads it as UTF-8. */
const BOM = String.fromCharCode(0xfeff);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

for (const theme of THEMES) {
  test.describe(`the chart platform page in the ${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await setTheme(page, theme);
    });

    for (const width of WIDTHS) {
      test(`has no accessibility violation and no horizontal scroll at ${String(width)} px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(PAGE);
        await waitForContent(page);
        await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /(^|\s)dark(\s|$)/ : /^(?!.*\bdark\b)/);
        await expectAccessible(page);
        const overflow = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
        }));
        expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth);
      });
    }
  });
}

test.describe('the chart overflow menu', () => {
  test.beforeEach(async ({ page }) => {
    await setTheme(page, 'light');
    await page.goto(PAGE);
    await waitForContent(page);
  });

  test('downloads the CSV with the counts, by keyboard', async ({ page }) => {
    const download = await downloadByKeyboard(page, 'Download CSV');
    expect(download.suggestedFilename()).toBe(`${FILE_NAME}.csv`);
    const text = (await readDownload(download)).toString('utf8');
    const lines = text.startsWith(BOM) ? text.slice(BOM.length).split(/\r?\n/) : text.split(/\r?\n/);
    // The header names the category column and the series; a name with a comma is quoted, so the columns are not counted
    expect(lines[0]).toContain('Week');
    expect(lines[0]).toContain('AI Mode');
    expect(lines.join('\n')).toContain(COUNT_TEXT);
  });

  test('downloads the PNG, by keyboard', async ({ page }) => {
    const download = await downloadByKeyboard(page, 'Download PNG');
    expect(download.suggestedFilename()).toBe(`${FILE_NAME}.png`);
    const image = await readDownload(download);
    expect(image.length).toBeGreaterThan(1024);
    expect(image.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)).toBe(true);
  });

  test('closes with Escape and returns the focus to its button', async ({ page }) => {
    const trigger = await openMenuByKeyboard(page);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('copies the link and says so', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openMenuByKeyboard(page);
    await chooseByKeyboard(page, 'Copy link');
    await expect(page.locator(POLITE_REGION)).toHaveText('Link copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(LINK);
  });
});

test('draws the PNG in the light theme when the page is dark', async ({ page }) => {
  await setTheme(page, 'dark');
  await captureDownloadedPng(page);
  await page.goto(PAGE);
  await waitForContent(page);
  await expect(page.locator('html')).toHaveClass(/(^|\s)dark(\s|$)/);

  // The surface in both themes, in the page's own terms: a 1 px canvas turns any CSS colour into RGB
  const surfaces = await page.evaluate(() => {
    const root = document.documentElement;
    const read = (): number[] => {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext('2d');
      if (context === null) throw new Error('No 2d canvas to read the surface colour with');
      context.fillStyle = getComputedStyle(root).getPropertyValue('--surface').trim();
      context.fillRect(0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data);
    };
    const dark = read();
    root.classList.remove('dark');
    try {
      return { dark, light: read() };
    } finally {
      root.classList.add('dark');
    }
  });
  expect(surfaces.light).not.toEqual(surfaces.dark);

  await downloadByKeyboard(page, 'Download PNG');
  await page.waitForFunction((key) => Reflect.get(window, key) instanceof Blob, BLOB_KEY);
  const corner = await page.evaluate(async (key) => {
    const blob: unknown = Reflect.get(window, key);
    if (!(blob instanceof Blob)) throw new Error('The page did not download a PNG');
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('No 2d canvas to read the image with');
    context.drawImage(bitmap, 0, 0);
    return Array.from(context.getImageData(2, 2, 1, 1).data);
  }, BLOB_KEY);
  expect(corner).toEqual(surfaces.light);
  expect(corner).not.toEqual(surfaces.dark);
});

test('the Table view shows the numbers with their caption', async ({ page }) => {
  await setTheme(page, 'light');
  await page.goto(PAGE);
  await waitForContent(page);
  const views = page.getByRole('group', { name: `${TITLE} view`, exact: true });
  const toggle = views.getByRole('button', { name: 'Table', exact: true });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  const table = page.getByRole('table', { name: TITLE, exact: true });
  await expect(table).toBeVisible();
  await expect(table.locator('caption')).toHaveText(TITLE);
  await expect(table).toContainText(COUNT_TEXT);
});

test('Retry in the error specimen goes busy and comes back', async ({ page }) => {
  await setTheme(page, 'light');
  await page.goto(PAGE);
  await waitForContent(page);
  await expect(page.getByText('Could not load the trend', { exact: true })).toBeVisible();
  const retry = page.getByRole('button', { name: 'Retry', exact: true });
  await expect(retry).not.toHaveAttribute('aria-busy', 'true');
  await retry.click();
  await expect(retry).toHaveAttribute('aria-busy', 'true');
  await expect(retry).not.toHaveAttribute('aria-busy', 'true');
});
