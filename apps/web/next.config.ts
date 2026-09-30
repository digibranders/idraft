import path from 'node:path';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

import { parsePublicEnv } from './src/lib/env/schema';

// The lockfile and node_modules live at the repository root (pnpm workspace), so file tracing for the
// standalone build and Turbopack both start there.
const REPOSITORY_ROOT = path.join(import.meta.dirname, '../..');

// A malformed NEXT_PUBLIC_* value fails the build here. The parsed values, defaults included, are then
// inlined through `env`, so the server and the browser read the same three values whatever the runtime
// environment holds (20 section 9.2).
const publicEnv = parsePublicEnv(process.env);

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const config: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: REPOSITORY_ROOT,
  turbopack: { root: REPOSITORY_ROOT },
  poweredByHeader: false,
  reactStrictMode: true,
  typedRoutes: true,
  env: { ...publicEnv },
};

export default withNextIntl(config);
