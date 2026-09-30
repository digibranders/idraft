/**
 * The three values the browser may know (20 section 9.2). next.config.ts validates them when the app is
 * built and inlines the result, defaults included, on the server and in the browser alike, so both sides
 * always agree. This module has no dependency: it is part of every client bundle that needs the mode.
 */
export const APP_ENVIRONMENTS = ['production', 'development', 'test'] as const;
/** `off`: every request reaches the API. `pending`: only endpoints the API does not have yet are mocked. `all`: no API is needed. */
export const MOCKING_MODES = ['off', 'pending', 'all'] as const;
export const DEFAULT_RELEASE = 'dev';

export type AppEnvironment = (typeof APP_ENVIRONMENTS)[number];
export type MockingMode = (typeof MOCKING_MODES)[number];
export interface PublicEnv {
  readonly NEXT_PUBLIC_APP_ENV: AppEnvironment;
  readonly NEXT_PUBLIC_API_MOCKING: MockingMode;
  readonly NEXT_PUBLIC_RELEASE: string;
}

/** The value when it is one of `allowed`. Anything else, which only an unvalidated run (a unit test) can produce, is the default. */
function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  return allowed.find((candidate) => candidate === value) ?? fallback;
}

// Each variable is named in full: the bundler replaces `process.env.NEXT_PUBLIC_X` only where it is written out.
export const publicEnv: PublicEnv = {
  NEXT_PUBLIC_APP_ENV: oneOf(process.env.NEXT_PUBLIC_APP_ENV, APP_ENVIRONMENTS, 'development'),
  NEXT_PUBLIC_API_MOCKING: oneOf(process.env.NEXT_PUBLIC_API_MOCKING, MOCKING_MODES, 'off'),
  NEXT_PUBLIC_RELEASE: process.env.NEXT_PUBLIC_RELEASE || DEFAULT_RELEASE,
};
