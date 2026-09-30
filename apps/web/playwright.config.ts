import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end and visual tests (26-implementation-guidelines.md section 11, 20-frontend-specification.md
 * section 8.4) against a production build of the app with every API route mocked, so no backend is needed.
 * The build is a test build: `NEXT_PUBLIC_APP_ENV=test`, since mocking is refused in production.
 *
 * The visual baselines are made and checked inside the pinned image `mcr.microsoft.com/playwright:v1.63.0-noble`,
 * which builds and serves the app itself. `E2E_BASE_URL` points the tests at a server that already runs, and
 * it must be a secure context (`localhost`, or https): the mock worker and the `__Host-` session cookie
 * exist only there, so `http://host.docker.internal:3100` would sign no one in.
 */
const PORT = 3100;
/** What a screenshot must not depend on (26 section 11): the machine's time zone and language. */
const VISUAL = { timezoneId: 'UTC', locale: 'en-US', deviceScaleFactor: 1 } as const;
const external = process.env.E2E_BASE_URL;
const baseURL = external ?? `http://localhost:${String(PORT)}`;

export default defineConfig({
  testDir: './e2e',
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}-{projectName}{ext}',
  fullyParallel: false,
  workers: 1,
  forbidOnly: process.env.CI !== undefined,
  retries: process.env.CI === undefined ? 0 : 1,
  reporter: process.env.CI === undefined ? 'list' : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    // The mock layer answers in the browser: nothing leaves the machine
    serviceWorkers: 'allow',
  },
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.002, animations: 'disabled', caret: 'hide' } },
  projects: [
    {
      name: 'e2e',
      testMatch: /flows\/.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'visual-desktop',
      testMatch: /visual\/.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], ...VISUAL, viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'visual-mobile',
      testMatch: /visual\/.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], ...VISUAL, viewport: { width: 390, height: 844 } },
    },
  ],
  ...(external === undefined
    ? {
        webServer: {
          command: `pnpm build && node scripts/prepare-standalone.mjs && PORT=${String(PORT)} node .next/standalone/apps/web/server.js`,
          url: `${baseURL}/login`,
          timeout: 240_000,
          reuseExistingServer: process.env.CI === undefined,
          env: {
            NEXT_PUBLIC_APP_ENV: 'test',
            NEXT_PUBLIC_API_MOCKING: 'all',
            NEXT_PUBLIC_RELEASE: 'e2e',
            // In a container Docker sets HOSTNAME to the container id, and the standalone server listens on it
            HOSTNAME: '127.0.0.1',
            API_INTERNAL_ORIGIN: 'http://127.0.0.1:8000',
          },
        },
      }
    : {}),
});
