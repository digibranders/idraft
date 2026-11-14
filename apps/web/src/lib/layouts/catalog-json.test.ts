import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const APP_ROOT = path.join(import.meta.dirname, '../../..');
const COMMITTED = path.join(APP_ROOT, '../../backend/src/idraft/api/layouts/catalog.json');
const GENERATION_TIMEOUT_MS = 30_000;

/**
 * The API checks layout documents against catalog.json, generated from catalog.ts and never edited
 * (owner decision D-10). This runs the package's own script and compares, so a catalog change
 * without `pnpm gen:layout-catalog` fails here (and in the backend's test_catalog.py).
 */
describe('the layout catalog the API checks against', () => {
  it(
    'is what `pnpm gen:layout-catalog` makes of the catalog',
    () => {
      const manifest = JSON.parse(readFileSync(path.join(APP_ROOT, 'package.json'), 'utf8')) as {
        scripts: Record<string, string>;
      };
      expect(manifest.scripts['gen:layout-catalog']).toBe('node scripts/gen-layout-catalog.mjs');
      const printed = execFileSync(process.execPath, ['scripts/gen-layout-catalog.mjs', '--stdout'], {
        cwd: APP_ROOT,
        encoding: 'utf8',
      });
      expect(printed).toBe(readFileSync(COMMITTED, 'utf8'));
    },
    GENERATION_TIMEOUT_MS,
  );
});
