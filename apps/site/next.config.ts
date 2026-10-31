import path from 'node:path';
import type { NextConfig } from 'next';

// The lockfile and node_modules live at the repository root (pnpm workspace).
const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  turbopack: { root: path.join(import.meta.dirname, '../..') },
};

export default config;
