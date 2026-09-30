import { expect, test } from '@playwright/test';

import { MOCK_TOKENS } from '../../src/mocks/fixtures';
import { expectAccessible, expectPolicy, signIn, watchPolicy } from '../support';

const EDITOR = 'priya@digibranders.test';
const OWNER = 'ana@digibranders.test';

test.describe('signing in and out', () => {
  test('an editor signs in and lands on the workspace, whose pages carry the policy', async ({ page }) => {
    const policy = watchPolicy(page);
    const login = await page.goto('/login');
    expectPolicy(login);
    await expectAccessible(page);
    await signIn(page, EDITOR);
    await expect(page).toHaveURL(/\/digibranders$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Fynix/ })).toBeVisible();
    await expectAccessible(page);
    expect(policy.violations).toEqual([]);
  });

  test('an account with two-factor on is asked for its code', async ({ page }) => {
    await signIn(page, OWNER, { code: true });
    await expect(page).toHaveURL(/\/digibranders$/);
  });

  test('a wrong password is said in one message, and the form keeps what was typed', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(EDITOR);
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill('not-the-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('The email or password is not correct.')).toBeVisible();
    await expect(page.getByLabel('Email')).toHaveValue(EDITOR);
    await expectAccessible(page);
  });

  test('a reset link sets a new password and says so at sign-in', async ({ page }) => {
    const policy = watchPolicy(page);
    await page.goto('/reset-password');
    await page.getByLabel('Email').fill(EDITOR);
    await page.getByRole('button', { name: 'Send link' }).click();
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
    // The emailed link opens a new page; the same path with a new fragment would not load one
    await page.goto('/login');
    await page.goto(`/reset-password#token=${MOCK_TOKENS.reset}`);
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
    // The token left the address bar as soon as the page read it
    await expect(page).toHaveURL(/\/reset-password$/);
    await page.getByRole('textbox', { name: 'New password', exact: true }).fill('a-long-enough-passphrase');
    await page.getByRole('button', { name: 'Save password' }).click();
    await expect(page.getByText('Your password was changed. Sign in with the new one.')).toBeVisible();
    expect(policy.violations).toEqual([]);
  });

  test('signing out ends at the sign-in page, and the pages behind it ask to sign in again', async ({ page }) => {
    await signIn(page, EDITOR);
    await page.goto('/digibranders/fynix/settings/profile');
    await page.getByRole('button', { name: /^Account menu/ }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto('/digibranders');
    await expect(page).toHaveURL(/\/login\?next=%2Fdigibranders$/);
  });

  test('another tenant’s workspace is the 404 page, like one that does not exist', async ({ page }) => {
    await signIn(page, EDITOR);
    await expect(page).toHaveURL(/\/digibranders$/);
    // The status is not checked here: with mocking on, MockGate renders nothing on the server, so the
    // response starts before the layout decides. A build with mocking off answers 404 (checked against the API).
    await page.goto('/another-agency');
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
  });
});
