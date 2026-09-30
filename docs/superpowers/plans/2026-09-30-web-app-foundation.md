# Web App Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `apps/web` from a static preview into the real Next.js application: a booting app with the design-system primitives, a typed API client, sign-in against the real API, the application shell, and account settings.

**Architecture:** Next.js 16 App Router in `apps/web/src/app`, self-hosted as a standalone build. Layouts are Server Components that fetch identity (`GET /api/v1/me`) with the session cookie forwarded; everything interactive is a client feature component that talks to the same-origin API through a client generated from `backend/openapi/v1.json`. Primitives are shadcn components on Base UI, copied into `src/components/ui` and restyled to the tokens that already exist in `src/styles`. Endpoints the backend has not built yet are served by MSW handlers, so a page can be finished before its endpoint exists.

**Tech Stack:** Next.js 16.3, React 19.3, TypeScript 6.0 (strict), Tailwind CSS 4.3, Base UI 1.8 through shadcn (preset `base-nova`), TanStack Query 5, nuqs 2, react-hook-form 7 with zod 4, next-intl, next-themes, openapi-typescript with openapi-fetch, MSW 2, Vitest 5 with Testing Library, Playwright 1.63.

**Sources of truth.** The plan does not repeat what these documents already fix. Read the named section before the task that cites it.

| Document | Decides |
|---|---|
| [`docs/20-frontend-specification.md`](../../20-frontend-specification.md) | Stack (2), routes and layouts (3.2, 3.3), server and client policy (3.4), API client (3.5), errors (3.7), permissions (3.9), security (7), testing (8), build (9) |
| [`docs/design-system/26-implementation-guidelines.md`](../../design-system/26-implementation-guidelines.md) | Directory structure (2), naming (3), shadcn import checklist (4), variants (5), lint rules (9), preview route (10), visual tests (11) |
| [`docs/design-system/25-component-inventory.md`](../../design-system/25-component-inventory.md) | Props, variants, states and accessibility of every component |
| [`docs/design-system/09-buttons-controls.md`](../../design-system/09-buttons-controls.md), [`10-forms.md`](../../design-system/10-forms.md), [`11-navigation.md`](../../design-system/11-navigation.md), [`16-drawers-dialogs-popovers.md`](../../design-system/16-drawers-dialogs-popovers.md), [`18-notifications-alerts.md`](../../design-system/18-notifications-alerts.md) | The visual and behavioral spec of each primitive and of the shell |
| [`AI_DEVELOPMENT_UI_RULES.md`](../../../AI_DEVELOPMENT_UI_RULES.md) | The 20 rules every UI change follows |
| `apps/web/design-preview/` | The visual reference. The shell, the settings sections and every primitive state are already drawn there; port the markup and classes, not the script |
| `backend/openapi/v1.json` | The API contract. Auth routes are on branch `backend/auth` until it merges |

**Notes for the executor**

- Work on branch `frontend/app-foundation` in the main checkout. The backend session works in `.claude/worktrees/`; never edit `backend/`, `infra/` or `.github/` without telling it first (session name: "SEO/AI visibility platform Implementation (fork)").
- Every task ends the same way: run the gates (`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` in `apps/web`, plus `pnpm run preview` while the static preview still exists), dispatch an independent senior review on the Opus model with the task's diff range and the spec sections it must satisfy, fix what it finds, run the gates again, commit. A task is not done while a gate is red.
- Tests first. For a component: write the test (render, states, keyboard, `vitest-axe`), watch it fail, implement, watch it pass.
- No em-dashes or en-dashes in any string, comment, commit message or document. No hex colors, no arbitrary Tailwind values outside `components/ui`, no palette classes. Text uses the 15 `type-*` utilities. Spacing uses the allowed steps.
- No string literals in JSX. Every visible string is a key in `messages/en.json`.
- Invoke the `design-taste-frontend` skill before editing markup or styles; the design-system documents outrank it.
- Commit messages: imperative sentence, no attribution lines.
- The static preview stays in place as the reference until every page it shows is ported. Do not delete it in this plan.

## Scope

In this plan:

| Part | Result |
|---|---|
| A. Foundation (Tasks 1 to 7) | The app builds and boots. Lint, type and test tooling cover JSX. The primitives the shell, the auth screens and the settings forms need exist, each with tests and a section in the `/design-system` route |
| B. API and security (Tasks 8 to 10) | Typed API client, the mock layer, the request proxy with the session check, the Content Security Policy and the static headers |
| C. Auth, shell and account (Tasks 11 to 15) | Sign in (with the code prompt for a user who has two-factor on), password reset, email verification and sign-up by invitation work against the real API. Signed-in users get the shell and can manage their profile, security and preferences |
| D. Delivery (Tasks 16 and 17) | End-to-end tests, accessibility and visual regression in CI, the `web` image, the documents brought up to date |

Deferred by the product owner on 2026-09-30 ("defer 2fa"): two-factor enrolment, that is the setup screen with the QR code, recovery codes, turning it off, and any requirement that a role enrols. The code prompt at sign-in stays, because a user who enrolled through the API cannot sign in without it.

Not in this plan (next plans, in order): porting Overview, Rankings and Topics & Prompts with `DataTable`, charts, `FilterBar` and the inspector; the command palette, date range, location and notification center in the top bar (their controls are absent until then, not disabled); project and workspace settings; onboarding; Sentry.

## Packages

Installed in Task 1. Versions are the ones verified in [`research/09-frontend-stack.md`](../../../research/09-frontend-stack.md) on 2026-09-29; use the latest patch of each line at install time and commit the lockfile.

| Package | Kind | Why |
|---|---|---|
| `next` 16.3, `react` 19.3, `react-dom` 19.3 | runtime | Framework |
| `@base-ui/react` 1.8 | runtime | Primitives (ADR-DS-001) |
| `lucide-react` 1.48.0 (exact, matches `lucide-static`) | runtime | Icons |
| `class-variance-authority`, `clsx`, `tailwind-merge` 3 | runtime | Variants and `cn` |
| `geist` 1.7 | runtime | Fonts through `next/font/local` |
| `next-themes` | runtime | Theme class on `<html>` |
| `@tanstack/react-query` 5 | runtime | Server state |
| `nuqs` 2 | runtime | URL state |
| `next-intl` | runtime | Message catalog |
| `react-hook-form` 7, `@hookform/resolvers` 5, `zod` 4 | runtime | Forms and the env schema |
| `openapi-fetch` | runtime | HTTP client |
| `server-only` | runtime | Makes importing a server module from client code a build error (added in Task 3) |
| `@tailwindcss/postcss` 4.3, `postcss` | dev | Tailwind in the Next build |
| `@types/react`, `@types/react-dom` | dev | Types |
| `shadcn` 4.21 | dev | CLI that fetches a component's source into a scratch folder as a reference. `shadcn/tailwind.css` is not imported (see Task 4) |
| `openapi-typescript` | dev | Generates `schema.d.ts` |
| `msw` 2 | dev | Mock layer for tests and for endpoints not built yet |
| `@vitejs/plugin-react`, `jsdom`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `vitest-axe` | dev | Component tests |
| `@next/eslint-plugin-next`, `eslint-plugin-react`, `eslint-plugin-react-hooks`, `eslint-plugin-jsx-a11y`, `eslint-plugin-better-tailwindcss` 4.7, `eslint-plugin-boundaries`, `eslint-import-resolver-typescript` (boundaries resolves `@/` through it; added in Task 2), `eslint-plugin-i18next`, `globals` | dev | Lint rules of 26 section 9 |
| `prettier`, `prettier-plugin-tailwindcss` 0.8 | dev | Formatting and class order |
| `@playwright/test` 1.63, `@axe-core/playwright` | dev, Task 16 | End-to-end, accessibility, screenshots. Installing the browser downloads about 170 MB and the pinned Docker image about 2 GB: ask the user before Task 16 |

Not installed: `tw-animate-css` (overlays use `data-starting-style` and the motion tokens, 21), `cmdk`, `sonner`, `recharts`, any Radix package.

## File structure

```
apps/web/
  next.config.ts            standalone output, tracing root, headers, dev rewrite to the API
  postcss.config.mjs        @tailwindcss/postcss
  components.json           shadcn: base-nova, aliases to src/components/ui and src/lib/utils
  prettier.config.mjs
  eslint.config.mjs         existing rules plus React, Next, a11y, Tailwind, boundaries, literal strings
  vitest.config.ts          node project for *.test.ts, jsdom project for *.test.tsx
  vitest.setup.ts           jest-dom and vitest-axe matchers, MSW server lifecycle
  messages/en.json          every visible string
  public/mockServiceWorker.js   generated by msw, development only
  src/
    proxy.ts                session presence redirect and the CSP nonce (Task 10)
    instrumentation.ts      starts the MSW server in the Node runtime when mocking is on (Task 9)
    i18n/request.ts         next-intl request config, single `en` locale
    app/
      layout.tsx            html, fonts, providers
      page.tsx              redirect: first workspace, else /login
      not-found.tsx, error.tsx, global-error.tsx
      (auth)/layout.tsx     centered auth layout
      (auth)/login, two-factor, reset-password, verify-email, invite
      (internal)/design-system/[section]/page.tsx
      [workspace]/layout.tsx          /me, permissions, shell frame
      [workspace]/page.tsx            project list
      [workspace]/[project]/layout.tsx, page.tsx
      [workspace]/[project]/settings/layout.tsx, profile, security, preferences
    components/ui/          primitives (Tasks 4 to 6)
    components/app/shell/   Sidebar, TopBar, PageHeader, ProjectSwitcher, ThemeSwitch, HelpMenu, UserMenu, ReauthDialog, SettingsNav
    components/app/status/  EmptyState, InlineError, ErrorPage, Banner
    components/app/forms/   FormField (react-hook-form binding)
    components/design-system/   preview sections, not imported by product code
    features/auth/          forms, mutations, the `next` path guard
    features/account/       profile, security, preferences
    features/projects/      project list and switcher data
    lib/utils.ts            cn
    lib/env.ts              zod schema for the environment, parsed once (under lib so it has a layer)
    lib/api/                schema.d.ts (generated), client.ts, server.ts, problem.ts, query.ts, keys.ts, types.ts, pending.ts
    lib/forms/              applyServerErrors
    lib/permissions/        can, Can, useCan, PermissionProvider
    lib/navigation/         the sidebar registry (groups, routes, icons, live or planned)
    lib/a11y/               announce, useShortcut
    lib/security/           csp.ts (pure builder), next-path.ts
    mocks/                  handlers, factories, browser.ts, node.ts
    providers/              AppProviders (query, nuqs, intl, theme, toasts)
```

---

# Part A. Foundation

### Task 1: Scaffold the Next.js app

**Files:** modify `apps/web/package.json`, `tsconfig.json`, `.gitignore` (root); create `next.config.ts`, `postcss.config.mjs`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/not-found.tsx`.

- [x] **Step 1: Install every package in the table above** except the Task 16 row, with `pnpm add` and `pnpm add -D` in `apps/web`. Pin `lucide-react` to `1.48.0`. Commit the lockfile with the task.

- [x] **Step 2: Scripts.** Replace the `scripts` block of `apps/web/package.json`; `preview` keeps its current value.

```json
"dev": "next dev",
"build": "next build",
"start": "node scripts/prepare-standalone.mjs && node .next/standalone/apps/web/server.js",
"lint": "eslint .",
"typecheck": "next typegen && tsc --noEmit",
"test": "vitest run",
"gen:api": "openapi-typescript ../../backend/openapi/v1.json -o src/lib/api/schema.d.ts"
```

The old `build` compiled `globals.css` into `.tmp/`. Nothing reads that output. Remove `apps/web/.tmp` from the index (`git rm -r --cached apps/web/.tmp`) and add `apps/web/.tmp/` and `apps/web/next-env.d.ts` to the root `.gitignore`. Update the description field: the package is the web application. `scripts/prepare-standalone.mjs` copies `.next/static` and `public` (when it exists) into the standalone tree, because `next build` leaves them out; the Dockerfile of Task 16 does the same two copies. Add `"engines": { "node": ">=20.11" }` (`import.meta.dirname` in the config needs it). The `format` scripts arrive in Task 2 with the Prettier config and ignore file.

- [x] **Step 3: `next.config.ts`.**

```ts
import path from 'node:path';
import type { NextConfig } from 'next';

const REPOSITORY_ROOT = path.join(import.meta.dirname, '../..');

const config: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: REPOSITORY_ROOT,
  turbopack: { root: REPOSITORY_ROOT },
  poweredByHeader: false,
  reactStrictMode: true,
  typedRoutes: true,
};

export default config;
```

- [x] **Step 4: `postcss.config.mjs`.**

```js
const config = { plugins: { '@tailwindcss/postcss': {} } };
export default config;
```

- [x] **Step 5: `tsconfig.json`.** Keep every strict flag. Add `"jsx": "react-jsx"`, `"incremental": true`, `"plugins": [{ "name": "next" }]`, `"allowJs": false`, add `"DOM.Iterable"` to `lib`, and set `include` to `["next-env.d.ts", ".next/types/**/*.ts", ".next/dev/types/**/*.ts", "src/**/*.ts", "src/**/*.tsx", "*.ts", "*.mts"]` with `"exclude": ["node_modules", "design-preview"]`. Next 16 rewrites the file on the first build: it requires `jsx: react-jsx`, `esModuleInterop` and `resolveJsonModule`, and adds the `.next/dev/types` entry. Keep those; set `allowJs` back to `false` (Next only suggests `true`).

- [x] **Step 5a: Tailwind sources.** In `globals.css`, change the import to `@import "tailwindcss" source(none);` and add `@source "../app"; @source "../components"; @source "../features"; @source "../providers";`. Automatic detection would scan all of `apps/web`, putting the preview's classes in the app bundle and the app's in the preview bundle. `design-preview/preview.css` imports `globals.css` and lists its own sources, so the preview is unaffected.

- [x] **Step 6: Root layout.** `src/app/layout.tsx` is a Server Component: `<html lang="en" suppressHydrationWarning>` carrying `GeistSans.variable` and `GeistMono.variable` from `geist/font/sans` and `geist/font/mono` (they define `--font-geist-sans` and `--font-geist-mono`, which `tokens.css` already reads), imports `@/styles/globals.css`, exports `metadata` (title template `%s · Sightline`, default `Sightline`, and `robots: noindex, nofollow` because every page sits behind sign-in; record that decision in 20 in Task 17) and `viewport` (`colorScheme: 'light dark'`). The body renders `children` only; providers arrive in Task 3.

- [x] **Step 7: First pages.** `src/app/page.tsx` renders the product name in an `h1` with `type-page-title` inside `main` (replaced by the redirect in Task 12). `src/app/not-found.tsx` renders a heading and one sentence (replaced by `ErrorPage` in Task 13).

- [x] **Step 8: Verify.** `pnpm build` succeeds and writes `.next/standalone/apps/web/server.js`. `pnpm dev` serves `/` with Geist loaded (the computed `font-family` of `body` starts with the Geist family) and the `background` token as page color in both themes (toggle the `dark` class on `<html>` by hand). `pnpm lint`, `pnpm typecheck`, `pnpm test` (304 tests) and `pnpm run preview` pass.

- [x] **Step 9: Opus review, fixes, gates, commit** "Scaffold the Next.js app in apps/web".

### Task 2: Lint, format and test tooling for JSX

**Files:** modify `eslint.config.mjs`, `vitest.config.ts`; create `prettier.config.mjs`, `.prettierignore`, `vitest.setup.ts`, `src/test/render.tsx`.

- [x] **Step 1: ESLint.** Extend the flat config, keeping every existing rule:
  - `@next/eslint-plugin-next` core-web-vitals rules; `eslint-plugin-react` flat recommended plus `jsx-runtime`, with `react/no-danger: error` and `settings.react.version: '19.3.0'` (never `'detect'`: that path calls `context.getFilename`, which ESLint 10 removed, and crashes the run); `eslint-plugin-react-hooks` recommended; `eslint-plugin-jsx-a11y` strict.
  - `eslint-plugin-better-tailwindcss` with `settings['better-tailwindcss'].entryPoint = 'src/styles/globals.css'`: `no-unknown-classes`, `no-conflicting-classes`, `no-duplicate-classes` as errors; `enforce-consistent-class-order` off (Prettier sorts); `no-restricted-classes` with the four patterns of 26 section 9 (arbitrary values outside `src/components/ui/**`, spacing steps off the scale, raw `z-` numbers).
  - `eslint-plugin-boundaries` with the element types `ui`, `app-component`, `feature`, `route`, `lib`, `design-system`, `mocks` and the import rules of 26 section 2 (rules 1 to 4).
  - `eslint-plugin-i18next` `no-literal-string` in `markupOnly` mode for `src/**/*.tsx`, off in `src/components/design-system/**` and tests.
  - Add `@radix-ui/*`, `cmdk`, `sonner`, `echarts-for-react` and `react-markdown` (outside the future `SafeMarkdown`) to the restricted imports.
  - Ignore `.next/**`, `next-env.d.ts`, `public/mockServiceWorker.js`, `src/lib/api/schema.d.ts`.
- [x] **Step 2: Prove the rules bite.** In a scratch file `src/lint-probe.tsx`, write one violation per rule (a hex color, `bg-blue-500`, `p-[13px]` outside `components/ui`, `gap-7`, `z-50`, a literal string in JSX, `dangerouslySetInnerHTML`, an import of a feature from `components/ui`) and confirm `pnpm lint` reports each one. Delete the file.
- [x] **Step 3: Prettier.** `prettier.config.mjs`: `singleQuote: true`, `printWidth: 120`, `plugins: ['prettier-plugin-tailwindcss']`, `tailwindStylesheet: './src/styles/globals.css'`, `tailwindFunctions: ['cn', 'cva']`. `.prettierignore`: `.next`, `design-preview`, `pnpm-lock.yaml`, `src/lib/api/schema.d.ts`, `public`. Add the scripts `"format": "prettier --write ."` and `"format:check": "prettier --check ."`. Run `pnpm format` and commit the result as its own commit ("Format the web sources with Prettier") so later diffs stay readable.
- [x] **Step 4: Vitest.** Two projects in `vitest.config.ts`: `unit` (`src/**/*.test.ts`, environment `node`, as today) and `dom` (`src/**/*.test.tsx`, environment `jsdom`, `@vitejs/plugin-react`, `setupFiles: ['./vitest.setup.ts']`). `vitest.setup.ts` registers `@testing-library/jest-dom/vitest` and the `vitest-axe` matcher, and calls `cleanup` after each test.
- [x] **Step 5: `src/test/render.tsx`.** `renderWithProviders(ui, options)` wraps in the providers of Task 3 (added there; start with a passthrough) and returns Testing Library's result plus a `user` from `@testing-library/user-event`.
- [x] **Step 6: A first DOM test** (`src/app/not-found.test.tsx`): the not-found page renders one `h1` and has no axe violations.
- [x] **Step 7: Opus review, fixes, gates, commit** "Add JSX lint rules, Prettier and the DOM test project".

Done differently from the steps above, and why:

- The literal-string rule runs in `jsx-only` mode with type information (`projectService`), not `markupOnly`: it then checks every string prop except those typed as a set of literal values, so `variant="primary"` passes and `tooltip="Save"` does not.
- The spacing rule is an allowlist of the twelve steps, not the list of forbidden numbers of 26 section 9 (which let `p-2.5`, `ps-7` and `p-7!` through). 26 section 9 is corrected.
- `boundaries/no-unknown-files` and `no-unknown-dependencies` are on, so the environment schema moved to `src/lib/env.ts`.
- Added: `--max-warnings 0`, a ban on `fetch` and on the API clients in components, the primitive import allowlist, the forms restriction, and `src/test/source-text.test.ts` (dashes in comments).
- `BEFORE_CATALOG` in `eslint.config.mjs` exempts `page.tsx` and `not-found.tsx` from the literal-string rule until Task 3 step 3.

### Task 3: Environment, class helper, messages, providers

**Files:** create `src/lib/env.ts`, `src/lib/utils.ts`, `src/lib/utils.test.ts`, `messages/en.json`, `src/i18n/request.ts`, `src/messages.test.ts`, `src/providers/app-providers.tsx`, `src/lib/a11y/announce.ts`, `src/lib/a11y/announce.test.tsx` (it needs a document, and the file extension picks the jsdom project); modify `next.config.ts`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/not-found.tsx`, `src/test/render.tsx`, `eslint.config.mjs`.

- [x] **Step 1: `src/lib/env.ts`.** One zod schema, parsed at import:

| Variable | Rule |
|---|---|
| `NEXT_PUBLIC_APP_ENV` | `production`, `development` or `test`; default `development` |
| `NEXT_PUBLIC_API_MOCKING` | `off`, `pending` or `all`; default `off`; must be `off` when the app environment is `production` |
| `NEXT_PUBLIC_RELEASE` | string, default `dev` |
| `API_INTERNAL_ORIGIN` | URL origin of the API for server components (`http://api:8000` in Compose, `http://127.0.0.1:8000` locally); server only |
| `API_PROXY_TARGET` | optional URL; development only. When set, `/api/*` is rewritten to it (Task 9) |

The generated paths already start with `/api/v1`, so the server client needs the API's origin, not a base URL ending in `/api/v1`. Record this rename of `API_INTERNAL_BASE_URL` in 20 section 9.2 in Task 17. Tests: a missing server variable throws with the variable's name; mocking on in production throws.

- [x] **Step 2: `cn`.** `src/lib/utils.ts` exports `cn(...inputs)` built with `extendTailwindMerge` so the design system's custom names merge correctly: the 15 `type-*` utilities form one conflict group; the named sizes (`control`, `control-sm`, `control-lg`, `row`, `row-compact`, `row-header`, `topbar`, `sidebar`, `sidebar-collapsed`, `sidebar-item`, `tab`, `metric-strip`, `badge`, `avatar`, `save-bar`, `inspector`, `inspector-wide`, `drawer`, `command`, `icon-xs` to `icon-lg`) are added to the spacing theme. Tests: `cn('type-body', 'type-table')` is `type-table`; `cn('h-control', 'h-control-sm')` is `h-control-sm`; `cn('px-3', 'px-4')` is `px-4`; `cn('text-foreground', 'type-body')` keeps both; falsy inputs are dropped.
- [x] **Step 3: Messages.** `messages/en.json` starts with the namespaces `common` (Cancel, Save, Close, Retry, Loading) and `errors` (not found, generic). `src/i18n/request.ts` returns locale `en` and the catalog. Wrap the Next config with `createNextIntlPlugin('./src/i18n/request.ts')`. `src/messages.test.ts` walks every string in the catalog and fails on U+2013, U+2014, a trailing exclamation mark, or an empty value. Move the text of `page.tsx` and `not-found.tsx` into the catalog, including the `metadata` titles and the product name (lint cannot see strings outside JSX, so read them with `getTranslations` in `generateMetadata`), then empty `BEFORE_CATALOG` in `eslint.config.mjs` and delete the constant.
- [x] **Step 4: Providers.** `AppProviders` (client component) composes, outside in: `NextIntlClientProvider` (messages passed from the root layout), `ThemeProvider` from `next-themes` (`attribute="class"`, `defaultTheme="system"`, `enableSystem`, `disableTransitionOnChange`), `QueryClientProvider` (one client per browser, `staleTime` 30 s by default, `retry` only for network errors and 5xx, never for an `ApiProblem` below 500), `NuqsAdapter`, and the Base UI `Toast.Provider` (its viewport arrives with the toast primitive in Task 6). The root layout renders `<AppProviders>` around `children`.
- [x] **Step 5: `announce`.** `announce(message, politeness)` writes to one of two visually hidden live regions that `AppProviders` mounts once. Test: two calls with the same text are both announced (the region is cleared between them).
- [x] **Step 6: Opus review, fixes, gates, commit** "Add the environment schema, cn, the message catalog and the providers".

Done differently from the steps above, and why:

- The environment is three files under `src/lib/env/`: `public.ts` (no dependency, safe in a client bundle), `schema.ts` (zod, used by `next.config.ts` and the server) and `server.ts` (`server-only`). One file would have put zod, about 90 KB gzip, into every client bundle that reads the mocking mode. `next.config.ts` inlines the validated public values through `env`, defaults included, so server and browser always agree. `src/instrumentation.node.ts` ends the process when a server value is missing, since Next.js would otherwise keep answering 500 on an open port.
- `NextIntlClientProvider` sits in the root layout (a Server Component), not inside `AppProviders`, because that is how it receives the messages without a prop.
- The announcer follows 20-accessibility section 10.1 exactly: `announce(message, { politeness, key, debounceMs })` in `src/lib/a11y/announcer.ts`, one message per region, cleared after one second.
- The class name lists live in `src/lib/design/class-names.ts`, with their own test against `globals.css`; `utils.ts` exports `cn` only, so that is all a primitive can reach.
- Added: `src/lib/api/retry.ts` and `query-client.ts` (no retry on the server and in tests), `.env.example`, the `server-only` package, a lint rule against named sizes used as padding or gap.
- The theme is stored by next-themes in `localStorage` under `sightline.theme`; 01 section 3 said a cookie and is corrected.

Carried to later tasks: the toast duration of 6 seconds (20-accessibility section 10.5) in Task 6; `private, no-store` on authenticated HTML in Task 10; the image build must pass `NEXT_PUBLIC_APP_ENV=production` as a build argument, because a build without it is a development build (Task 16); the whole catalog is sent to the browser, which is fine at this size and should become per-route namespaces when it grows; 20 section 7.4 should say the theme key is per device, not per user (Task 17); the app has no icon yet, so `/favicon.ico` is a 404 until the shell task adds one.

### Task 4: Primitives, batch 1: static and display

Every primitive in Tasks 4 to 6 follows the same steps. They are written once here.

1. Read its section in 25 (props, variants, states, accessibility) and the section of the owning document. Find the same element in `design-preview/index.html` for the exact classes.
2. Write the test file: every variant and size renders the documented classes; every state (disabled, loading, invalid, open) is reachable; keyboard behavior matches the APG pattern named in 25; `expect(await axe(container)).toHaveNoViolations()`.
3. Where shadcn has the component, fetch its source into a scratch folder as a reference for the Base UI wiring (`pnpm exec shadcn add <name> --path <scratch>`; never into `src/components/ui`, where it would overwrite a finished primitive), then write the primitive by the eight-step import checklist of 26 section 4: `type-*` utilities, documented radius, token colors, size utilities, no arbitrary values where a token exists, the global focus ring, Base UI data attributes. Where shadcn has no equivalent, build on the Base UI primitive directly.
4. No `forwardRef` (React 19), `data-slot` on the root, `render` prop for composition. Every primitive takes the attributes of its root element and passes them on with `ref`, so callers can pass `aria-*` and `data-*` and so `Tooltip` and Base UI's `render` can compose with it. `className` is merged last through `cn`. `'use client'` only when the primitive has a hook or a handler of its own.
5. Add the component to its `/design-system` section file under `src/components/design-system/` with every variant and state (the route itself is Task 7).

**Create `components.json` first** (style `base-nova`, `rsc: true`, `tsx: true`, `tailwind.css: "src/styles/globals.css"`, `tailwind.cssVariables: true`, aliases `components: "@/components"`, `ui: "@/components/ui"`, `utils: "@/lib/utils"`, `iconLibrary: "lucide"`). Do not run `shadcn init`: it would overwrite `globals.css`. `shadcn/tailwind.css` is not imported: it defines `data-selected` and its siblings as `[data-selected="true"]`, while Base UI writes the bare attribute, which Tailwind's own `data-*` variants already match.

| Component | File | Spec | Notes |
|---|---|---|---|
| `Icon` | `ui/icon.tsx` | 07, 25 | Wraps a Lucide component; sizes `xs` 12, `sm` 14, `default` 16, `md` 18, `lg` 20 through `size-icon-*`; stroke 1.75 (1.5 at `xs` and `lg`), non-scaling; `aria-hidden` unless `label` is given |
| `Button`, `LinkButton` | `ui/button.tsx`, `ui/button-variants.ts`, `ui/link-button.tsx` | 09 section 2 | Copy `buttonVariants` from 09 section 2.9 exactly: 7 variants, sizes `sm`, `md`, `lg`, `icon-xs`, `icon-sm`, `icon`. `loading` shows `Spinner`, keeps the width and sets `aria-busy`; a disabled button with a reason uses `aria-disabled` so the tooltip stays reachable |
| `IconButton` | `ui/icon-button.tsx` | 09 section 3 | Requires `label`; renders the tooltip with it |
| `Spinner` | `ui/spinner.tsx` | 21 section 8.2 | Static under reduced motion |
| `Kbd` | `ui/kbd.tsx` | 09 section 11 | `type-kbd` |
| `Separator` | `ui/separator.tsx` | 06 section 5 | |
| `Skeleton` | `ui/skeleton.tsx` | 17 section 3.1 | Pulses, never shimmers; static under reduced motion |
| `Avatar` | `ui/avatar.tsx` | 11 section 4 | Photo or initials on `neutral-subtle`; `size-avatar` |
| `Badge` | `ui/badge.tsx` | 14 section 1 | Tones and the outline look from the preview's neutral badge |
| `TextLink` | `ui/text-link.tsx` | 20 section 19 | `next/link` for internal targets |
| `Truncate` | `ui/truncate.tsx` | 20 section 13.4 | Tooltip with the full text only when truncated |
| `Tooltip` | `ui/tooltip.tsx` | 16 section 6.1 | Pulled forward from Task 6: `IconButton` and `Truncate` need it |
| `ScrollArea` | `ui/scroll-area.tsx` | 16 section 5.1 | |

- [x] Steps 1 to 5 for each row, in table order (`Icon`, `Spinner` and `Tooltip`'s trigger contract come first because `Button` and `IconButton` use them; stub nothing: build `Tooltip` from Task 6 early if `IconButton` needs it).
- [x] Opus review, fixes, gates, commit "Add the display primitives".

Done differently from the steps above, and why:

- `Tooltip` is built here, not in Task 6. Its description is a `hidden` element beside the trigger that `aria-describedby` points at, so the popup mounts only while open and nothing is read twice; `purpose="label"` is for text that repeats the accessible name (25 section 23 row 73).
- `LinkButton` exists because Base UI gives whatever `Button` renders the button role. It and `buttonVariants` live in modules without `'use client'`, so a Server Component can use them and pass an icon.
- `TextLink` has `variant`: `inline` is underlined at rest, because the link color is below 3:1 against body text in both themes (25 section 23 row 78).
- `Truncate` measures when the pointer arrives instead of observing every cell.
- The neutral badge always has its border; there is no `bordered` prop (25 section 23 row 75).
- The stylesheet of the app is `src/styles/app.css`, which imports `globals.css` and names the source folders. `globals.css` names none, so the static preview and the app never carry each other's classes. `src/features/` exists already, because a source folder must exist when the dev server starts.
- A minimal `/design-system` route (three sections: buttons, badges, display) exists already, to check the primitives in a browser. Task 7 completes it.
- The test render helper sets the tooltip delay to 0, and axe runs without `color-contrast` and `region`, which jsdom cannot judge (the Playwright run of Task 16 keeps both on).
- Lint: the literal-string rule exempts `src/app/(internal)/**`, and `jsx-a11y/anchor-has-content` is off in tests, where an empty anchor is handed to `render`.

Carried to later tasks: the section list, `aria-current` in the section nav and the production 404 test of `/design-system` (Task 7); a truncated value in a table cell needs its tooltip on keyboard focus, owned by the `DataTable` cell (the tables plan; 25 section 23 row 76); skeletons mounted at different times pulse out of phase (Task 13, with the loading states of the shell; row 82); the Playwright run must keep the axe `region` and `color-contrast` rules on (Task 16).

### Task 5: Primitives, batch 2: forms

| Component | File | Spec | Notes |
|---|---|---|---|
| `Field`, `FieldLabel`, `FieldHelp`, `FieldError` | `ui/field.tsx` | 10 sections 2 and 18 | Label above, error replaces helper text, `aria-describedby` wiring, optional marker |
| `Input` | `ui/input.tsx` | 10 section 4 | Sizes `sm`, `md`, `lg` (`lg` only in auth and onboarding) |
| `InputGroup` | `ui/input-group.tsx` | 10 section 4 | Leading and trailing addons |
| `PasswordInput` | `ui/password-input.tsx` | 10 section 21, 20 section 11 | Show and hide button named by state; allows paste; `autocomplete` passed by the caller |
| `OtpField` | `ui/otp-field.tsx` | 10 section 21, 20 section 11.5 | Base UI OTP Field, 6 digits, `autocomplete="one-time-code"`, `inputMode="numeric"`, paste fills all cells |
| `Checkbox` | `ui/checkbox.tsx` | 10 section 7 | |
| `Switch` | `ui/switch.tsx` | 10 section 8 | |
| `Select` | `ui/select.tsx` | 10 section 6.2 | |
| `SegmentedControl` | `ui/segmented-control.tsx` on `ui/radio-group.tsx` | 09 section 6 | |
| `ReadOnlyField` | `ui/read-only-field.tsx` | 10 section 20 | |
| `FormAlert`, `ErrorSummary` | `ui/form-alert.tsx`, `ui/error-summary.tsx` | 10 sections 19 and 24 | `ErrorSummary` takes focus on a failed submit and links to each field |
| `SettingRow` | `ui/setting-row.tsx` | 10 section 13.3 | |
| `SaveBar` | `ui/save-bar.tsx` | 10 section 13.2 | `h-save-bar`; count of changed fields passed as a display string |
| `FormField` | `app/forms/form-field.tsx` | 10 section 22 | Binds a `Field` to react-hook-form's `Controller`; the only place outside features that imports react-hook-form |
| `applyServerErrors` | `lib/forms/apply-server-errors.ts` | 10 section 23 | Maps `ApiProblem.errors[]` (`location`, `path`, `code`, `message`) onto form fields; returns the items that matched no field so the form can show them in `FormAlert` |

- [x] Steps 1 to 5 for each row. `applyServerErrors` tests: a body path `email` sets the `email` field error; a nested path `profile.name` sets `profile.name`; an item for an unknown path is returned, not dropped; `location` other than `body` is returned.
- [x] Opus review, fixes, gates, commit "Add the form primitives".

Done differently from the steps above, and why:

- `PasswordInput` has its own file, `ui/password-input.tsx`. `SecretInput` (provider tokens, never pre-filled, with verification) stays a later component; a password of the user's own account needs password managers and `autocomplete`, which a secret field must refuse.
- `RadioGroup` (list and cards) is built with `SegmentedControl`, in `ui/radio-group.tsx`, because both are Base UI radio groups and account settings needs one of them.
- The field parts are `Field`, `FieldLabel`, `FieldDescription`, `FieldError` and `Fieldset` (the names of 25 section 4.1; the table's `FieldHelp` is `FieldDescription`). `FieldLabel.optional` is the marker text, because a primitive cannot read the catalog. `common.optional` is the first form string in `messages/en.json`.
- `Input` has a `bare` variant for use inside `InputGroup`, and `inputVariants` lives in `ui/input-variants.ts` so the `Select` trigger shares it.
- `SaveBar` has no `onSave`: "Save changes" is the submit button of the form, so Enter in a field saves too.
- `FormField` shows an error once the user has changed the field since the last reset, or the form was submitted. `isDirty` alone misses a field that was typed into and emptied again.
- `applyServerErrors(form, items, { fields, messages })` takes the list of field names the form renders, because react-hook-form has no public way to ask which fields are mounted. It declares `ValidationItem` locally; Task 8 replaces that with the generated type and adds the handling by problem `code` (10 section 23, step 2).
- Lint: `src/components/design-system/**` may import react-hook-form, so the preview can show a live form. It still may not fetch.
- A `forms` section is added to the `/design-system` route.

Carried to later tasks: `disabledReason` on the selection controls, added together by the first screen that needs it (25 section 23 row 83); `ReadOnlyField.copyValue` with `CopyButton` (row 89); the 16 px input font on phones needs the `type-input-touch` utility that 19-responsive-behavior asks for (its touch targets section) before the auth screens (Task 11); `Select` as a bottom sheet on phones (mobile layout); a settings form reserves the bar's height with `pb-save-bar`, which the named-size lint rule refuses today, so the first settings form (Task 14) adds the exception or a utility; `Textarea`, `Combobox`, `CheckboxGroup`, `NumberInput` and the date pickers belong to the plans of the screens that use them.

### Task 6: Primitives, batch 3: overlays and feedback

| Component | File | Spec | Notes |
|---|---|---|---|
| `Tooltip` | `ui/tooltip.tsx` | 16 section 6.1 | One shared provider with the documented delay; `max-w-tooltip-max` |
| `Popover` | `ui/popover.tsx` | 16 section 5.1 | Portal, Positioner, Popup; `z-(--z-dropdown)` |
| `Menu` | `ui/menu.tsx` | 09 section 10, 16 section 5.2 | Items, checkbox and radio items, group labels, separators, a destructive item tone |
| `Dialog` | `ui/dialog.tsx` | 16 section 4 | Widths 400, 560 and 720 px as a `size` axis; title required; focus returns to the trigger |
| `ConfirmDialog`, `TypeToConfirmField`, `DiscardChangesDialog` | `ui/alert-dialog.tsx` | 16 section 4.5, 10 section 13.2 | |
| `Drawer` | `ui/drawer.tsx` | 19 section 3.1 | The navigation drawer below 1024 px |
| `Toast`, `Toaster`, `toast()` | `ui/toast.tsx` | 18 section 3 | Base UI Toast; 360 px, bottom right of the main column; one action at most; errors do not auto-dismiss |
| `Combobox` | `ui/combobox.tsx` | 10 section 6.3 | Used by the project switcher |
| `Tabs` | `ui/tabs.tsx` | 09 section 12 | `h-tab`, underline indicator |

- [x] Steps 1 to 5 for each row. Overlay tests cover: Escape closes and returns focus; the trigger carries `aria-expanded` and `aria-controls`; a modal dialog traps focus and a popover does not; the toast region is a polite live region and an error toast an assertive one.
- [x] Opus review, fixes, gates, commit "Add the overlay and feedback primitives".

Done differently from the steps above, and why:

- `Tooltip` was built in Task 4. This task adds `ui/popup-styles.ts`: the surface, the motion, the row and the collision rule every anchored popup shares, also used by `Select`.
- Every label inside an overlay is a prop (`closeLabel`, `cancelLabel`, the `discard` copy of `Dialog`, the labels of `Toaster` and `Combobox`), because primitives cannot read the catalog. `common.notifications` is added for the toast region.
- `ToastProvider` and `Toaster` are mounted in `AppProviders` and in the test render helper; `toast()` and `dismissToast()` work from anywhere through one toast manager.
- `Drawer` is the navigation drawer only (from the left). The right-hand `SideDrawer` stays a later component.
- `Combobox` has two forms: the text field of a form, and a button with the search field in the popup, which the project switcher of Task 13 uses.
- `Menu` takes items as data and orders them itself: groups as given, destructive items last after a separator. It has `kind: 'link'` for items that navigate.
- `buttonVariants` gained the pressed look for a button whose menu or popover is open.
- An `overlays` section is added to the `/design-system` route.
- A new color token, `--surface-elevated-hover`, marks the highlighted row of a popup: `surface-hover` is almost the color of a popup in the dark theme (25 section 23 row 107).
- Popups opened inside a dialog or the drawer take its z-index, through `--z-dropdown` set on its portal (row 108).
- jsdom does not run animation frames, run transitions or lay out, so the focus trap, the motion and the placement of popups are checked in the browser, not in unit tests. The unit tests check what causes them: the page outside a dialog is made inert, a popup opens on the documented side, and so on.

Carried to later tasks: `Tabs.overflow` ("More tabs" below 1024 px) with the first page that has more tabs than fit; toasts aligned to the main column while the inspector is docked (Task 13 and the inspector plan); the dialog as a bottom-anchored sheet with a sticky 48 px header on phones follows 19 section 9 only in outline (full screen, scrolling body) and gets its final form with the mobile layout; 44 px menu rows on touch devices (19 section 9) with the mobile layout; `ContextMenu`, `Toggletip`, `PreviewCard` and `StepperDialog` belong to the plans of the screens that use them.

### Task 7: The `/design-system` route

**Files:** create `src/app/(internal)/design-system/layout.tsx`, `src/app/(internal)/design-system/page.tsx`, `src/app/(internal)/design-system/[section]/page.tsx`, `src/components/design-system/registry.ts` and one section file per group.

- [x] **Step 1:** `registry.ts` lists the sections: `tokens` (swatches with contrast read live), `typography` (the 15 utilities), `sizes`, `icons`, `buttons`, `forms`, `badges`, `overlays`, `feedback`. `generateStaticParams` returns them; an unknown section is a 404.
- [x] **Step 2:** The layout renders a plain section list and, for each section, the same content twice, side by side, in a `light` and a `dark` container (the `dark` class on a wrapper, since the variant is `:where(.dark, .dark *)`).
- [x] **Step 3:** The route calls `notFound()` when `NEXT_PUBLIC_APP_ENV` is `production`. Access for platform operators waits for an operator flag in `/me`; record that in Task 17.
- [x] **Step 4:** Test: every registered section renders without axe violations in both themes (jsdom cannot judge contrast; the token contrast tests already do).
- [x] **Step 5:** Compare each section against the static preview in the browser, both themes, at 1440 and 390 px. Fix every difference in size, color, radius, focus ring and spacing.
- [x] **Step 6: Opus review, fixes, gates, commit** "Add the design-system preview route".

Done differently from the steps above, and why:

- One theme at a time, chosen with a Light, Dark and System switch in the preview (`theme-control.tsx`), not two columns. A dialog, a menu or a toast is portalled to `<body>` and takes the theme of the page, so a dark column could not show it dark, and a section rendered twice repeats every id (25 section 23 row 115). The test of Step 4 still renders each section in a plain and in a `dark` wrapper.
- The earlier `display` section is gone. Its content moved to `icons` (Icon, Avatar, Separator), `buttons` (LinkButton, TextLink, Kbd, and Tabs from `overlays`), `typography` (Truncate), `overlays` (Tooltip, ScrollArea) and `feedback` (Spinner, Skeleton, and Toast from `overlays`). Combobox moved from `overlays` to `forms`.
- `buttons-section.tsx` is a Server Component that renders the client `button-specimens.tsx`, so `LinkButton` and `TextLink` are shown the way pages use them: without a client boundary.
- The tokens section reads each token from the page with `getComputedStyle`. The build rewrites `oklch()` as hex or `lab()`, so `src/lib/design/contrast.ts` reads all three and is checked against culori for every token (25 section 23 row 116). `token-groups.test.ts` fails when a color token of `tokens.css` is in no group of the preview, and when a ratio the section states does not hold in either theme.
- Container widths and radii are measured on an element, because Tailwind writes a theme value into the rule and leaves the variable out of `:root`.
- Found by the sizes section: `max-w-prose` was Tailwind's 65ch, not the 720 px of the design system. The container is now `max-w-reading`, and lint refuses the old name (25 section 23 row 114).
- `[section]/page.tsx` sets `dynamicParams = false`, so an unknown section is a 404 without rendering.
- From the Opus review: the production gate is in the layout, the index and each section page, because a client navigation can render a page without the layout, and a production build builds no section page at all. The route's title is empty in production, so a 404 does not name it. Tables that can be wider than the page sit in `TableScroll`, a named tab stop while it overflows (lint allows `tabIndex` on `role="region"` for this). The pairs that must reach a contrast ratio are one list, `src/lib/design/contrast-requirements.ts`, read by the token contrast test and the preview. `--max-width-prose` is reset, so `max-w-prose` no longer compiles at all.

Carried to later tasks: access for platform operators in production waits for the operator flag in `/me` (Task 17 records it); the sections for the shell, tables, filters, charts and application components arrive with the plans that build those components; the Playwright run of Task 16 checks contrast and landmarks on these pages in both themes.

---

# Part B. API and security

**Precondition, met on 2026-09-30.** `main` (25e99f0, with the auth API) is merged into `frontend/app-foundation` (871bf3f), so `backend/openapi/v1.json` has the 16 auth routes, `GET` and `PATCH /me` and `POST /me/reauthenticate`.

### Task 8: The typed API client

**Files:** create `src/lib/api/schema.d.ts` (generated), `types.ts`, `problem.ts`, `client.ts`, `server.ts`, `keys.ts`, `query.ts` and their tests.

- [x] **Step 1: Generate.** `pnpm gen:api`. Commit `schema.d.ts`. `types.ts` re-exports the component schemas the app names (`Me`, `MeMembership`, `Role`, `Problem`, `ValidationItem`, `SessionItem`).
- [x] **Step 2: `problem.ts`.**

```ts
export class ApiProblem extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;
  readonly errors: readonly ValidationItem[];
  readonly retryAfterSeconds: number | null;
  readonly body: Readonly<Record<string, unknown>>;
}
export function problemFrom(response: Response, body: unknown): ApiProblem;
export function isApiProblem(error: unknown, code?: string): error is ApiProblem;
```

`problemFrom` accepts a body that is not problem JSON (a proxy's HTML 502) and produces `code: 'http_error'` with the response status; it reads `Retry-After` as seconds or as an HTTP date; it never throws. Tests cover a full problem body, a body with extra members (kept in `body`), a non-JSON body, both `Retry-After` forms, and a missing `errors`.

- [x] **Step 3: Clients.** `client.ts`: `createClient<paths>({ baseUrl: '' , credentials: 'same-origin' })` for the browser. `server.ts` (`import 'server-only'`): `serverApi()` builds a client on `env.API_INTERNAL_ORIGIN` that forwards only the incoming `cookie` and `x-request-id` headers and sets `cache: 'no-store'`. Both go through one `unwrap` helper that returns `data` or throws `problemFrom(...)`. Test with MSW: the server client forwards the cookie and the request id and nothing else (an incoming `authorization` header is not forwarded).
- [x] **Step 4: Keys.** `keys.ts`: `queryKey(scope, resource, filters)` returns `['ws', workspaceId, 'p', projectId, domain, resource, normalized]` (20 section 3.5). `normalizeFilters` sorts keys, drops `undefined`, `null`, empty arrays and values equal to a given default. Tests: two filter objects that differ only in key order produce the same key; a default value is dropped.
- [x] **Step 5: `query.ts`.** `apiQuery(path, init)` returns TanStack `queryOptions` for a GET path with typed params, the derived key and `unwrap`. `apiMutation(method, path)` returns `mutationOptions` whose variables are the typed params and body. Tests (type level with `expectTypeOf`, runtime with MSW): a wrong path or a missing path param is a type error; a problem response rejects with an `ApiProblem` carrying its `code`.
- [x] **Step 6: Global error policy** in the query client of Task 3: a `401` with code `unauthenticated` or `session_expired` clears the cache and hard-navigates to `/login?next=<current path>`; a `429` waits `retryAfterSeconds` before one retry; an `ApiProblem` below 500 is never retried. Test each with MSW.
- [x] **Step 7: Opus review, fixes, gates, commit** "Add the generated API client and the query helpers".

Done differently from the steps above, and why:

- The generated file is `src/lib/api/schema.ts`, not `schema.d.ts`: `--enum-values` writes runtime lists (`reservedWorkspaceSlugValues`, `reservedProjectSlugValues`, `roleValues`), which a declaration file cannot hold. `--immutable` is not used: openapi-fetch's `Readable` turns a readonly array into `never[]`, which erased `Me.memberships`. `schema.test.ts` regenerates the file with the `gen:api` script and fails when it differs, so a stale client fails the test run without a CI step of its own.
- `queryKey(path, pathParams, query, defaults)` derives the key from the path template: `workspaces/{W}` becomes `'ws', W`, `projects/{P}` becomes `'p', P`, other segments stay, and the normalized query comes last. That is the shape of 20 section 3.5 without a hand-written domain per call. `workspaceKey(W)` and `projectKey(W, P)` are the prefixes to invalidate.
- `apiQuery(path, init)` takes two extras in `init`: `defaults` (dropped from the key) and `client` (the server client when a page prefetches). The init is optional exactly when the path needs no parameter.
- Both clients look up `fetch` at each call. openapi-fetch keeps the function it finds when the client is made, which misses a fetch wrapped later (Next.js on the server, MSW in tests).
- A list parameter is sent once, comma-separated (`filter[status_in]=active,paused`), the form 19 documents.
- `ApiProblem` also has `detail`, and `number(name)` and `string(name)` for the extension members that the OpenAPI document leaves untyped (`limit`, `used`, `requested`, `reauth_url`). A body that is not problem JSON gives `code: 'http_error'` (`HTTP_ERROR`).
- Retries: a 409 `conflict` is retried once, queries and mutations alike, because the API wrote nothing; no other write is ever repeated. A wait longer than 60 seconds (maintenance) is not spent inside a query. `retryDelay` waits `Retry-After`, otherwise backs off from 1 second to 30.
- `ValidationItem` in `lib/forms` is now the generated type.
- Tests reach MSW through `setupApiServer()` and `testApi()` in `src/test/api-server.ts`. The shared handlers and the mock modes are Task 9.
- From the Opus review:
  - The browser client's base is `window.location.origin` (under jsdom, `http://localhost:3000`), so component tests reach MSW with the client the app ships. `apiQuery` and `apiMutation` refuse the browser client on the server with a message that names `serverApi()`.
  - `newRequestId()` is `src/lib/request-id.ts`, the name 25 section 3.3 gives it, with `isRequestId()`. The browser client sends a new id with every request. The server client sends the page render's id when it is valid, otherwise one id of its own for all the calls of that render; it forwards the cookie and that id, nothing else.
  - A 2xx that is not JSON (a captive portal) becomes an `http_error` problem, not a `SyntaxError` that looks like a lost connection.
  - Query inits and mutation variables accept only `params` and `body`: `parseAs`, `baseUrl` and `headers` would change a request without changing its type or key. Defaults are left out of the request as well as the key. `ApiPath` is limited to `/api/v1/...`; `ApiResponse` of a 204 is `undefined`; `ApiQueryOptions` has a non-optional `queryFn`, so it also suits `useSuspenseQuery`.
  - Sign-out: a 401 on a public page (`src/lib/routes/public-paths.ts`, the list Task 10's proxy will use) empties the cache but does not navigate, and the policy stays on, so a lost session after moving on without a reload still signs out. Once the page is being left, further 401s change nothing.
  - Retries: `query_timeout`, `provider_paused` and `maintenance` are final; no retry waits more than 10 seconds and the backoff stays under 4, so a query reaches its error state within seconds; a write is repeated after a `conflict` only when the wait is short.
  - Step 2 of 10-forms.md section 23 is `applyProblem(form, error, { fields, messages, codeToField, alertCodes })` in `lib/forms`: it returns `fields` (with the unmatched items), `alert`, `conflict` or `fresh-session`, and rethrows anything else.
  - `source-text.test.ts` skips generated files by path, so `src/lib/env/schema.ts` is still read. `schema.test.ts` refuses a `gen:api` script without `-o src/lib/api/schema.ts` before it runs.

Carried to later tasks:
- Task 9: `vitest.setup.ts` starts one MSW server for every `dom` test; fold `setupApiServer()` into it so no file starts a second one.
- Task 12: prefetching needs one query client per server request (React `cache` around `makeQueryClient`), and the workspace layout must turn a signed-out `ApiProblem` into `redirect(loginUrl(...))` itself, because the query cache's policy runs only in the browser. `withFreshSession` handles the `fresh-session` outcome of `applyProblem` and reads `problem.string('reauth_url')`.
- Task 13: an `ApiProblem` thrown in a Server Component reaches `error.tsx` as a plain `Error`, so the request id shown there must travel in the digest. The 429 toast with its countdown and the query error states belong here.
- Task 17: 20 section 3.5 still names `API_INTERNAL_BASE_URL` and a browser base of `/api/v1` (the generated paths carry `/api/v1`, so the base is the origin); 20 section 3.7 and 10-forms.md section 23 still describe 409 `conflict` as a stale edit, while 19 section 2.7 says a lock timeout with nothing written, and puts stale edits on 412.

### Task 9: The mock layer

**Files:** create `src/mocks/factories/*.ts`, `src/mocks/handlers/auth.ts`, `me.ts`, `projects.ts`, `src/mocks/handlers/index.ts`, `src/mocks/browser.ts`, `src/mocks/node.ts`, `src/lib/api/pending.ts`, `src/lib/api/pending.test.ts`, `src/instrumentation.ts`, `src/providers/mock-gate.tsx`, `public/mockServiceWorker.js` (`pnpm exec msw init public --save`); modify `next.config.ts`, `vitest.setup.ts`.

- [x] **Step 1: Factories.** `userFactory`, `workspaceFactory`, `membershipFactory(role)`, `meFactory(overrides)`, `projectFactory`. The development fixtures are the workspace Digibranders with the projects `fynix.digital`, `cleanstart.com`, `eventussecurity.com`, `oyechats.com` and `firstfold.io`, and one user per role.
- [x] **Step 2: Handlers** typed against the generated `paths` (`http.post<never, components['schemas']['SignInRequest']>(...)`), so a contract change breaks the mocks at compile time. The auth handlers keep a small in-memory session state: sign-in with the fixture password returns `signed_in` or `totp_required`; a wrong password returns the `invalid_credentials` problem; five failures return `rate_limited` with `Retry-After`.
- [x] **Step 3: Pending endpoints.** `pending.ts` holds hand-written types, copied from 19, for endpoints the backend has not built (first: `GET /api/v1/workspaces/{workspace_id}/projects`). `pending.test.ts` fails when a pending path appears in the generated `paths`, which is the signal to delete the hand-written type and its `pending` handler.
- [x] **Step 4: Modes.** `NEXT_PUBLIC_API_MOCKING`: `off` starts nothing. `pending` starts MSW with only the pending handlers and `onUnhandledRequest: 'bypass'`. `all` starts every handler and `onUnhandledRequest: 'error'` for `/api/` URLs. In the browser, `MockGate` (rendered by `AppProviders` only when mocking is not `off`) starts the worker before children render. On the server, `instrumentation.ts` `register()` starts `msw/node` when `NEXT_RUNTIME === 'nodejs'`. Neither import exists in a production bundle: both are behind `process.env.NEXT_PUBLIC_API_MOCKING !== 'off'` checks that the compiler removes; verify by searching the production build output for `msw`.
- [x] **Step 5: Development rewrite.** In `next.config.ts`, when `API_PROXY_TARGET` is set and the environment is not production, `rewrites()` sends `/api/:path*` to it. The browser still talks to `http://localhost:3000`, so the `Origin` header matches the API's `APP_ORIGIN` and the `__Host-session` cookie is stored for the app's origin (Chrome and Firefox accept a `Secure` cookie on `http://localhost`; Safari does not).
- [x] **Step 6: Document the three ways to run** in `apps/web/README.md`: `all` mocks (no backend), `pending` with the real API through the rewrite, and the production shape behind Caddy.
- [x] **Step 7: Vitest** starts the node server from `vitest.setup.ts` with `onUnhandledRequest: 'error'` and resets handlers after each test.
- [x] **Step 8: Opus review, fixes, gates, commit** "Add the MSW mock layer and the development API rewrite".

Done differently from the steps above, and why:

- The session of the mocks is kept in the `__Host-session` cookie itself (`mock.active.<user id>.<fresh until>`, `src/mocks/session.ts`). The browser's worker and the server's MSW are two processes that share no memory; with the cookie both know who is signed in, and the proxy of Task 10 sees a cookie as it will with the API. MSW writes the mocked `Set-Cookie` to `document.cookie`, which Chrome and Firefox accept for a `Secure` cookie on `http://localhost`. Failed attempts and changed names live in the memory of one process (`src/mocks/state.ts`), so a reload forgets them.
- The fixtures are in `src/mocks/fixtures.ts`: Digibranders, its five projects, one user per role (the owner has two-factor on, the analyst is limited to two projects), the fixture password, second-factor code, recovery code and emailed tokens. The factories are `factories/identity.ts` (`userFactory`, `workspaceFactory`, `membershipFactory`, `meFactory`) and `factories/project.ts` (`projectFactory`).
- The permission keys of each role are copied into `factories/permissions.ts`, because the OpenAPI document types permissions as plain strings. `permissions.test.ts` reads the table of `backend/src/sightline/api/permissions.py` and fails when the two differ.
- Handlers are declared with `mock(method, path, resolver)` (`src/mocks/respond.ts`), which types the path parameters, request body and response against the generated schema. It already caught one mistake: the `Done` body is `{ status: 'ok' }`. `problem(request, code)` sends the status and title the API gives each code.
- `GET /workspaces/{id}/projects`, the plan's first pending endpoint, shipped in the API before this task; the pending endpoint is now `GET /api/v1/invitations/preview` (19 section 3.2.2, deferred on the backend), with a `pendingApi` client. `pending.test.ts` reads `backend/openapi/v1.json` and fails once a pending path appears there.
- `src/mocks/node.ts` exports the server the tests use; `vitest.msw.ts` starts it for both test projects (the unit tests too) and resets handlers and the mocks' memory after each test. `setupApiServer()` of Task 8 is gone; `src/test/api-server.ts` keeps `TEST_API_ORIGIN` and `testApi()`.
- Verified: the production build contains no MSW code (the only match is the comment text of `MockGate` in a server source map); in the browser with `all`, the worker is in control, sign-in sets the cookie, `/me` answers 200 for the signed-in fixture user, and an API route without a handler is reported.
- From the Opus review:
  - The worker starts once per page (`browser.ts` keeps the promise): React's strict mode ran the start twice, which attached every handler twice, so an address locked after 3 wrong passwords. `MockGate` renders anyway after 10 seconds when the worker never starts.
  - In jsdom, MSW keeps a mocked cookie in `document.cookie` and in its own cookie jar; `vitest.msw.ts` signs out through the mocks after each test, and `session-isolation.test.tsx` checks it. DOM tests run on `https://localhost:3000`, so the `__Host-` cookie can be set at all.
  - The mocks follow the API more closely: `totp/verify` answers `unauthenticated` without a session and `session_expired` after the 10 minutes of a pending one (the deadline is in the cookie, `Max-Age=600`), and accepts an active session; wrong passwords and codes count together and the lock ends after 15 minutes; `fresh_session_required` carries `reauth_url`; re-authentication needs exactly one of password and code and answers `invalid_credentials` for either wrong; signing out the current session clears the cookie and a session already signed out is a 404; a password change signs out the other sessions; registration is bound to the invited address (`MOCK_INVITED_USER`, who can then sign in) and checks the password before a duplicate; projects are sorted by name, have no domain yet (`primary_domain` and `default_location_id` are null, as in the API), and unknown or out-of-range query parameters are a 422; every body is checked like the API's models (`checkBody`: unknown members are `extra_forbidden`, missing ones `missing`); a valid incoming request id is answered with.
  - A name saved through `PATCH /me` is kept in a `mock-name` cookie, so the server's MSW, which Task 12's layout reads `/me` through, sees it too. The tests' MSW server is `src/test/msw.ts`; the dev server's is started by `src/mocks/node.ts`.
  - Not mirrored, on purpose: the API's `Origin` check on writes (jsdom's fetch sends no `Origin`, so every test would need to add one); the mocked cookie cannot be HttpOnly.

Carried to later tasks: the pending invitation preview was `GET ?token=`, which would put the token in the API's access log; the backend session agreed on 2026-09-30 to build it as `POST /api/v1/invitations/preview` with `{ token }`, answering with the invited email too, and the pending type, mock and invite screen use that shape since Task 11 (the route stays deferred, doc 29 section 1.1 step 10). Task 15 says `wrong_password` for a wrong current password; the API answers `invalid_credentials`, and the mocks do too. 20 section 8.1 still names `src/test/factories` (Task 17: the factories are `src/mocks/factories`).

### Task 10: Request proxy, CSP and headers

**Files:** create `src/lib/security/csp.ts`, `csp.test.ts`, `src/lib/security/next-path.ts`, `next-path.test.ts`, `src/proxy.ts`, `src/proxy.test.ts`; modify `next.config.ts`, `src/app/layout.tsx`, `src/providers/app-providers.tsx`.

- [x] **Step 1: `buildCsp({ nonce, development })`**, a pure function returning the policy of 20 section 7.3. Development adds `'unsafe-eval'` to `script-src` and `ws:` to `connect-src`; production never does. Tests assert each directive, that the nonce appears in `script-src` and `style-src`, and that the production policy contains neither `unsafe-eval` nor `unsafe-inline`.
- [x] **Step 2: `safeNextPath(value)`** returns the value only when it is a same-origin path: starts with one `/`, not `//`, not `/\`, no scheme, no control characters, and not an `/api/` path. Anything else returns `/`. Tests: `/acme/crm?x=1` passes; `//evil.example`, `https://evil.example`, `/\evil`, `javascript:alert(1)`, `/api/v1/me` and an empty value all return `/`.
- [x] **Step 3: `proxy.ts`.** For every request except `/_next/*`, static files and `/api/*`: generate a nonce, set `Content-Security-Policy` on the response and pass the nonce to the render through the `x-nonce` request header. If the path is not public (`/login`, `/two-factor`, `/reset-password`, `/verify-email`, `/invite`, and `/design-system` outside production) and the `__Host-session` cookie is absent, redirect to `/login?next=<path and query>`. The proxy never validates the session; the API does. Tests call the exported handler with constructed requests: an anonymous request to `/acme` redirects with the encoded `next`; a request with the cookie passes and carries a CSP header whose nonce matches `x-nonce`; `/login` without a cookie passes.
- [x] **Step 4: Nonce consumers.** The root layout reads `x-nonce` from `headers()` and passes it to `ThemeProvider` (`nonce` prop, for its inline script).
- [x] **Step 5: Static headers** in `next.config.ts` `headers()` for all routes: the six headers of 20 section 7.3. Authenticated HTML is `Cache-Control: private, no-store` (set in the proxy for non-public paths).
- [x] **Step 6: Verify in the browser:** `pnpm build && pnpm start`, open `/login`, confirm no CSP violation in the console, the theme script runs, and the response carries every header.
- [x] **Step 7: Opus review, fixes, gates, commit** "Add the request proxy with the session check, CSP nonce and security headers".

Done differently from the steps above, and why:

- The policy has `style-src-attr 'unsafe-inline'`, beyond 20 section 7.3. The server-rendered HTML carries style attributes (Base UI's visually hidden inputs of radio groups and selects, sizes read from tokens in the preview), a nonce cannot cover an attribute, and a probe in Chrome showed a nonce-only `style-src` blocks them. An attribute styles one element and can run nothing; inline `<style>` and `<script>` elements still need the nonce. Base UI's documentation names this option. Record it in 20 section 7.3 in Task 17.
- Base UI gets the nonce through `CSPProvider`, but React hoists its scrollbar `<style>` into `<head>` without the nonce, so the provider sets `disableStyleElements` and the two rules of `.base-ui-disable-scrollbar` are in `globals.css`.
- `upgrade-insecure-requests` is sent only when the page was requested over https (`x-forwarded-proto` from the TLS proxy, or the URL's scheme), not by build mode: a production build served on plain http (Playwright against `http://web:3000`, WebKit on localhost) would otherwise send its own requests to an https origin that does not answer.
- The development policy allows inline styles without the nonce (`style-src 'self' 'unsafe-inline'`): the dev overlay's styles carry none. Production keeps the nonce.
- `img-src` also allows `https://*.gstatic.com`: the favicon endpoint answers with a redirect there, and a browser checks the host it is redirected to. Recorded in 07-icons section 5.
- The proxy matcher skips top-level files with an extension (`/mockServiceWorker.js`, `/favicon.ico`), `/api` and `/api/*`, all of `/_next/`, and `/.well-known/`. It runs for prefetches: a header that skipped it would let any client turn off the policy and the redirect. The matcher is tested with Next's `unstable_doesMiddlewareMatch`.
- `safeNextPath` checks the normalised result as well as the input (`/.//evil.example` resolves to `//evil.example`), compares `/api` without regard to case, and sends a value over 2048 characters home.
- The layout's nonce is kept for the life of the document in `AppProviders`: a refresh renders the layout with a new response's nonce, which the document's policy does not allow.
- `Strict-Transport-Security` is sent by production builds only, so five static headers in development.
- Left for later tasks: a CSP violation report endpoint (Task 16, with the Playwright check); `_global-error` is prerendered without a nonce, so check the root error page under the policy in Task 13; `Cache-Control: private, no-store` survives only in production builds (the dev server overwrites it), so Task 16 asserts it on the production build; 24 section 7.1 lacks `blob:` in `img-src` (Task 17).
- The session cookie's name is `src/lib/security/session-cookie.ts`, shared by the proxy and the mocks.
- Verified on `pnpm build && pnpm start` with mocking off: every response carries the six static headers and the policy; an anonymous request to `/digibranders` is redirected to `/login?next=%2Fdigibranders`; on `/login` and the preview sections no `<script>` or `<style>` element lacks the nonce; the theme script runs; `.base-ui-disable-scrollbar` still hides the native scrollbar. A build picks up `NEXT_PUBLIC_API_MOCKING` from `.env.local`, so a check of the production shape needs `NEXT_PUBLIC_API_MOCKING=off` (and `NEXT_PUBLIC_APP_ENV=production`) on the command.

---

# Part C. Auth, shell and account

### Task 11: Auth screens

The design system has no auth template yet. Rule: specify, then build.

**Files:** modify `docs/design-system/24-page-templates.md` (new section "T7 Auth"), `25-component-inventory.md` (`AuthCard`), `review-log.md`; create `src/app/(auth)/layout.tsx`, the six route folders, `src/features/auth/*`, `src/components/app/shell/auth-card.tsx`; extend `messages/en.json` (`auth` namespace) and the MSW auth handlers.

- [x] **Step 1: Specify T7.** One centered column, 400 px wide, on `background`; the product name above a `surface` panel with a 1 px `border` and `rounded-lg`, 32 px padding; `type-page-title` heading, one `type-body` sentence in `foreground-secondary`; controls at `h-control-lg`; one primary button, full width; secondary links as `TextLink` below the panel. No illustration, no marketing copy, no second column. Below 480 px the panel loses its border and fills the width. Write the section and the `AuthCard` entry; log it in `review-log.md`.
- [x] **Step 2: Flows.** Each screen is a route with a Server Component page that renders one client form from `features/auth`. Forms use react-hook-form with a zod schema, `apiMutation`, `applyServerErrors`, and a `FormAlert` for problems that belong to no field.

| Route | Calls | Success | Problems shown |
|---|---|---|---|
| `/login` | `POST /auth/sign-in` | `signed_in`: go to `safeNextPath(next)`. `totp_required`: go to `/two-factor` keeping `next` | `invalid_credentials` (one message for wrong email or password), `rate_limited` (with the wait in minutes), `validation_failed` |
| `/two-factor` | `POST /auth/totp/verify` with `code`, or with `recovery_code` after "Use a recovery code" | go to `safeNextPath(next)` | `invalid_code`, `rate_limited`, `session_expired` (back to `/login`) |
| `/reset-password` without a token | `POST /auth/password-reset/request` | the same confirmation whether or not the address has an account | `rate_limited` |
| `/reset-password#token=...` | `POST /auth/password-reset/confirm` | go to `/login` with a notice | `invalid_token` (offer a new link), `weak_password` (on the field) |
| `/verify-email#token=...` | `POST /auth/verify-email`; "Send a new link" calls `POST /auth/verify-email/request` | confirmation, then `/login` or `/` | `invalid_token` |
| `/invite#token=...` | `POST /auth/register` with `invitation_token` | go to `/login` with a notice (an invited account is created already verified) | `registration_closed` (one message for every reason), `duplicate`, `weak_password`, `validation_failed` |

Tokens arrive in the URL fragment, as the API's emails write them (`/verify-email#token=`, `/reset-password#token=`), so they never reach server logs. A small hook `useFragmentParam(name)` reads the fragment after mount and then removes it from the address bar with `history.replaceState`. The invitation link is `{origin}/invite#token=<token>` (agreed with the backend session on 2026-09-30; 20 section 3.2 still says `invite/[token]`, correct it in Task 17). The route that returns the workspace name, role and invited email for a token is not built yet: add it to `pending.ts` with the provisional shape and show those three values above the form.

Contract details from the backend session, all in 19 sections 2.1 and 3.1 on `backend/auth`:

- The browser calls sign-in, register, `verify-email/request` and `password-reset/request`. Never call them from a Server Component or route handler: the throttle counts per client address, and the server would share one.
- Any state-changing call made from server code must set `Origin` itself, or the API answers `403 origin_not_allowed`. This plan makes none.
- `totp_required` leaves a 10 minute pending session that only `totp/verify` and sign-out accept; every other route answers 401, so `/two-factor` must not fetch `/me`.
- `weak_password` (422) carries `reason`: `too_short`, `too_long`, `contains_email`, `breached` or `unchanged`. One message per reason, on the field.
- `rate_limited` (429) carries `retry_after_seconds` and a `Retry-After` header.
- A password reset does not sign the user in: go to `/login`.
- Other codes to map: 401 `unauthenticated`, `session_expired`, `invalid_credentials`, `invalid_code`; 400 `invalid_token`; 409 `duplicate`, `totp_already_enabled`, `totp_not_enabled`; 503 `service_unavailable`.
- Every request carries `X-Request-Id`: `req_` plus a UUIDv7 in Crockford base32 (25 section 3.3). Add `newRequestId()` to `lib/api` in Task 8 with a test for the format, and send it from both clients.

- [x] **Step 3: Rules.** Password fields: `autocomplete="current-password"` or `"new-password"`, paste allowed, minimum 12 characters checked on blur for new passwords. Email: `autocomplete="email"`, `type="email"`. The submit button shows `loading` and the form is not submittable twice. Validation timing follows 10 section 18. A failed submit moves focus to the `FormAlert` or the first invalid field and announces the error.
- [x] **Step 4: Tests** (one file per form, MSW in `all` mode): the happy path; every problem in the table renders its message and keeps the typed values; `next=//evil.example` lands on `/`; a second-factor code pasted as `123 456` is accepted as `123456`; no axe violations.
- [x] **Step 5: Against the real API.** Start the backend (its README, "Run locally"), create an operator with its CLI, run the app with `NEXT_PUBLIC_API_MOCKING=off` and `API_PROXY_TARGET=http://127.0.0.1:8000`, and walk every row of the table in Chrome: sign in, wrong password, throttle, the code prompt for a user enrolled through the API, reset (the link is printed on the API's stderr), sign out. Record what differs from the mocks and fix the mocks.
- [x] **Step 6: Opus review, fixes, gates, commit** "Add the auth screens".

Done differently from the steps above, and why:

- T7 uses the breakpoints and spacing steps that exist: the panel loses its border, fill and padding below 640 px (`sm`, there is no 480 px breakpoint), and the column starts 48 px down (`pt-12`, the largest spacing step). 24 section 11 says so.
- The five routes are `/login`, `/two-factor`, `/reset-password` (request and confirm on one page, by the fragment), `/verify-email` and `/invite`; there is no sign-up without an invitation.
- The first field takes focus with react-hook-form's `setFocus` after mount, because lint refuses `autoFocus`.
- `FormAlert` gained `tone="positive"`, for the notice the sign-in page shows after a reset, a new account or an expired second step (`?notice=passwordReset`, `accountCreated`, `sessionExpired`, the only values it accepts; the notice goes once the person submits), and `live={false}` for an alert that takes focus, so it is read once.
- A full page load (`hardNavigate`, `src/lib/navigation/hard-navigate.ts`) follows every change of session, so the server renders the next page with the new cookie, the pending second-factor session included.
- `/two-factor` also sends the person back to sign in on `401 unauthenticated`, which the API answers when the pending session is gone altogether.
- `useFragmentParam` (`src/lib/url/use-fragment-param.ts`) reads the fragment when the component subscribes, not during a render, and keeps what it read across React's strict-mode remount.
- DOM tests run on `https://localhost:3000`, so the `__Host-` cookie of the mocks can be set in jsdom.
- Step 5, against the real API (the backend session's dev Postgres and Redis, the API on port 8000, the app with `API_PROXY_TARGET` and mocking off, a local operator account): sign-in, a wrong password in one message, the lock (401 five times, then 429 with `Retry-After: 900` and `retry_after_seconds`), validation (`value_error` on `email`, `extra_forbidden`), the reset request (202), a used reset link in the page ("This link does not work"), `invalid_token` on verify, `registration_closed` without an invitation, and sign-out all answered exactly as the mocks do. Not walked: the code prompt for a user enrolled through the API and a real reset link, because both need a live secret (a TOTP seed, an emailed token) that the session was not allowed to handle; walk those two by hand.
- After the review: the invitation is accepted. `/invite` registers, then sends the person to `/login?notice=accountCreated#invitation=<token>`; the sign-in form (and `/two-factor`, which the token follows in the fragment) calls `POST /invitations/accept` once signed in and opens `/{slug}`, or `/?invitation=<reason>` when accepting fails (Task 12 shows the reason there). An address that has an account already gets "Sign in to accept", which does the same.
- `/invite` no longer needs the pending preview: it asks for the address (`autocomplete="username"`) and uses the preview, when it answers, for the heading and a read-only address. Only `invalid_token` from the preview shows the invalid-link panel.
- The mocks keep the invited person's registration and acceptance in cookies (`mock-invitee`, `mock-joined`), so the flow survives the page loads between registering, signing in and joining; `/me` lists no membership for them until they join. Tests expire every mock cookie after each test through a test-only route, one cookie per answer (MSW reads one `Set-Cookie` from a mocked response).
- Every auth form stays busy from submit until the next page has loaded, and returns early when submitted again. A step without a field (check your email, verified, could not check) moves focus to the panel's heading; the page title follows the step. `/verify-email` shows "This link does not work" only for `invalid_token`; a limit or an outage offers "Try again" with the same token. An email request that hits its hourly limit says so in its own words.
- `useFragmentParam` forgets what it read once its last reader is gone (a client-side return to the page no longer sends a used token again), and removes the value a microtask later with `replaceState(null, ...)`, so the App Router adopts the new address and a later router update cannot put the token back.
- Text fields and OTP cells use the new `type-input-touch` (16 px) below 768 px (19 section 10, rule 2); OTP cells after the first are named "Digit n of 6". Server field errors show the app's own words. Copy: roles in sentences read "an editor", the product name is a parameter, "Send new link", no "Something went wrong" in auth.
- Not changed: "Forgot your password?" does not carry `next` (a reset ends at the sign-in page, which then goes home); the 44 px touch height of the text links belongs with the shell's mobile pass in Task 13.

### Task 12: Identity, permissions and the fresh-session dialog

**Files:** create `src/lib/permissions/*`, `src/app/[workspace]/layout.tsx`, `src/features/session/*` (sign out, `useMe`), `src/components/app/shell/reauth-dialog.tsx`; modify `src/app/page.tsx`.

- [x] **Step 1: `/` redirect.** `src/app/page.tsx` (Server Component) calls `/me` through `serverApi()`. `401`: redirect to `/login`. No membership: render the documented empty state ("You are not a member of any workspace"). Otherwise redirect to `/<first workspace slug>`.
- [x] **Step 2: Workspace layout.** `[workspace]/layout.tsx` fetches `/me`, finds the membership whose `workspace.slug` matches the segment (`notFound()` when there is none, so another tenant's slug never confirms it exists), and renders `PermissionProvider` with the membership's `permissions`, `role` and `project_ids`. It seeds the client query cache for `/me` through `HydrationBoundary`, so client components read the same data without a second request.
- [x] **Step 3: `can`.** `can(permissions, permission)`, `useCan(permission)`, `<Can permission fallback>`. The client never decides access; it only hides or disables what will fail (20 section 3.9). Tests: each role fixture against a table of permissions.
- [x] **Step 4: `ReauthDialog`** (16 section 4.4, 25): a 400 px dialog "Confirm it is you" with a password field, or a code field when the user has a second factor, calling `POST /me/reauthenticate` with `{ password }`, or with `{ totp_code }` when the user has a second factor (the API refuses a password alone with `403 second_factor_required`). `withFreshSession(mutationFn)` catches `403 fresh_session_required`, opens the dialog, and on success retries the original call once. Tests: the retry happens once; cancelling rejects with the original problem; a second `fresh_session_required` after the retry is surfaced, not looped.
- [x] **Step 5: Two-factor is opt-in.** No route requires enrolment for now, so nothing redirects to a setup screen. A `403 two_factor_required_for_role`, should the API ever send one before the setup screen exists, shows the inline permission panel with the API's own `detail`.
- [x] **Step 6: Sign out.** Calls `POST /auth/sign-out`, clears the query cache, removes the user's preference keys from `localStorage`, hard-navigates to `/login`.
- [x] **Step 7: Opus review, fixes, gates, commit** "Add the workspace layout, permissions and re-authentication".

Done differently from the steps above, and why:

- `/` is `src/app/(auth)/page.tsx`, so its two screens use the T7 layout: "You are not in a workspace yet" (plainer than step 1's wording), and an invitation that could not be accepted (`?invitation=<reason>` from Task 11, with the way on to the first workspace the person has). Both show who is signed in and "Sign out". The decision is `homeOutcome` in `features/session/server.ts`, tested on its own. A membership whose workspace is `deleting` is left out everywhere (`openMemberships`).
- The layout's work is `WorkspaceRoot` in `features/session/workspace-root.tsx` (routes stay thin): `getMe()` (React `cache`: one `/me` per request, in place of the per-request query client that Task 8 carried here), `notFound()` for a slug the caller is not in, and `/me` handed to the client cache through `HydrationBoundary` under `meQuery()`'s key. A session that has ended goes to sign in with `next` set to the page asked for: the proxy hands every render its path in `x-pathname`, which a client cannot set. `meQuery` lives in a module without `'use client'`, because the server calls it too.
- Paths built from a slug go through `src/lib/routes/paths.ts` (`workspacePath`, `projectPath`, `signInPath`), the one place that types a dynamic string as a `Route`, as the Next.js documentation shows for typed routes.
- Permissions: `PERMISSIONS` and `Permission` in `src/lib/permissions/permissions.ts` are the app's list of the API's keys (the OpenAPI document types them as strings); the mocks' role table is keyed by it, so an unknown key fails to compile, and its test still compares it with the backend's table. `canOpenProject(projectIds, id)` is there for the project layout of Task 13.
- `ReauthDialog` keeps its form state in React state: application components may not use react-hook-form (lint). `onSubmit` answers `'ok' | 'invalid' | 'second-factor-required'`; the last switches the dialog to the code. A wrong secret is a `FormAlert` that takes focus, as on the sign-in page, so it is read even when the form was sent with Enter. A lock gives its wait; any other failure one plain sentence. The dialog does not read `reauth_url` from the problem (Task 8 carried it here): the page's own dialog is the way to re-authenticate.
- `useFreshSession()` returns `withFreshSession` bound to the page's one dialog (`FreshSessionProvider`, inside `WorkspaceProviders`). Requests that need a fresh session while it is open wait for the same answer; a request refused within a minute of a confirmation is sent again without asking; Cancel and Escape wait while the secret is on its way; waiting requests are answered "no" when the workspace is left; `/me` is read again when the dialog opens, so it asks for what the account uses now. A DOM test puts the dialog above another `Dialog` that asked: the one below stays open (hidden from assistive technology meanwhile) and gets the result.
- Step 5 needs no code yet: no screen sends a request that can answer `two_factor_required_for_role`; the generic 403 panel of Task 13 shows the API's `detail`.
- Sign out (step 6): `useSignOut()` removes every `sightline.pref.*` key (`src/lib/preferences/storage.ts`, where Task 15's preferences will live) and loads `/login` in full, which drops the query cache with the page. It does not empty the cache first: a query still on screen would ask again, hear 401 and send the next person to sign in with this person's page in `next`. Its mutation is marked (`SIGN_OUT_META`) so the cache's 401 policy leaves it alone. The API answers sign-out with 204 even without a session; a 401 is taken as signed out all the same, defensively. A network failure leaves the person signed in and the caller says so.
- Found while checking in the browser: MSW's `setupServer` never saw the requests of Server Components, because Next.js wraps `fetch` and keeps the original it found. The server mocks now call the handlers directly: `startMockServer` sets an override that every API client's `fetch` consults (`src/lib/api/api-fetch.ts`, on `globalThis` under a registered symbol, since instrumentation and pages are separate bundles; a build with mocking off drops the lookup). In `all` mode an unhandled API request is a logged 404; in `pending` mode it goes to the API.
- Checked on the dev server: `/` redirects a member to `/digibranders`, shows the no-workspace screen to the invited person before they join, and "Sign out" ends at `/login` with the session cookie gone. `/digibranders` itself is still the 404 page, because `[workspace]` has no page until Task 14, so the layout's branches are covered by `WorkspaceRoot`'s unit tests only; Task 14 checks them in the running app, once with mocking off (`next start`), where `MockGate` does not hold back the server render.

### Task 13: The application shell

**Files:** create `src/lib/navigation/registry.ts`, `registry.test.ts`, `src/components/app/shell/sidebar.tsx`, `top-bar.tsx`, `breadcrumb.tsx`, `project-switcher.tsx`, `theme-switch.tsx`, `help-menu.tsx`, `user-menu.tsx`, `page-header.tsx`, `skip-link.tsx`, `src/components/app/status/empty-state.tsx`, `inline-error.tsx`, `error-page.tsx`, `src/app/[workspace]/[project]/layout.tsx`, `error.tsx`, `loading.tsx`, `src/app/not-found.tsx`, `src/app/error.tsx`, `src/app/global-error.tsx`.

- [x] **Step 1: Navigation registry.** The 14 destinations of 11 section 1.1 with `key`, `labelKey`, `href(workspace, project)`, `icon`, `group`, `permission` and `status: 'live' | 'planned'`. In this plan only `settings` is live. `visibleNavigation(registry, permissions)` drops planned items and items the role can never use, and drops a group label whose items are all gone. Tests: a viewer sees no item that needs a write permission; an empty group has no label; hrefs are built from slugs.
- [x] **Step 2: `Sidebar`** (11 sections 1 to 3, 24 section 9.1, the preview's markup): 208 px, the project switcher on top, 32 px items with 18 px icons, the active item in `surface-selected` with `aria-current="page"`, the three sections separated by 16 px, the Collapse button and the `[` shortcut. Collapsed state is `data-sidebar="collapsed"` on `<html>`, stored in a cookie so the server renders the right width and nothing shifts on load. The `rail:`, `narrow:` and `peek:` variants already exist in `globals.css`. Below 1024 px the sidebar is the `Drawer`, opened by the top bar's menu button.
- [x] **Step 3: `TopBar`** (11 section 4): the breadcrumb (House link, workspace, project, current page), then on the right `ThemeSwitch` (at 1440 px and up), `HelpMenu`, `UserMenu` (name, email, the Theme group below 1440 px, "Account settings", "Sign out"). Search, date range, location and notifications are not rendered in this plan.
- [x] **Step 4: `ThemeSwitch`** (11 section 4, 21 section 5.1): `role="switch"` named "Dark theme", writes through `next-themes`, reveals the new theme with the View Transitions circle where the API exists and reduced motion is off, and switches instantly otherwise.
- [x] **Step 5: `ProjectSwitcher`** (11 section 8): a `Combobox` menu with search, fed by the pending endpoint `GET /workspaces/{id}/projects`; members limited to some projects see only those; switching keeps the current destination.
- [x] **Step 6: `PageHeader`, `EmptyState`, `InlineError`, `ErrorPage`** per 25 and 17. `not-found.tsx` never implies the object exists. `error.tsx` offers "Try again" (`reset`) and shows the request id when the error is an `ApiProblem`.
- [x] **Step 7: Project layout.** Routes import features only (26 section 2, rule 4, enforced by lint), so the composition lives in `src/features/shell`: `ProjectShell` (skip link, `Sidebar`, `TopBar`, `main`) and `RouteError`, `RouteNotFound` (which render `ErrorPage`). The layout and the `error.tsx`, `not-found.tsx` files import those. `[workspace]/[project]/layout.tsx` resolves the project slug (pending endpoint; `notFound()` for an unknown slug or a project outside `project_ids`), renders the skip link, `Sidebar`, `TopBar` and `main`. `[workspace]/[project]/page.tsx` renders Overview when its registry entry is live; until then it redirects to the first live destination.
- [x] **Step 8: Tests.** Landmarks (`nav` Primary, `nav` Breadcrumb, `main`) and the skip link as first focusable; keyboard order; the collapsed rail shows tooltips with full labels; the user menu signs out; no axe violations in either theme.
- [x] **Step 9: Compare with the static preview** at 1680, 1440, 1280, 1100, 1024, 768 and 390 px in both themes. The shell must match it.
- [x] **Step 10: Opus review, fixes, gates, commit** "Add the application shell".

Done differently from the steps above, and why:

- The session data layer moved from `features/session` to `src/lib/session` (`getMe`, `openMemberships`, `membershipOf`, `meQuery`, `useMe`, `useSignOut`, and the fresh-session context with `withFreshSession` and `useFreshSession`): the shell and, in Task 15, account settings are features of their own, and a feature may not import another. `features/session` keeps the screens and providers (`HomeScreen`, `WorkspaceRoot`, `FreshSessionProvider`, `homeOutcome`).
- The composition is `features/shell`: `ProjectRoot` (server: `/me`, the membership, the project list from the real `GET {W}/projects` with `limit=200`, `notFound()` for an unknown slug or a project outside `project_ids`, the sidebar cookie), `ProjectShell` (client), `RouteError`, `RouteNotFound`, `PageSkeleton`, `firstDestination`, and the hooks `useSidebar` and `useThemeChange`.
- `[workspace]/[project]/page.tsx` redirects to the first live destination the member can open (Settings for now; its pages arrive with Task 15). `[workspace]/[project]/[...rest]/page.tsx` calls `notFound()`, so an unknown or planned path renders the 404 inside the shell: Next.js shows a segment's `not-found.tsx` only for a `notFound()` in that segment.
- The sidebar is one component (`SidebarNav`) for the expanded sidebar, the rail and the drawer; the `rail:`, `narrow:` and `peek:` variants do the layout, and `useSidebar` keeps the preference (cookie `sightline-sidebar`, read by the root layout into `<html data-sidebar>`) and the rail's expanded overlay (`data-sidebar-peek`, closed by Escape, a press outside or following a link).
- Keys go through `useShortcut` (`src/lib/a11y/use-shortcut.ts`, 25 section 19.5): `[` toggles the sidebar, `?` opens the shortcuts dialog (both `single-key`), and Escape closes the rail's overlay and returns focus to the toggle (`dismiss`). Neither fires while a dialog, menu or list is open or the key comes from one: Base UI marks them with `data-open`, not `aria-modal`. `scope` and sequences come with the screens that need them. The switch that turns single-key shortcuts off arrives with Task 15.
- `Menu` gained a `header` slot (the account menu's name and email). `HelpMenu` lists Keyboard shortcuts only: Methodology, Documentation and Contact support have no destination yet, and it takes them as `links` when they do. `UserMenu` has the Theme group below 1440 px only (`useMediaQuery`), and Account settings links to `settings/profile` of the open project.
- `ThemeSwitch` sets an explicit Light or Dark and the reveal runs through `useThemeChange` (View Transitions, `--duration-reveal`, which is 0 under reduced motion); the Theme group of the account menu offers System too.
- `src/app/error.tsx` and `src/app/global-error.tsx` show the same error page; `global-error` brings its own catalog through `src/i18n/fallback.ts` (a new catalog reader in the lint boundaries), since it replaces the root layout that provides it.
- The Next.js rule `no-html-link-for-pages` is off for tests: the primitives' tests render plain anchors on purpose, and `[workspace]/[project]` makes every two-segment path look like a page to it.
- A menu test was racy (Left pressed before focus reached the submenu); it now waits for the focus.
- Step 9, checked in the dev server by measuring (the Browser pane was hidden, so no screenshots): at 1680 px the sidebar is 208 px, the top bar 52 px from x 208, the theme switch 52 by 28, Help 36, the avatar 32, 12 px apart, the switcher 12 px from the top and the first item 16 px below it; `[` collapses to the 56 px rail and the top bar moves to x 56, with the cookie written; at 1100 px the rail is the default and the toggle expands it to 208 px over the page without moving the top bar, and a press outside closes it; at 390 px the sidebar is the drawer behind the menu button, with no horizontal scroll. The drawer's slide and a visual comparison in both themes need a visible browser: Task 16's screenshots cover them.
- After the review: the breadcrumb and the project switch look only at live destinations (`LIVE_NAVIGATION`), so the 404 page of a planned path names no destination; the drawer closes when the window reaches 1024 px, and the rail's overlay when it leaves 1024 to 1279 px; the toggle reads the current choice from `<html data-sidebar>` (another tab may have changed it) and carries `aria-keyshortcuts` and `aria-controls`; sections are 24 px apart, as in the preview; `useThemeChange` reports no theme until the page has hydrated, so the switch is not rendered in a state React would keep (the server does not know the theme); a theme chosen in the account menu is revealed from the account button once the menu has closed; the reveal reads `--ease-standard`.
- The workspace item of the breadcrumb shows from 1680 px only; below that the way to the workspace's project list is "All projects in {workspace}" at the foot of the project switcher, at every width. 11 section 4 puts the workspace in the Project menu below 1680 px; the switcher is a combobox of projects, so the link is its footer (review log).
- `global-error.tsx` has a title and the Geist variables; `LOCALE` and `TIME_ZONE` are in `src/i18n/locale.ts`, shared by the request config and the fallback catalog.
- Not changed: the skip link targets `main` (the page `h1` differs per page and is inside it); redirects and 404s of the project segment stream inside `loading.tsx`'s boundary in development (Task 16 checks the statuses on the production build).
- Tests added after the review: `ProjectRoot` (member, unknown slug, another workspace, a project outside `project_ids`, an ended session back to the page asked for), `firstDestination`, `RouteError` (request id, digest, none), the drawer below 1024 px, `?`, the theme switch's name and state, and `useShortcut` behind a real `Dialog`.

### Task 14: Workspace page

**Files:** create `src/app/[workspace]/page.tsx`, `src/features/projects/*`.

- [ ] **Step 1:** The workspace root lists the projects the member can open (name, domain, a link to each) under a `PageHeader`, with the documented empty state when there are none ("No projects yet", with who can create one when the viewer cannot). It uses the top bar without the sidebar. Project creation belongs to the onboarding plan; the button is absent, not disabled.
- [ ] **Step 2:** Tests: restricted membership sees only its projects; empty state for both roles; axe.
- [ ] **Step 3: Opus review, fixes, gates, commit** "Add the workspace project list".

### Task 15: Account settings

**Files:** create `src/components/app/shell/settings-nav.tsx`, `src/app/[workspace]/[project]/settings/layout.tsx`, `profile/page.tsx`, `security/page.tsx`, `preferences/page.tsx`, `src/features/account/*`.

Spec: 11 section 5 (the table of the three sections), 24 sections 6 and 9.13, 10 section 13, and the preview's `#/settings/profile`, `#/settings/security`, `#/settings/preferences`.

- [ ] **Step 1: `SettingsNav`**: 200 px local navigation, a `Select` below 1024 px. Only "Your account" is listed in this plan.
- [ ] **Step 2: Profile.** Name through the `SaveBar` (`PATCH /me`), email read-only with the Verified badge (and "Send verification email" when not verified), the workspace table (workspace, role, project access). Leaving with unsaved changes opens `DiscardChangesDialog`.
- [ ] **Step 3: Security.** "Change password" dialog (`POST /auth/password/change`, new password at least 12 characters, confirm field, `wrong_password` and `weak_password` on their fields; it signs out other sessions and says so). Two-factor is deferred: the section shows its state only ("Off", or "On" for a user who enrolled through the API) with one sentence that setup arrives later; it has no controls. Sessions: `GET /auth/sessions` as a 32 px-row table with device, place and IP, last active, a "This device" badge, "Sign out" per row (`DELETE /auth/sessions/{id}`) and "Sign out other sessions". Every action that needs a fresh session goes through `withFreshSession`.
- [ ] **Step 4: Preferences.** Theme (segmented control: System, Light, Dark), default table density, number and date format with a live example from `@/lib/format`, "Reduce motion" and "Single-key shortcuts" switches. Each control saves at once (10 section 13.3) to `localStorage` keyed by user id, and a small `usePreference` hook reads them. No `SaveBar`.
- [ ] **Step 5: Tests:** each mutation's success and each problem; the discard guard; preferences survive a reload and are cleared on sign out; axe.
- [ ] **Step 6: Against the real API,** as in Task 11 step 5.
- [ ] **Step 7: Opus review, fixes, gates, commit** "Add account settings: profile, security and preferences".

---

# Part D. Delivery

### Task 16: End-to-end, accessibility, visual regression, image and CI

Ask the user before this task: it downloads a browser (about 170 MB) and the pinned Playwright Docker image (about 2 GB). Tell the backend session before touching `.github/` and `infra/`.

- [ ] **Step 1: Playwright** against `pnpm build && pnpm start` with `NEXT_PUBLIC_API_MOCKING=all` in a test build: sign in, the code prompt for an enrolled user, reset, the shell at three widths, account settings, sign out, a viewer sees no write action, an unknown workspace slug is a 404. `@axe-core/playwright` with the WCAG 2.2 AA tags on every visited page. One test asserts the CSP header on every route and that no violation is reported.
- [ ] **Step 2: Visual regression** (26 section 11): `toHaveScreenshot` over every `/design-system` section and the auth, shell and settings pages, light and dark, at 1440 x 900 and 390 x 844, in `mcr.microsoft.com/playwright:v1.63.0-noble`, with fonts awaited and the clock fixed.
- [ ] **Step 3: `apps/web/Dockerfile`**: dependencies, build, then a slim runtime with `.next/standalone`, `.next/static` and `public`, running `node apps/web/server.js` as a non-root user (20 section 9.1).
- [ ] **Step 4: CI** `.github/workflows/web.yml`: install with the frozen lockfile, `format:check`, lint, typecheck, `gen:api` followed by `git diff --exit-code` on `schema.d.ts`, unit and DOM tests, build, Playwright in the pinned image, image build. The Compose `web` service, the Caddy routes and `web.yml` belong to the backend session's deploy plan: ask it and build them together, so there is one shape.
- [ ] **Step 5: Opus review, fixes, gates, commit.**

### Task 17: Documents and the final review

- [ ] 26: mark the Phase 1 rows of section 9 as implemented; section 10: the route exists and which sections it has; the `cn` note.
- [ ] 20: section 9.2 (`API_INTERNAL_ORIGIN`, `API_PROXY_TARGET`, `NEXT_PUBLIC_API_MOCKING`), section 3.2 (the auth routes as built, tokens in the fragment), a note that `/me` has no `features` list and no operator flag yet.
- [ ] 24 section 9.1: the shell wireframe still shows a Topics item and says 15 items; correct it to 14.
- [ ] `DESIGN_SYSTEM.md` and `AI_DEVELOPMENT_UI_RULES.md`: commands and paths for the real app.
- [ ] `docs/design-system/review-log.md`: what was built, what was deferred, every open point below.
- [ ] A whole-branch Opus review (cross-task issues: boundaries, duplicated helpers, strings outside the catalog, unused packages), fixes, gates.
- [ ] Tell the user the branch is ready to merge; merge only on their word.

---

## Open points to settle during the work

| Point | Who | Needed by |
|---|---|---|
| Shape of the public route that describes an invitation token (workspace, role, email): `POST /invitations/preview` with `{ token }`, agreed; deferred on the backend, and `/invite` works without it | backend session | Task 11 (done) |
| `user.is_platform_operator` in `/me` (the name the backend will use); mocked under that name | backend session | Task 7, recorded in Task 17 |
| `/me` has no `features` list and the backend does not plan one; 20 section 3.10 is corrected in Task 17 and phase gating is the navigation registry | frontend | Task 17 |
| `GET /workspaces/{id}/projects` and project summary do not exist yet; served by the pending mock | backend session | Task 13 |
| Playwright browser and Docker image download | user | Task 16 |
| Compose `web` service, Caddy routes, `web.yml` | backend session | Task 16 |
| Re-authentication rotates the session and revokes the old one at once, so a request still carrying the old cookie gets 401 and signs the person out; a short grace period for the replaced session would close it | backend session | before settings screens are used widely (Task 15) |

## Contract updates from the backend session (2026-09-30)

`main` has the auth API since 25e99f0. Its next plan, `backend/workspaces`, is in progress. These change the tasks below when they are reached:

| Change | Affects |
|---|---|
| Accepting an invitation is `POST /api/v1/invitations/accept` with `{ token }`, called after the invited person registered (with `invitation_token`, which verifies the email) and signed in. Errors: 400 `invalid_token`, 410 `invitation_expired`, 403 `email_not_verified`. The public route that describes an invitation before sign-up is deferred, so `/invite` shows the form without the workspace name | Task 11 |
| `/me` gains `user.is_platform_operator`. Only an operator may create a workspace while registration is by invitation | Tasks 7 and 14 |
| `GET` and `POST {W}/projects`, `GET` and `PATCH {P}`: a project has `name`, `slug`, `timezone`, `deep_check_weekday`, `default_language_code`; `primary_domain` and `default_location_id` are null until the keyword system. Slugs are 3 to 40 characters, lower-case letters, digits and hyphens, and the reserved words are enums in the OpenAPI document | Tasks 9, 13 and 14 (the pending mock uses this shape) |
| Two-factor is opt-in: no route answers `two_factor_enrollment_required` for now, and sign-in asks for a code only from a user who enrolled | Confirmed by the product owner: `/two-factor/setup`, the redirect of Task 12 step 5 and the two-factor controls of Security are removed from this plan. `/two-factor` (entering a code at sign-in) stays |
| Invitation resend, cancel and decline, `GET /roles`, change of email, workspace and project delete are deferred on the backend | none in this plan |

Later messages, from the final review of `backend/workspaces` (tip e11af45, not merged yet; the backend session says when `main` has it):

| Change | Affects |
|---|---|
| Accept answers `{ data: { workspace: { workspace_id, name, slug }, member } }`, so the page routes to `/{slug}` at once; accepting again returns the same. One more error: 403 `workspace_suspended`. 400 `invalid_token` is one answer for unknown, withdrawn, sent to another address, or void | Task 11 |
| Inviting an `owner` or `admin`, changing a member's role and removing a member need a fresh session (403 `fresh_session_required` with `reauth_url`). Invitation limits per hour: 20 per inviter, 50 per workspace, 3 per address (429 with `Retry-After`) | Task 12 (`withFreshSession`); member screens in a later plan |
| `Member.two_factor_enabled` and `Member.last_active_at` are null unless the caller holds `members:manage` or the row is the caller's own. `Member.project_ids`: null is every project, `[]` is none | Task 12 (permission context) |
| Generate the client with `--enum-values`: `ReservedWorkspaceSlug` and `ReservedProjectSlug` are then runtime lists a form can check a slug against. `design-system` and `projects` are reserved. A slug cannot be shaped like a uuid | Tasks 8 and 14 |
| Time zones: send what `Intl.DateTimeFormat().resolvedOptions().timeZone` gives and show what the API returns (a legacy name comes back under its current name). Unknown zone: 422 with field code `timezone_unknown` | Task 14 |
| `POST {W}/projects` needs `projects:write` and a membership not limited to some projects. The limit counts active and paused projects: 422 `quota_exceeded` with `limit`, `used`, `requested`. `PATCH {P}` always returns `meta.warnings` (`timezone_change_applies_forward`). `GET {W}/projects` takes `filter[status_in]` (default `active,paused`), `offset`, `limit` | Tasks 9, 13 and 14 |
| Every route refuses a query parameter it does not declare (422, `extra_forbidden`): the client sends none of its own | Task 8 |
| 409 `conflict` is safe to retry once. 403 `workspace_suspended` answers any write in a suspended workspace. A field that cannot be null and is sent null is a 422 on that field | Task 8 (`shouldRetry`, `ApiProblem`) |
| In `WorkspaceUpdate`, `MemberUpdate` and `ProjectUpdate` the fields that refuse null are plain optional; only `logo`, `project_ids` and `default_language_code` take null. In `Problem`, `detail` and `errors` are optional and never null | Tasks 5 and 8 |
| Error codes are not enumerated in the OpenAPI document: `Problem.code` is a string and `limit`, `used`, `requested`, `reauth_url`, `retry_after_seconds` are untyped. 19 section 2.7 is the list; `ApiProblem` types them by hand. Field codes to match on: `extra_forbidden`, `null_not_allowed`, `slug_reserved`, `slug_is_id`, `timezone_unknown`, `project_unknown`, `scope_not_allowed` | Tasks 5 and 8 |
| `POST /api/v1/workspaces` is 403 for anyone but an operator while registration is by invitation, and limited to 5 per user per day. `/me` still lists a membership whose workspace has `status: 'deleting'` (all its routes are 404) | Tasks 12 and 13 (skip such a workspace in the switcher) |

`main` has these routes since 4201599 (the backend session's message of 2026-09-30). Merge `main` into this branch at the start of Task 8, after the user agrees, and generate the client from `backend/openapi/v1.json` with `--enum-values`. Changes since the table above: `ProfileUpdate.name` is optional and not nullable, like the other update models; the three invitation allowances are counted together, so a refused invitation costs none. Local sign-in steps are in `backend/README.md` under "Signing in locally". Open on the backend side: whether every member sees every member's email.

## Self-review

- **Coverage of 20 section 10, Phase 1:** auth routes (Task 11), app shell with the generated client (Tasks 8 and 13), workspace and project layouts (Tasks 12 and 13), permission context (Task 12), error and loading system (Task 13), CSP and headers (Task 10), standalone image and CI (Task 16). Deferred and named in Scope: the flag context (no API field yet), workspace, member and project settings, onboarding, `size-limit`.
- **Coverage of 26 section 9, Phase 1 rows:** every lint row is in Task 2 step 1; class ordering in Task 2 step 3; the copy test in Task 3 step 3; accessibility and visual regression in Task 16.
- **Names used across tasks:** `cn` (Task 3), `ApiProblem`, `problemFrom`, `isApiProblem`, `unwrap`, `apiQuery`, `apiMutation`, `queryKey`, `serverApi` (Task 8), `applyServerErrors` (Task 5), `safeNextPath`, `buildCsp` (Task 10), `useFragmentParam` (Task 11), `can`, `useCan`, `Can`, `PermissionProvider`, `withFreshSession` (Task 12), `visibleNavigation` (Task 13), `usePreference` (Task 15). Each is defined before its first use except `applyServerErrors`, which Task 5 defines against the `ValidationItem` shape and Task 8 then types with the generated schema: in Task 5 declare the item type locally from 19, and in Task 8 replace it with the generated type.
- **No placeholders:** destinations that are not built are absent from the navigation, not stubbed; controls whose feature is a later plan are not rendered.
