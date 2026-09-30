# Web app

The Next.js application of Sightline: App Router, React 19, TypeScript, Tailwind CSS 4 and the design system in `docs/design-system`. The plan it is built from is `docs/superpowers/plans/2026-09-30-web-app-foundation.md`.

## Commands

Run them in `apps/web`:

| Command             | What it does                                                       |
| ------------------- | ------------------------------------------------------------------ |
| `pnpm dev`          | Development server on http://localhost:3000                        |
| `pnpm lint`         | ESLint, including the design-system and import-boundary rules      |
| `pnpm typecheck`    | Route types, then `tsc --noEmit`                                   |
| `pnpm test`         | Vitest: `*.test.ts` in Node, `*.test.tsx` in jsdom                 |
| `pnpm format:check` | Prettier                                                           |
| `pnpm build`        | Production build (standalone output)                               |
| `pnpm gen:api`      | Regenerates `src/lib/api/schema.ts` from `backend/openapi/v1.json` |
| `pnpm run preview`  | Rebuilds the static design preview in `design-preview/`            |

Copy `.env.example` to `.env.local` for local settings. Every variable is validated when the app starts (`src/lib/env/schema.ts`).

## Three ways to run

### 1. Everything mocked, no backend

```bash
NEXT_PUBLIC_API_MOCKING=all pnpm dev
```

[MSW](https://mswjs.io) answers every API request: in the browser through `public/mockServiceWorker.js`, and on the server for requests from Server Components (`src/instrumentation.ts`). The handlers are in `src/mocks/handlers`, typed by the generated schema, so a change of the API contract breaks them at compile time.

The fixture workspace is Digibranders with five projects. Every fixture user has the password in `src/mocks/fixtures.ts` (`MOCK_PASSWORD`), and there is one user per role:

| Email                     | Role    | Notes                                                                             |
| ------------------------- | ------- | --------------------------------------------------------------------------------- |
| `ana@digibranders.test`   | owner   | Two-factor on: the code is `MOCK_TOTP_CODE`, a recovery code `MOCK_RECOVERY_CODE` |
| `tomas@digibranders.test` | admin   |                                                                                   |
| `priya@digibranders.test` | editor  |                                                                                   |
| `jonas@digibranders.test` | analyst | Limited to two projects                                                           |
| `mei@digibranders.test`   | viewer  |                                                                                   |
| `kwame@digibranders.test` | billing |                                                                                   |

The emailed links take the tokens in `MOCK_TOKENS`: `/reset-password#token=mock-reset-token`, `/verify-email#token=mock-verify-token`, `/invite#token=mock-invitation-token`. The invitation is for `lena@digibranders.test`, who has no account until she registers with it; she can then sign in with the password she chose until the page is reloaded.

As in the API, five wrong passwords or codes lock an address for 15 minutes. Who is signed in, and a name changed in the account settings, are kept in cookies, so the browser's mocks and the server's agree; failed attempts and registrations live in the memory of one process and a reload forgets them. Mocked cookies are written by script, so unlike the API's they are not HttpOnly.

Two things to know while working in this mode: the server's mocks pick up an edited handler only after the dev server restarts, and the mock worker stays registered in the browser after you switch mocking off (unregister it in the browser's developer tools, under Application and Service workers).

### 2. The real API, with mocks only for what it lacks

Start the backend as its README describes ("Run locally", then "Signing in locally" for the first account), then:

```bash
NEXT_PUBLIC_API_MOCKING=pending API_PROXY_TARGET=http://127.0.0.1:8000 pnpm dev
```

Open http://localhost:3000, not http://127.0.0.1:3000. The browser sends every call to the page's origin, and the development server passes `/api/*` to the API. The `Origin` header then matches the API's `APP_ORIGIN`, and the `__Host-session` cookie is stored for the app's origin. Chrome and Firefox accept that `Secure` cookie on `http://localhost`; Safari does not, so use one of the two.

In `pending` mode MSW answers only the endpoints of `src/lib/api/pending.ts`, which the backend has not built yet, and lets every other request through. With `NEXT_PUBLIC_API_MOCKING=off` nothing is mocked.

### 3. The production shape

`NEXT_PUBLIC_APP_ENV=production pnpm build`, then `pnpm start`, runs the standalone server. The environment has to be named: a build without it is a development build. In production `NEXT_PUBLIC_API_MOCKING` must be `off` (the build refuses anything else), `API_PROXY_TARGET` is refused (a development build would keep the one in `.env.local`), `API_INTERNAL_ORIGIN` names the API on the internal network (`http://api:8000` in Compose), and Caddy routes `/api` to the API and everything else to this app, on one origin.

## Where things are

| Path                 | What                                                                             |
| -------------------- | -------------------------------------------------------------------------------- |
| `src/app`            | Routes. `(internal)/design-system` is the component preview, a 404 in production |
| `src/components/ui`  | Primitives of the design system                                                  |
| `src/components/app` | Application components                                                           |
| `src/features`       | Features: each owns its data and composes components                             |
| `src/lib/api`        | The generated client, `apiQuery` and `apiMutation`, problems, retries            |
| `src/mocks`          | Fixtures, factories and MSW handlers                                             |
| `messages/en.json`   | Every visible string outside the internal routes                                 |
