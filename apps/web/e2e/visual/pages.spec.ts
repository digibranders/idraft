import { expect, test, type Page } from '@playwright/test';

import { PREVIEW_SECTION_SLUGS } from '../../src/components/design-system/section-slugs';
import { signIn, waitForContent } from '../support';

/**
 * Visual regression (26-implementation-guidelines.md section 11): each page as a whole, light and dark, at
 * the two widths of the visual projects, with the clock, time zone and locale fixed in the config. The
 * baselines are made in the pinned Playwright image only, so fonts and anti-aliasing match from one machine
 * to the next: `pnpm e2e:visual` inside the image, which builds and serves the app there too.
 */

/** Every date the pages show is relative to this moment, so "Last active" reads the same on each run. */
const NOW = new Date('2026-09-29T12:00:00Z');
const THEMES = ['light', 'dark'] as const;
const THEME_STORAGE_KEY = 'idraft.theme';

const SIGNED_OUT = [
  { name: 'login', path: '/login' },
  { name: 'reset-password', path: '/reset-password' },
] as const;

const EDITOR = 'priya@digibranders.test';
/** An admin manages members: the invitations, the two-factor column and the row actions show. */
const ADMIN = 'tomas@digibranders.test';

interface SignedInPage {
  name: string;
  path: string;
  as?: string;
  /** What a person does on the page before it is the one to compare: open a panel, go to a step. */
  prepare?: (page: Page) => Promise<void>;
}

/** The first keyword of Rankings, opened in the inspector with its volume chart drawn. */
async function openFirstKeyword(page: Page): Promise<void> {
  await page.getByRole('grid', { name: 'Tracked keywords' }).getByRole('rowheader').first().click();
  // Docked beside the table on a wide screen and a sheet on a narrow one, so it is found by its heading
  await expect(page.getByRole('heading', { level: 2, name: 'seo agency' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Search volume by month' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Rank history' })).toBeVisible();
}

/** A file of one new keyword, one that cannot be tracked and one that Fynix tracks already, taken to Review. */
async function reviewImport(page: Page): Promise<void> {
  // The mocks read the file 1.5 s after it is uploaded, by the page's clock, which stands still here: it runs on
  await page.clock.setSystemTime(NOW);
  const dialog = page.getByRole('dialog', { name: 'Import keywords' });
  await dialog.locator('input[type="file"]').setInputFiles({
    name: 'keywords.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('keyword\nimport review one\nsite:fynix.example\nseo audit\n'),
  });
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await expect(dialog.getByText(/^Choose what each column of the file holds/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await expect(dialog.getByRole('group', { name: 'Rows by outcome' })).toBeVisible();
  // The rows of each outcome load after the counts
  await expect(dialog.getByText('Search operators such as site: are not tracked.')).toBeVisible();
}

const SIGNED_IN: readonly SignedInPage[] = [
  { name: 'workspace', path: '/digibranders' },
  { name: 'workspace-settings-profile', path: '/digibranders/settings/profile' },
  { name: 'settings-profile', path: '/digibranders/fynix/settings/profile' },
  { name: 'settings-security', path: '/digibranders/fynix/settings/security' },
  { name: 'settings-preferences', path: '/digibranders/fynix/settings/preferences' },
  { name: 'settings-project-general', path: '/digibranders/fynix/settings/general' },
  { name: 'settings-workspace-general', path: '/digibranders/fynix/settings/workspace' },
  { name: 'settings-members', path: '/digibranders/fynix/settings/members' },
  { name: 'settings-members-admin', path: '/digibranders/fynix/settings/members', as: ADMIN },
  { name: 'new-project', path: '/digibranders/onboarding' },
  { name: 'settings-entities', path: '/digibranders/fynix/settings/entities' },
  { name: 'settings-domains', path: '/digibranders/fynix/settings/domains' },
  { name: 'settings-taxonomy', path: '/digibranders/fynix/settings/taxonomy' },
  { name: 'settings-schedules', path: '/digibranders/fynix/settings/schedules' },
  { name: 'rankings', path: '/digibranders/fynix/seo/rankings' },
  { name: 'rankings-inspector', path: '/digibranders/fynix/seo/rankings', prepare: openFirstKeyword },
  { name: 'rankings-import-review', path: '/digibranders/fynix/seo/rankings/import', prepare: reviewImport },
  // Costs and Runs read the month of the fixed clock, September 2026, which is where the fixture runs are
  { name: 'costs', path: '/digibranders/fynix/costs', as: ADMIN },
  { name: 'runs', path: '/digibranders/fynix/ops/runs', as: ADMIN },
];

/** Waits until nothing on the page will still move: the content is there, the fonts are in, no request is out. */
async function settle(page: Page): Promise<void> {
  await waitForContent(page);
  await page.waitForLoadState('networkidle');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

async function expectPage(page: Page, name: string): Promise<void> {
  await settle(page);
  await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
}

for (const theme of THEMES) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.clock.setFixedTime(NOW);
      await page.addInitScript(
        ([key, value]) => {
          localStorage.setItem(key, value);
        },
        [THEME_STORAGE_KEY, theme] as const,
      );
    });

    for (const slug of PREVIEW_SECTION_SLUGS) {
      test(`design-system ${slug}`, async ({ page }) => {
        await page.goto(`/design-system/${slug}`);
        await expectPage(page, `design-system-${slug}-${theme}`);
      });
    }

    for (const { name, path } of SIGNED_OUT) {
      test(`${name}`, async ({ page }) => {
        await page.goto(path);
        await expectPage(page, `${name}-${theme}`);
      });
    }

    for (const { name, path, as = EDITOR, prepare } of SIGNED_IN) {
      test(`${name}`, async ({ page }) => {
        await signIn(page, as);
        await page.goto(path);
        if (prepare !== undefined) await prepare(page);
        await expectPage(page, `${name}-${theme}`);
      });
    }
  });
}
