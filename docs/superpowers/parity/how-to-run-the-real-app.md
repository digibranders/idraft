# How to run the real app and look at it

How to run the real web app (`apps/web`, Next.js) against its in-browser mock API (MSW), sign in, and take screenshots of the AI Prompts page and the AI visibility Overview page at 1440 and 390 px, to compare them with the design preview on http://localhost:4190.

Tested on 2026-11-16 with the worktree `port-w1-oshell` (branch `port/w1-oshell`), Next.js 16.3.7 (Turbopack), Playwright 1.63 with its bundled Chromium.

## The recipe in short

1. Start the app with the mocks on a free port: `cd <worktree>/apps/web && NEXT_PUBLIC_API_MOCKING=all pnpm dev -p 3301`.
2. Do not use the in-app Browser pane and do not use the user's Chrome. Use the Playwright Chromium that is already installed with the project (script below).
3. The script signs in as `priya@digibranders.test` with the fixture password `MOCK_PASSWORD` from `apps/web/src/mocks/fixtures.ts`, then opens the two pages at 1440 and 390 px and saves full page PNGs.
4. Real app URLs: `http://localhost:3301/digibranders/eventus-security/ai` (Overview) and `.../ai/prompts` (Prompts). Preview URLs: `http://localhost:4190/#/ai` (AI visibility Overview) and `http://localhost:4190/#/prompts`.
5. Stop only your own server when done and delete the two files Next writes into `apps/web` (see "Clean up").

## 1. Start the dev server

Pick a free port first. Never kill a process you did not start.

```bash
lsof -nP -iTCP -sTCP:LISTEN | grep -E 'node|next|vite|python'   # see what is taken
cd /Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/<worktree>/apps/web
NEXT_PUBLIC_API_MOCKING=all nohup pnpm dev -p 3301 > /tmp/dev3301.log 2>&1 &   # use the scratchpad for the log
```

Wait for `Ready` in the log. No `.env.local` is needed. Use `localhost`, never `127.0.0.1`: the mock worker and the `__Host-` session cookie need a secure context, and only `localhost` counts as one over plain http.

Each worktree has its own `node_modules`; `port-w1-oshell` already has them. A worktree without them needs `pnpm install` first.

## 2. How the mock sign-in works

- Every fixture user has the password `MOCK_PASSWORD` (`correct-horse-battery`, `apps/web/src/mocks/fixtures.ts`). Do not type any other password.
- Users: `priya@digibranders.test` (editor, no second factor), `tomas@` (admin), `jonas@` (analyst, two projects), `mei@` (viewer), `kwame@` (billing), `ana@` (owner, asks for `MOCK_TOTP_CODE` `246810`). All `@digibranders.test`.
- The browser mock worker (`public/mockServiceWorker.js`, started by `src/providers/mock-gate.tsx`) answers `POST /api/v1/auth/sign-in` and the rest of the API. The server side of the app is answered by MSW in `src/instrumentation.ts`.
- The session is the cookie `__Host-session=mock.active.<user id>.<fresh until>` (`src/mocks/session.ts`). MSW writes it with `document.cookie`. The proxy (`src/proxy.ts`) sends any request without that cookie to `/login`.
- Workspace slug `digibranders`. Projects: `fynix`, `cleanstart`, `eventus-security`, `oyechats`, `firstfold`. Use `eventus-security`: it has the AI prompt fixtures (65 prompts, 29 groups, ChatGPT and Gemini). `fynix` has little AI data.

## 3. What does not work, and why (evidence)

### The in-app Browser pane (`mcp__Claude_Browser__*`): cannot register the worker

The pane is the Claude desktop app's own Chromium (user agent `Claude/5.11492.5 Chrome/156`). Page JavaScript at `http://localhost:3301/login`:

```
isSecureContext: true, 'serviceWorker' in navigator: true, fetch('/mockServiceWorker.js'): 200 application/javascript
navigator.serviceWorker.register('/mockServiceWorker.js')
  -> TypeError: Failed to register a ServiceWorker for scope ('http://localhost:3301/') with script
     ('http://localhost:3301/mockServiceWorker.js'): An unknown error occurred when fetching the script.
console: [error] The API mocks could not start Error: [MSW] Failed to register the Service Worker
```

The script itself is served fine (200, no CSP on it); the host app blocks service worker registration in the pane. A reload does not help. Nothing to fix in the app. The pane is fine for plain pages such as the preview on 4190 and for looking at the login page, but not for the mocked app.

### The user's Chrome (`mcp__claude-in-chrome__*`): the worker runs, but the session never sticks

Chrome 157 registers the worker (`controller` set after a second load, registration scope `http://localhost:3301/`), the sign-in call `POST /api/v1/auth/sign-in` returns 200 `{"status":"signed_in"}`, the form clears, and the page stays on `/login`. Cause: Chrome 157 refuses the `__Host-session` cookie when it is set from script on an http origin, so the proxy never sees it.

```
document.cookie = '__Host-session=x; Path=/; Secure; SameSite=Lax'   -> not stored
document.cookie = 'plain-test=1; Path=/; Secure'                      -> stored (a Secure cookie is fine)
cookieStore.set({name:'__Host-session', ...secure:true})              -> TypeError: Cookie was malformed
```

The other mock cookies (`mock-entities`, `mock-workspace`, `mock-keywords`) are stored; only the `__Host-` prefixed one is refused. This is the "always returns to /login" the builder saw. `apps/web/README.md` says Chrome accepts it; that holds for older Chrome and for Playwright's Chromium, not for Chrome 157 over http. Do not work around it by editing `SESSION_COOKIE`; use the Playwright browser instead.

Two more traps in the Chrome extension: `form_input` values are lost when the form re-renders, and `ref_N` ids go stale after the page hydrates. If a human wants to use Chrome anyway, it needs https with a trusted certificate (`mkcert` is not installed here, and installing a local CA changes the system trust store, so it was not tried).

### Server-level mocking without the worker

Not possible without editing source. The server's MSW (`instrumentation.ts`) only answers requests made by Server Components; the client components call `/api/*` from the browser, and nothing but the worker answers those in the dev server. There is no flag or cookie that bypasses the worker.

## 4. What works: Playwright's Chromium, driven by a script

`@playwright/test` 1.63 and its Chromium (`~/Library/Caches/ms-playwright/chromium-1248`) are already installed for the e2e tests (`apps/web/e2e`, `playwright.config.ts`: `serviceWorkers: 'allow'`, base URL `http://localhost`). It accepts the `__Host-` cookie on `http://localhost`, registers the worker, and signs in exactly like the e2e `signIn` helper (`apps/web/e2e/support.ts`).

Save this as `shoot.mjs` in the scratchpad (not in the repo):

```js
// node shoot.mjs <apps/web dir> <base url> <out dir> [project slug]
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';

const [webDir, base, outDir, project = 'eventus-security'] = process.argv.slice(2);
const require = createRequire(path.join(webDir, 'package.json'));
const { chromium } = require('@playwright/test');
const MOCK_PASSWORD = 'correct-horse-battery'; // apps/web/src/mocks/fixtures.ts

fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 }, serviceWorkers: 'allow', timezoneId: 'UTC', locale: 'en-US',
});
const page = await context.newPage();

await page.goto(`${base}/login`);
await page.getByLabel('Email').fill('priya@digibranders.test');
await page.getByRole('textbox', { name: 'Password', exact: true }).fill(MOCK_PASSWORD);
await page.getByRole('button', { name: 'Sign in' }).click();
await page.waitForURL((u) => !['/login', '/two-factor'].includes(u.pathname), { timeout: 20000 });

const routes = { overview: `/digibranders/${project}/ai`, prompts: `/digibranders/${project}/ai/prompts` };
for (const [name, route] of Object.entries(routes)) {
  for (const [label, vp] of [['1440', { width: 1440, height: 900 }], ['390', { width: 390, height: 844 }]]) {
    await page.setViewportSize(vp);
    await page.goto(`${base}${route}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(outDir, `real-${name}-${label}.png`), fullPage: true });
  }
}
await browser.close();
```

Run it:

```bash
cd /Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/<worktree>/apps/web
node <scratchpad>/shoot.mjs "$PWD" http://localhost:3301 <scratchpad>/shots
```

It writes `real-overview-1440.png`, `real-overview-390.png`, `real-prompts-1440.png` and `real-prompts-390.png`. Open them with the Read tool to look at them. `fullPage: true` gives the whole page; drop it for the first screen only (1440x900 and 390x844). The first request of a route compiles it in the dev server, so the first run takes a while (the script waits for `networkidle`).

To look at a single page by hand instead, add `headless: false` to `chromium.launch` (a visible window the user can watch) and keep the script alive with `await page.pause()`.

### Navigation in the real app

Sign in goes to `/digibranders`. Sidebar, section "AI Visibility": Overview is `/digibranders/<project>/ai`, Prompts is `/digibranders/<project>/ai/prompts`, Citations is `.../ai/citations`, Sources is `.../ai/sources`. A project name in the top left switches project.

## 5. Side by side with the design preview

The preview is a static page on http://localhost:4190 (started by someone else; do not start or stop it). Its hash routes: `#/ai` is the AI visibility Overview, `#/prompts` the Prompts page, `#/overview` is the combined SEO and AI project Overview (not the AI one). The preview shows the `fynix.digital` project; the real app shows Eventus Security, so numbers differ and only layout, controls and states are comparable.

For a pair of screenshots at the same width, reuse the same Playwright setup (the preview needs no sign-in):

```js
const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto('http://localhost:4190/#/prompts'); await p.waitForTimeout(1500);
await p.screenshot({ path: 'preview-prompts-1440.png' });
```

Use `{ width: 390, height: 844 }` for mobile. The in-app Browser pane can open the preview too (`mcp__Claude_Browser__navigate` to `http://localhost:4190/#/prompts`, then `resize_window` with preset `mobile` for 390 or a custom `width: 1440, height: 900`), because the preview needs no worker or cookie. For two panes next to each other, take the two PNGs and Read them one after the other, or paste both into one HTML page with two `<img>` tags.

## 6. Observations from the tested run (branch `port/w1-oshell`, 85e294e1)

- Prompts page: groups table renders at 1440 with 7 top-level groups, 65 prompts, ChatGPT 28% and Gemini 30% in the header strip, "Gemini degraded" badge. At 390 it becomes a list with a search field and a Sort button.
- AI Overview at 1440: two cards show "This card could not be shown" with a Retry button. The browser console says `Error: A card of the competitors family needs an "engine" option` (from `useCardEngine`, thrown by `ShareOfVoiceCard` and `LostToCard`). The cards "Headline numbers", "Mention position" and "Brand sentiment" show "This card is not built yet". These are findings in the app, not problems of the run.
- The Next.js dev overlay shows a small "N" badge and an issue count at the bottom left of the screenshots; it is the dev server, not the app.

## 7. Clean up

`next dev` writes two untracked files into the app folder every time it starts: `apps/web/AGENTS.md` and `apps/web/CLAUDE.md` ("Generated AGENTS.md and CLAUDE.md for AI agents"). Delete them after the run so they are not committed by accident (they are not in `.gitignore`).

```bash
lsof -nP -iTCP:3301 -sTCP:LISTEN         # find the pid of YOUR server only
kill <pid>                               # the pnpm/next pid you started; never another port
rm -f apps/web/AGENTS.md apps/web/CLAUDE.md
git status --short                       # must show nothing from this run
```
