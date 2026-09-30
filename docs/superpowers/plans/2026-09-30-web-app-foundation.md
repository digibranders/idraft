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
- Every task ends the same way: run the gates (`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` in `apps/web`, plus `pnpm run preview` while the static preview still exists), dispatch an independent senior review on the Fable model with the task's diff range and the spec sections it must satisfy, fix what it finds, run the gates again, commit. A task is not done while a gate is red.
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
| C. Auth, shell and account (Tasks 11 to 15) | Sign in, second factor, password reset, email verification and sign-up work against the real API. Signed-in users get the shell and can manage their profile, security and preferences |
| D. Delivery (Tasks 16 and 17) | End-to-end tests, accessibility and visual regression in CI, the `web` image, the documents brought up to date |

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
| `uqr` | runtime | QR matrix for the authenticator setup screen, drawn as SVG rects |
| `@tailwindcss/postcss` 4.3, `postcss` | dev | Tailwind in the Next build |
| `@types/react`, `@types/react-dom` | dev | Types |
| `shadcn` 4.21 | dev | CLI for `shadcn add`, and `shadcn/tailwind.css` (Base UI data-attribute variants) |
| `openapi-typescript` | dev | Generates `schema.d.ts` |
| `msw` 2 | dev | Mock layer for tests and for endpoints not built yet |
| `@vitejs/plugin-react`, `jsdom`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `vitest-axe` | dev | Component tests |
| `@next/eslint-plugin-next`, `eslint-plugin-react`, `eslint-plugin-react-hooks`, `eslint-plugin-jsx-a11y`, `eslint-plugin-better-tailwindcss` 4.7, `eslint-plugin-boundaries`, `eslint-plugin-i18next`, `globals` | dev | Lint rules of 26 section 9 |
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
    env.ts                  zod schema for the environment, parsed once
    proxy.ts                session presence redirect and the CSP nonce (Task 10)
    instrumentation.ts      starts the MSW server in the Node runtime when mocking is on (Task 9)
    i18n/request.ts         next-intl request config, single `en` locale
    app/
      layout.tsx            html, fonts, providers
      page.tsx              redirect: first workspace, else /login
      not-found.tsx, error.tsx, global-error.tsx
      (auth)/layout.tsx     centered auth layout
      (auth)/login, two-factor, two-factor/setup, reset-password, verify-email, invite
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

- [x] **Step 9: Fable review, fixes, gates, commit** "Scaffold the Next.js app in apps/web".

### Task 2: Lint, format and test tooling for JSX

**Files:** modify `eslint.config.mjs`, `vitest.config.ts`; create `prettier.config.mjs`, `.prettierignore`, `vitest.setup.ts`, `src/test/render.tsx`.

- [ ] **Step 1: ESLint.** Extend the flat config, keeping every existing rule:
  - `@next/eslint-plugin-next` core-web-vitals rules; `eslint-plugin-react` flat recommended plus `jsx-runtime`, with `react/no-danger: error` and `settings.react.version: '19.3.0'` (never `'detect'`: that path calls `context.getFilename`, which ESLint 10 removed, and crashes the run); `eslint-plugin-react-hooks` recommended; `eslint-plugin-jsx-a11y` strict.
  - `eslint-plugin-better-tailwindcss` with `settings['better-tailwindcss'].entryPoint = 'src/styles/globals.css'`: `no-unknown-classes`, `no-conflicting-classes`, `no-duplicate-classes` as errors; `enforce-consistent-class-order` off (Prettier sorts); `no-restricted-classes` with the four patterns of 26 section 9 (arbitrary values outside `src/components/ui/**`, spacing steps off the scale, raw `z-` numbers).
  - `eslint-plugin-boundaries` with the element types `ui`, `app-component`, `feature`, `route`, `lib`, `design-system`, `mocks` and the import rules of 26 section 2 (rules 1 to 4).
  - `eslint-plugin-i18next` `no-literal-string` in `markupOnly` mode for `src/**/*.tsx`, off in `src/components/design-system/**` and tests.
  - Add `@radix-ui/*`, `cmdk`, `sonner`, `echarts-for-react` and `react-markdown` (outside the future `SafeMarkdown`) to the restricted imports.
  - Ignore `.next/**`, `next-env.d.ts`, `public/mockServiceWorker.js`, `src/lib/api/schema.d.ts`.
- [ ] **Step 2: Prove the rules bite.** In a scratch file `src/lint-probe.tsx`, write one violation per rule (a hex color, `bg-blue-500`, `p-[13px]` outside `components/ui`, `gap-7`, `z-50`, a literal string in JSX, `dangerouslySetInnerHTML`, an import of a feature from `components/ui`) and confirm `pnpm lint` reports each one. Delete the file.
- [ ] **Step 3: Prettier.** `prettier.config.mjs`: `singleQuote: true`, `printWidth: 120`, `plugins: ['prettier-plugin-tailwindcss']`, `tailwindStylesheet: './src/styles/globals.css'`, `tailwindFunctions: ['cn', 'cva']`. `.prettierignore`: `.next`, `design-preview`, `pnpm-lock.yaml`, `src/lib/api/schema.d.ts`, `public`. Add the scripts `"format": "prettier --write ."` and `"format:check": "prettier --check ."`. Run `pnpm format` and commit the result as its own commit ("Format the web sources with Prettier") so later diffs stay readable.
- [ ] **Step 4: Vitest.** Two projects in `vitest.config.ts`: `unit` (`src/**/*.test.ts`, environment `node`, as today) and `dom` (`src/**/*.test.tsx`, environment `jsdom`, `@vitejs/plugin-react`, `setupFiles: ['./vitest.setup.ts']`). `vitest.setup.ts` registers `@testing-library/jest-dom/vitest` and the `vitest-axe` matcher, and calls `cleanup` after each test.
- [ ] **Step 5: `src/test/render.tsx`.** `renderWithProviders(ui, options)` wraps in the providers of Task 3 (added there; start with a passthrough) and returns Testing Library's result plus a `user` from `@testing-library/user-event`.
- [ ] **Step 6: A first DOM test** (`src/app/not-found.test.tsx`): the not-found page renders one `h1` and has no axe violations.
- [ ] **Step 7: Fable review, fixes, gates, commit** "Add JSX lint rules, Prettier and the DOM test project".

### Task 3: Environment, class helper, messages, providers

**Files:** create `src/env.ts`, `src/lib/utils.ts`, `src/lib/utils.test.ts`, `messages/en.json`, `src/i18n/request.ts`, `src/messages.test.ts`, `src/providers/app-providers.tsx`, `src/lib/a11y/announce.ts`, `src/lib/a11y/announce.test.ts`; modify `next.config.ts`, `src/app/layout.tsx`, `src/test/render.tsx`.

- [ ] **Step 1: `src/env.ts`.** One zod schema, parsed at import:

| Variable | Rule |
|---|---|
| `NEXT_PUBLIC_APP_ENV` | `production`, `development` or `test`; default `development` |
| `NEXT_PUBLIC_API_MOCKING` | `off`, `pending` or `all`; default `off`; must be `off` when the app environment is `production` |
| `NEXT_PUBLIC_RELEASE` | string, default `dev` |
| `API_INTERNAL_ORIGIN` | URL origin of the API for server components (`http://api:8000` in Compose, `http://127.0.0.1:8000` locally); server only |
| `API_PROXY_TARGET` | optional URL; development only. When set, `/api/*` is rewritten to it (Task 9) |

The generated paths already start with `/api/v1`, so the server client needs the API's origin, not a base URL ending in `/api/v1`. Record this rename of `API_INTERNAL_BASE_URL` in 20 section 9.2 in Task 17. Tests: a missing server variable throws with the variable's name; mocking on in production throws.

- [ ] **Step 2: `cn`.** `src/lib/utils.ts` exports `cn(...inputs)` built with `extendTailwindMerge` so the design system's custom names merge correctly: the 15 `type-*` utilities form one conflict group; the named sizes (`control`, `control-sm`, `control-lg`, `row`, `row-compact`, `row-header`, `topbar`, `sidebar`, `sidebar-collapsed`, `sidebar-item`, `tab`, `metric-strip`, `badge`, `avatar`, `save-bar`, `inspector`, `inspector-wide`, `drawer`, `command`, `icon-xs` to `icon-lg`) are added to the spacing theme. Tests: `cn('type-body', 'type-table')` is `type-table`; `cn('h-control', 'h-control-sm')` is `h-control-sm`; `cn('px-3', 'px-4')` is `px-4`; `cn('text-foreground', 'type-body')` keeps both; falsy inputs are dropped.
- [ ] **Step 3: Messages.** `messages/en.json` starts with the namespaces `common` (Cancel, Save, Close, Retry, Loading) and `errors` (not found, generic). `src/i18n/request.ts` returns locale `en` and the catalog. Wrap the Next config with `createNextIntlPlugin('./src/i18n/request.ts')`. `src/messages.test.ts` walks every string in the catalog and fails on U+2013, U+2014, a trailing exclamation mark, or an empty value.
- [ ] **Step 4: Providers.** `AppProviders` (client component) composes, outside in: `NextIntlClientProvider` (messages passed from the root layout), `ThemeProvider` from `next-themes` (`attribute="class"`, `defaultTheme="system"`, `enableSystem`, `disableTransitionOnChange`), `QueryClientProvider` (one client per browser, `staleTime` 30 s by default, `retry` only for network errors and 5xx, never for an `ApiProblem` below 500), `NuqsAdapter`, and the Base UI `Toast.Provider` (its viewport arrives with the toast primitive in Task 6). The root layout renders `<AppProviders>` around `children`.
- [ ] **Step 5: `announce`.** `announce(message, politeness)` writes to one of two visually hidden live regions that `AppProviders` mounts once. Test: two calls with the same text are both announced (the region is cleared between them).
- [ ] **Step 6: Fable review, fixes, gates, commit** "Add the environment schema, cn, the message catalog and the providers".

### Task 4: Primitives, batch 1: static and display

Every primitive in Tasks 4 to 6 follows the same steps. They are written once here.

1. Read its section in 25 (props, variants, states, accessibility) and the section of the owning document. Find the same element in `design-preview/index.html` for the exact classes.
2. Write the test file: every variant and size renders the documented classes; every state (disabled, loading, invalid, open) is reachable; keyboard behavior matches the APG pattern named in 25; `expect(await axe(container)).toHaveNoViolations()`.
3. Run `pnpm dlx shadcn@latest add <name>` where shadcn has the component (it writes to `src/components/ui` through `components.json`), then apply the eight-step import checklist of 26 section 4: `type-*` utilities, documented radius, token colors, size utilities, no arbitrary values where a token exists, the global focus ring, Base UI data attributes. Where shadcn has no equivalent, build on the Base UI primitive directly.
4. No `forwardRef` (React 19), `data-slot` on the root, `render` prop for composition, props spread last so callers can pass `aria-*` and `data-*`.
5. Add the component to its `/design-system` section file under `src/components/design-system/` with every variant and state (the route itself is Task 7).

**Create `components.json` first** (style `base-nova`, `rsc: true`, `tsx: true`, `tailwind.css: "src/styles/globals.css"`, `tailwind.cssVariables: true`, aliases `components: "@/components"`, `ui: "@/components/ui"`, `utils: "@/lib/utils"`, `iconLibrary: "lucide"`). Do not run `shadcn init`: it would overwrite `globals.css`. Add `@import "shadcn/tailwind.css";` to `globals.css` after the Tailwind import, then confirm the build output still contains no palette classes and that `pnpm run preview` output is unchanged except for the new variants.

| Component | File | Spec | Notes |
|---|---|---|---|
| `Icon` | `ui/icon.tsx` | 07, 25 | Wraps a Lucide component; sizes `xs` 12, `sm` 14, `md` 16 (default), `lg` 18, `xl` 20 through `size-icon-*`; stroke 1.75 non-scaling; `aria-hidden` unless `label` is given |
| `Button` | `ui/button.tsx` | 09 section 2 | Copy `buttonVariants` from 09 section 2.9 exactly: 7 variants, sizes `sm`, `md`, `lg`, `icon-xs`, `icon-sm`, `icon`. `loading` shows `Spinner`, keeps the width and sets `aria-busy`; a disabled button with a reason uses `aria-disabled` so the tooltip stays reachable |
| `IconButton` | `ui/icon-button.tsx` | 09 section 3 | Requires `label`; renders the tooltip with it |
| `Spinner` | `ui/spinner.tsx` | 21 section 8.2 | Static under reduced motion |
| `Kbd` | `ui/kbd.tsx` | 09 section 11 | `type-kbd` |
| `Separator` | `ui/separator.tsx` | 06 section 5 | |
| `Skeleton` | `ui/skeleton.tsx` | 17 section 3.1 | Pulses, never shimmers; static under reduced motion |
| `Avatar` | `ui/avatar.tsx` | 11 section 4 | Photo or initials on `neutral-subtle`; `size-avatar` |
| `Badge` | `ui/badge.tsx` | 14 section 1 | Tones and the outline look from the preview's neutral badge |
| `TextLink` | `ui/text-link.tsx` | 20 section 19 | `next/link` for internal targets |
| `Truncate` | `ui/truncate.tsx` | 20 section 13.4 | Tooltip with the full text only when truncated |
| `ScrollArea` | `ui/scroll-area.tsx` | 16 section 5.1 | |

- [ ] Steps 1 to 5 for each row, in table order (`Icon`, `Spinner` and `Tooltip`'s trigger contract come first because `Button` and `IconButton` use them; stub nothing: build `Tooltip` from Task 6 early if `IconButton` needs it).
- [ ] Fable review, fixes, gates, commit "Add the display primitives".

### Task 5: Primitives, batch 2: forms

| Component | File | Spec | Notes |
|---|---|---|---|
| `Field`, `FieldLabel`, `FieldHelp`, `FieldError` | `ui/field.tsx` | 10 sections 2 and 18 | Label above, error replaces helper text, `aria-describedby` wiring, optional marker |
| `Input` | `ui/input.tsx` | 10 section 4 | Sizes `sm`, `md`, `lg` (`lg` only in auth and onboarding) |
| `InputGroup` | `ui/input-group.tsx` | 10 section 4 | Leading and trailing addons |
| `PasswordInput` | `ui/secret-input.tsx` | 10 section 14, 20 section 11 | Show and hide button named by state; allows paste; `autocomplete` passed by the caller |
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
| `applyServerErrors` | `lib/forms/apply-server-errors.ts` | 10 section 23 | Maps `ApiProblem.errors[]` (`location`, `path`, `message`) onto form fields; returns the items that matched no field so the form can show them in `FormAlert` |

- [ ] Steps 1 to 5 for each row. `applyServerErrors` tests: a body path `email` sets the `email` field error; a nested path `profile.name` sets `profile.name`; an item for an unknown path is returned, not dropped; `location` other than `body` is returned.
- [ ] Fable review, fixes, gates, commit "Add the form primitives".

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

- [ ] Steps 1 to 5 for each row. Overlay tests cover: Escape closes and returns focus; the trigger carries `aria-expanded` and `aria-controls`; a modal dialog traps focus and a popover does not; the toast region is a polite live region and an error toast an assertive one.
- [ ] Fable review, fixes, gates, commit "Add the overlay and feedback primitives".

### Task 7: The `/design-system` route

**Files:** create `src/app/(internal)/design-system/layout.tsx`, `src/app/(internal)/design-system/page.tsx`, `src/app/(internal)/design-system/[section]/page.tsx`, `src/components/design-system/registry.ts` and one section file per group.

- [ ] **Step 1:** `registry.ts` lists the sections: `tokens` (swatches with contrast read live), `typography` (the 15 utilities), `sizes`, `icons`, `buttons`, `forms`, `badges`, `overlays`, `feedback`. `generateStaticParams` returns them; an unknown section is a 404.
- [ ] **Step 2:** The layout renders a plain section list and, for each section, the same content twice, side by side, in a `light` and a `dark` container (the `dark` class on a wrapper, since the variant is `:where(.dark, .dark *)`).
- [ ] **Step 3:** The route calls `notFound()` when `NEXT_PUBLIC_APP_ENV` is `production`. Access for platform operators waits for an operator flag in `/me`; record that in Task 17.
- [ ] **Step 4:** Test: every registered section renders without axe violations in both themes (jsdom cannot judge contrast; the token contrast tests already do).
- [ ] **Step 5:** Compare each section against the static preview in the browser, both themes, at 1440 and 390 px. Fix every difference in size, color, radius, focus ring and spacing.
- [ ] **Step 6: Fable review, fixes, gates, commit** "Add the design-system preview route".

---

# Part B. API and security

**Precondition.** `backend/openapi/v1.json` must contain the auth routes. They are on branch `backend/auth`. When this part starts, ask the user whether `backend/auth` is merged into `main`; if it is, merge `main` into `frontend/app-foundation` (a normal merge; tell the backend session first). If it is not merged yet, generate from the worktree copy with `pnpm exec openapi-typescript ../../.claude/worktrees/backend-auth/backend/openapi/v1.json -o src/lib/api/schema.d.ts` and regenerate from the committed document after the merge.

### Task 8: The typed API client

**Files:** create `src/lib/api/schema.d.ts` (generated), `types.ts`, `problem.ts`, `client.ts`, `server.ts`, `keys.ts`, `query.ts` and their tests.

- [ ] **Step 1: Generate.** `pnpm gen:api`. Commit `schema.d.ts`. `types.ts` re-exports the component schemas the app names (`Me`, `MeMembership`, `Role`, `Problem`, `ValidationItem`, `SessionItem`).
- [ ] **Step 2: `problem.ts`.**

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

- [ ] **Step 3: Clients.** `client.ts`: `createClient<paths>({ baseUrl: '' , credentials: 'same-origin' })` for the browser. `server.ts` (`import 'server-only'`): `serverApi()` builds a client on `env.API_INTERNAL_ORIGIN` that forwards only the incoming `cookie` and `x-request-id` headers and sets `cache: 'no-store'`. Both go through one `unwrap` helper that returns `data` or throws `problemFrom(...)`. Test with MSW: the server client forwards the cookie and the request id and nothing else (an incoming `authorization` header is not forwarded).
- [ ] **Step 4: Keys.** `keys.ts`: `queryKey(scope, resource, filters)` returns `['ws', workspaceId, 'p', projectId, domain, resource, normalized]` (20 section 3.5). `normalizeFilters` sorts keys, drops `undefined`, `null`, empty arrays and values equal to a given default. Tests: two filter objects that differ only in key order produce the same key; a default value is dropped.
- [ ] **Step 5: `query.ts`.** `apiQuery(path, init)` returns TanStack `queryOptions` for a GET path with typed params, the derived key and `unwrap`. `apiMutation(method, path)` returns `mutationOptions` whose variables are the typed params and body. Tests (type level with `expectTypeOf`, runtime with MSW): a wrong path or a missing path param is a type error; a problem response rejects with an `ApiProblem` carrying its `code`.
- [ ] **Step 6: Global error policy** in the query client of Task 3: a `401` with code `unauthenticated` or `session_expired` clears the cache and hard-navigates to `/login?next=<current path>`; a `429` waits `retryAfterSeconds` before one retry; an `ApiProblem` below 500 is never retried. Test each with MSW.
- [ ] **Step 7: Fable review, fixes, gates, commit** "Add the generated API client and the query helpers".

### Task 9: The mock layer

**Files:** create `src/mocks/factories/*.ts`, `src/mocks/handlers/auth.ts`, `me.ts`, `projects.ts`, `src/mocks/handlers/index.ts`, `src/mocks/browser.ts`, `src/mocks/node.ts`, `src/lib/api/pending.ts`, `src/lib/api/pending.test.ts`, `src/instrumentation.ts`, `src/providers/mock-gate.tsx`, `public/mockServiceWorker.js` (`pnpm exec msw init public --save`); modify `next.config.ts`, `vitest.setup.ts`.

- [ ] **Step 1: Factories.** `userFactory`, `workspaceFactory`, `membershipFactory(role)`, `meFactory(overrides)`, `projectFactory`. The development fixtures are the workspace Digibranders with the projects `fynix.digital`, `cleanstart.com`, `eventussecurity.com`, `oyechats.com` and `firstfold.io`, and one user per role.
- [ ] **Step 2: Handlers** typed against the generated `paths` (`http.post<never, components['schemas']['SignInRequest']>(...)`), so a contract change breaks the mocks at compile time. The auth handlers keep a small in-memory session state: sign-in with the fixture password returns `signed_in` or `totp_required`; a wrong password returns the `invalid_credentials` problem; five failures return `rate_limited` with `Retry-After`.
- [ ] **Step 3: Pending endpoints.** `pending.ts` holds hand-written types, copied from 19, for endpoints the backend has not built (first: `GET /api/v1/workspaces/{workspace_id}/projects`). `pending.test.ts` fails when a pending path appears in the generated `paths`, which is the signal to delete the hand-written type and its `pending` handler.
- [ ] **Step 4: Modes.** `NEXT_PUBLIC_API_MOCKING`: `off` starts nothing. `pending` starts MSW with only the pending handlers and `onUnhandledRequest: 'bypass'`. `all` starts every handler and `onUnhandledRequest: 'error'` for `/api/` URLs. In the browser, `MockGate` (rendered by `AppProviders` only when mocking is not `off`) starts the worker before children render. On the server, `instrumentation.ts` `register()` starts `msw/node` when `NEXT_RUNTIME === 'nodejs'`. Neither import exists in a production bundle: both are behind `process.env.NEXT_PUBLIC_API_MOCKING !== 'off'` checks that the compiler removes; verify by searching the production build output for `msw`.
- [ ] **Step 5: Development rewrite.** In `next.config.ts`, when `API_PROXY_TARGET` is set and the environment is not production, `rewrites()` sends `/api/:path*` to it. The browser still talks to `http://localhost:3000`, so the `Origin` header matches the API's `APP_ORIGIN` and the `__Host-session` cookie is stored for the app's origin (Chrome and Firefox accept a `Secure` cookie on `http://localhost`; Safari does not).
- [ ] **Step 6: Document the three ways to run** in `apps/web/README.md`: `all` mocks (no backend), `pending` with the real API through the rewrite, and the production shape behind Caddy.
- [ ] **Step 7: Vitest** starts the node server from `vitest.setup.ts` with `onUnhandledRequest: 'error'` and resets handlers after each test.
- [ ] **Step 8: Fable review, fixes, gates, commit** "Add the MSW mock layer and the development API rewrite".

### Task 10: Request proxy, CSP and headers

**Files:** create `src/lib/security/csp.ts`, `csp.test.ts`, `src/lib/security/next-path.ts`, `next-path.test.ts`, `src/proxy.ts`, `src/proxy.test.ts`; modify `next.config.ts`, `src/app/layout.tsx`, `src/providers/app-providers.tsx`.

- [ ] **Step 1: `buildCsp({ nonce, development })`**, a pure function returning the policy of 20 section 7.3. Development adds `'unsafe-eval'` to `script-src` and `ws:` to `connect-src`; production never does. Tests assert each directive, that the nonce appears in `script-src` and `style-src`, and that the production policy contains neither `unsafe-eval` nor `unsafe-inline`.
- [ ] **Step 2: `safeNextPath(value)`** returns the value only when it is a same-origin path: starts with one `/`, not `//`, not `/\`, no scheme, no control characters, and not an `/api/` path. Anything else returns `/`. Tests: `/acme/crm?x=1` passes; `//evil.example`, `https://evil.example`, `/\evil`, `javascript:alert(1)`, `/api/v1/me` and an empty value all return `/`.
- [ ] **Step 3: `proxy.ts`.** For every request except `/_next/*`, static files and `/api/*`: generate a nonce, set `Content-Security-Policy` on the response and pass the nonce to the render through the `x-nonce` request header. If the path is not public (`/login`, `/two-factor`, `/reset-password`, `/verify-email`, `/invite`, and `/design-system` outside production) and the `__Host-session` cookie is absent, redirect to `/login?next=<path and query>`. The proxy never validates the session; the API does. Tests call the exported handler with constructed requests: an anonymous request to `/acme` redirects with the encoded `next`; a request with the cookie passes and carries a CSP header whose nonce matches `x-nonce`; `/login` without a cookie passes.
- [ ] **Step 4: Nonce consumers.** The root layout reads `x-nonce` from `headers()` and passes it to `ThemeProvider` (`nonce` prop, for its inline script).
- [ ] **Step 5: Static headers** in `next.config.ts` `headers()` for all routes: the six headers of 20 section 7.3. Authenticated HTML is `Cache-Control: private, no-store` (set in the proxy for non-public paths).
- [ ] **Step 6: Verify in the browser:** `pnpm build && pnpm start`, open `/login`, confirm no CSP violation in the console, the theme script runs, and the response carries every header.
- [ ] **Step 7: Fable review, fixes, gates, commit** "Add the request proxy with the session check, CSP nonce and security headers".

---

# Part C. Auth, shell and account

### Task 11: Auth screens

The design system has no auth template yet. Rule: specify, then build.

**Files:** modify `docs/design-system/24-page-templates.md` (new section "T7 Auth"), `25-component-inventory.md` (`AuthCard`), `review-log.md`; create `src/app/(auth)/layout.tsx`, the six route folders, `src/features/auth/*`, `src/components/app/shell/auth-card.tsx`; extend `messages/en.json` (`auth` namespace) and the MSW auth handlers.

- [ ] **Step 1: Specify T7.** One centered column, 400 px wide, on `background`; the product name above a `surface` panel with a 1 px `border` and `rounded-lg`, 32 px padding; `type-page-title` heading, one `type-body` sentence in `foreground-secondary`; controls at `h-control-lg`; one primary button, full width; secondary links as `TextLink` below the panel. No illustration, no marketing copy, no second column. Below 480 px the panel loses its border and fills the width. Write the section and the `AuthCard` entry; log it in `review-log.md`.
- [ ] **Step 2: Flows.** Each screen is a route with a Server Component page that renders one client form from `features/auth`. Forms use react-hook-form with a zod schema, `apiMutation`, `applyServerErrors`, and a `FormAlert` for problems that belong to no field.

| Route | Calls | Success | Problems shown |
|---|---|---|---|
| `/login` | `POST /auth/sign-in` | `signed_in`: go to `safeNextPath(next)`. `totp_required`: go to `/two-factor` keeping `next` | `invalid_credentials` (one message for wrong email or password), `rate_limited` (with the wait in minutes), `validation_failed` |
| `/two-factor` | `POST /auth/totp/verify` with `code`, or with `recovery_code` after "Use a recovery code" | go to `safeNextPath(next)` | `invalid_code`, `rate_limited`, `session_expired` (back to `/login`) |
| `/two-factor/setup` | `POST /auth/totp/setup`, then `POST /auth/totp/setup/confirm` | show the recovery codes once with Copy and a "I saved these codes" checkbox, then continue | `invalid_code`, `totp_already_enabled` (continue) |
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

- [ ] **Step 3: Rules.** Password fields: `autocomplete="current-password"` or `"new-password"`, paste allowed, minimum 12 characters checked on blur for new passwords. Email: `autocomplete="email"`, `type="email"`. The submit button shows `loading` and the form is not submittable twice. Validation timing follows 10 section 18. A failed submit moves focus to the `FormAlert` or the first invalid field and announces the error.
- [ ] **Step 4: Tests** (one file per form, MSW in `all` mode): the happy path; every problem in the table renders its message and keeps the typed values; `next=//evil.example` lands on `/`; a second-factor code pasted as `123 456` is accepted as `123456`; the recovery codes screen cannot continue until the checkbox is ticked; no axe violations.
- [ ] **Step 5: Against the real API.** Start the backend (its README, "Run locally"), create an operator with its CLI, run the app with `NEXT_PUBLIC_API_MOCKING=off` and `API_PROXY_TARGET=http://127.0.0.1:8000`, and walk every row of the table in Chrome: sign in, wrong password, throttle, second factor setup and verify, reset (the link is printed on the API's stderr), sign out. Record what differs from the mocks and fix the mocks.
- [ ] **Step 6: Fable review, fixes, gates, commit** "Add the auth screens".

### Task 12: Identity, permissions and the fresh-session dialog

**Files:** create `src/lib/permissions/*`, `src/app/[workspace]/layout.tsx`, `src/features/session/*` (sign out, `useMe`), `src/components/app/shell/reauth-dialog.tsx`; modify `src/app/page.tsx`.

- [ ] **Step 1: `/` redirect.** `src/app/page.tsx` (Server Component) calls `/me` through `serverApi()`. `401`: redirect to `/login`. No membership: render the documented empty state ("You are not a member of any workspace"). Otherwise redirect to `/<first workspace slug>`.
- [ ] **Step 2: Workspace layout.** `[workspace]/layout.tsx` fetches `/me`, finds the membership whose `workspace.slug` matches the segment (`notFound()` when there is none, so another tenant's slug never confirms it exists), and renders `PermissionProvider` with the membership's `permissions`, `role` and `project_ids`. It seeds the client query cache for `/me` through `HydrationBoundary`, so client components read the same data without a second request.
- [ ] **Step 3: `can`.** `can(permissions, permission)`, `useCan(permission)`, `<Can permission fallback>`. The client never decides access; it only hides or disables what will fail (20 section 3.9). Tests: each role fixture against a table of permissions.
- [ ] **Step 4: `ReauthDialog`** (16 section 4.4, 25): a 400 px dialog "Confirm it is you" with a password field, or a code field when the user has a second factor, calling `POST /me/reauthenticate` with `{ password }`, or with `{ totp_code }` when the user has a second factor (the API refuses a password alone with `403 second_factor_required`). `withFreshSession(mutationFn)` catches `403 fresh_session_required`, opens the dialog, and on success retries the original call once. Tests: the retry happens once; cancelling rejects with the original problem; a second `fresh_session_required` after the retry is surfaced, not looped.
- [ ] **Step 5: `403 two_factor_required_for_role`** anywhere redirects to `/two-factor/setup?next=<path>`.
- [ ] **Step 6: Sign out.** Calls `POST /auth/sign-out`, clears the query cache, removes the user's preference keys from `localStorage`, hard-navigates to `/login`.
- [ ] **Step 7: Fable review, fixes, gates, commit** "Add the workspace layout, permissions and re-authentication".

### Task 13: The application shell

**Files:** create `src/lib/navigation/registry.ts`, `registry.test.ts`, `src/components/app/shell/sidebar.tsx`, `top-bar.tsx`, `breadcrumb.tsx`, `project-switcher.tsx`, `theme-switch.tsx`, `help-menu.tsx`, `user-menu.tsx`, `page-header.tsx`, `skip-link.tsx`, `src/components/app/status/empty-state.tsx`, `inline-error.tsx`, `error-page.tsx`, `src/app/[workspace]/[project]/layout.tsx`, `error.tsx`, `loading.tsx`, `src/app/not-found.tsx`, `src/app/error.tsx`, `src/app/global-error.tsx`.

- [ ] **Step 1: Navigation registry.** The 14 destinations of 11 section 1.1 with `key`, `labelKey`, `href(workspace, project)`, `icon`, `group`, `permission` and `status: 'live' | 'planned'`. In this plan only `settings` is live. `visibleNavigation(registry, permissions)` drops planned items and items the role can never use, and drops a group label whose items are all gone. Tests: a viewer sees no item that needs a write permission; an empty group has no label; hrefs are built from slugs.
- [ ] **Step 2: `Sidebar`** (11 sections 1 to 3, 24 section 9.1, the preview's markup): 208 px, the project switcher on top, 32 px items with 18 px icons, the active item in `surface-selected` with `aria-current="page"`, the three sections separated by 16 px, the Collapse button and the `[` shortcut. Collapsed state is `data-sidebar="collapsed"` on `<html>`, stored in a cookie so the server renders the right width and nothing shifts on load. The `rail:`, `narrow:` and `peek:` variants already exist in `globals.css`. Below 1024 px the sidebar is the `Drawer`, opened by the top bar's menu button.
- [ ] **Step 3: `TopBar`** (11 section 4): the breadcrumb (House link, workspace, project, current page), then on the right `ThemeSwitch` (at 1440 px and up), `HelpMenu`, `UserMenu` (name, email, the Theme group below 1440 px, "Account settings", "Sign out"). Search, date range, location and notifications are not rendered in this plan.
- [ ] **Step 4: `ThemeSwitch`** (11 section 4, 21 section 5.1): `role="switch"` named "Dark theme", writes through `next-themes`, reveals the new theme with the View Transitions circle where the API exists and reduced motion is off, and switches instantly otherwise.
- [ ] **Step 5: `ProjectSwitcher`** (11 section 8): a `Combobox` menu with search, fed by the pending endpoint `GET /workspaces/{id}/projects`; members limited to some projects see only those; switching keeps the current destination.
- [ ] **Step 6: `PageHeader`, `EmptyState`, `InlineError`, `ErrorPage`** per 25 and 17. `not-found.tsx` never implies the object exists. `error.tsx` offers "Try again" (`reset`) and shows the request id when the error is an `ApiProblem`.
- [ ] **Step 7: Project layout.** `[workspace]/[project]/layout.tsx` resolves the project slug (pending endpoint; `notFound()` for an unknown slug or a project outside `project_ids`), renders the skip link, `Sidebar`, `TopBar` and `main`. `[workspace]/[project]/page.tsx` renders Overview when its registry entry is live; until then it redirects to the first live destination.
- [ ] **Step 8: Tests.** Landmarks (`nav` Primary, `nav` Breadcrumb, `main`) and the skip link as first focusable; keyboard order; the collapsed rail shows tooltips with full labels; the user menu signs out; no axe violations in either theme.
- [ ] **Step 9: Compare with the static preview** at 1680, 1440, 1280, 1100, 1024, 768 and 390 px in both themes. The shell must match it.
- [ ] **Step 10: Fable review, fixes, gates, commit** "Add the application shell".

### Task 14: Workspace page

**Files:** create `src/app/[workspace]/page.tsx`, `src/features/projects/*`.

- [ ] **Step 1:** The workspace root lists the projects the member can open (name, domain, a link to each) under a `PageHeader`, with the documented empty state when there are none ("No projects yet", with who can create one when the viewer cannot). It uses the top bar without the sidebar. Project creation belongs to the onboarding plan; the button is absent, not disabled.
- [ ] **Step 2:** Tests: restricted membership sees only its projects; empty state for both roles; axe.
- [ ] **Step 3: Fable review, fixes, gates, commit** "Add the workspace project list".

### Task 15: Account settings

**Files:** create `src/components/app/shell/settings-nav.tsx`, `src/app/[workspace]/[project]/settings/layout.tsx`, `profile/page.tsx`, `security/page.tsx`, `preferences/page.tsx`, `src/features/account/*`.

Spec: 11 section 5 (the table of the three sections), 24 sections 6 and 9.13, 10 section 13, and the preview's `#/settings/profile`, `#/settings/security`, `#/settings/preferences`.

- [ ] **Step 1: `SettingsNav`**: 200 px local navigation, a `Select` below 1024 px. Only "Your account" is listed in this plan.
- [ ] **Step 2: Profile.** Name through the `SaveBar` (`PATCH /me`), email read-only with the Verified badge (and "Send verification email" when not verified), the workspace table (workspace, role, project access). Leaving with unsaved changes opens `DiscardChangesDialog`.
- [ ] **Step 3: Security.** "Change password" dialog (`POST /auth/password/change`, new password at least 12 characters, confirm field, `wrong_password` and `weak_password` on their fields; it signs out other sessions and says so). Two-factor: state badge, "Set up" (the setup flow of Task 11 in a dialog), "New recovery codes" (`POST /auth/totp/recovery-codes`, codes shown once), "Turn off" (`POST /auth/totp/disable`; disabled with the reason for owners and admins). Sessions: `GET /auth/sessions` as a 32 px-row table with device, place and IP, last active, a "This device" badge, "Sign out" per row (`DELETE /auth/sessions/{id}`) and "Sign out other sessions". Every action that needs a fresh session goes through `withFreshSession`.
- [ ] **Step 4: Preferences.** Theme (segmented control: System, Light, Dark), default table density, number and date format with a live example from `@/lib/format`, "Reduce motion" and "Single-key shortcuts" switches. Each control saves at once (10 section 13.3) to `localStorage` keyed by user id, and a small `usePreference` hook reads them. No `SaveBar`.
- [ ] **Step 5: Tests:** each mutation's success and each problem; the discard guard; the owner cannot turn the second factor off and sees why; preferences survive a reload and are cleared on sign out; axe.
- [ ] **Step 6: Against the real API,** as in Task 11 step 5.
- [ ] **Step 7: Fable review, fixes, gates, commit** "Add account settings: profile, security and preferences".

---

# Part D. Delivery

### Task 16: End-to-end, accessibility, visual regression, image and CI

Ask the user before this task: it downloads a browser (about 170 MB) and the pinned Playwright Docker image (about 2 GB). Tell the backend session before touching `.github/` and `infra/`.

- [ ] **Step 1: Playwright** against `pnpm build && pnpm start` with `NEXT_PUBLIC_API_MOCKING=all` in a test build: sign in, second factor, reset, the shell at three widths, account settings, sign out, a viewer sees no write action, an unknown workspace slug is a 404. `@axe-core/playwright` with the WCAG 2.2 AA tags on every visited page. One test asserts the CSP header on every route and that no violation is reported.
- [ ] **Step 2: Visual regression** (26 section 11): `toHaveScreenshot` over every `/design-system` section and the auth, shell and settings pages, light and dark, at 1440 x 900 and 390 x 844, in `mcr.microsoft.com/playwright:v1.63.0-noble`, with fonts awaited and the clock fixed.
- [ ] **Step 3: `apps/web/Dockerfile`**: dependencies, build, then a slim runtime with `.next/standalone`, `.next/static` and `public`, running `node apps/web/server.js` as a non-root user (20 section 9.1).
- [ ] **Step 4: CI** `.github/workflows/web.yml`: install with the frozen lockfile, `format:check`, lint, typecheck, `gen:api` followed by `git diff --exit-code` on `schema.d.ts`, unit and DOM tests, build, Playwright in the pinned image, image build. The Compose `web` service, the Caddy routes and `web.yml` belong to the backend session's deploy plan: ask it and build them together, so there is one shape.
- [ ] **Step 5: Fable review, fixes, gates, commit.**

### Task 17: Documents and the final review

- [ ] 26: mark the Phase 1 rows of section 9 as implemented; section 10: the route exists and which sections it has; the `cn` note.
- [ ] 20: section 9.2 (`API_INTERNAL_ORIGIN`, `API_PROXY_TARGET`, `NEXT_PUBLIC_API_MOCKING`), section 3.2 (the auth routes as built, tokens in the fragment), a note that `/me` has no `features` list and no operator flag yet.
- [ ] 24 section 9.1: the shell wireframe still shows a Topics item and says 15 items; correct it to 14.
- [ ] `DESIGN_SYSTEM.md` and `AI_DEVELOPMENT_UI_RULES.md`: commands and paths for the real app.
- [ ] `docs/design-system/review-log.md`: what was built, what was deferred, every open point below.
- [ ] A whole-branch Fable review (cross-task issues: boundaries, duplicated helpers, strings outside the catalog, unused packages), fixes, gates.
- [ ] Tell the user the branch is ready to merge; merge only on their word.

---

## Open points to settle during the work

| Point | Who | Needed by |
|---|---|---|
| `backend/auth` merged into `main`, then `main` merged into this branch | user, backend session | Task 8 |
| Shape of the public route that describes an invitation token (workspace, role, email); mocked until the backend's next plan | backend session | Task 11 |
| `user.is_platform_operator` in `/me` (the name the backend will use); mocked under that name | backend session | Task 7, recorded in Task 17 |
| `/me` has no `features` list and the backend does not plan one; 20 section 3.10 is corrected in Task 17 and phase gating is the navigation registry | frontend | Task 17 |
| `GET /workspaces/{id}/projects` and project summary do not exist yet; served by the pending mock | backend session | Task 13 |
| Playwright browser and Docker image download | user | Task 16 |
| Compose `web` service, Caddy routes, `web.yml` | backend session | Task 16 |

## Self-review

- **Coverage of 20 section 10, Phase 1:** auth routes (Task 11), app shell with the generated client (Tasks 8 and 13), workspace and project layouts (Tasks 12 and 13), permission context (Task 12), error and loading system (Task 13), CSP and headers (Task 10), standalone image and CI (Task 16). Deferred and named in Scope: the flag context (no API field yet), workspace, member and project settings, onboarding, `size-limit`.
- **Coverage of 26 section 9, Phase 1 rows:** every lint row is in Task 2 step 1; class ordering in Task 2 step 3; the copy test in Task 3 step 3; accessibility and visual regression in Task 16.
- **Names used across tasks:** `cn` (Task 3), `ApiProblem`, `problemFrom`, `isApiProblem`, `unwrap`, `apiQuery`, `apiMutation`, `queryKey`, `serverApi` (Task 8), `applyServerErrors` (Task 5), `safeNextPath`, `buildCsp` (Task 10), `useFragmentParam` (Task 11), `can`, `useCan`, `Can`, `PermissionProvider`, `withFreshSession` (Task 12), `visibleNavigation` (Task 13), `usePreference` (Task 15). Each is defined before its first use except `applyServerErrors`, which Task 5 defines against the `ValidationItem` shape and Task 8 then types with the generated schema: in Task 5 declare the item type locally from 19, and in Task 8 replace it with the generated type.
- **No placeholders:** destinations that are not built are absent from the navigation, not stubbed; controls whose feature is a later plan are not rendered.
