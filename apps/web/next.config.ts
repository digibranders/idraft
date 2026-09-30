import path from 'node:path';
import type { NextConfig } from 'next';

// The lockfile and node_modules live at the repository root (pnpm workspace), so file tracing for the
// standalone build and Turbopack both start there.
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
