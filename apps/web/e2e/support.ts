import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, type Response } from '@playwright/test';

import { MOCK_PASSWORD, MOCK_TOTP_CODE } from '../src/mocks/fixtures';

/** The WCAG 2.2 AA rules axe checks on every page (20-accessibility.md). */
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/**
 * Waits until the page has rendered its content. With mocking on, `MockGate` renders nothing until the
 * mock worker has started, which is often after `load`: a check made before would see an empty body.
 * Every page of the app has one `h1`.
 */
export async function waitForContent(page: Page): Promise<void> {
  await page.locator('h1').first().waitFor();
}

/**
 * No accessibility violation on the page, once its content is there. The page's text has no en or em dash
 * either (20-frontend-specification.md section 8.7): copy uses ordinary punctuation.
 */
export async function expectAccessible(page: Page): Promise<void> {
  await waitForContent(page);
  expect(await page.locator('body').innerText()).not.toMatch(/[\u2013\u2014]/);
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(
    violations.map(
      (violation) =>
        `${violation.id}: ${violation.help} (${violation.nodes.map((node) => node.target.join(' ')).join(', ')})`,
    ),
  ).toEqual([]);
}

/**
 * Collects the Content Security Policy violations the browser reports on `page`, as console errors. The
 * test fails when any is reported.
 */
export function watchPolicy(page: Page): { violations: string[] } {
  const seen = { violations: [] as string[] };
  page.on('console', (message) => {
    if (message.type() === 'error' && /Content Security Policy/i.test(message.text()))
      seen.violations.push(message.text());
  });
  return seen;
}

/** Every page response carries the policy with a nonce. */
export function expectPolicy(response: Response | null): void {
  expect(response?.headers()['content-security-policy']).toMatch(
    /script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/,
  );
}

/** Signs in through the page, as a person does; `code` answers the second step when the account has one. */
export async function signIn(page: Page, email: string, { code = false }: { code?: boolean } = {}): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(MOCK_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  if (code) {
    await page.getByRole('heading', { name: 'Enter your code' }).waitFor();
    await page.getByRole('textbox').first().click();
    await page.keyboard.type(MOCK_TOTP_CODE);
    await page.getByRole('button', { name: 'Continue' }).click();
  }
  // Signing in ends with a full page load; the next step starts once it has landed
  await page.waitForURL((url) => !['/login', '/two-factor'].includes(url.pathname));
}
