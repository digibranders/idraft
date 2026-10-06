# 20. Frontend Specification

Status: Draft for architecture freeze
Last updated: 2026-09-30
Related: [03-system-architecture.md](03-system-architecture.md) (read path, stack), [08-seo-keyword-system.md](08-seo-keyword-system.md), [09-rank-tracking-methodology.md](09-rank-tracking-methodology.md), [10-serp-feature-tracking.md](10-serp-feature-tracking.md), [11-ai-prompt-system.md](11-ai-prompt-system.md), [13-ai-extraction-engine.md](13-ai-extraction-engine.md), [14-citation-intelligence.md](14-citation-intelligence.md), [15-seo-ai-correlation.md](15-seo-ai-correlation.md), [16-metrics-methodology.md](16-metrics-methodology.md), [17-statistical-methodology.md](17-statistical-methodology.md), [18-first-party-integrations.md](18-first-party-integrations.md), [21-scheduler-workers.md](21-scheduler-workers.md), [24-security.md](24-security.md)

> Visual and interaction rules are owned by the design system ([DESIGN_SYSTEM.md](../DESIGN_SYSTEM.md), [docs/design-system/](design-system/00-design-principles.md)). Notes marked "Superseded by design system" record where this document disagreed; the design system wins.

This document specifies the web application: stack, architecture, shared UI patterns, every screen, the statistics drawer, frontend security, testing, and deployment. It is written so that a team can build the app without re-deciding measurement rules. Where a screen shows a number, the number's definition lives in doc 09 or doc 16; this document defines how it is displayed.

**Precedence (2026-09-29):** the UI design system in [design-system/](design-system/) and [../DESIGN_SYSTEM.md](../DESIGN_SYSTEM.md) is the source of truth for all visual, layout, component and interaction rules. Where this document differs on those topics (component library, colors, delta colors, chart palette, row heights, navigation structure, directory layout, viewport support), the design system wins; the affected sections below are marked. This document remains authoritative for data contracts, measurement display rules, security, testing scope and deployment.

There is no marketing site in scope. The only public routes are authentication routes. The root URL redirects to the last used project or to the login page.

## 1. Principles

1. **The UI never computes a metric.** Values, denominators, intervals, detectability and version boundaries come from the API ([16-metrics-methodology.md](16-metrics-methodology.md) section 2). The client only formats, sorts and filters computed rows, plus the panel sizing calculator (5.7), which mirrors a published formula.
2. **Every number carries its denominator.** A metric response without `denominator` and `n_observations` is a contract bug and renders an error state.
3. **Unknown is shown as unknown.** Beyond depth, insufficient samples, absent surfaces and failed collection each have a visual state (4.5). None renders as zero.
4. **Channels sit side by side.** SEO rank, AI rates, GSC and GA4 use separate columns, axes and labels. No combined score exists ([15-seo-ai-correlation.md](15-seo-ai-correlation.md) section 10).
5. **Engines are never pooled silently.** A cross-engine figure is labeled "Equal-weight average of N engines" with per-engine values beside it.
6. **Collected content is hostile.** Titles, snippets, answers and URLs render as text or through the sanitizing pipeline (section 7).

## 2. Stack and libraries

| Concern | Choice | Why this and not the alternative |
|---|---|---|
| Framework | Next.js (App Router), current major at freeze, version pinned | RSC shell, nested layouts matching workspace and project, intercepting routes for drawers. Self-hosted on the droplet with `output: 'standalone'`: one Node process in the `web` container, image built in CI. No Vercel ([ADR-022](adr/ADR-022-python-backend-simplified-platform.md)) |
| Language | TypeScript `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` | API types come from the client generated from the API's OpenAPI document, so a backend change the frontend does not follow fails type checking ([19-api-specification.md](19-api-specification.md) section 1.4); catches `rows[0].value` on empty results |
| API client | `openapi-typescript` (types) plus `openapi-fetch` (runtime), generated from the committed OpenAPI document | Same-origin calls to `/api/v1`; typed paths, params and bodies without a hand-written client. Wrapped for TanStack Query (3.5) |
| Server state | TanStack Query v5 | Filter-keyed cache, dedupe, `placeholderData` for smooth filter changes, mutation lifecycle for optimistic triage. SWR is weaker on mutations and dependent queries |
| Tables | TanStack Table v9 (stable 2026-08-04, `useTable` API) + `@tanstack/react-virtual` | Headless, so we own markup and accessibility; pinning, sizing, grouping, tree rows built in. AG Grid brings its own DOM and styling that fights shadcn tokens |
| URL state | `nuqs` v2 | Typed query-string filters with shallow updates; deep links from alerts and digests work |
| Charts | Apache ECharts 6 via an in-house wrapper (not `echarts-for-react`), tree-shaken from `echarts/core` | See 2.1 and [design-system/15-data-visualization.md](design-system/15-data-visualization.md) |
| Components | shadcn/ui on **Base UI** primitives (copied, restyled to tokens), Tailwind CSS v4 | Superseded by [design-system ADR-DS-001](design-system/adr/ADR-DS-001-shadcn-base-ui.md): Base UI is shadcn's default base since July 2026 and gives focus management and ARIA for dialogs, menus, comboboxes |
| Forms | react-hook-form + zod | Client-side schemas give instant field feedback and are typed against the generated request types; the API's Pydantic validation is authoritative and its `422` `errors[]` map onto fields (3.7) |
| Untrusted markdown | `react-markdown` + `rehype-sanitize` (GitHub schema, no raw HTML) | Mandated by [24-security.md](24-security.md) section 7.1 |
| Dates and time zones | `date-fns` v4 + `@date-fns/tz` (`TZDate`) | DST-safe project-timezone windows. Temporal is adopted natively once every supported browser ships it, instead of a polyfill in the main bundle |
| i18n | `next-intl`, single `en` catalog | English only, but no literal strings, so localization is not a rewrite |
| Auth client | Generated client calls to `/api/v1/auth/*` on the same origin | Our own auth module in the API ([19-api-specification.md](19-api-specification.md) section 3.1, [24-security.md](24-security.md) section 2); no auth SDK in the browser |
| Hosting and headers | `web` container behind Caddy on the droplet; static security headers in `next.config.ts` `headers()`, the nonce-bearing CSP in `proxy.ts` (7.3) | Same origin as the API, so no CORS and one cookie. Cloudflare proxied DNS is optional and only caches static assets (4.11) |
| Errors and RUM | `@sentry/nextjs`, Web Vitals | `sendDefaultPii: false`, no session replay in V1 (tenant data on screen) |
| Testing | Vitest, Testing Library, MSW, Playwright, `@axe-core/playwright`, `vitest-axe` | Section 8 |

> Superseded by design system: record detail opens in the right inspector addressed by the `?inspect=<type>:<id>` query parameter (with `itab` for its tab), so the app uses no intercepting routes for drawers. See [16-drawers-dialogs-popovers.md](design-system/16-drawers-dialogs-popovers.md) §2.7 and [ADR-DS-012-url-state.md](design-system/adr/ADR-DS-012-url-state.md).

### 2.1 Why ECharts

| Requirement | ECharts | Recharts | visx |
|---|---|---|---|
| 10,000+ points (matrix scatter, rank history across many competitors) | Canvas renderer, `large` mode, LTTB sampling | SVG only; one DOM node per point, slows above a few thousand | SVG by default; canvas is a custom build |
| Heatmaps (SERP feature strip, topic by engine grid) | Built in | Not built in | Primitives only, we build it |
| Vertical marker lines with labels (version boundaries) | `markLine` with tooltip | `ReferenceLine`, limited tooltip | Custom |
| Shaded bands (depth band, CI band) | `markArea` and stacked area bands | Possible with stacked areas | Custom |
| Accessibility aids | `aria` option generates a text description; decal patterns for color-blind users | Minimal | Whatever we build |
| Shared crosshair across small multiples | `connect` groups | Manual sync | Manual |
| Cost | Larger bundle (lazy loaded, section 4.11) | Small | Small, but high build cost per chart |

The hardest charts (depth bands, CI bands, markers, heatmaps, large scatters) are native in ECharts and custom work elsewhere. ECharts loads only on chart routes through `next/dynamic` with `ssr: false`.

## 3. Application architecture

### 3.1 Location in the repository

Directory layout: superseded by [design-system/26-implementation-guidelines.md](design-system/26-implementation-guidelines.md) section 2 (`src/components/ui`, `src/components/app`, `src/features`, `src/lib`). The listing below is kept for the dependency rules.

The app lives in `apps/web/` ([ADR-022](adr/ADR-022-python-backend-simplified-platform.md): the repository holds `apps/web/`, `backend/`, `data/fixtures/`, `infra/` and `docs/`; pnpm for `apps/web`, no Turborepo). `apps/web` imports nothing from `backend/`. Its only link to the API is the committed OpenAPI document (`backend/openapi/v1.json`), from which `src/lib/api/schema.ts` is generated (a `.ts` file, because `--enum-values` writes runtime lists); enums, the permission list and the reserved slug list reach the app through those generated types. A dependency-cruiser rule forbids imports from outside `apps/web`.

```
apps/web/
  app/                      routes (3.2)
  components/ui/            shadcn primitives (copied)
  components/metric/        MetricTile, DeltaBadge, CiTooltip, InsufficientData, EstimateBadge
  components/charts/        EChart wrapper, RankHistoryChart, RateTrendChart, FeatureStrip, MatrixScatter
  components/table/         DataTable, ColumnChooser, CsvExportButton, VirtualRows
  components/evidence/      EvidenceViewer, CitationList, SerpSnapshotViewer
  features/<screen>/        screen-specific components, hooks, query definitions
  lib/api/                  generated schema.d.ts, openapi-fetch clients (browser, server), query keys, error mapping
  lib/format/               numbers, percents, ranks, dates (Intl + TZDate)
  lib/permissions/          can(), <Can>, route guards
  lib/flags/                feature flag reader
  messages/en.json          string catalog
  proxy.ts                  request proxy (Next middleware): session presence check, CSP nonce
```

> Superseded by design system: components use the canonical names `MetricItem` (not `MetricTile`), `MetricCell` (not `RateCell`), `URLCell` (not `UrlCell`), `SERPFeatureList` (not `FeatureIconsCell`), `ChartFrame` and `RankHistoryChart`, with metric components (`MetricStrip`, `MetricItem`, `Delta`) in `components/app/metric/` and charts in `components/app/chart/`. See [25-component-inventory.md](design-system/25-component-inventory.md) §23 (item 48) and [26-implementation-guidelines.md](design-system/26-implementation-guidelines.md) §2.

### 3.2 Route structure

```
app/
  layout.tsx                         root html, fonts, theme, providers (no data)
  (auth)/page.tsx                    home: a member goes to their first workspace; signed out, /login
  (auth)/layout.tsx                  centered card layout, no app shell
  (auth)/login, verify-email, reset-password, two-factor, invite
  [workspace]/layout.tsx             RSC: /api/v1/me, workspace resolution, permissions, flags
  [workspace]/page.tsx               project list for the workspace
  [workspace]/onboarding/            new project wizard (5.1)
  [workspace]/costs/                 5.16 (as built: redirects to [workspace]/[project]/costs)
  [workspace]/ops/                   runs, runs/[runId], dead-letters, providers, schedules (5.18; as built: runs redirects to [workspace]/[project]/ops/runs)
  [workspace]/settings/              workspace, members, integrations, projects, budgets, notifications (api-keys deferred, 5.19.3)
  [workspace]/[project]/layout.tsx   project shell, filter context, data-version poller
  [workspace]/[project]/page.tsx     Overview (5.2)
  [workspace]/[project]/rankings/            Rank Tracker (5.3), rankings/import
  [workspace]/[project]/keywords/[tkId]/     Keyword Detail (5.4)
  [workspace]/[project]/pages/, pages/[urlId]/          Landing Pages, Page Intelligence (5.5)
  [workspace]/[project]/prompts/, prompts/[promptId]/   Prompt Explorer (5.6)
  [workspace]/[project]/panels/, panels/[panelId]/      Panels (5.7)
  [workspace]/[project]/matrix/                          SEO + AI Matrix (5.8)
  [workspace]/[project]/citations/[tab]/                 Citation Intelligence (5.9)
  [workspace]/[project]/competitors/                     Competitor Intelligence (5.10)
  [workspace]/[project]/topics/                          Topic Explorer (5.11)
  [workspace]/[project]/discovery/keywords, discovery/prompts   Inboxes (5.12, 5.13)
  [workspace]/[project]/diagnostics/keywords/[tkId], diagnostics/prompts/[promptId]  (5.14)
  [workspace]/[project]/first-party/[source]/           GSC, Bing, GA4, Cloudflare, imports (5.15)
  [workspace]/[project]/alerts/                          rules, rules/[id], events, digests (5.17)
  [workspace]/[project]/settings/                        general, entities, entities/[id], taxonomy, engines, schedules
  [workspace]/[project]/@drawer/(.)keywords/[tkId]       intercepted quick view from tables
  [workspace]/[project]/@drawer/(.)prompts/[promptId]
```

> Superseded by design system: project routes and their page tabs are owned by the navigation spec (for example `/seo/rankings`, `/seo/keywords/[tkId]`, `/ai/prompts/[promptId]`, `/ai/citations`, `/ai/sources`, `/discover/keywords`, `/integrations`), and the `@drawer` slots are not built. See [11-navigation.md](design-system/11-navigation.md) §1.1.

Built so far (web app foundation, 2026-10-01; `apps/web/src/app`):

| Route | What it is |
|---|---|
| `/` (`(auth)/page.tsx`) | Sends a member to their first workspace; signed out, to `/login`. Without a workspace, or after an invitation that could not be accepted (`?invitation=<reason>`), it shows that screen in the auth layout, with Sign out |
| `/login`, `/two-factor` | Sign in, then the code prompt for a user with two-factor on |
| `/reset-password` | Request a link; with `#token=` in the address, set the new password |
| `/verify-email` | Confirms the address from `#token=`; offers a new link |
| `/invite` | Registration by invitation from `#token=`. There is no sign-up without an invitation |
| `/[workspace]` | The workspace's project list (top bar, no sidebar) |
| `/[workspace]/[project]` | The project shell. Redirects to the first live destination the member can open (Settings for now) |
| `/[workspace]/[project]/settings/profile`, `security`, `preferences` | Your account; `settings` redirects to Profile |
| `/[workspace]/[project]/settings/general` | Project settings > General: name, address, time zone, deep check day, default language; pause, resume and archive (workspace setup, 2026-10-01) |
| `/[workspace]/[project]/settings/workspace`, `members` | Workspace settings > General (name, address, time zone) and Members and roles (members, role and project access, removal; invitations for `members:manage`) |
| `/[workspace]/onboarding` | New project, step 1 of 5.1 (Basics); a 404 for a member who may not create projects or is limited to some |
| `/[workspace]/settings/profile`, `security`, `preferences`, `workspace`, `members` | Settings outside any project (settings follow-ups, 2026-10-01): the same screens in the workspace shell, without the Project settings group; `settings` redirects to Profile. The workspace root's account menu opens it, so a member who can open no project still reaches their account and the workspace |
| `/new` (`(auth)`) | Create a workspace, for a platform operator while sign-up is by invitation; a 404 for anyone else |
| `/[workspace]/[project]/[...rest]` | Catch-all for planned destinations: the 404 page inside the shell |
| `/design-system`, `/design-system/[section]` (`(internal)`) | The component preview; a 404 in production builds ([26-implementation-guidelines.md](design-system/26-implementation-guidelines.md) section 10) |

Tokens from emails arrive in the URL fragment (`/verify-email#token=`, `/reset-password#token=`, `/invite#token=`), so they never reach a server log. `useFragmentParam` (`src/lib/url/use-fragment-param.ts`) reads the fragment once after mount and removes it from the address bar with `history.replaceState`. `invite/[token]` is not a route. An invitation is accepted with `POST /api/v1/invitations/accept` (`{ token }`) after the person has registered and signed in: the token follows them to sign in in the fragment (`/login#invitation=<token>`), and acceptance opens `/{slug}` of the workspace.

- URL segments use workspace and project **slugs**. `/api/v1/me` returns memberships with `{id, slug}` pairs, so the layout resolves slugs to ids without an extra request. API calls always use ids ([24-security.md](24-security.md) section 4).
- Static segments (`onboarding`, `costs`, `ops`, `settings`) win over `[project]` in Next routing, so project slugs must not use them. The reserved list is an enum in the API's OpenAPI document (so it is in the generated types), and the project create form validates against it.
- Intercepting routes give a drawer quick view when a user clicks a row in a table; opening the same URL directly loads the full page. Closing the drawer restores table scroll position and filters because they live in the URL.

> Superseded by design system: a row click opens the right inspector on the list page through `?inspect=<type>:<id>` (push on open, replace for tab and record changes), a pasted or reloaded URL reopens the same list with the same record, and the full page is reached through "Open page". See [16-drawers-dialogs-popovers.md](design-system/16-drawers-dialogs-popovers.md) §2.7.

### 3.3 Layouts

| Layout | Renders | Data |
|---|---|---|
| Root | `<html>`, theme class, font, `QueryClientProvider`, `NuqsAdapter`, `IntlProvider`, Toaster | none |
| `(auth)` | centered card, product name | none |
| `[workspace]` | top bar (workspace switcher, project switcher, user menu), permission context, flag context | `/api/v1/me` on the server with the forwarded cookie |
| `[workspace]/[project]` | left navigation (grouped: Overview; SEO; AI; Cross-channel; Discovery; Data; Alerts; Settings), global filter bar slot, data-version poller, setup checklist banner until onboarding completes | project summary (timezone, engines, entities, phase flags) |

> Superseded by design system: sidebar groups and items (Overview, Matrix; SEO; AI Visibility; Competitors, Topics, Discover; Reports, Integrations, Settings) follow the navigation spec, the project switcher sits at the top of the sidebar and the workspace in the top bar breadcrumb, and `SetupChecklist` appears only on Overview (other pages name the missing step in their empty states), not as a banner on every project page. See [11-navigation.md](design-system/11-navigation.md) §1.1 and [23-application-patterns.md](design-system/23-application-patterns.md) §13.

Metadata: the root layout sets the title template (`%s · Sightline`, the product name from the catalog) and `robots: noindex, nofollow` for every page, because everything sits behind sign-in and shows tenant data. The sign-in pages carry the same tag.

### 3.4 Server and client component policy

1. **The shell is RSC.** Layouts and page frames render on the server and fetch only identity and configuration (`/api/v1/me`, project summary, flags) from the API over the Docker network (`API_INTERNAL_ORIGIN`, the `api` service) with the incoming `cookie` header forwarded and `cache: 'no-store'`. `web` and `api` run on the same droplet, so this call never leaves the host (section 9, [ADR-022](adr/ADR-022-python-backend-simplified-platform.md)).
2. **Analytics data is client-side.** Tables, charts and tiles fetch through TanStack Query from the browser as same-origin requests to `/api/v1` (the session cookie is sent automatically): instant filter changes, cached back-navigation, no extra server hop ([03-system-architecture.md](03-system-architecture.md) section 7.4).
3. **Server prefetch where first paint matters.** Overview tiles and the Keyword Detail header are prefetched with `queryClient.prefetchQuery` and handed over through `HydrationBoundary` under the same query key. Tables are never server-prefetched.
4. **No server actions for mutations.** Mutations go from the browser to the API so its Origin check applies ([24-security.md](24-security.md) section 2.1); a server action would call the API from the `web` container instead, outside the browser's Origin check.
5. `"use client"` boundaries sit at feature components, not pages.

### 3.5 API client and data layer

- **Generated client.** `openapi-typescript` generates `src/lib/api/schema.ts` (with `--enum-values`) from the committed OpenAPI document that FastAPI produces ([19-api-specification.md](19-api-specification.md) sections 1.3 and 1.4); `schema.test.ts` regenerates it with the `gen:api` script and fails on a difference, so a stale client fails the test run. `openapi-fetch` (`createClient<paths>()`) is the only HTTP client. The generated paths already start with `/api/v1`, so both clients take an origin, not a base URL ending in `/api/v1`. The browser instance uses the page's own origin, so every call is a same-origin request to a relative `/api/v1/...` path and carries the `__Host-session` cookie without CORS. The server instance (`serverApi()`, `server-only`), used only by server components, uses `API_INTERNAL_ORIGIN` (origin only; the `api` service on the Docker network), forwards the incoming `cookie` header and the render's `x-request-id`, and forwards nothing else.
- **TanStack Query wrapper.** `lib/api/query.ts` turns a path template and its typed params into `queryOptions` (`apiQuery('/workspaces/{workspace_id}/projects/{project_id}/tracked-keywords', { params })`) and mutations into `mutationOptions`. The wrapper derives the query key, unwraps `data`, and throws a typed `ApiProblem` for any `application/problem+json` response so section 3.7 can branch on `code`. A list a screen shows whole (a workspace's members, invitations and projects) uses `apiAllPagesQuery`, which reads every offset page (`lib/api/pages.ts`, at most 50 pages of 200) and answers them as one page; the server's project list reads its pages the same way. Each page after the first starts one item early, and that item, named by the caller's `idOf`, must be the last one read: when it is not, when `total` moved, or when a page brings nothing new before `total` is reached, the list changed meanwhile and is read again from the start. After three readings in all that each changed, the query fails (`ListChangedError`), and a list longer than 50 pages hold fails too (`ListTooLongError`): a screen never shows part of a list. Each page's shape (`data` and `page.total`) is checked at runtime, the one answer this wrapper does check.
- **Validation.** Request bodies are typed by the generated types and forms validate with zod before sending; the API validates every request and every response against its Pydantic models and is the authority. Responses are therefore not re-parsed at runtime, except the page shape `apiAllPagesQuery` checks before it joins pages. Principle 2 is still enforced at render time: a `MetricValue` without `denominator` or `n_observations` renders the contract error state.
- **Query keys** are hierarchical: `['ws', wsId, 'p', projectId, domain, resource, normalizedFilters]`, with filters key-sorted and defaults dropped so equivalent URLs share a cache entry.
- **Freshness through `data_version`.** The project layout polls `GET {P}` (field `data_version`, doc 19 section 3.3) every 60 s while visible and on focus; a change invalidates every analytics query under the project key. Analytics `staleTime` is 5 minutes (matches the API's Redis cache); configuration is 30 s.
- **Run progress** (Check now, Run prompt now, imports) polls at the `Retry-After` interval the API returns until terminal ([19-api-specification.md](19-api-specification.md) section 2.10; [21-scheduler-workers.md](21-scheduler-workers.md) section 11).
- **Mutations.** Inbox triage is optimistic with rollback. Changes to a measurement instrument (core panel, prompt version, aliases, schedules, budgets) are pessimistic: confirm, wait, refetch.

Endpoint paths follow [19-api-specification.md](19-api-specification.md) section 3. Some "Data:" lines in section 5 still use shorter indicative paths written before doc 19; where this document and doc 19 differ, doc 19 wins (see the review log for the mapping).

### 3.6 URL state

All filters, sort, visible columns (when not default), selected tab, compare mode and window live in the query string through `nuqs` parsers defined once in `lib/filters/parsers.ts`. Defaults are omitted from the URL. Examples: `?loc=2840&dev=desktop&win=28d&cmp=prev&eng=chatgpt_web,gemini_web&topic=t_12&branded=exclude`. Alerts, digests and saved views link to these URLs, so a notification opens the exact filtered view.

### 3.7 Errors

| Condition | Handling |
|---|---|
| 401 `unauthenticated` | Clear query cache, redirect to `/login?next=<path>` |
| 403 `fresh_session_required` (sensitive action within 10 min rule, [24-security.md](24-security.md) section 2; doc 19 section 2.7) | Open re-authentication dialog (password or TOTP), then retry the original mutation once |
| 403 `two_factor_enrollment_required` (owner or admin without TOTP) | Not sent for now: two-factor is opt-in and its setup screen is deferred (the product owner's decision of 2026-09-30). When enforcement arrives, redirect to the setup screen |
| 403 | Inline "You do not have permission" panel naming the required permission; no retry |
| 404 | Route-level `not-found.tsx`. Cross-tenant ids return 404 by design, so the copy never implies the object exists |
| 409 `conflict` (a lock timeout: nothing was written, doc 19 section 2.7) | Safe to retry once: the query client repeats queries and writes once, a write only when the wait is short (`src/lib/api/retry.ts`). If it fails again, a resource form gets the `conflict` outcome of `applyProblem` (`src/lib/forms/apply-problem.ts`), the same as a 412; the account forms, which do not use it, show their failed-save sentence |
| 412 `precondition_failed` (stale edit: `If-Match` no longer matches, once the API sends ETags) | Dialog showing the server version with "Reload" and "Overwrite" where the API allows overwrite |
| 422 validation | Field errors mapped onto react-hook-form by path |
| 429 | Toast with retry-after countdown; queries back off automatically |
| `budget_blocked` on a triggered run | Inline notice with estimate, budget name and a link to Budgets |
| 5xx, network | Query error state with "Retry" and a Sentry event id |

Each route segment has `error.tsx` (client error boundary with reset) and `loading.tsx` (skeleton). Chart and table components also carry their own error boundary so one failed widget does not blank a page.

### 3.8 Loading and empty states

- Skeletons match final layout dimensions to hold CLS under budget. Tiles show a grey value bar and a grey denominator line; tables show 12 skeleton rows with real headers; charts show axes with a shimmer area.

> Superseded by design system: skeletons pulse (opacity 1 to 0.6 over 1.5 s, static under reduced motion) and never shimmer; chart skeletons show real axes and one flat `--chart-band` block with no fake series. See [17-empty-loading-error-states.md](design-system/17-empty-loading-error-states.md) §3.1 and [21-motion.md](design-system/21-motion.md) §8.1.

- Filter changes keep previous data visible with reduced opacity (`placeholderData: keepPreviousData`) and a thin progress bar, instead of reverting to skeletons.

> Superseded by design system: during a refetch the previous data stays at full opacity (no dimming) and a static 2 px `RefetchBar` in `primary` appears at the top edge of the refetching region. See [17-empty-loading-error-states.md](design-system/17-empty-loading-error-states.md) §3.4 and [21-motion.md](design-system/21-motion.md) §6.

- Empty states always say why and what to do: "No keywords tracked yet. Add keywords or import a CSV", "First rank check scheduled for 02:00 Europe/Berlin", "No prompts in the core panel. Promote prompts from the discovery panel". Empty states for users without write permission omit the action and name who can do it.

### 3.9 Permission-aware UI

Permissions come from `/api/v1/me` as a flat list per workspace, drawn from the API's permission enum (doc 19 section 2.13, also present in the generated types), the same source the API enforces ([24-security.md](24-security.md) section 3.2). The client never decides access; it only avoids offering actions that will fail.

| Rule | Example |
|---|---|
| **Hide** navigation and actions the role can never perform in this workspace | Viewer sees no "Add keyword" button, no Settings > Members, no Ops |
| **Disable with a reason** when the action exists for this role but is blocked right now | Editor on a locked core panel: "Core panel changes need an admin (panels:core:modify)"; analyst hitting the manual run quota: "20 manual runs per project per day reached"; budget blocked |
| **Show read-only** forms when the user can read configuration but not edit | Analyst viewing entities and aliases |
| **Project restriction** | Members limited to some projects see only those in the project switcher; direct URLs to other projects render the 404 page |

`<Can permission="keywords:write">` and `useCan()` wrap every action. A unit test renders each screen with each role fixture and snapshots the set of visible actions.

### 3.10 Feature flags and phase gating

Flags come from the API in `/api/v1/me` (`features: string[]` per workspace), backed by the API's own configuration (`sightline.config`, platform defaults plus per-workspace overrides). There is no Vercel or edge flag service; server components read flags from the same `/api/v1/me` call as the rest of the shell. The frontend uses them for two purposes: phase gating (a screen whose API is not live yet is absent from navigation) and gradual rollout. Navigation items, routes and columns check flags; a route visited while its flag is off renders the 404 page. Flags are never used for authorization.

> Superseded (web app foundation, 2026-10-01): `/api/v1/me` has no `features` list, and the backend does not plan one. Phase gating is the navigation registry, `src/lib/navigation/registry.ts`: the 14 destinations of [11-navigation.md](design-system/11-navigation.md) §1.1, each `live` or `planned`. Only Settings is live. A planned destination is absent from the sidebar, the breadcrumb and the project switch, and its path renders the 404 page inside the shell. There is no flag context and no gradual rollout; if one is needed later, it comes from a new API field.

### 3.11 Formatting and i18n readiness

- English only in V1. All UI strings live in `messages/en.json`; no string literals in components (ESLint rule `no-literal-string` in JSX, with an allowlist for symbols).
- Locale for number and date formatting comes from the user profile, defaulting to the browser's English locale (`en-US`, `en-GB`). All formatting goes through `lib/format`:
  - Rates: `34%` for headline values; one decimal only when the interval half-width is under 2 points.
  - Intervals: "29% to 39%" (never a dash).
  - Counts: full digits in tables (`12,480`), compact in tiles (`12.5K`) with the full value in the tooltip.
  - Ranks: integers; averages with one decimal and the ranked count ("7.4 across 612 ranked of 1,000").
  - Currency: USD with 2 decimals, 4 decimals for unit costs under one cent.
- Copy rule: no em-dashes or en-dashes in any string. A unit test scans `messages/en.json` and fails on U+2014 and U+2013.

### 3.12 Time and time zones

- Every project has a timezone. Business dates (`observed_date`, rollup dates, week starts) arrive from the API already computed in that timezone ([04-data-model.md](04-data-model.md)); the frontend displays them as plain dates and never converts them.
- Timestamps (`observed_at`, run times) arrive in UTC and are displayed in the project timezone with its abbreviation ("02:14 CEST"). A tooltip shows the viewer's local time when it differs.
- Date windows ("Last 28 days", "This week") are resolved in the project timezone with `TZDate`, then sent as `from` and `to` ISO dates plus `tz`. Weeks start on Monday (ISO), matching `week_start` rollups.
- Workspace-level screens (Costs, Ops) use the workspace timezone and say so in the header. Provider cost days that are UTC-based are labeled "UTC day".

## 4. Global UI patterns

### 4.1 App shell

```
+--------------------------------------------------------------------------------+
| [Workspace v] / [Project v]            search (/)      alerts bell   user menu |
+-----------+--------------------------------------------------------------------+
| Overview  | Filter bar: Location v  Device v  28 days v  vs previous v  ...    |
| SEO       |--------------------------------------------------------------------|
|  Rankings |                                                                    |
|  Pages    |                         page content                               |
| AI        |                                                                    |
|  Prompts  |                                                                    |
|  Panels   |                                                                    |
|  Citations|                                                                    |
| Cross     |                                                                    |
|  Matrix   |                                                                    |
|  Topics   |                                                                    |
|  Compet.  |                                                                    |
| Discovery |                                                                    |
| Data      |                                                                    |
| Alerts    |                                                                    |
| Settings  |                                                                    |
+-----------+--------------------------------------------------------------------+
```

Superseded: the navigation structure is defined in [design-system/11-navigation.md](design-system/11-navigation.md) and viewport support (1280 full, tablet review and triage, mobile monitoring) in [design-system/19-responsive-behavior.md](design-system/19-responsive-behavior.md).

> Superseded by design system: the shell sketch above is historical; the sidebar follows the navigation spec's groups and 28 px items, and the top bar holds the breadcrumb (workspace and project menus), a search trigger that opens the command palette (`⌘K`), notifications, help, theme and user menu. See [11-navigation.md](design-system/11-navigation.md) §1.1, §2 and §4.

### 4.2 Filter bar

One component, configured per screen with the filters that apply. Filters not relevant to a screen are not shown (not disabled).

| Filter | Values | Notes |
|---|---|---|
| Location | project locations (country, then city) | SEO and AI screens both filter; AI filters to locations in the same country ([15-seo-ai-correlation.md](15-seo-ai-correlation.md) section 2.1) |
| Device | desktop, mobile | SEO only. AI screens hide it because device is engine-level |
| Date window | 7, 28, 90 days, 12 weeks, custom; weekly screens snap to weeks | Resolved in project timezone |
| Compare | none, previous period, same period last year, custom | Drives deltas; paired vs unpaired method is chosen by the API and shown in the delta tooltip |
| Engine selector | multi-select grouped by class: **Consumer UI** (ChatGPT, Gemini), **SERP AI** (AI Overview, AI Mode), **Official API** (benchmarks) | Each option shows its class label. Selecting engines from two classes shows per-engine columns, never a pooled value. Engines with `exposes_fanout = false` grey out fan-out widgets |
| Group, tag, topic, cluster | tree pickers from taxonomy | Topic is subtree-aware; a note says "Topic totals do not sum to the project total" |
| Intent, funnel stage | enums | |
| Panel | core (default on AI screens), discovery, experiment, custom | Membership at observation time, per doc 16 rule 8 |
| Branded | exclude (default), only branded, include with separation | "Only branded" is the Branded prompts view. There is no "pool branded and non-branded" option |

Active filters render as removable chips below the bar with a "Reset" link. A filter count badge shows on narrow widths.

> Superseded by design system: active filters are neutral `FilterChip`s inline in the `FilterBar` after the always-visible scope controls, followed by "+ Filter" and a "Clear all" link, and below 768 px the bar collapses to a "Filters (3)" button that opens a sheet. See [13-filters-search.md](design-system/13-filters-search.md) §2.

### 4.3 Saved views

A saved view stores a screen id, the URL query string, visible columns and sort, a name, and visibility (private or workspace). Analysts create private views; editors and above can also create workspace views (`views:write`, doc 24 section 3.2). Views appear in a dropdown next to the page title and as optional pinned items in navigation. Opening a view whose filters reference deleted objects (a removed tag) shows a warning chip "1 filter no longer exists" and ignores that filter. Saved views are stored by the API, never in localStorage, so they follow the user across devices.

> Superseded by design system: the `SavedViewMenu` sits in the page header title row on table pages, inboxes, Matrix and Competitors only (not on Overview, detail pages or settings), and saved views are never pinned as sidebar items. See [23-application-patterns.md](design-system/23-application-patterns.md) §14 and [11-navigation.md](design-system/11-navigation.md) §1.

### 4.4 Metric tile

> Superseded by design system: summary metrics render as one borderless `MetricStrip` of `MetricItem`s (label, value with `Delta`, context line with the denominator), and a bordered `MetricCard` is allowed only as a single-metric detail header card or in `QuadrantSummary`. Non-detectable deltas show signed points in `foreground-secondary` without a `~` glyph. See [23-application-patterns.md](design-system/23-application-patterns.md) §2 and [14-badges-status.md](design-system/14-badges-status.md) §5.

```
+--------------------------------------------+
| Mention rate  ChatGPT  [consumer UI]    (i) |
| 34%              ~ +2 pts                   |
| 612 of 1,800 obs · 250 prompts · 28 days    |
| [Estimate] [|v2 boundary]                   |
+--------------------------------------------+
```

| Element | Source field | Behavior |
|---|---|---|
| Label, engine, class chip | `metric`, `engines`, `observation_class` | Class chip is always visible on AI tiles |
| Value | `value`, `unit` | `null` renders the insufficient or no-data state (4.5), never 0 |
| Delta | `delta.value`, `delta.is_detectable` (`MetricComparison`) | Colored only when `delta.is_detectable === true` (4.7). Grey with "within normal variation" otherwise |
| Denominator line | `numerator`, `denominator`, `n_observations`, `n_prompts` or `n_keywords`, `window` | Always visible, not only on hover |
| CI tooltip | `ci.low`, `ci.high`, `ci.method`, `aggregation` | Hover or focus on the value: "95% interval 31% to 37% (Wilson on pooled counts). Prompt-weighted." |
| Method link | `method`, `method_version` | (i) opens a popover with the plain-language definition, formula reference (doc and section), and method version, plus "Open statistics drawer" on AI rates |
| Estimate badge | `is_estimate` | "Estimate" chip with the method string on hover (CTR-based clicks, search volume, modeled AI demand) |
| Version boundary icon | `version_boundaries` inside the window | Icon with count; hover lists component, from, to, date |
| Source label | first-party metrics | "GSC", "GA4", "Bing (sampled)" chip, never mixed into synthetic tiles |

Comparisons use `MetricComparison` from [19-api-specification.md](19-api-specification.md) section 2.6: `current`, `previous` and `delta { value, ci, is_detectable, label, discordant }`, with interval methods `paired_bootstrap`, `newcombe` and `mcnemar_exact`.

### 4.5 Unknown, insufficient and absent states

| State | When | Display |
|---|---|---|
| **Not yet collected** | No run has completed for the scope | "First check scheduled for <time>" |
| **Insufficient data** | Below the minimum sample: fewer than 4 valid observations per engine in window for AI rate cells ([15-seo-ai-correlation.md](15-seo-ai-correlation.md) section 3); flip rate with T < 3; keyword volatility with fewer than 10 ranked checks; GSC position with fewer than 20 impressions | Hatched cell, text "Insufficient data", tooltip "3 valid observations; 4 needed". Counts are still shown ("1 of 3 runs") where doc 17 section 3.3 asks for counts |
| **Not applicable** | Surface absent: AI Overview citation rate when no AIO appeared in window | "No AI Overview in window" with the presence rate |
| **Beyond depth** | Rank NULL with `depth_requested` | "Not in top 20" chip (depth from the row), never a number |
| **Collection issue** | Valid-observation rate below 90% or stale flag set | Warning icon linking to the run in Ops; the value, if any, is still shown |
| **Uncertain** | Uncertain mentions excluded from rates | Footnote "12 uncertain mentions excluded" with a link to review |

> Superseded by design system: in table cells beyond depth renders as `>20` text and a below-minimum sample as a hatched cell reading "Insufficient" (or the count), while "not in top 20" and "Insufficient data" are used in tiles, the inspector and screen-reader text. See [22-content-formatting.md](design-system/22-content-formatting.md) §3 and [17-empty-loading-error-states.md](design-system/17-empty-loading-error-states.md) §8.

### 4.6 Chart conventions

All charts go through one `EChart` wrapper that applies these rules; feature charts pass data and semantic options, not raw ECharts config.

1. **Version boundaries.** Every series response carries `version_boundaries`; the wrapper draws a dashed vertical `markLine` at each with a short label and a tooltip (component, from, to, date). Prompt versions, extractor versions, model changes, panel membership changes, CTR curve versions and competitor additions (SOV) all use it.
2. **Depth-aware rank charts.** Inverted y-axis from 1 to depth. Below the depth line sits a hatched band labeled "Not in top 20" (per-check depth; the boundary steps when depth changes). Beyond-depth checks are hollow markers inside the band; lines break there (`connectNulls: false`) and never run into the band. Deep checks use a distinct marker; "Show deep checks" extends the axis to 100.
3. **CI bands for AI rates.** Point estimate as a line, 95% interval as a shaded band; insufficient points are hollow with no band. Tooltip: `k of n`, prompts, interval, method.
4. **Separate axes per channel.** Different units never share an axis and dual y-axes are not used; cross-channel views are stacked small multiples with a shared time axis and linked crosshair (`echarts.connect`). Organic and absolute rank may share an axis, both named in the legend.
5. **Engines as separate series.** A cross-engine average, when shown, is a distinct dashed series named "Equal-weight average (3 engines)".
6. **Estimates** (estimated clicks, AIO-adjusted clicks) use a dotted line and "Estimate" in the series name.
7. **Events** (entered top 10, URL changed, AIO appeared) are small glyphs on the x-axis with tooltips, toggled from the legend.
8. **Table fallback.** Every chart has a "Table" toggle rendering the same data (including n and interval columns) with CSV export, and an `aria-describedby` summary sentence produced by the feature component (4.10).
9. **Tooltips are text only.** Custom `formatter` functions must escape every collected string with `echarts.format.encodeHTML` or return plain text; a lint rule flags formatters that concatenate strings without the escape helper (section 7.3).
10. Animations are off when `prefers-reduced-motion` is set, and off for charts with more than 2,000 points.

> Superseded by design system: chart animation is off for all charts (`animation: false` in the wrapper's base option, not overridable by features). See [21-motion.md](design-system/21-motion.md) §6.

### 4.7 Color semantics

- **Superseded (2026-09-29):** color semantics, delta colors and the chart palette are defined in [design-system/02-color-system.md](design-system/02-color-system.md) and [ADR-DS-010](design-system/adr/ADR-DS-010-semantic-change-colors.md) (detectable improvements in positive green, declines in negative red, always with arrows or signs; a CVD-validated six-color palette replaces Okabe-Ito). The detectability rules below still apply. Previous text:

> Superseded by design system: deltas are colored only when detectable (ranks when beyond the keyword's normal movement, `New` and `Lost` always), non-detectable deltas are `foreground-secondary` with no `~` glyph, and series use the six `--chart-*` tokens with the top 5 plus "Other" beyond six entities, so the hex values below are historical. See [02-color-system.md](design-system/02-color-system.md) §6 and §7.1.

- **Categorical palette:** Okabe-Ito (blue #0072B2, orange #E69F00, bluish green #009E73, reddish purple #CC79A7, sky blue #56B4E9, vermillion #D55E00, black; yellow #F0E442 only with an outline). The own brand is always blue #0072B2. Competitors get stable colors assigned by the order they were added, persisted per project so colors do not shuffle between screens. Beyond seven entities, decal patterns distinguish series.
- **Deltas:** a detectable improvement is blue with an up arrow; a detectable decline is vermillion with a down arrow; everything else is neutral grey with "~" and the text "within normal variation". Direction is always also carried by the sign and the arrow, so color is never the only signal. Red and green are not used as a pair.
- **When a delta is colored:** only when `delta.is_detectable === true`. For metrics without a detectability test (`is_detectable: null`) the change is shown with sign and arrow in neutral color. Single-keyword rank changes are not significance-tested; they are colored only when `|change| > max(2, 2 x mean absolute daily change over the last 30 ranked checks)` (doc 17 section 10), otherwise neutral, shown next to the keyword's volatility.
- **Status colors** (collection errors, budget warnings) use a separate amber and red token set with icons, visually distinct from delta colors.
- Light and dark themes are defined as CSS variables in Tailwind v4 `@theme`; both are checked for 4.5:1 text contrast and 3:1 for non-text marks.

### 4.8 Table conventions

`DataTable` wraps TanStack Table and TanStack Virtual:

| Feature | Rule |
|---|---|
| Virtualization | Rows virtualized above 100 rows; fixed row height (32 px compact, 40 px comfortable, per [design-system/12-tables.md](design-system/12-tables.md)) for predictable scroll math |
| Size mode | Up to 10,000 rows: full dataset fetched sequentially in 200-row cursor pages (doc 19 section 2.4), then sorted and filtered client-side. Above 10,000: server-side sort, filter and pagination with the same component API |
| Sticky header and first column | Header sticky; the identity column (keyword, prompt, domain, URL) pinned left. Focused cells scroll clear of sticky areas (WCAG 2.4.11) |
| Column chooser | Popover with grouped checkboxes (Rank, Metrics, AI, GSC, Competitors), drag to reorder, "Reset to default". Choices persist per user and screen in the API-backed saved view, or in localStorage as a convenience default (non-sensitive) |
| Sorting | Multi-sort with shift-click; beyond-depth ranks sort after all ranked values in both directions; insufficient-data cells sort last |
| Row selection | Checkbox column, shift range select, "Select all 4,812 matching" banner for bulk actions |
| CSV export | Exports the current filter scope (not just visible rows) with all columns including denominators, n, CI bounds, depth, and source labels. Up to 50,000 rows client-side via a Web Worker; above that the API's async export ([08-seo-keyword-system.md](08-seo-keyword-system.md) section 3.4). Cells starting with `=`, `+`, `-`, `@`, tab or carriage return are prefixed with `'` to prevent formula injection |
| Density and width | Column resize with double-click to auto-fit; widths persisted like column choice |
| Cell components | `RankCell` (number or depth chip), `RateCell` (value, `k of n`, mini CI bar), `DeltaCell`, `UrlCell` (path with host, copy, external link), `FeatureIconsCell`, `SparklineCell` (canvas, drawn by a shared tiny renderer, not ECharts, to keep 10,000 rows fast) |

> Superseded by design system: cells use the canonical components (`MetricCell` shows the rate with `k of n` in comfortable density and no mini CI bar, `RankDeltaCell` for rank changes, `URLCell`, `SERPFeatureList`), the bulk bar (not a banner) offers "Select all N matching", and column state persists in the API-backed default view, not localStorage. See [12-tables.md](design-system/12-tables.md) §6, §10 and §14.

### 4.9 Evidence viewer

Used by Prompt Explorer answers, AI Overview history, diagnostics and the alias test tool.

```
+------------------------------------------------------------+----------------------+
| ChatGPT · 2026-09-22 01:14 CEST · replicate 2 of 3 · valid | Entities            |
| Prompt v3: "What is the best CRM for a 20-person startup?" | [x] Acme (own)   3   |
|------------------------------------------------------------| [x] HubSpot      2   |
| ## Top options                                             | [x] Pipedrive    1   |
| 1. [Acme] is a solid pick for small teams because... [1]   | [ ] uncertain    1   |
| 2. [HubSpot] offers a free tier... [2][3]                  |----------------------|
| 3. [Pipedrive] focuses on pipeline... [4]                  | Citations           |
| Unlike [HubSpot], ...                                      | 1 acme.com/pricing   |
|                                                            |   own · vendor_site  |
|                                                            | 2 g2.com/...  3rd    |
| View: (o) Evidence  ( ) Formatted  ( ) Raw (escaped)       | 5 [Ad] excluded      |
+------------------------------------------------------------+----------------------+
| Facts: mentioned yes · cited yes · recommended yes (0.85, rule) · structured rank 1 of 3 |
| Extractor v4 · entity config v12 · derivation 381                                       |
+----------------------------------------------------------------------------------------+
```

- **Evidence mode (default)** renders the extractor's blocks (headings, paragraphs, numbered list items, table rows) from `answer_text` and applies mention spans by character offset, which is exact because offsets refer to `answer_text` ([13-ai-extraction-engine.md](13-ai-extraction-engine.md) stage 3). Output is React elements only (`<h3>`, `<p>`, `<li>`, `<mark>`).
- **Formatted mode** renders `answer_markdown` through `SafeMarkdown` (7.1), without highlights. **Raw mode** shows the payload fragment as escaped text for `raw:read`, fetched on open.
- **Highlights:** `<mark>` with the entity's color as left border and tint, a hover label, and `aria-label="Acme mention, word boundary match, confidence 0.95"`. Uncertain spans are dashed and excluded from rates; product mentions show "via Sales Hub". Side panel toggles highlights per entity with counts.
- **Citation markers** become superscript buttons `[n]` linked both ways with the citation list: index, escaped title, host, role chip, category, `citation_kind`, canonical and raw URL, `referral_tag`, flags (`unresolved_redirect`, `engine_internal`).
- **Ads and sponsored items** show an "Ad" chip, greyed, "excluded from metrics".
- **Facts footer** shows `observation_facts` and derivation versions so any rate traces back to this answer. **Compare mode** shows two observations side by side (prompt diagnostics).

### 4.10 Accessibility (WCAG 2.2 AA)

- **Keyboard tables:** `DataTable` implements the ARIA grid pattern: one tab stop into the grid, arrow keys move between cells, Home/End and Ctrl+Home/End, Page Up/Down by visible page, Enter opens the row (drawer), Space toggles selection. `aria-rowcount` and `aria-rowindex` are set so screen readers announce position in virtualized tables. Sortable headers are buttons with `aria-sort`.
- **Charts:** ECharts `aria.enabled` with a generated description, decal patterns available from a "Patterns" toggle, and the table fallback (4.6). Each chart has a heading and a one-sentence summary ("ChatGPT mention rate 34%, 28 days, change within normal variation").
- **Color independence:** deltas carry sign and arrow; SERP feature icons have text labels in tooltips and in the column's accessible name; entity highlights carry labels.
- **Focus:** visible focus rings (2 px, 3:1 contrast); focus never hidden under sticky headers or the filter bar (2.4.11); dialogs trap and restore focus (Radix).
- **Targets:** interactive targets at least 24 by 24 px (2.5.8), including icon buttons in dense tables.
- **Authentication:** password fields allow paste and password managers; TOTP input accepts paste; no cognitive tests (3.3.8).
- **Redundant entry:** the onboarding wizard carries earlier answers forward (3.3.7).
- **Motion:** reduced-motion respected globally.
- **Keyboard shortcuts** (`/` for search, `?` for help) are single-key only when focus is not in an input and can be turned off in the user menu (2.1.4).
- Language attribute `lang="en"` on `<html>`; collected answers in other languages get `lang` from the prompt's `language_code` on the evidence container.

> Superseded by design system: Enter on a row opens the right inspector (not a drawer), overlays are Base UI primitives with no Radix packages, and `/` focuses table search on table pages and opens the command palette elsewhere, with `⌘K` always opening the palette. See [20-accessibility.md](design-system/20-accessibility.md) §6.3, [26-implementation-guidelines.md](design-system/26-implementation-guidelines.md) §4 and [25-component-inventory.md](design-system/25-component-inventory.md) §23 (item 21).

### 4.11 Performance budgets

| Budget | Target | Enforcement |
|---|---|---|
| LCP (p75, desktop, authenticated) | 2.0 s on Overview, 2.5 s on every other route | Sentry Web Vitals (RUM); Lighthouse CI in CI against the standalone build (`node server.js` with seeded data) for Overview, Rank Tracker, Prompt Explorer |
| INP (p75) | 200 ms | RUM |
| CLS (p75) | 0.05 | RUM, skeletons sized to content |
| First-load JS per route (gzip) | 180 KB shared + 60 KB route | `size-limit` in CI, fails the build |
| Lazy chunks | ECharts 170 KB gzip; evidence viewer (markdown, sanitize) 60 KB | `size-limit` per chunk |
| Table with 10,000 rows | Data ready to first rows painted under 150 ms; client sort or filter under 100 ms; no long task over 50 ms while scrolling; heap under 150 MB | Playwright performance test with a 10,000-row fixture, CPU throttled 4x |
| Charts | 10,000-point scatter renders under 250 ms; line series over 2,000 points use LTTB sampling | Same test harness |
| API payload | Table pages under 1 MB compressed | Contract test on fixtures |

Route transitions prefetch the next route's code on link hover (Next default) but never its data.

Static assets (`/_next/static`) are content-hashed and served by the `web` container with `Cache-Control: public, max-age=31536000, immutable`; Caddy compresses them. Cloudflare proxied DNS is optional ([ADR-022](adr/ADR-022-python-backend-simplified-platform.md)): when enabled it caches only these static assets at the edge and adds DDoS protection. HTML and `/api/*` responses are `private, no-store` and are never cached at the edge. The budgets above hold without Cloudflare.

## 5. Screens

Each screen lists phase (section 10), permissions, layout, data, interactions and states. Data needs name endpoints; doc 19 section 3 is authoritative (section 3.5 note). All AI rates follow tile and cell rules from section 4.

> Superseded by design system: the route names in this section predate the navigation spec, whose paths and page tabs apply (for example Rank Tracker at `/seo/rankings`, Prompt Detail at `/ai/prompts/[promptId]`), and every "drawer" or "quick view" opened from a table row is the right inspector. See [11-navigation.md](design-system/11-navigation.md) §1.1 and [16-drawers-dialogs-popovers.md](design-system/16-drawers-dialogs-popovers.md) §1.1.

### 5.1 Onboarding (new project)

Route `[workspace]/onboarding`. Permission `projects:write`. Phase 1 (steps 1, 8 and 9), Phase 3 (step 7, schedules), grows through Phase 7.

```
+---------------------------------------------------------------------------+
| New project                                             Step 3 of 9       |
| (1) Basics (2) Brand (3) Competitors (4) Keywords (5) Prompts (6) Engines |
| (7) Schedule (8) Budget (9) Review                                        |
|---------------------------------------------------------------------------|
|  step form                                   | Estimate so far            |
|                                              | Keywords 240 x daily       |
|                                              | Prompts 120 x 3 engines    |
|                                              | ~ USD 212 / month (estimate)|
|  [Back]                     [Skip] [Save and continue]                    |
+---------------------------------------------------------------------------+
```

| Step | Fields and notes |
|---|---|
| 1 Basics | Name, slug (reserved words rejected), primary domain, timezone (browser default), default country, language, location, device. Creates the project, so an abandoned wizard resumes from the setup checklist |
| 2 Own brand | Name, suggested aliases, owned domains with match scope; compact entity editor (5.19.6) |
| 3 Competitors | Up to 10 entities with aliases, domains, `track_seo` and `track_ai`; suggestions from Phase 11 |
| 4 Keywords | Paste or CSV with groups and tags; import preview (5.3.1); quota use |
| 5 Prompts | Manual entry with lint warnings, templates from step 4 keywords; branded prompts flagged |
| 6 Engines | ChatGPT, Gemini, AI Mode, AI Overview (from SERP checks), replicates, locations; class label per engine |
| 7 Schedule | Rank window and depth profile, deep check weekday, AI weekday, in project timezone |
| 8 Budget | Monthly limits per workload, soft limit %, action on hard limit; "Estimate from price book" |
| 9 Review | Summary, first run times, total estimate; "Start tracking" enables schedules |

Data: project, entity, keyword import, prompt, engine, schedule and budget endpoints, plus `POST .../estimates` for the running estimate panel. Server errors map to fields. Overview shows "4 of 9 setup steps complete" until done.

### 5.2 Overview

Route `[workspace]/[project]`. Permission `data:read`. SEO half Phase 5, AI half Phase 9, cross-channel widgets Phase 10a.

The wireframe below is the built-in default. The headline numbers and the cards are rendered from a layout the person can customize ([layout customization design](superpowers/specs/2026-09-30-layout-customization-design.md), [design-system/23-application-patterns.md](design-system/23-application-patterns.md) section 18). Layouts are stored by the API (`core.layouts`), not in browser storage, so they follow the person across devices.

```
+------------------------------------------------------------------------------+
| Overview                       Filter bar (location, device, window, compare) |
|------------------------------------------------------------------------------|
| SEO                                                                          |
| [Visibility vol-wt] [Visibility equal-wt] [Top 3] [Top 10] [Top 20] [Avg rank]|
| [Distribution: 1 | 2 to 3 | 4 to 10 | 11 to 20 | 21 to 50 | 51 to 100 | beyond] |
| [AIO presence rate] [AIO citation rate] [Est. clicks (Estimate)]              |
|------------------------------------------------------------------------------|
| AI (core panel, non-branded)                         Branded prompts view >  |
|          Mention   Citation   Recommendation   SOV     Owned citation share   |
| ChatGPT  34% ~     21% ^      18% ~            27%     9%                    |
| Gemini   29% ~     14% ~      15% ~            24%     6%                    |
| AI Mode  41% v     33% ~      n/a              31%     12%                   |
| Equal-weight average (3 engines): 35% mention                                |
|------------------------------------------------------------------------------|
| Trends: visibility (SEO)   |  mention rate per engine (small multiples, CI)  |
|------------------------------------------------------------------------------|
| Key changes (detectable only)       | Competitor overview                    |
| - Entered top 10: 14 keywords       | Entity  SEO SOV  Vis.  AI SOV (per eng)|
| - ChatGPT mention rate on "CRM"     | Acme    18%      31%   27 / 24 / 31    |
|   topic down 6 pts (detectable)     | HubSpot 24%      40%   33 / 35 / 29    |
+------------------------------------------------------------------------------+
```

> Superseded by design system: Overview opens with one `MetricStrip` of 6 items (3 SEO, then 3 AI with one per engine) instead of tile rows, followed by a chart with the rank distribution list, the `QuadrantSummary`, `ChangeFeed` with opportunities, and the AI by engine and competitor tables; the remaining SEO tiles move to the Visibility inspector, the distribution list and the Rankings strip. See [24-page-templates.md](design-system/24-page-templates.md) §9.2 and [23-application-patterns.md](design-system/23-application-patterns.md) §2.

Data: `GET .../overview/seo`, `GET .../overview/ai?engines=`, `GET .../overview/changes`, `GET .../overview/competitors`. The SEO and AI blocks are separate requests so one can render while the other loads.

Rules:
- Both visibility variants, with the tooltip "100% means position 1 for every keyword; not comparable across projects" ([09-rank-tracking-methodology.md](09-rank-tracking-methodology.md) section 6.2) and a "Keywords without volume: 38" note.
- Average rank shows ranked count and total. Distribution uses checked keywords; top 50 and 100 buckets say "from deep checks (last 8 days)".
- AI block: core panel, non-branded, one row per engine (A1 mention, A2 owned citation, A5, A7, A8). The equal-weight line appears only with two or more engines.
- Key changes: SEO events aggregated by type and detectable AI changes (BH-filtered), each linking to its filtered view; anomaly-held days show one notice.
- Competitor overview: SEO SOV (with "other domains" remainder), visibility, AI SOV per engine in separate columns.

States: before the first check, the setup checklist and "First results after <time>"; the AI block is absent (flag) before Phase 9.

### 5.3 Rank Tracker

Route `rankings`. Permissions: `data:read` to view; `keywords:write` for add, edit, import, archive; `runs:trigger` for "Check now". Phase 4 (table), Phase 5 (analytics columns, summaries).

```
+------------------------------------------------------------------------------------------+
| Rankings  [Saved view v]                 [Add keywords] [Import] [Export] [Columns]       |
| Filter bar: Location Device Window Compare | Group Tag Intent Rank bucket URL Feature AIO |
|------------------------------------------------------------------------------------------|
| 1,000 tracked · 986 checked · Top 3: 88 · Top 10: 301 · Top 20: 488 (of 986 checked)     |
| Avg rank 9.1 across 612 ranked · distribution bar                                        |
|------------------------------------------------------------------------------------------|
| [] Keyword         Loc/Dev  Rank  Prev  Chg     Best  Target URL  Ranking URL   Vol  KD  |
|                                                                  Intent  SERP  AIO  Acme  |
|                                                                  HubSpot  Trend(30)       |
| [] best crm for..  US/desk  4     6     ^2      2     /pricing ok  /pricing     2.4K 41  |
| [] crm pricing     US/desk  >20   14    lost    9     /pricing !  (none)       880  33  |
| [] crm for startup US/mob   12    new   first   12    -           /blog/crm    1.3K 29  |
+------------------------------------------------------------------------------------------+
```

Columns (default set in bold, rest in the column chooser):

| Column | Content |
|---|---|
| **Keyword** | Text, location and device chips, tags on hover, stale badge, cannibalization icon |
| **Current rank** | Organic rank or "Not in top N" chip; depth in tooltip |
| **Previous** | Previous comparable check (same or greater depth coverage) |
| **Change** | Numeric when both ranked; otherwise categorical label: new, lost, first check, unchanged beyond, consistent beyond ([09-rank-tracking-methodology.md](09-rank-tracking-methodology.md) section 4). Neutral color with arrow |
| Best rank | With date tooltip |
| **Target URL** | Path with match icon (match, mismatch "ranking URL is not the target URL", none set) |
| **Ranking URL** | Path; multiple owned URLs shown as "+1" with list |
| **Volume** | With Estimate badge in header; seasonal icon when flagged |
| KD | Provider metric, source in header tooltip |
| **Intent** | Enum chip; "manual" marker when overridden |
| **SERP features** | Icons: outline = present, filled = owned; accessible names list both |
| **AIO** | absent, present (not cited), cited #n |
| **Competitor positions** | One column per selected competitor (first 2 by default), rank or depth chip |
| **Trend** | 30-check sparkline with the depth band as a grey strip |
| Absolute rank, pixel displacement proxy | Secondary |
| Volatility, URL stability | With "10 ranked checks needed" insufficient state |
| GSC clicks, impressions, avg position | Labeled GSC, low-data rule |
| Priority, group, last checked | |

> Superseded by design system: rank changes render through `RankDeltaCell` as `↑5`, `↓3`, `0`, `New` or `Lost` (empty on first check), colored only beyond the keyword's normal movement with `New` and `Lost` always colored, and SERP features use `SERPFeatureList` (owned in `primary-text`, present in `foreground-muted`). The default columns, widths and priorities are those of the Rank Tracker template, with location and device in the keyword tooltip. See [22-content-formatting.md](design-system/22-content-formatting.md) §3 and [24-page-templates.md](design-system/24-page-templates.md) §9.3.

Filters: location, device, group, tag, topic, intent, rank bucket (1, 2 to 3, 4 to 10, 11 to 20, 21 to 50, 51 to 100, beyond), ranking URL (contains, equals, is target, is not target), SERP feature (present or owned, per type), AIO state, stale, cannibalization class, change type (improved, declined, new, lost).

Interactions: row click opens the keyword quick view drawer; bulk actions on selection (add or remove tags, move to group, set priority, set target URL, archive, check now within quota, create prompts from keywords); inline edit of target URL and tags (editor); column header menus for sort and hide.

> Superseded by design system: a row click opens the keyword in the right inspector (480 px), not a quick view drawer. See [16-drawers-dialogs-popovers.md](design-system/16-drawers-dialogs-popovers.md) §1.1.

Data: `GET .../rank-tracker/keywords?filters` (rows with state, metrics, competitor ranks, last 30 ranks for sparklines), `GET .../rank-tracker/summary?filters`.

States: stale rows show the badge and last successful check; keywords added today show "First check pending"; a filter with no matches offers "Clear filters".

> As built (keywords UI, step 5 part 1, 2026-10-05): the route is `[workspace]/[project]/seo/rankings`, and a project opens on it. The data comes from `GET {P}/tracked-keywords` (`include=metrics,groups,terms`) and its bulk routes, not from the `rank-tracker` paths above, which the backend did not build. The table holds the metrics columns only: Keyword (location, device, search engine and language in its tooltip), Volume (Estimate in the header tooltip), KD, CPC, Intent, Priority, Group, Tags and Added. A keyword with no metrics reads "Pending" before Labs has answered and "No data" after an empty answer. Volume, KD, CPC, Priority, Keyword and Added sort, and the default is Volume descending. The rank columns of the table above (current rank, previous, change, best, target URL match, ranking URL, SERP features, AIO, competitor positions, trend), the metric strip and sparklines wait for rank collection (step 5 part 2), as do Export, saved views and "Check now". The user asked for three of them first: current position, the change since yesterday's check and the ranking URL. A project that tracks up to 10,000 keywords loads them whole, in pages of 200, and sorts and searches them in memory; above that the table pages on the server with the API's sort and cursor (page size 100 or 200).
>
> Filters are chips (13-filters-search.md), each under one URL key: `grp` (group), `tag` (terms of the vocabularies the project sees), `dev`, `loc`, `lang`, `intent`, `stage`, `prio` (at most), `src`, `depth`, `vol` (at least) and `kd` (at most). The toolbar's search is `q`; `archived=true` is the Active and Archived view switch, not a chip; `sort`, `cols`, `density` and `inspect` (`keyword:<id>`) complete the URL. Everything is kept across a reload and a shared link; a value that does not read is dropped and a toast says which filter. A project with no keywords shows an empty state with Add keywords; no match offers "Clear filters".
>
> Bulk actions on the chosen rows, in the template's order: Add tags, Move to group, Set target URL, Set priority, Refresh metrics (with `runs:trigger`), then Archive and Delete. "Select all N matching" sends the filters rather than the ids. Archive and Unarchive need no question up to 100 keywords and end in a toast with Undo (by filter there is no Undo); above 100 each asks first with the count (12-tables.md section 14), and Delete always asks, with the exact count. Archive and Unarchive sit last in the bar but are drawn neutral; only Delete is destructive. When the bar is too narrow for every action (the inspector open beside the table at 1280 px), the actions that do not fit go into a More actions menu in the same order, Delete last. Ids go to the API in requests of 5,000, and a change that landed in part says so. The selection is dropped when the filters, the view or the API's search change. Add keywords is a 560 px dialog: one keyword per line (700 characters each, repeats once), location, language, device (Desktop, Mobile, Desktop and mobile, from the project's keyword default), groups, tags and priority; the search engine is Google and not a control. Keywords tracked already come back as skipped with "Show it" (and "Unarchive" for an archived one), refused ones with their reason, and a restored deleted keyword is told apart. A quota error says how many fit.
>
> The inspector (a row opens it, `j` and `k` step through the table's rows in the current sort) has one tab, Overview: Volume, KD and CPC, searches by month as a bar chart with its table view, Groups and tags, Tracking (target URL, priority, intent, funnel stage and the depth profile, which changes through a dialog with a reason because it starts a configuration version), Competitors (include or exclude per competitor) and the configuration history. Each card edits in place with its own save; Archive is in its More menu with Undo, and Unarchive is there too without one: Archive undoes it. An inspector for a keyword that is not known yet (a shared link, a list that has not reached it) is titled by its type, so the heading that takes focus is never empty. Groups are kept in a tree (Manage groups, from the More actions menu with `keywords:write`: add, rename, "Move to", delete with its subgroups, members unlinked); a group typed as a path such as `Blog/Guides` in Add keywords, Move to group or the inspector is created, parents first, when the form is saved. New keywords show "Pending" and the list reads again every 30 seconds while a row on screen has no metrics (D8: within minutes). "Refresh metrics" (More actions, the bulk bar) asks what to refresh (the chosen keywords, those matching the filters, or all stale ones), shows the day's remaining manual runs ("14 of 20 left today"), and follows the run in the page header with its progress.

> As built (rank columns, step 5 part 2, 2026-10-06, plan `docs/superpowers/plans/2026-10-06-rank-columns-ui.md`): the rows carry `state` (`TrackedKeywordState`), and the table gains Rank, Change, Ranking URL, Best rank and Updated, in the template's order after Keyword: Rank and Change are tier 1 (always shown), Ranking URL, Volume, KD and CPC tier 2 (from 1280 px), Intent, Priority and Group tier 3 (from 1440 px), Best rank tier 3 and off by default (the column chooser lists it), Tags and Updated tier 4 (from 1680 px) and Added tier 4. The default sort is still Volume descending. Rank, Change, Best rank and Updated sort (`current_rank`, `rank_change`, `best_rank`, `last_observed_at`); Ranking URL does not. To keep the Keyword column at 280 px or more at 1440 px and 320 px or more at 1280 px, the screen sets the widths: Rank 72, Change 88, Ranking URL 180, Volume 88, KD 72, CPC 96, Intent 96, Priority 72, Group 104, Tags 104, Updated 160 and Added 112 px. The rank change column type is 84 to 88 px wide (12-tables.md section 5 says 56 / 48 / 72), because the header "Change" beside its sort arrow needs 84 px: 72 px cut it to "Cha", and with a lower minimum the width resolver shrank it to about 75 px at 1680 px. Measured in the e2e flow, the Keyword column is 394 px at 1280 px, 282 px at 1440 px and 200 px at 1680 px, where every column of the set shows, the Keyword column sits at its minimum and the other columns give up part of their width (Rank to 65 px, Change to 86 px, Updated to 136 px). That is accepted as recorded: Added and Tags, the last two columns of tier 4, may move to the column chooser later if the Keyword column needs the room at 1680 px.
>
> A pure model (`lib/format/rank-display.ts`) turns the API's facts into what a cell shows; the cells (`features/rankings/rank-cells.tsx`) only lay it out. Rank is the number, right aligned; `>20` in tertiary text, for the depth of that check, when the keyword is beyond it (a screen reader hears "not in top 20"); "Pending" before the first check; a 14 px warning icon named "Check failed" for a keyword that never had a good check (the API keeps `current` from the last good check, so `failed` occurs only then). A cell that claims a rank without the rank, the depth or the check time shows "Pending" rather than a number. Two marks, 12 px glyphs 2 px before the value (so a stale rank never looks current, at any table width): a clock when the API flags the keyword stale (`is_stale`), with the hidden word "stale", and a warning glyph when `consecutive_failures` is above zero beside a rank or `>20` from the last good check, with the hidden words "last check failed". The tooltip adds the previous rank, the last successful check of a stale keyword and the failure. Change is an arrow glyph and the places (`↑5`, `↓3`), `0`, "New" or "Lost", with no icon and no badge box, and the words in hidden text; the first check of a keyword that has been checked once, a keyword still beyond the depth ("still beyond tracked depth") and a `consistent_beyond` pair ("no change within the depth checked", since one side may have a rank) show nothing visible and only their words for a screen reader, and a keyword that has no good check yet (not checked, or every check failed) says nothing at all in Change. Color marks a move of more than 2 places, and New and Lost always. The API sends no figure for a keyword's normal movement, so the rule of 22-content-formatting.md section 3 (more than twice the mean daily change, at least 2 places) is applied with a fixed threshold of 2: this is a limit until the API supplies the mean. Ranking URL is the path in mono with the host hidden (a project tracks one domain) and `+1` when a second URL of the project ranks; its last 12 characters never shrink and the start gives way to an ellipsis by CSS, so a long article URL still ends in what tells it apart (the column's width is the browser's to know, so the code counts no characters of it); "Not ranking" when nothing does, "Pending" before the first check and "n/a" after a failed one (tooltip "The last check failed"), which Best rank says in the same words. Updated is the last successful check, with a "Stale" marker before the date from the API's `is_stale` and never worked out in the page; a keyword whose every check failed shows "Check failed" with the marker as well (the API judges it from its creation). Beside a marker the date stays in one piece and the pair wraps, the marker above the date, before it could spill into the next column. The rank cell's tooltip gives the check and the depth ("Rank 3, Oct 6, 2026 · 02:00 UTC, depth 20") and the previous rank; the Rank cell carries the stale mark itself, so a stale keyword shows below 1680 px too. Every tooltip is the description of the focused cell (the table's `cellTip`), so a keyboard and a screen reader reach it.
>
> Filters: `rank` (Top 3, 4 to 10, 11 to 20, 21 to 50, 51 to 100, Beyond depth), `chg` (Improved, Declined, Entered, Lost) and `stale` (field "Freshness", option "Stale", so the chip reads "Freshness: Stale"), each a single choice, since the API has one range of places and joins its rank filters with AND; the template's bucket facets with counts and several buckets at once wait for an API that supplies them. A link that names several values of a single-choice chip (`rank=top3,top10`) keeps the first and says the others were left out, as for any filter of a link that does not read. They send `filter[rank_gte]` and `filter[rank_lte]` (`rank_is_null=true` for Beyond depth), `filter[improved]`, `filter[declined]`, `filter[rank_change_label_in]` (`new` for Entered, `lost` for Lost) and `filter[is_stale]`, only when chosen, and "Select all N matching" carries the same members in the body filter, and because a rank filter follows the daily check, the screen counts the matches again (a list read of one row with the same filters) just before it deletes, archives or changes them by filter: when the count is no longer the one the person confirmed, nothing is sent, the list is read again and the dialog says "The keywords that match changed since you chose them: N now. Choose again." Actions on chosen ids need no count. A keyword never checked matches none of them. A new keyword shows "Pending" in Rank, and the poll that fills in metrics also waits for the first rank check of a keyword added within the last hour that has not been checked, laying the rank state over the row when it arrives and giving up on a row after 15 minutes of visible time, as for metrics; an older keyword that was never checked (a paused or budget-blocked project, an old import) is not polled for. Rows that tie on a sort come in row id order in client mode, as the API orders them in server mode, so a rank sort lists the same keywords in the same order in both.
>
> Still to come, each with its own plan: the sparkline, SERP features, AI Overview and competitor columns, target URL match, the metric strip, "Check now", the inspector's rank history, group-by, and Previous rank, Absolute rank and the other chooser extras. A keyword whose checks within the shared depth are both beyond it has an empty Change though it may show a rank (the methodology compares within the smaller depth of the two checks).

> As built (copy and link controls, 2026-10-06): the Keyword cell has a copy button that copies the keyword text, and the Ranking URL cell shows its path as a link to the whole canonical address (`target="_blank"`, `rel="noopener noreferrer nofollow"`, only for an `http` or `https` address without a user name or password, other addresses stay plain text) with a copy button for that address exactly as the API sent it. The link is in the link color and underlined on hover and focus. Departure from section 7.2, [design-system/20-accessibility.md](design-system/20-accessibility.md) section 9.1 rule 4 and [design-system/12-tables.md](design-system/12-tables.md) section 6 (the `URLCell` row): the link is not the `ExternalLink` component and has no external-link icon, and there is no hover "open" icon, because a 14 px icon would take width from the 180 px Ranking URL column, which has none to spare; its name says "Open /pricing in a new tab", and `nofollow` is kept. The buttons show on row hover, when the cell has focus and always on a touch screen, and show a check for 2 seconds with a polite "Keyword copied" or "Ranking URL copied"; a refused copy ends in an error toast. The copy button lies over the end of the cell, so the Ranking URL column keeps its width and the Keyword column its 280 px at 1440 px; beside a `+N` marker it has a place of its own, so the marker is never covered. A click on the link or a button does not open the keyword; a click elsewhere in the cell does. The grid keeps its one tab stop: F2 on a focused cell (on a Mac laptop usually fn+F2) moves into its controls, Tab and Shift+Tab step between them, Enter or Space activates (Space on the link is taken by the table, which clicks it instead of scrolling), Escape returns to the cell, and Enter on the cell still opens the inspector; widget mode ends when focus goes to anything that is not a control of the cell, and not when the window loses focus. The grid's hint mentions F2 only on a table with a column that holds such controls ([design-system/12-tables.md](design-system/12-tables.md) section 9, "Controls in a cell").

#### 5.3.1 Add and import keywords

Routes `rankings/import` and a dialog for manual add. Steps: source (paste, CSV, from GSC suggestions later), column mapping (auto by header, editable), validation preview with counts: new, duplicate, variant, conflict, invalid, over quota, with per-row reasons and the default action per case ([08-seo-keyword-system.md](08-seo-keyword-system.md) section 3.3), then confirm. Progress polls the import job. The downloadable report link appears on completion. Device `both` shows as two rows in the preview.

> Superseded by design system: keyword import is a 720 px multi-step dialog (Upload, Map columns, Review, Confirm) over Rank Tracker, where the `rankings/import` route renders Rank Tracker with that dialog open, and manual add is a 560 px dialog. See [16-drawers-dialogs-popovers.md](design-system/16-drawers-dialogs-popovers.md) §1.1 and §4.6.

> As built (keywords UI, step 5 part 1, 2026-10-05): the Import button needs `imports:write`, and `/{workspace}/{project}/seo/rankings/import` is Rankings with the dialog open (`seo/rankings/layout.tsx` keeps Rankings mounted, so closing returns to the table). The source is a CSV file (up to 50 MB, UTF-8; the API reads CSV only, no XLSX) or pasted text (one keyword per line, with a tab and `|` between tags). Before uploading, the browser reads the file's first 64 KiB for every header and three sample rows, and refuses a file that is not UTF-8, is empty, has no rows, or repeats a header. The upload goes through `XMLHttpRequest` for its progress bar, and the dialog then polls the import until its preview is ready. Defaults for rows that leave a field out are chosen on Upload: location, language, device.
>
> Map columns is a step for files only. Each file header maps to a field (Keyword, Country, Location, Language, Device, Tags, Topic, Group, Intent, Funnel stage, Priority, Target URL, Depth profile) or to Ignore, auto-mapped by header, with a sample beside it; Keyword is required and `column_mapping` names only mapped headers. Tags and topics ask for their vocabulary on the row that maps them (for a paste with tabs, on Upload), and the API's `needs_mapping` codes (`keyword_column_missing`, `tags_vocabulary_missing`, `topic_vocabulary_missing`) show on the row they concern. The `competitors` column is not offered.
>
> Review shows the counts per outcome (New, Duplicate, Variant, Archived, Invalid, Over quota) and, for each outcome with rows, what it means and its first 20 rows with the row number (and the part of a `device: both` row), the keyword and, for an invalid row, its reason code in words. There is one choice per outcome: duplicates are skipped or merged (their groups and tags join the tracked keyword), and archived keywords are left or unarchived with the file's settings. Rows that repeat an earlier row of the file are always skipped. Over quota blocks the last step: the final button is disabled (`finalDisabled` of `StepperDialog`) and the step says why. Confirm lists what will be created, merged, unarchived and skipped, and its button names the result ("Import 1,204 keywords").
>
> After Confirm the dialog closes and the page header shows the progress of the write (`CollectionProgress`), which a reload finds again; the finished toast says how many were added, updated and skipped and offers "Download report" (the streamed CSV). A preview expires after 7 days and says so; closing the dialog past the first step asks first, and cancelling before Confirm drops the import.

### 5.4 Keyword Detail

Route `keywords/[tkId]`, also as a drawer. Permission `data:read`; actions as in 5.3. Phase 4 (rank history, snapshots, features, AIO history), Phase 5 (metrics, URL changes, competitors), Phase 10a (related prompts, AIO cross-view), Phase 12 (GSC panel).

```
+--------------------------------------------------------------------------------------+
| best crm for startups   US · desktop · google · depth 20 (deep Mon)   [Check now] [...]|
| Target /pricing (ranking) · Tags: comparison · Group: Product/CRM · Vol 2.4K (Estimate)|
|--------------------------------------------------------------------------------------|
| Rank history  [organic] [absolute] [competitors v] [events] [deep checks]            |
|  1 |      ___                                                                        |
| 10 |  ___/   \____   |v2                                                             |
| 20 |- - - - - - - - -|- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - |
|    |//// Not in top 20 ////  o   o      ////////////////////////////////////////////  |
|--------------------------------------------------------------------------------------|
| SERP features (last 30 checks)       | Ranking URL changes                          |
| AIO       ##.####..######### (owned) | 09-12 /blog/crm -> /pricing                  |
| PAA       ###############...         | 08-30 /pricing -> /blog/crm                  |
| Video     ....######........         |                                              |
|--------------------------------------------------------------------------------------|
| SERP snapshots [date v] [compare with v]    | Competing domains                     |
|  1 hubspot.com/... organic                  | Domain      Rank now  30d ago  Role   |
|  AIO block (cites acme.com #2)              | hubspot.com 1         2        comp.  |
|  2 [Ad] ... excluded                        | g2.com      3         3        3rd    |
|--------------------------------------------------------------------------------------|
| AI Overview history (table)  | Related AI prompts (per engine rates)  | GSC (Google-  |
|                              |                                        | reported)     |
+--------------------------------------------------------------------------------------+
```

> Superseded by design system: from a list the keyword opens in the right inspector (480 px), not a drawer, and the full page at `/seo/keywords/[tkId]` has a `MetricStrip` under the header and the tabs Overview, SERP snapshots and Diagnostics. See [16-drawers-dialogs-popovers.md](design-system/16-drawers-dialogs-popovers.md) §1.1 and [24-page-templates.md](design-system/24-page-templates.md) §9.4.

Sections:
1. **Rank history** (4.6 rule 2): organic rank, optional absolute rank, competitor lines, events, boundaries (depth profile or location changes). Summary: best, worst, average and median with `n_ranked / n_checks`, days in top 10, volatility, URL stability.
2. **SERP snapshots:** results in page order with position, type, escaped title, host, role chip, inline features (AIO with citations, PAA), ads marked "Ad, excluded from organic rank". Compare mode: two checks side by side with moved, new and dropped markers and top-10 RBO distance. "Reproduce" opens the provider `check_url` through `ExternalLink`.
3. **Competing domains:** latest top 20 with rank now and at the comparison date.
4. **Ranking URL changes:** `url_changed` timeline, target match, cannibalization evidence when flagged, with "Possible causes to check" labeled as hypotheses.
5. **SERP features strip:** heatmap of feature type by check (last 30): empty, present, owned; presence rate per row.
6. **Related AI prompts:** active links with type, per-engine rates (`k of n`, CI), primary marker; suggested links with "Activate" (`prompts:write`).
7. **AI Overview history** ([10-serp-feature-tracking.md](10-serp-feature-tracking.md) section 5): date, device, location, present, own cited (position), competitors cited, sources, organic rank at the same check, "View AIO".
8. **GSC panel** "Google Search Console (Google-reported, impression-weighted)": own chart and axis, low-data rule, never on the rank chart.
9. **Demand:** volume history (Estimate), trend, seasonality; link to diagnostics when a drop or loss event exists.

Data: `GET .../keywords/{tk}`, `.../history?from&to`, `.../serp-snapshots`, `.../serp-snapshots/{id}`, `.../features-history`, `.../url-changes`, `.../aio-history`, `.../linked-prompts`, `.../gsc`.

### 5.5 Landing Pages and Page Intelligence

Routes `pages` (list) and `pages/[urlId]` (detail). Permission `data:read`. Phase 5 (SEO columns), Phase 10a (AI columns), Phase 12 (first-party columns), Phase 13 (third-party pages).

**List:** owned URLs with keywords ranking, average rank (with count), top 3 and top 10 counts, volume represented (Estimate), visibility contribution, target coverage, AIO citations (checks), ChatGPT, Gemini and AI Mode citation units (separate columns), retrieved-not-cited count (ChatGPT), GSC clicks and impressions (labeled). Toggle "Include third-party pages" (Phase 13) switches to pages cited for the project's topics.

**Detail:**

```
+-------------------------------------------------------------------------------+
| acme.com/pricing                                   [open page] [copy URL]      |
|-------------------------------------------------------------------------------|
| SEO                | AI Overview        | ChatGPT | Gemini | AI Mode | GSC     |
| 14 keywords rank   | cited in 22 checks | 31 units| 9 units| 12 units| 4.1K clk|
|-------------------------------------------------------------------------------|
| Weekly trends: small multiples, one per channel, shared time axis             |
|-------------------------------------------------------------------------------|
| Keywords ranking with this URL (table)  | Prompts citing this URL (table)     |
| Associated mentions (same block, labeled association) | Retrieved not cited   |
+-------------------------------------------------------------------------------+
```

Sections follow [15-seo-ai-correlation.md](15-seo-ai-correlation.md) section 6. The "Associated mentions" block carries the note "Mentions in the same answer block as this citation. Association, not proof the page says this." First-party columns carry their source chips and, for GA4, the two classifiers side by side.

Data: `GET .../pages?filters`, `GET .../pages/{urlId}`, `.../pages/{urlId}/keywords`, `.../pages/{urlId}/citations`, `.../pages/{urlId}/trends`.

### 5.6 Prompt Explorer

> Superseded by design system: the page is "Topics & Prompts" and opens on a Topics tab, with the prompts of each topic grouped under it and a topic drawer; the list below is its Prompts tab. See [24-page-templates.md](design-system/24-page-templates.md) section 9.5 and [ADR-DS-022](design-system/adr/ADR-DS-022-topics-and-prompts.md).

Routes `prompts` (list) and `prompts/[promptId]` (detail). Permissions: `data:read`; `prompts:write` to add and edit; `runs:trigger` for "Run now"; `panels:core:modify` for core changes. Phase 6 (list, editor, versions), Phase 9 (metrics), Phase 10a (fan-out links), Phase 14 (statistics drawer extras).

**List:**

| Column | Content |
|---|---|
| Prompt | Text (2 lines), branded chip, importance, persona preamble indicator |
| Topic, intent, type | Chips |
| Panels | Core, discovery, experiment, custom chips |
| Mention rate per engine | One `RateCell` per selected engine: value, `k of n`, mini CI bar; insufficient state below 4 observations |
| Citation, recommendation rates per engine | Chooser columns |
| SOV (own) per engine | |
| Change | Per engine delta vs comparison window; colored only if detectable (per-prompt changes are rarely detectable, so most are grey) |
| Volatility | Flip rate, citation Jaccard distance |
| Linked keywords | Count and primary keyword with its current rank |
| Last observed | Stale badge |
| Versions | Count; boundary icon if a version changed in window |

Filters: panel (default core), topic, intent, funnel stage, prompt type, persona, engines, country and language, branded (default exclude; "Branded prompts" is a saved view with `branded=only`), importance, linked keyword present, "detectable changes only".

**Detail:**

```
+------------------------------------------------------------------------------------+
| "What is the best CRM for a 20-person startup?"  v3 · core since 2026-06-01        |
| Preamble: none · Topic CRM > Startups · commercial · recommendation · not branded   |
| [Edit] [Run now] [Diagnostics] [Statistics]                                         |
|------------------------------------------------------------------------------------|
| Engine    Mention        Citation      Recommend.   Top-3 list   Outcome mix        |
| ChatGPT   8 of 12 [ci]   5 of 12       6 of 12      4 of 9       ####====..  (4)    |
| Gemini    3 of 4  [ci]   1 of 4        insufficient              ##==..             |
| AI Mode   2 of 4         2 of 4        n/a                                          |
|------------------------------------------------------------------------------------|
| Trend per engine (small multiples, CI bands, version and model markers)            |
|------------------------------------------------------------------------------------|
| Tabs: Answers | Citations | Competitors | Recommendation | Volatility | Fan-out |   |
|       Related keywords | Timeline                                                  |
+------------------------------------------------------------------------------------+
```

> Superseded by design system: Prompt Detail has 6 tabs (Overview, Answers, Citations, Competitors, Fan-out, History), with Recommendation and Related keywords inside Overview and Volatility and Timeline inside History, because pages allow at most 6 tabs. See [24-page-templates.md](design-system/24-page-templates.md) §9.6 and [11-navigation.md](design-system/11-navigation.md) §6.

- **Rates:** per engine as counts with intervals when n is small (doc 17 section 3.3); recommendation shows classification coverage ("classified 11 of 12 mentions").
- **Outcome mix** (A4): 100% stacked bar per engine, four segments, never collapsed.
- **Answers:** observations with engine, date, replicate, status and facts; invalid ones greyed with reason and excluded. Selecting one opens the evidence viewer (4.9).
- **Citations:** top domains and pages per engine with new and lost markers and `min_support`.
- **Competitors:** mention, recommendation and SOV per entity per engine; gap (A14) with paired interval.
- **Recommendation:** A5, A6, and sentiment distribution (A13, four shares, never a score) with example spans.
- **Volatility:** flip rate, citation Jaccard (temporal, within-run), within-run disagreement; descriptive only.
- **Fan-out** (engines with fan-out only): queries by frequency, matched keywords with rank (F3, F5), "Add to keyword inbox".
- **Related keywords:** link type, organic rank, AIO status, volume.
- **Timeline:** version diffs with change kind, author and reason; panel membership; model and extractor changes.
- **Edit prompt:** live lint warnings (doc 11 section 4), change kind (wording, typo, context), reason required in a locked core panel, warning "This creates version 4. Charts will show a boundary." Metadata edits create no version.

Data: `GET .../prompts?filters&engines`, `GET .../prompts/{id}`, `.../prompts/{id}/metrics?engines&window`, `.../prompts/{id}/observations`, `.../observations/{obsId}/evidence`, `.../prompts/{id}/citations`, `.../prompts/{id}/competitors`, `.../prompts/{id}/fanout`, `.../prompts/{id}/timeline`, `POST .../prompts/{id}/versions`.

### 5.7 Panels management

Routes `panels` and `panels/[panelId]`. Permissions: `data:read`; `prompts:write` for discovery, custom and experiment membership; `panels:core:modify` for core. Phase 6 (panels, membership, lock), Phase 9 (promotion criteria use metrics; sizing with measured flip rates, doc 19 `panels/{panel_id}/sizing`).

```
+----------------------------------------------------------------------------+
| Core panel  [Locked]  412 prompts · weekly · 3 engines                     |
| Changed in last 90 days: 6.1% (warning at 10%)                             |
|----------------------------------------------------------------------------|
| Membership history (timeline of adds and removals, reasons, actors)         |
|----------------------------------------------------------------------------|
| Sizing guidance                                                            |
| Measured flip rate: ChatGPT 22% · Gemini 18% · AI Mode 25%                 |
| With 412 prompts this panel can detect a weekly change of about 7 points   |
| (ChatGPT, alpha 0.05, power 0.8).  Try size: [ 600 ] -> about 6 points     |
|----------------------------------------------------------------------------|
| Promotion candidates from Discovery (criteria met: 23)   [Promote selected] |
+----------------------------------------------------------------------------+
```

- **Core lock:** lock state with who can change it. Unlocking needs `panels:core:modify` and a reason (doc 19 `PATCH {P}/panels/{panel_id}`); normal changes go through reasoned add and remove actions.
- **Membership history:** list and timeline with `valid_from`, `valid_to`, actor, reason; filters for adds and removals; the 10% warning banner when exceeded.
- **Promotion flow:** candidates table shows each criterion as a check column ([11-ai-prompt-system.md](11-ai-prompt-system.md) section 3.1): observations per engine (at least 3), tracked-entity mention share (at least 30%), not branded, near-duplicate similarity (under 0.8, with the nearest core prompt on hover). Promote opens a dialog: selected prompts, required reason, "Takes effect from the next cycle", resulting change percentage. Confirm requires `panels:core:modify`.
- **Sizing guidance:** calculator implementing the doc 17 section 7.2 formula client-side (a published formula, no data computation), fed with the API's measured flip rate per engine. Recommended ranges from doc 11 section 3.2 shown as reference text.
- Other panel types: discovery (free membership edits, cadence), experiment (frozen during experiment, Phase 15), custom.

### 5.8 SEO + AI Matrix

Route `matrix`. Permission `data:read`. Phase 10a (keyword mode), Phase 10b (cluster mode).

```
+----------------------------------------------------------------------------------+
| Matrix  Mode: (o) Keywords ( ) Clusters   AI axis: [Mention rate v]              |
| Engines: ChatGPT, Gemini, AI Overview (equal-weight)  Thresholds [Edit]          |
| Definition: AI presence = equal-weight mean of own mention rate on 3 engines;    |
| SEO strong = rank <= 10, weak = > 20 or not in top 20; AI strong >= 50%, weak <= 10%|
|----------------------------------------------------------------------------------|
|                 AI weak                      AI strong                            |
| SEO strong  [ 84 kw · 96K vol ]         [ 41 kw · 58K vol ]                      |
|             GEO opportunity             Visible in both                          |
| SEO weak    [ 212 kw · 71K vol ]        [ 9 kw · 7K vol ]                        |
|             Low visibility              AI without rankings                      |
| Near threshold: 133 · Insufficient AI data: 57 · Not tracked in location: 12     |
|----------------------------------------------------------------------------------|
| Scatter: x = rank bucket (jittered), y = AI presence, size = volume              |
|----------------------------------------------------------------------------------|
| Table: keyword-level channel row (all columns from doc 15 section 3)             |
+----------------------------------------------------------------------------------+
```

> Superseded by design system: quadrant labels are descriptive, "SEO strong, AI weak" (was "GEO opportunity"), "Strong in both" (was "Visible in both"), "Weak in both" (was "Low visibility") and "AI strong, SEO weak" (was "AI without rankings"), and the scatter's x axis is organic rank on a log scale with better to the right plus a "Not ranking" strip at the left edge, not jittered rank buckets. See [15-data-visualization.md](design-system/15-data-visualization.md) §8.

- **Thresholds control:** popover with the four thresholds and engine selection; defaults marked; changing them updates the URL and the printed definition line. The definition line is always visible and included in exports and screenshots.
- **AI axis metric:** mention, citation or recommendation rate.
- **2x2 grid:** counts and volume represented; quadrant labels from doc 15 section 4.1 with "Typical next step (hypothesis)" in a tooltip. Clicking a quadrant filters the table and scatter.
- **Near threshold, insufficient, not tracked in this location** are separate lists, not forced into quadrants.
- **Scatter:** ECharts scatter with `large` mode; point tooltip shows keyword, rank, per-engine rates with n. Brushing selects points into the table.
- **Table:** keyword-level channel row with every column of doc 15 section 3, each AI rate cell with n; "other device" marker when the link resolved to another device; GSC columns labeled.
- **Cluster mode:** rows are topic or cluster terms; SEO axis is volume-weighted visibility (strong at least 30%, weak at most 5%), AI axis is prompt-weighted mention rate over all prompts with the term.
- **Drill-down:** row opens keyword quick view; from there to prompt detail or diagnostics.
- Analyses from doc 15 section 5 are available as preset saved views on this screen (for example "Rank 1 to 3 without AIO citation", "Cited despite weak rankings").

Data: `GET .../matrix?mode&engines&aiMetric&thresholds&window&loc&dev`.

### 5.9 Citation Intelligence

Route `citations/[tab]`. Permission `data:read`. Phase 9 (domains and pages basic), Phase 13 (categories, publishers, opportunities, overrides).

Tabs:

| Tab | Content |
|---|---|
| Domains | C1 source share, C2 citation units, observations, prompts, trend vs previous window, category, role; per engine (engine selector); "All engines" shows per-engine columns side by side |
| Pages | Same at URL grain with escaped title, first seen, last seen |
| Categories | C4 category distribution per engine as 100% bars; C3 diversity (distinct domains, effective number of sources) |
| New and lost | C5 and C6 with `min_support` control (default 2) and the "lost after 2 windows" rule explained |
| Publisher opportunities | Doc 14 section 7 list: domain, reach, opportunity share, competitors mentioned, sample observations, cited page titles, category. Header copy: "Sources frequently cited in answers that mention competitors but not you." No causal claim |
| Retrieved, not cited | ChatGPT only (C8): domains and own pages retrieved but not cited; own pages highlighted as near misses |

> Superseded by design system: Citations has 3 tabs (Domains, Pages, New and lost) with "Retrieved, not cited (ChatGPT)" as a scope chip on Pages, and Categories and Publisher opportunities live under AI Visibility > Sources. See [24-page-templates.md](design-system/24-page-templates.md) §9.7 and [11-navigation.md](design-system/11-navigation.md) §1.1.

Controls: engine selector, topic, window, `min_support`, "Include unresolved redirects" (off), "Include engine-internal links" (off). Category override (`entities:write` scope proposed, see section 11) on a domain row opens a dialog to set the workspace category.

Data: `GET .../citations/domains`, `/pages`, `/categories`, `/changes`, `/opportunities`, `/retrieved-not-cited`.

### 5.10 Competitor Intelligence

Route `competitors`. Permission `data:read`; `entities:write` to track candidates. Phase 5 (SEO side), Phase 9 (AI side), Phase 10b (cross-channel overlap), Phase 13 (source overlap).

```
+---------------------------------------------------------------------------------+
| Competitor  [HubSpot v]   vs  Acme (own)                                         |
|---------------------------------------------------------------------------------|
| SEO                                   | AI (per engine, core panel, non-branded) |
| SOV 24% vs 18%                        | SOV  ChatGPT 33 vs 27 · Gemini 35 vs 24  |
| Visibility 40% vs 31%                 | Recommendation 22% vs 18% (ChatGPT)      |
| Avg rank 6.2 (540 ranked) vs 9.1 (612)| Citation share 11% vs 9%                 |
| Keyword gap: they lead 188, we lead   | Gap vs own (A14) with paired interval    |
| 143, only they rank 61, only we 40    |                                          |
|---------------------------------------------------------------------------------|
| Beats us in both channels: 37 keywords (table)                                  |
| Source overlap (Jaccard 0.42) and top sources co-occurring with their mentions  |
|---------------------------------------------------------------------------------|
| Candidates to track                                                              |
| AI-mentioned brands not tracked: Pipedrive (48 prompts, ChatGPT, Gemini) [Track] |
| SEO domains in top 10 for 38% of keywords: zoho.com [Track]                      |
+---------------------------------------------------------------------------------+
```

"Track" opens the entity editor prefilled with display name, aliases and linked domains, and warns: "Adding a competitor changes SOV for all entities from today; a boundary will appear on SOV charts. SEO history is backfilled from stored snapshots."

> Superseded by design system: "Track" opens the 560 px Add competitor dialog (name, domains, colour slot preview, SOV effect note) prefilled from the candidate, not the full entity editor. See [16-drawers-dialogs-popovers.md](design-system/16-drawers-dialogs-popovers.md) §1.1.

Data: `GET .../competitors`, `.../competitors/{entityId}`, `.../competitors/candidates`.

### 5.11 Topic Explorer

> Superseded by design system: there is no separate Topics destination. Topics are listed on the Topics tab of "Topics & Prompts" ([ADR-DS-022](design-system/adr/ADR-DS-022-topics-and-prompts.md)). Its SEO visibility and Top 10 columns are columns of that tab. Term editing and influencing pages have no home yet: see the consequences in that ADR.

Route `topics`. Permission `data:read`; `taxonomy:write` to edit terms. Phase 2 (taxonomy tree), Phase 10b (metrics), Phase 13 (influencing pages).

Tree table (TanStack Table expanding rows, keyboard arrow left and right to collapse and expand):

| Column | Content |
|---|---|
| Term | Topic path, vocabulary chip |
| Keywords, prompts | Counts (subtree-aware) |
| SEO visibility | Volume-weighted, with keyword count |
| Top 10 | Count of checked keywords |
| Mention rate per engine | `RateCell` with n and prompts |
| Citation rate per engine | |
| AI SOV leader | Entity with highest SOV, per engine |
| Pages repeatedly influencing | Count (doc 14 section 6 rule), link |

A permanent note: "A keyword or prompt in two topics counts in both. Rows do not sum to parents or to the project total." Selecting a node opens a side panel with trends (small multiples), matrix counts for the cluster, and the influencing pages list.

Data: `GET .../topics/tree?engines&window`, `GET .../topics/{termId}`.

### 5.12 Keyword Discovery inbox

Route `discovery/keywords`. Permissions: `data:read`; `keywords:write` to triage and promote. Phase 11.

Table columns: text, source chips (labs ideas, PAA, related searches, autocomplete, GSC, competitor ranked, domain intersection, fan-out, manual) with source details on hover, search volume (Estimate), KD, CPC, intent, modeled AI demand (labeled, Estimate), GSC impressions (28 days), competitor best rank, opportunity score with a popover showing each factor ([08-seo-keyword-system.md](08-seo-keyword-system.md) section 5.2) and the note "Sorting aid, not a KPI", data as of date, status.

Tabs: New, Accepted, Snoozed, Rejected. Bulk actions: accept, reject (never suggest again), snooze 30 days, assign group, tags, topic, intent, priority, and **Promote to tracked**. The promote dialog sets location, device (both creates two), depth profile and group, and shows quota impact and the daily cost estimate before confirm. "Create prompts" hands selected keywords to the prompt generator (5.13).

> Superseded by design system: the status views (New, Accepted, Snoozed, Rejected) are a `SegmentedControl` in the table toolbar, and the page tabs under Discover are Keywords, Prompts and Opportunities. See [24-page-templates.md](design-system/24-page-templates.md) §9.11.

Optimistic updates move rows between tabs immediately; failures return them with a toast.

Data: `GET .../keyword-candidates?status&filters`, `PATCH .../keyword-candidates` (bulk), `POST .../keyword-candidates/promote`.

### 5.13 Prompt Discovery inbox

Route `discovery/prompts`. Permissions: `data:read` to view; `prompts:write` to triage; adding to core needs `panels:core:modify`. Phase 11 (Phase 12 for GSC and Bing sources, Phase 13 for LLM Mentions questions).

Columns: text (editable inline before accept), source chip (keyword template, LLM variant, GSC query, Bing grounding phrase, PAA, autocomplete, fan-out, customer FAQ upload), source reference link, near-duplicate indicator (opens a diff against the existing prompt), suggested terms and intent, linked keywords, modeled AI demand of the seed keyword (labeled, only for keyword-derived candidates), GSC impressions.

Honesty rules in the UI: generated candidates show "Generated phrasing, not an observed user prompt"; Bing grounding phrases show "Bing grounding phrase, not a user prompt"; no volume column.

Actions: accept, reject, snooze, edit text, assign terms and intent, **add to discovery panel** (default), add to core (admin, reason required), link keywords. A "Generate from keywords" panel takes selected tracked keywords, picks template sets and optionally LLM variants (shows budget left for generation), and previews candidates before they land in the inbox. The customer FAQ upload shows a warning to remove personal data and the 30-day file retention.

Data: `GET .../prompt-candidates`, `PATCH .../prompt-candidates`, `POST .../prompt-candidates/generate`, `POST .../prompt-candidates/{id}/accept`.

### 5.14 Diagnostics panels

Routes `diagnostics/keywords/[tkId]` and `diagnostics/prompts/[promptId]`, also opened as a wide drawer from Keyword Detail and Prompt Detail. Permission `data:read`. Phase 15 (not in MVP, doc 29).

> Superseded by design system: diagnostics are a Diagnostics tab inside keyword and prompt detail, not separate routes, navigation entries or a wide drawer. See [11-navigation.md](design-system/11-navigation.md) §1.1 and [24-page-templates.md](design-system/24-page-templates.md) §9.4.

```
+-------------------------------------------------------------------------------+
| Why am I losing "crm pricing"?                    Window: last 30 days        |
|-------------------------------------------------------------------------------|
| EVIDENCE                                                                      |
| E1 Rank history (depth band, events, boundaries)                              |
| E2 Ranking URL: /pricing -> /blog/crm on 09-12; target is /pricing            |
| E3 Competitors above us now vs 30 days ago (table)                            |
| E4 SERP composition: AI Overview appeared on 09-10; absolute rank 4 -> 9      |
| E5 AIO: present in 18 of 20 checks; own cited in 2; cited instead: g2.com ... |
| E6 Cannibalization: likely (evidence table)                                   |
| E7 GSC (Google-reported): impressions -12%, clicks -30%                       |
| E8 Linked prompts: ChatGPT mention rate change within normal variation        |
| E9 Search volume trend: stable (Estimate)                                     |
|- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -|
| HYPOTHESES (rule-generated, not conclusions)                                  |
| H1 A different page now ranks; check intent match of the new URL   [E2]       |
| H2 Traffic may be affected by SERP layout change, not rank loss    [E4]       |
+-------------------------------------------------------------------------------+
```

- Evidence sections are numbered in the fixed order of [15-seo-ai-correlation.md](15-seo-ai-correlation.md) sections 7 and 8; empty evidence sections say "No change" rather than disappearing, so the absence is visible.
- Hypotheses sit in a visually separate container (dashed border, "Hypothesis" badge on each), each linking to the evidence card that triggered it. There is no summary sentence and no causal wording.
- When the prompt diagnostic finds no detectable change, the top card reads "The drop is within normal variation for this prompt" with the interval.
- Prompt diagnostics include the side-by-side answer comparison (4.9 compare mode), lost own-cited sources, retrieved-not-cited own pages, fan-out queries where we rank poorly, and model changes.

Data: `GET .../diagnostics/keywords/{tk}?window`, `GET .../diagnostics/prompts/{id}?window&engines`.

### 5.15 First-party data

Route `first-party/[source]` with sources `gsc`, `bing`, `ga4`, `cloudflare`, `imports`. Permissions: `data:read` to view; `integrations:manage` to connect or disconnect (owner, admin); file import upload needs `imports:write` (doc 24 section 3.2). Phase 11 (GSC basic), Phase 12 (all).

Each source has a header with connection status (connected, `reauth_required`, revoked), property, last sync, coverage (days with data over days in window) and a "Sync paused since <date>" banner when re-auth is needed. Nothing here is combined with synthetic observations.

| Source | Content |
|---|---|
| GSC | Clicks, impressions, CTR, GSC average position (low-data rule) by date, query, page, country, device; provisional days marked; hidden query share explained; query matching with "Add to keyword inbox" for unmatched |
| GSC generative AI (import) | Imported impressions by date and breakdowns, each view naming its file and filter; "Impressions only; already inside Web totals"; Discover zeros as "0 or not reported" |
| Bing | API traffic, query and page stats; AI Performance imports badged "Sampled by Bing", citation share as imported; never compared with GSC |
| GA4 AI referrals | Sessions and key events, Google's AI Assistant channel and our classifier side by side, never summed; "Excludes Google AI Overviews and AI Mode; lower bound" |
| Cloudflare crawls | AI crawler requests by bot class, status, path; "Crawls are not citations" |
| Imports | Provenance per file: name, SHA-256 prefix, uploader, time, report kind, declared filters and filter source, date range, status (`needs_mapping`, `imported`, `superseded`, `failed`), row counts, 1,000-row truncation flag, original file download |

**Import wizard:** upload, declare report kind, property, date range and active filters, 20-row preview, validation, confirm. Duplicates report "Already imported on <date>"; a superseding import names the one it replaces. **Connect flows** are top-level navigations to the API host's OAuth start, returning to a property picker and backfill progress.

### 5.16 Costs

Route `[workspace]/costs`, project filter optional. Permissions: `costs:read` to view; `budgets:manage` to edit budgets. Phase 4 (spend, budget status, unit costs, forecast), Phase 9 (AI workloads), later forecast refinement.

```
+--------------------------------------------------------------------------------+
| Costs · September 2026 (workspace timezone Europe/Berlin; provider days UTC)   |
| Month to date USD 1,284.10 of 2,000.00 budget (64%) · soft limit 80%           |
| Forecast month end USD 1,910 (Estimate: month-to-date + planned runs)          |
|--------------------------------------------------------------------------------|
| Spend by day, stacked by workload | By provider | By project                   |
|--------------------------------------------------------------------------------|
| Unit costs: SERP check depth 20 USD 0.0012 · AI observation ChatGPT USD 0.0x   |
|--------------------------------------------------------------------------------|
| Budgets (workspace, per project, per workload) with status and action on hard  |
| Budget-blocked runs: 1 (ai_prompt, estimate USD 84.20, blocked by Project X)   |
| Reconciliation: provider spend vs our events, last run 00:45 UTC, diff 0.3%    |
+--------------------------------------------------------------------------------+
```

Data: `GET /api/v1/workspaces/{ws}/costs?period&project&groupBy`, `GET .../costs/unit`, `GET .../costs/forecast`, `GET/PUT .../budgets`, `GET .../costs/reconciliation`. Forecast is labeled Estimate and names its method. Actual cost always comes from provider-reported cost events; estimates from the price book are labeled as such.

> As built (keywords UI, step 5 part 1, 2026-10-05): Costs is `/{workspace}/costs` and needs `costs:read` (every role but viewer; a member without it sees a no-access state with "Back to Overview"). The scope is a month (UTC days; this month and the 11 before, URL key `month`), with the filters Project, Workload and Provider (`project`, `workload`, `provider`) applied to every cost query. The summary strip shows the month to date and the workspace budget with a read-only meter (`GET budgets/status`) and, when there are any, the runs blocked by a budget. Below it, spend by day is a stacked bar chart by workload, in fixed workload colors, with its table view, and a by-workload table beside it; the cost sources line (provider reported, from tokens, price book estimate) comes from `meta.cost_sources`. The tabs are By provider, By project, Unit costs (the price book, each figure labelled an estimate) and Budgets (read-only: budget editing and Settings > Budgets and usage come with the budgets API). Not built because their routes are not: the month-end forecast and projection, unit costs per SERP check or prompt, and the reconciliation panel. Costs are up to an hour behind, and the page says so.

> Moved (2026-10-06): Costs is `/{workspace}/{project}/costs`, inside the project shell, so the sidebar stays on screen: it is a sidebar item (`costs:read`, third section, after Integrations) and Settings > Workspace settings links to it in the open project. The data is still the workspace's whole spend, so the Project filter starts empty and the project in the route is no filter. `/{workspace}/costs` redirects on the server to the same page of the first project the member can open, keeping the query string (the month, the tab and the filters); only a member who can open no project stays on it, in the workspace shell. A member without `costs:read` gets the no-access state inside the project shell, and the sidebar has no Costs item for them.

### 5.17 Alerts

Routes `alerts/rules`, `alerts/rules/[id]`, `alerts/events`, `alerts/digests`. Permissions: `data:read` to view events; `alerts:write` (doc 24 section 3.2) for rule editing and acknowledging events. Phase 5 (SEO rules), Phase 9 (AI rules), Phase 13 (source rules).

> Superseded by design system: Alerts has no sidebar entry; events are reached from the notification bell and open in the inspector, and rules are managed under Settings > Alert rules. See [11-navigation.md](design-system/11-navigation.md) §1.1 and [23-application-patterns.md](design-system/23-application-patterns.md) §4.3.

**Rules builder:**

```
+---------------------------------------------------------------------------+
| New alert rule                                                            |
| Type: [rank_drop v]   Positions: [5]   From top N: [10] (optional)         |
| Scope: Groups [Product/CRM]  Tags []  Priority <= [2]  Device [any]       |
|        Location [US]  Keywords [all in scope: 312]                         |
| Delivery: [x] In-app  [x] Email (daily digest)  [ ] Slack webhook [v]      |
| Mode: ( ) Immediate (critical only)  ( ) Hourly digest  (o) Daily digest   |
| Preview: this rule matched 23 events in the last 30 days                   |
|                                                   [Cancel] [Save rule]     |
+---------------------------------------------------------------------------+
```

Rule types come from the SEO catalog ([08-seo-keyword-system.md](08-seo-keyword-system.md) section 12.1) and the AI catalog ([11-ai-prompt-system.md](11-ai-prompt-system.md) section 10), grouped by channel. Parameters render from the rule type's Zod schema. AI rules that depend on detectability say so ("Fires only when the 95% interval excludes zero"). The preview count requires an API backtest endpoint (proposed).

**Events feed:** grouped by rule and date, sorted by priority and volume, with anomaly-hold notices, flapping mutes ("Muted for 7 days after 3 firings"), links to filtered views. **Digests:** archive of sent digests rendered as they were sent (text, escaped).

Data: `GET/POST/PATCH .../alert-rules`, `GET .../alert-events`, `GET .../digests`, `POST .../alert-rules/preview`.

### 5.18 Operations and admin

Route `[workspace]/ops/*`. Permissions: owner and admin for everything; roles with `runs:trigger` see runs they triggered. Phase 4 (runs, tasks, dead letters, provider balance, schedules), Phase 7 (AI runs), Phase 12 (first-party syncs).

| View | Content |
|---|---|
| Runs | Workload, trigger (schedule, manual, backfill, retry), status (planned, running, completed, completed_with_errors, failed, cancelled, budget_blocked), window, tasks by status bar, estimate vs actual cost, started and finished times |
| Run detail | Virtualized task table: subject, status, attempts, error kind, last error, provider task id, cost; filters by status and error kind |
| Dead letters | Tasks in `dead` with error, attempts and raw error body (escaped); "Requeue" (`tasks:requeue`, `POST /api/v1/workspaces/{workspace_id}/tasks/{task_id}/requeue`), bulk requeue with confirm (`POST /api/v1/workspaces/{workspace_id}/tasks/requeue`) |
| Providers | Per provider: status (active, paused with a reason such as auth, payment or account limit, degraded), balance and days of runway at trailing spend, limiter state, last `tasks_ready` poll and outstanding tasks (readiness is polling only), last error |
| Schedules | Workload, selector, cadence, window, `next_run_at`, last run, `failed_schedule` flag |
| Freshness | Stale keyword and prompt ratios per project, overdue runs |

Platform-level panels (provider account balance for the platform key) appear only for installation operators; see section 11.

> As built (keywords UI, step 5 part 1, 2026-10-05): only Runs exists, at `/{workspace}/ops/runs`, and Settings > Workspace settings links to it as "Operations". The backend builds no workspace-wide runs list in part 1, so Runs is per project, on `GET {P}/runs`: a project picker (the member's projects, URL key `project` holding the slug) sits above the table, with the month scope (`month`) and the filters Workload, Status and Trigger (`workload`, `status`, `trigger`). It needs `data:read`, which every role but billing holds, so the page is not limited to owners and admins; a billing member gets the no-access state. The table lists a month's runs (the newest 2,000 of it, with a notice past that) with workload, status, start, trigger, tasks done and failed, actual and estimated cost and the window; the header says how many of the day's 20 manual runs the project has used. A run opens in the inspector with its summary and tasks by status, and an open run is read again every 10 seconds. Cancel is offered on planned and running runs to a member with `schedules:write`, or with `runs:trigger` on the manual runs they started, after a confirmation. Not built, since the tasks API is not: the run's task table (run detail), dead letters, providers, freshness and the workspace-wide list. The Schedules view of this table is Settings > Schedules (5.19), and a schedule's last run links to Runs of the project.

> Moved (2026-10-06): Runs is `/{workspace}/{project}/ops/runs`, inside the project shell, and a sidebar item (`data:read`, third section, after Integrations). The project is the route, so the project picker and its `project` URL key are gone; the month and the filters stay, and the project switcher keeps Runs when another project is chosen. A link of Settings > Schedules (the last run) and of Settings > Workspace settings ("Operations") opens Runs of the project in view. `/{workspace}/ops/runs` redirects on the server to the project the old link named in `?project=<slug>` when the member can open it, else to the first project they can open, keeping the other query keys; a member who can open no project stays on it, in the workspace shell, where Runs says there is nothing to show.

### 5.19 Settings

Workspace settings under `[workspace]/settings/*`; project settings under `[workspace]/[project]/settings/*`.

> As built (workspace setup, 2026-10-01): every settings section lives under `[workspace]/[project]/settings/*`, the workspace's ones too (`settings/workspace`, `settings/members`), so the local navigation lists all groups wherever a project is open; a route for workspace settings without a project waits for the settings plan. Every member sees every section; one they may not change is read-only with one `Banner`. Built: 5.19.1 without the 2FA policy, quota bars and delete (deferred, docs/29 section 1.1); 5.19.2 with invite, withdraw, role and project access change (fresh session) and removal; 5.19.5 General with pause, resume and archive (delete deferred).

| Section | Content | Permission |
|---|---|---|
| 5.19.0 Account (user level, not tied to a workspace) | Profile: name, photo, email (read-only), memberships with "Leave". Security: change password, TOTP state, recovery codes, turn off (blocked for owners and admins), own active sessions with revoke. Preferences: theme, default table density, number and date format, reduce motion, single-key shortcuts. Layout in [design-system/11-navigation.md](design-system/11-navigation.md) section 5 | any signed-in user (session only, no API keys) |
| 5.19.1 Workspace | Name, default timezone, 2FA policy, quota usage bars, delete (typed confirmation, re-auth, explains 30-day purge) | `workspace:update` (owner, admin); delete `workspace:delete` (owner) |
| 5.19.2 Members | Table (role, project restriction, 2FA, last active), invite, role change (re-auth), remove, role descriptions from the permission matrix | `members:manage` |
| 5.19.3 API keys | **Deferred** ([ADR-022](adr/ADR-022-python-backend-simplified-platform.md)): no page in V1. Planned design: list (prefix, scopes, expiry, last used, last IP). Create: scopes, expiry (default 365 days), IP allowlist, re-auth. Secret shown once; closing the dialog discards it from memory and the query cache | `api_keys:manage` |
| 5.19.4 Integrations | Connections and their properties, sites, zones; connect, reconnect, disconnect with optional data deletion; scopes in plain language | `integrations:manage` |
| 5.19.5 Projects | List, create (onboarding), archive, delete (re-auth). General: slug, timezone ("affects new business dates only"), defaults, depth profile, engines and replicates with estimate delta, deep check and AI weekdays | `projects:write` |

> As built (entities, 2026-10-01): Settings > Project settings gains Entities and aliases (`settings/entities`), the entity editor (`settings/entities/[entityId]`), Domains (`settings/domains`, read-only, by role) and Taxonomy (`settings/taxonomy`). Project General gains the site (`primary_domain`) and the location (`default_location_id`, shown from `default_location`). Step 1 of New project (5.1) asks for the site, the location and the own brand with its other names, sent as `own_entity`; competitors are added in settings, as steps 2 and 3 of the wizard wait for their own plan. The competitor limit counts competitors tracked in SEO; past it a new competitor starts as AI-only. A name that exists in the workspace (such as a competitor removed from this project) is offered for attaching rather than created twice. The editor shows the project's `entity_config_version`; re-derivation of past answers and its confirmation wait for observations (step 8), as does the server dry run. The alias test matches saved aliases only (G13). Taxonomy has add, rename, "Move to", delete with the terms under it, and paste a list of paths; drag and merge wait (step 11). The picker groups the vocabularies, the workspace's first, each group in the API's name order; a member limited to some projects reads the workspace vocabularies and changes only their projects' (the API answers `403`), and the terms refuse a place deeper than 10 levels (`too_deep`) or a parent deleted meanwhile (`parent_unknown`). A new primary own entity takes over from the old one in the same write, so `409 primary_own_exists` is gone; the alias test names the product of a `via_product` span (`via_entity_id`), and the alias editor says when an alias restates the entity's own name, whose options then set how the name itself is matched. New project's other names are checked for length and count (200 characters, 50 names), and an error on one of them (`own_entity.aliases.N`) shows on that field.

> As built (keywords UI, step 5 part 1, 2026-10-05): Settings lists only the sections that exist. Project settings: General, Entities and aliases, Domains, Taxonomy and Schedules (`settings/schedules`); Workspace settings: General and Members and roles, then links to Costs (with `costs:read`) and Operations (with `data:read`), which open the project's pages `/{workspace}/{project}/costs` and `/{workspace}/{project}/ops/runs` while a project is open and the workspace's own routes outside any project (the project switcher's Workspace group of the same links is gone since 2026-10-06: Runs and Costs are sidebar items, 11-navigation.md section 1.1). Engines, Alert rules, Data retention, API keys, Budgets and usage, Notifications and Billing wait for their plans.
>
> Schedules (5.19.5, `schedules:write` to change; others read the list under one `Banner`) is a table of the project's schedules: name and workload, what it collects (the selector in words: all keywords, keywords not refreshed in 25 days, a priority range, groups and terms), when (cadence, time and window in the schedule's zone, named when it differs from the project's) and the next run, with the last run as a line under it linking to Runs of the project. A paused schedule shows "Paused" in place of its next run. A menu per row offers Edit (only for the two workloads, `keyword_metrics` and `seo_rank`, on a daily, weekly or monthly cadence; a `cron` schedule or another workload is paused, resumed and deleted but not edited), Pause or Resume, and Delete, which asks first and answers `409 schedule_in_use` while keywords still follow the schedule. New schedule opens a dialog: name, workload, Repeats (every day, week with a weekday, or month with a day from 1 to 28), start time as `HH:MM`, window in whole hours, time zone, priority, the provider mode for rankings only (the standard queue by default, or the priority queue; `live` is not available for a schedule, and a metrics schedule is always live and leaves the field out) and the selector as radios per workload. A rank schedule that still holds `live` shows it as a disabled option, "Live (no longer available)", and sends no provider mode until a queue is chosen. A change sends only the fields that differ, so a rename never rewrites a selector the form cannot show whole, and the API's field errors (`window_start_local`, `required` and `not_applicable` days, `timezone_unknown`, `selector_empty`, `selector_conflict`, `group_unknown`, `term_unknown`) appear on their fields. Every write waits for the answer, and the toast says when the schedule runs next. Previews of a schedule (what it would pick) and `cron` wait for step 10.
>
> Keyword defaults is a section of General (5.19.5), saved on its own with "Save defaults" (`projects:write`; others see the values): the default device (Desktop, Mobile, Desktop and mobile), the default depth profile and the default check frequency, kept in `seo` of `{P}/settings` as a merge patch of only the members that changed, so a save never overwrites another member's change. There is no search engine setting (the API tracks Google only), the visibility settings are left out, and `until_own_match_100` is not offered. Add keywords reads the default device from it. General's two forms (the project's details and the keyword defaults) report unsaved changes to the page together, so leaving it asks one question.

#### 5.19.6 Entities and aliases editor

Route `[project]/settings/entities/[id]`. Permission `entities:write`; read-only for others.

```
+----------------------------------------------------------------------------------+
| Entity: HubSpot   Role: competitor   Track SEO [x]  Track AI [x]  Ambiguous [ ]   |
| Parent entity: none      Disambiguation hints: crm, marketing                    |
|----------------------------------------------------------------------------------|
| Domains                                                                           |
| hubspot.com      scope: registrable                                               |
| blog.hubspot.com scope: host                                                      |
|----------------------------------------------------------------------------------|
| Aliases                                    mode           case  negative  context |
| HubSpot                                    word boundary  no    no        no      |
| Hub Spot                                   word boundary  no    no        no      |
| HubSpot Academy                            word boundary  no    yes       no      |
|----------------------------------------------------------------------------------|
| Test against sample answer                                                        |
| [ paste text, or pick: recent observation v ]                                     |
| Result: 3 accepted spans, 1 dropped by negative alias, 0 uncertain                |
| (highlighted text as in the evidence viewer, with scores per span)                |
| [Run against last 50 observations on the server]  before: 31 mentions, after: 29  |
|----------------------------------------------------------------------------------|
| Saving bumps entity config to v13 and re-derives the last 90 days.   [Save]       |
+----------------------------------------------------------------------------------+
```

- Alias fields: text, match mode (word boundary, exact case, regex), `case_sensitive`, `is_negative`, `requires_context`. Regex aliases are validated by the API with RE2 semantics; the form shows the API's error.
- Domain rules: domain, match scope (registrable, host, path prefix) with the path prefix field when chosen. Conflicts with another entity's domain at the same specificity are shown as a warning ("own wins").
- **Test tool:** extraction is Python on the server (`sightline.extraction`, doc 13), so the tool calls `POST {P}/alias-test` (debounced 300 ms) and renders the returned spans with the evidence viewer plus debug detail (score per span, dropped spans, disambiguation signals). Stages 3 to 7 are pure and take milliseconds, so the round trip stays interactive on the same origin. Testing unsaved aliases needs the request to carry the draft configuration (gap G13). "Run against last 50 observations" calls an API dry-run endpoint with the unsaved configuration and shows before and after mention counts per entity, so the server result is the authority.
- Save confirmation states the re-derivation scope and that charts will show a version boundary. Adding a competitor states the SOV effect (5.10).

| Section | Content | Permission |
|---|---|---|
| 5.19.7 Taxonomy | Tree per vocabulary: add, rename, move (drag, or "Move to..." dialog for keyboard users), merge with affected counts, delete blocked while in use; auto-cluster review (Phase 11) | `taxonomy:write` |
| 5.19.8 Schedules | Per workload: cadence, window in project timezone, priority, provider mode, selector, next run; monthly estimate change shown before save | `schedules:write` |
| 5.19.9 Budgets | Per workspace, project and workload: limit, soft limit %, action on hard limit, month status | `budgets:manage` |
| 5.19.10 Notifications | Email recipients, Slack webhooks (stored as secrets, masked, SSRF-validated by the API), test send, digest time | `alerts:write` |

## 6. Statistics drawer

Opened from any AI rate tile, rate column header, or trend chart via "Statistics". A right-side drawer, 560 px wide, focus-trapped, deep-linkable with `?stats=<metric>:<engine>`. Phase 9 (sections 1 to 3 and 5 with fixed-panel methods, BH movers list), Phase 14 (population inference, bootstrap for SOV, BH filtering on every other mover list).

> Superseded by design system: this content renders as a non-modal `StatisticsPanel` in the inspector region (560 px, `stats=<metric>:<engine>`, replacing an open record inspector with "Back to <record>") or in a record inspector's Stats tab, never as a focus-trapped modal drawer. See [23-application-patterns.md](design-system/23-application-patterns.md) §8.6.

```
+----------------------------------------------------------+
| Mention rate · ChatGPT · core panel · 28 days       [x]  |
|----------------------------------------------------------|
| 1 Estimate                                               |
|   Aggregation: (o) Prompt-weighted  ( ) Observation-wt   |
|   Prompt-weighted 34.0%   Observation-weighted 35.2%     |
|   250 prompts · 1,800 valid obs · replicates: 100 x 3    |
|   Per-prompt rate distribution (histogram, k/n)          |
|----------------------------------------------------------|
| 2 Uncertainty                                            |
|   Inference: (o) Fixed panel  ( ) Population (warning)   |
|   95% interval 31.2% to 36.9% (normal, fixed panel)      |
|   Method chosen because all prompts have 2+ replicates   |
|   and 250 >= 30 prompts.                                  |
|----------------------------------------------------------|
| 3 Period comparison  vs 2026-08-04 to 2026-08-31         |
|   Design: paired (same 243 prompts in both periods)      |
|   Change +1.8 pts, 95% interval -1.1 to +4.6             |
|   Gained in 41 prompts, lost in 19 (McNemar)             |
|   Result: within normal variation                        |
|----------------------------------------------------------|
| 4 Movers (BH at 10% FDR)                                 |
|   3 of 250 prompts show a detectable change              |
|   [Show all sorted by effect size]                       |
|----------------------------------------------------------|
| 5 Version boundaries in window                           |
|   extractor v3 -> v4 on 09-14  [Recompute old period]    |
|----------------------------------------------------------|
| 6 Panel sizing: detectable change ~ 9 pts at this size   |
+----------------------------------------------------------+
```

1. **Estimate.** Prompt-weighted (default, matches the tile) and observation-weighted side by side; with equal n per prompt the drawer says both are identical and why. A histogram shows per-prompt rates.
2. **Uncertainty.** Fixed panel by default, naming the API's method and reason (doc 17 section 4.2: normal interval when every prompt has replicates and there are at least 30 prompts, else Wilson on pooled counts). Population inference (Phase 14) shows the prompt-cluster bootstrap with a persistent warning: "Only meaningful if these prompts are a representative sample of real questions, which is rarely true." SOV bootstrap intervals compute lazily on open.
3. **Period comparison.** Paired when the panel is the same in both periods: mean per-prompt difference, paired bootstrap interval, McNemar gained and lost counts. Unpaired (panel changed, or two engines): Newcombe interval, labeled "may understate uncertainty". A breaking boundary between periods shows a warning.
4. **Movers.** Sorted by effect size; the "detectable" badge only on Benjamini-Hochberg survivors at 10% FDR, with the survivor count in the header.
5. **Version boundaries** with "Recompute old period with current extractor" (editor and above), which queues a re-derivation.
6. **Panel sizing** summary linking to the Panels calculator.

Copy in the drawer follows doc 17 section 2.3: claims are always "in N% of responses to our 250 tracked prompts", never "N% of AI answers about CRM".

## 7. Security in the frontend

### 7.1 Rendering untrusted content

- `dangerouslySetInnerHTML` is banned by ESLint (`react/no-danger`, error level, no exceptions list). The only HTML-producing path is `react-markdown` with `rehype-sanitize` (GitHub schema, raw HTML disabled, `javascript:`, `vbscript:` and `data:` URLs stripped), wrapped in one `SafeMarkdown` component; direct imports of `react-markdown` elsewhere are banned by lint.
- Evidence mode renders text as React children only (4.9).
- Raw provider HTML is shown as escaped text. Any future HTML preview goes in a sandboxed iframe without `allow-scripts`, served from a separate origin ([24-security.md](24-security.md) section 7.1).
- ECharts tooltip and label formatters escape collected strings with `echarts.format.encodeHTML`. A custom lint rule flags template literals or concatenation inside `formatter` functions that do not pass through the helper.
- Collected URLs are parsed with `new URL()`; only `http:` and `https:` become links, everything else renders as text. The visible link always shows the host next to the (attacker-controlled) title, so a misleading title cannot hide the destination.
- Third-party favicons and images are not loaded (they would reveal to third parties which pages users view); domains get letter avatars.

> Superseded by design system: domain-first tables (Citations, Sources, Competitors) show 16 px favicons from one allowlisted favicon endpoint configured in the CSP, with a neutral placeholder square on error or when favicons are disabled in settings, and keyword and prompt tables never show them. See [07-icons.md](design-system/07-icons.md) §5.

- CSV exports neutralize formula prefixes (4.8).

### 7.2 Links

`ExternalLink` is the only way to render an outbound anchor: `target="_blank"`, `rel="noopener noreferrer nofollow"`, scheme check, external-link icon with accessible text "opens in a new tab". Internal links use `next/link`.

### 7.3 Headers and CSP

Static headers are set in `next.config.ts` `headers()` for all routes:

| Header | Value |
|---|---|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `same-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=()` |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `X-Frame-Options` | `DENY` (legacy companion to `frame-ancestors 'none'`) |

The Content Security Policy needs a per-request nonce (`script-src 'self' 'nonce-...'` in [24-security.md](24-security.md) section 7.1), which a static `next.config` header cannot carry. The CSP is therefore set in `proxy.ts` (Next request middleware), which generates the nonce, sets the header, and passes the nonce to the root layout through a request header so Next applies it to its inline scripts. All authenticated pages are dynamic already, so nonce-based CSP costs no static optimization. Policy (doc 24 value plus additions marked):

```
default-src 'self';
script-src 'self' 'nonce-{n}' 'strict-dynamic';                 (strict-dynamic added)
style-src 'self' 'nonce-{n}';                                    (added; doc 24 omits style-src)
style-src-attr 'unsafe-inline';                                  (added, see below)
img-src 'self' data: blob: https://www.google.com/s2/favicons https://*.gstatic.com;
                                                                 (tightened from https:, see 7.1)
font-src 'self';                                                 (added)
connect-src 'self' https://*.ingest.sentry.io;                  (the API is same-origin under /api)
worker-src 'self' blob:;                                         (added: CSV export worker)
object-src 'none';                                               (added)
frame-ancestors 'none'; base-uri 'self'; form-action 'self';
upgrade-insecure-requests                                        (only when the page was requested over https)
```

> Superseded by design system: `img-src` also allows the single allowlisted favicon endpoint used for 16 px favicons in domain-first tables. See [07-icons.md](design-system/07-icons.md) §5.

As built (`buildCsp` in `apps/web/src/lib/security/csp.ts`, set by `src/proxy.ts`; the policy above is the production one):

- `style-src-attr 'unsafe-inline'`: the server-rendered HTML carries `style` attributes (Base UI's visually hidden inputs of radio groups and selects, sizes read from tokens in the preview). A nonce cannot cover an attribute, and a nonce-only `style-src` blocks them in Chrome. An attribute styles one element and cannot run code or load anything. Inline `<style>` and `<script>` elements still need the nonce. Base UI gets the nonce through `CSPProvider`, with `disableStyleElements` set, because React hoists its scrollbar `<style>` into `<head>` without the nonce; those two rules are in `globals.css`.
- `img-src`: the favicon endpoint answers with a redirect to a `gstatic.com` host, and a browser checks the host it is redirected to, so that host is allowed too.
- `upgrade-insecure-requests` is sent only when the request came over https (the URL's scheme, or `x-forwarded-proto` from Caddy). On plain http (a test run against `http://web:3000`, WebKit on localhost) it would send the page's own requests to an https origin that does not answer.
- The static headers of the table above are set in `next.config.ts`; `Strict-Transport-Security` only in production builds. The proxy adds `Cache-Control: private, no-store` to every page that needs a session.

Development (`NODE_ENV=development`) adds `'unsafe-eval'` to `script-src` (React rebuilds server error stacks with it), `ws:` to `connect-src` for hot reload, and uses `style-src 'self' 'unsafe-inline'` without the nonce, since the dev overlay's styles carry none and a nonce makes browsers ignore `'unsafe-inline'`. Production never has any of these. There are no preview deployments and no staging API ([ADR-022](adr/ADR-022-python-backend-simplified-platform.md)). A Playwright test (`e2e/flows/`) asserts the CSP header on every visited page and that the browser reports no violation. The report endpoint is not built yet.

### 7.4 Session, tokens and CSRF

- The session cookie is `__Host-session`: `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, no `Domain` attribute (web and API share one origin); JavaScript never reads it. `proxy.ts` only checks its presence to redirect anonymous users to `/login` before rendering; validity is decided by the API.
- No tokens, keys or tenant data in `localStorage`, `sessionStorage` or IndexedDB. TanStack Query persistence is not used. `localStorage` holds only non-sensitive preferences. The theme is per device, not per user: next-themes keeps it under `sightline.theme`, and it stays after sign out. Every other preference (density, number and date format, reduced motion, single-key shortcuts; later column widths) is per user in this browser, under `sightline.pref.<user id>.settings` (`src/lib/preferences/`), and signing out removes every `sightline.pref.*` key. The collapsed sidebar is a cookie (`sightline-sidebar`), so the server renders the right width.
- API key secrets (when API keys ship, 5.19.3) exist only in component state of the one-time dialog.
- CSRF: the API relies on `SameSite=Lax` plus an Origin check (the app's own origin) for state-changing methods ([24-security.md](24-security.md) section 2.1). The frontend's obligations: all mutations are same-origin `fetch` calls to `/api/v1` with `Content-Type: application/json` (a cross-origin attempt would need a preflight, which the API never grants), no state change on GET, no HTML forms posting to `/api` (`form-action 'self'` plus the Origin check), and no server actions for mutations (3.4).
- Logout calls the API sign-out, clears the preference keys, and hard-navigates to `/login`, which drops the query cache with the page. The cache is not emptied first: a query still on screen would ask again, hear 401 and send the next person to sign in with this person's page in `next`.
- OAuth connect flows are top-level navigations to `/api/v1/...` on the same origin; `state` and PKCE are handled by the API.

### 7.5 Error reporting hygiene

Sentry `beforeSend` strips query strings from URLs (filters can contain keyword text), drops request bodies, and scrubs breadcrumbs with the shared redaction list. Console logging of API payloads is removed in production builds.

## 8. Testing

### 8.1 Component and unit tests (Vitest, Testing Library, MSW)

- `lib/format`: rates, intervals ("29% to 39%"), ranks, compact numbers, time zones including DST transitions in the project timezone.
- `MetricTile`, `RateCell`, `RankCell`, `DeltaBadge`: null values, insufficient data, beyond depth, detectable vs not detectable coloring, estimate badge, version boundary icon, missing denominator renders the contract error state.

> Superseded by design system: these tests target the canonical components `MetricItem`, `MetricCell`, `RankCell`, `Delta` and `RankDeltaCell`. See [25-component-inventory.md](design-system/25-component-inventory.md) §23 (item 48).

- Chart option builders (pure functions): depth band placement, `connectNulls: false`, CI band construction, version boundary markLines, no dual axis in cross-channel builders.
- Evidence viewer: span placement at exact offsets across block boundaries, overlapping via-product spans, uncertain styling, citation marker focus linking, `lang` attribute.
- Permission rendering: every screen rendered with each role fixture; snapshot of visible actions.
- Filter URL parsers: round trip, defaults omitted, invalid values ignored.
- MSW 2 handlers are typed against the generated `paths` types and built from fixture factories in `apps/web/src/mocks/factories/`, so a changed API schema fails type checking in the mocks. `NEXT_PUBLIC_API_MOCKING` picks the mode: `off` starts nothing, `pending` mocks only the endpoints the API does not have yet (`src/lib/api/pending.ts`) and sends the rest to the API, `all` mocks every route so no backend is needed. Tests use the same handlers.
- Accessibility at component level with `vitest-axe`.

### 8.2 XSS fixture tests (every CI run, required by [24-security.md](24-security.md) section 14)

A shared fixture set in `data/fixtures/xss/` (also used by the backend's API tests) feeds the answer renderer, SERP snapshot viewer, citation list, chart tooltips, tables and CSV export:

- `<script>` tags, `<img src=x onerror=...>`, `<svg onload=...>` in titles, snippets and answer text
- markdown links and images with `javascript:`, `data:text/html`, `vbscript:` and mixed-case or entity-encoded variants
- raw HTML blocks inside markdown, HTML comments, `<iframe>`, `<style>` with `expression()`
- Unicode tricks: right-to-left override in hosts and titles, zero-width characters
- URLs with credentials (`https://user:pass@host`) and non-http schemes
- CSV formula payloads (`=HYPERLINK(...)`, `+cmd`, `@SUM`)

Assertions: no element with `on*` attributes in the rendered DOM, no `href` or `src` with a non-http(s) scheme, no `<script>`, `<iframe>` or `<style>` elements from content, a sentinel `window.__xss` never set, CSV cells prefixed, ECharts tooltip DOM contains escaped text.

### 8.3 Contract tests

The client is generated from the API's committed OpenAPI document in CI: the job regenerates `schema.ts`, fails if it differs from the committed file, and runs `tsc --noEmit`, so any drift between API and client fails CI at client generation ([ADR-022](adr/ADR-022-python-backend-simplified-platform.md)). Recorded API responses (sanitized fixtures from the backend's API tests) are validated against the document's response schemas with a JSON Schema validator, which backs the decision not to re-parse responses at runtime (3.5).

### 8.4 End-to-end (Playwright)

Run against a Docker Compose stack of Caddy, web, API, PostgreSQL and Redis (the production topology, one origin) seeded with deterministic fixture data (no provider calls; collection results are inserted by the seed script).

Flows: sign up, verify, log in with TOTP, re-auth on a fresh-session action (member role change), log out; onboarding with resume; keyword CSV import with duplicate handling; Rank Tracker filters, back button, drawer and Keyword Detail depth band; prompt edit in a locked core panel (editor blocked, admin with reason creates a version and a boundary); panel promotion; matrix threshold change reflected in the definition line and export; evidence highlights against fixture spans; alias test worker and server dry-run agreement; inbox optimistic triage with forced rollback; alert rule to event to filtered view; viewer role tour with no write actions; another workspace's project id renders 404.

`@axe-core/playwright` runs on every visited page in E2E with WCAG 2.2 AA tags; violations fail the run. Keyboard-only tests cover the grid pattern in the Rank Tracker and Prompt Explorer and the statistics drawer focus trap.

> Superseded by design system: the statistics content is a non-modal `StatisticsPanel` that follows the inspector focus rules (focus to its title on open, back to the trigger on close), so keyboard tests cover those rules instead of a focus trap. See [23-application-patterns.md](design-system/23-application-patterns.md) §8.6 and [20-accessibility.md](design-system/20-accessibility.md) §4.3.

### 8.5 Visual regression (optional)

Playwright screenshots of chart components with fixed fixtures (rank history with depth band and boundaries, CI trend, matrix, feature strip) in a pinned Linux container, reviewed on change. Not a merge gate in V1.

> Superseded by design system: visual regression is part of CI enforcement from Phase 1, with Playwright `toHaveScreenshot` over every preview-route component state and the page templates in a pinned Docker image, in light and dark themes. See [26-implementation-guidelines.md](design-system/26-implementation-guidelines.md) §11 and [ADR-DS-015-visual-regression.md](design-system/adr/ADR-DS-015-visual-regression.md).

### 8.6 Performance tests

The 10,000-row table and 10,000-point scatter budgets (4.11) run in Playwright with CPU throttling in a nightly job; bundle budgets run with `size-limit` on every PR.

### 8.7 Copy lint

Unit test over `messages/en.json` and a Playwright check over rendered text fail on U+2014 and U+2013, matching the house writing rule.

## 9. Build and deploy on the droplet

### 9.1 Build and hosting

- `apps/web` builds with pnpm (committed lockfile) and `next build` with `output: 'standalone'`. CI builds the `web` image (multi-stage: dependencies, build, then a slim runtime holding `.next/standalone`, `.next/static` and `public`), pushes it to GHCR by digest, and the deploy workflow pulls it on the droplet ([ADR-022](adr/ADR-022-python-backend-simplified-platform.md), [22-infrastructure-devops.md](22-infrastructure-devops.md)). Runtime is one Node process (`node server.js`), 150 to 250 MB steady RAM.
- As built: the image is `apps/web/Dockerfile`, built from the repository root (`docker build -f apps/web/Dockerfile .`, context trimmed by `apps/web/Dockerfile.dockerignore`), since the lockfile and the pnpm workspace live there. Base `node:24-bookworm-slim` pinned by digest; `pnpm install --frozen-lockfile`; a production build (`NEXT_PUBLIC_APP_ENV=production` and `NEXT_PUBLIC_RELEASE` as build arguments, mocking off); a runtime of the standalone tree, `.next/static` and `public`, running `node apps/web/server.js` as user `node` on port 3000. The CI job, the push to GHCR and the Compose `web` service belong to the backend session's deploy plan and are not written yet.
- Caddy on the droplet terminates TLS for the single domain and routes `/api/*` to `api` and everything else to `web`. There is no Vercel project, no Turborepo and no function region.
- Production domain `<domain>`; the API is `/api/v1` on the same origin ([24-security.md](24-security.md) section 2.1).

### 9.2 Environment variables

Validated by a zod schema in `apps/web/src/lib/env/schema.ts`: the public values when `next.config.ts` loads (so a bad value fails the build), the server values at server start (`src/instrumentation.node.ts` ends the process and names the variable). `apps/web/.env.example` lists them.

| Variable | Scope | Purpose |
|---|---|---|
| `NEXT_PUBLIC_APP_ENV` | all | `production`, `development`, `test`; default `development`. A build without it is a development build, so the image passes `production` |
| `NEXT_PUBLIC_API_MOCKING` | all | `off`, `pending` or `all` (8.1); default `off`. Must be `off` in production: the schema refuses anything else |
| `NEXT_PUBLIC_RELEASE` | all | Image tag (git SHA) passed as a build argument, for Sentry releases; default `dev` |
| `NEXT_PUBLIC_SENTRY_DSN` | all | Browser and server error reporting. Not wired yet |
| `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` | build only | Source map upload; source maps are not served publicly. Not wired yet |
| `API_INTERNAL_ORIGIN` | server | Origin of the `api` service for server component fetches: scheme, host and port, no path (`http://api:8000` on the Compose network), since the generated paths carry `/api/v1`. Replaces `API_INTERNAL_BASE_URL`. Required in production; defaults to `http://127.0.0.1:8000` elsewhere |
| `API_PROXY_TARGET` | server, development only | When set, the dev server rewrites `/api/*` to this origin, so the browser reaches the real API on the app's own origin. Refused in production, where Caddy routes `/api` |

The browser needs no API URL: it calls the relative `/api/v1`. `NEXT_PUBLIC_*` values are inlined at build time, so the image is built for its environment; V1 has one environment (production) plus local development. No secret that grants API access exists in the frontend environment. The frontend authenticates only with the user's session.

### 9.3 Preview deployments

None. V1 has one environment and no staging API ([ADR-022](adr/ADR-022-python-backend-simplified-platform.md)). Pull requests build the `web` image and run Vitest, the Playwright E2E suite against the Compose stack (8.4), Lighthouse CI and `size-limit` in CI; reviewers run the app locally when they need to click through a change.

### 9.4 Caching

- Authenticated HTML responses: `Cache-Control: private, no-store`. No ISR or static generation for app routes; auth pages are static.
- Static assets (`/_next/static`) are content-hashed and immutable (Next default). With optional Cloudflare proxied DNS they are cached at the edge; nothing else is (4.11).
- Data caching is the API's responsibility (Redis with `data_version`) plus the TanStack Query cache in the browser (3.5). The Next.js data cache is not used for API responses (`fetch` with `cache: 'no-store'` in RSC).

### 9.5 Release flow

Merges to `main` build the `web`, `api` and `worker` images from the same commit. The deploy workflow runs `migrator`, restarts `api` and `worker`, then `web` ([ADR-022](adr/ADR-022-python-backend-simplified-platform.md)), so the frontend never runs ahead of the API it was generated against. Rollback is the previous image tag. Contract-breaking API changes still ship behind flags or versioned endpoints, so rolling back one image never meets an incompatible API.

## 10. Phase mapping of screens

MVP in this document means Phases 0 to 9 plus Phase 10a, as defined in [29-phase-roadmap.md](29-phase-roadmap.md): SEO tracking, AI tracking, the keyword-level SEO/AI matrix and page intelligence. Phase 10b (cluster matrix and longitudinal analysis) and Phases 11 to 15 are later.

| Phase | Frontend deliverables |
|---|---|
| 1 Foundation | Auth routes, app shell with the generated API client, workspace and project layouts, `/api/v1/me` permission and flag contexts, Settings: workspace, members, projects (API keys deferred); onboarding steps 1, 7 to 9 skeleton; error and loading system; CSP and headers; standalone `web` image; CI (lint, types, client generation check, unit, size-limit) |
| 2 Entities and taxonomy | Entities and aliases editor (without server dry-run until Phase 8), taxonomy editor, onboarding steps 2 and 3 |
| 3 Keywords | Keyword add and CSV import wizard, keyword list (configuration view), groups and tags, onboarding step 4 |
| 4 Rank collection | Rank Tracker table (current, previous, change, URLs, features, AIO state, sparkline), Check now, Ops: runs, tasks, dead letters, providers, schedules; Costs: spend and budget status; Settings: schedules, budgets |
| 5 SEO analytics | Overview SEO block, Rank Tracker summaries and analytics columns, Keyword Detail (history with depth bands, snapshots, features strip, URL changes, competitors), Landing Pages (SEO), Competitor Intelligence (SEO side), SEO alerts, saved views, Costs unit costs |
| 6 Prompts | Prompt list and editor with lint rules, versions timeline, Panels screen (core lock, membership history), onboarding step 5 |
| 7 AI collection | Engines settings, onboarding step 6, AI runs in Ops, Run prompt now, raw observation view |
| 8 Extraction | Evidence viewer, alias test tool with server dry-run, uncertain mention review, re-derivation progress |
| 9 AI analytics | Overview AI block, Prompt Explorer metrics and detail tabs, Citation Intelligence (domains, pages), Competitor Intelligence (AI side), AI alerts, statistics drawer sections 1 to 3 and 5, BH-filtered AI movers, panel sizing with measured flip rates |
| 10a Cross-channel (MVP) | SEO + AI Matrix (keyword mode), Page Intelligence (AI columns), Keyword Detail related prompts and AIO history cross-view, fan-out link suggestions |
| 10b Cross-channel (post-MVP) | Matrix cluster mode, cross-channel competitors, Topic Explorer metrics, domain dominance |
| 11 Discovery | Keyword and Prompt Discovery inboxes, prompt generator, GSC basic connect and query matching, auto-cluster review (competitor candidates arrive with Phases 5 and 8; fan-out links with 10a) |
| 12 First-party | First-party screens (GSC full, gen AI import, Bing, GA4, Cloudflare, imports), Integrations settings, Page Intelligence first-party columns, project-restricted memberships UI |
| 13 Source intelligence | Citation Intelligence categories, new and lost, publisher opportunities, retrieved-not-cited, category overrides, third-party pages, source alerts, influencing pages in Topic Explorer |
| 14 Advanced statistics | Statistics drawer population inference, SOV bootstrap, BH filtering on SEO and source mover lists, AIO-adjusted click estimate, official API benchmark engines (AI movers BH and panel sizing ship in Phase 9) |
| 15 Advanced intelligence | Diagnostics panels (keyword and prompt evidence), experiment panels with control groups, extended diagnostics hypotheses, fan-out rank coverage (F5), site-crawl-based discovery sources |

## 11. Gaps and open questions found in other documents

| # | Gap | Where | Proposal |
|---|---|---|---|
| G1 | Resolved: doc 19 exists; `MetricComparison` and `suppressed_reason` are in its section 2.6 | 03, 16 | Remaining path differences in section 5 "Data:" lines: doc 19 wins |
| G2 | Detectability is defined only for AI rates, not SEO deltas | 16, 17 | API returns `detectable: null`; UI shows neutral deltas. A volatility-relative rank indicator could join doc 17 in Phase 14 |
| G3 | Resolved in part: doc 24 section 7.1 now has `style-src`, `font-src`, `worker-src`, `object-src`. Open: this document proposes `img-src 'self' data: blob:` instead of the favicon service, and `upgrade-insecure-requests` | 24 section 7.1 | Decide on 7.3 |
| G4 | Resolved: doc 24 section 3.2 has `alerts:write`, `views:write`, `imports:write`, `api_keys:manage`, `taxonomy:write`; category overrides use `entities:write` | 24 section 3.2 | none |
| G5 | Resolved: platform operator flag `auth.users.is_platform_operator` (doc 24 section 3.1, doc 04 section 4) | 24 | none |
| G6 | Resolved: `ops:read` (owner, admin, editor) and `tasks:requeue` (owner, admin) in doc 24 section 3.2; run lists need `data:read` | 21, 24 | none |
| G7 | Evidence mode needs block offsets; persistence is unspecified | 13 stage 3 | API computes blocks on request with `sightline.extraction`, or persists per derivation |
| G8 | Resolved: forecast is month-to-date actual plus planned runs ([27-cost-model.md](27-cost-model.md) section 10.3) | 21, 24 | none |
| G9 | Alert rule backtest preview unspecified | 08, 11 | Add `POST .../alert-rules/preview` or drop the preview |
| G10 | Resolved by ADR-022: no Vercel and no preview deployments; web and API share one origin | 24 section 2.1 | none |
| G11 | Resolved in the data model (`core.saved_views`, doc 04 section 11.6); doc 19 has no saved-view endpoints yet | 04, 19 | Add `{P}/saved-views` CRUD to doc 19 (Phase 5, `views:write`) |
| G12 | Resolved: MVP is Phases 0 to 9 plus 10a ([29-phase-roadmap.md](29-phase-roadmap.md)) | 29 | none |
| G13 | The alias test tool (5.19.6) now runs server-side, but `POST {P}/alias-test` tests only the saved configuration | 19 section 3.4, 13 | Add an optional draft `entity_config` body field to `{P}/alias-test` (same permission, no persistence) |

> Superseded by design system: for G3, favicons are loaded from one allowlisted favicon endpoint in domain-first tables, so `img-src` must allow that endpoint rather than only `'self' data: blob:`. See [07-icons.md](design-system/07-icons.md) §5.
