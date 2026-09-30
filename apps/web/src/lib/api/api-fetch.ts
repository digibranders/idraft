/**
 * The `fetch` every API client sends through. It is looked up at each request, not when the client is
 * made, so a test's MSW (which replaces `globalThis.fetch` when it starts) sees requests of clients made
 * before it.
 *
 * On the server, development with API mocking puts MSW's handlers in front of it (src/mocks/node.ts):
 * Next.js wraps `globalThis.fetch` with its own caching fetch, which keeps the original it found and so
 * passes by an interceptor that MSW installs later. The handlers are therefore called directly.
 *
 * The override lives on `globalThis` under a registered symbol: instrumentation, which sets it, and the
 * pages, which read it, are separate bundles and share no module state.
 */
export type ApiFetch = (request: Request) => Promise<Response>;

const OVERRIDE = Symbol.for('sightline.api-fetch');
const shared = globalThis as typeof globalThis & { [OVERRIDE]?: ApiFetch | undefined };

/** Sends every API request of this process through `fetcher` from now on. Called once, at start-up. */
export function overrideApiFetch(fetcher: ApiFetch): void {
  shared[OVERRIDE] = fetcher;
}

/** Back to `globalThis.fetch`. For tests of an override. */
export function clearApiFetchOverride(): void {
  shared[OVERRIDE] = undefined;
}

export function apiFetch(request: Request, init?: RequestInit): Promise<Response> {
  // Only mocking sets an override; a build with mocking off drops the lookup (the variable is inlined)
  const override = process.env.NEXT_PUBLIC_API_MOCKING === 'off' ? undefined : shared[OVERRIDE];
  return override === undefined ? globalThis.fetch(request, init) : override(new Request(request, init));
}
