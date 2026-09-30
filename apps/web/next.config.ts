import path from 'node:path';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

import { parsePublicEnv, parseServerEnv } from './src/lib/env/schema';

// The lockfile and node_modules live at the repository root (pnpm workspace), so file tracing for the
// standalone build and Turbopack both start there.
const REPOSITORY_ROOT = path.join(import.meta.dirname, '../..');

// A malformed NEXT_PUBLIC_* value fails the build here. The parsed values, defaults included, are then
// inlined through `env`, so the server and the browser read the same three values whatever the runtime
// environment holds (20 section 9.2).
const publicEnv = parsePublicEnv(process.env);

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/**
 * In development the API can run apart from the app (API_PROXY_TARGET, for example http://127.0.0.1:8000).
 * The browser still sends every call to the app's own origin, which passes `/api/*` on: the `Origin` header
 * then matches the API's APP_ORIGIN and the `__Host-session` cookie is stored for the app's origin. In
 * production the reverse proxy routes `/api`, and the server environment refuses API_PROXY_TARGET.
 */
function apiProxyTarget(): string | undefined {
  if (publicEnv.NEXT_PUBLIC_APP_ENV === 'production') return undefined;
  return parseServerEnv(process.env, publicEnv.NEXT_PUBLIC_APP_ENV).API_PROXY_TARGET;
}

const config: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: REPOSITORY_ROOT,
  turbopack: { root: REPOSITORY_ROOT },
  poweredByHeader: false,
  reactStrictMode: true,
  typedRoutes: true,
  env: { ...publicEnv },
  rewrites: async () => {
    const target = apiProxyTarget();
    return target === undefined ? [] : [{ source: '/api/:path*', destination: `${target}/api/:path*` }];
  },
};

export default withNextIntl(config);
