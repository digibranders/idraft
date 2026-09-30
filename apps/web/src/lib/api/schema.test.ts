import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { reservedProjectSlugValues, reservedWorkspaceSlugValues, roleValues } from './types';

const APP_ROOT = path.join(import.meta.dirname, '../../..');
const GENERATION_TIMEOUT_MS = 30_000;

/**
 * schema.ts is generated, never edited. This regenerates it from the committed OpenAPI document with the
 * package's own script and compares, so a stale client fails CI instead of drifting from the API
 * (20-frontend-specification.md section 3.5). Run `pnpm gen:api` to update it.
 */
describe('the generated schema', () => {
  it(
    'is what `pnpm gen:api` makes of backend/openapi/v1.json',
    () => {
      const directory = mkdtempSync(path.join(tmpdir(), 'schema-'));
      try {
        const script = JSON.parse(readFileSync(path.join(APP_ROOT, 'package.json'), 'utf8')) as {
          scripts: Record<string, string>;
        };
        const [command, ...args] = (script.scripts['gen:api'] ?? '').split(/\s+/);
        if (command !== 'openapi-typescript') throw new Error('gen:api no longer runs openapi-typescript');
        // The output is redirected to a scratch file; without `-o` the tool would print, and with another
        // spelling the committed file would be overwritten, so anything else stops the test first
        const outputAt = args.indexOf('-o') + 1;
        if (outputAt === 0 || args[outputAt] !== 'src/lib/api/schema.ts') {
          throw new Error('gen:api must write src/lib/api/schema.ts with -o');
        }
        const output = path.join(directory, 'schema.ts');
        const withOutput = args.map((arg, index) => (index === outputAt ? output : arg));
        execFileSync(path.join(APP_ROOT, 'node_modules/.bin/openapi-typescript'), withOutput, {
          cwd: APP_ROOT,
          stdio: 'pipe',
        });
        const committed = readFileSync(path.join(APP_ROOT, 'src/lib/api/schema.ts'), 'utf8');
        expect(readFileSync(output, 'utf8') === committed, 'src/lib/api/schema.ts is stale: run pnpm gen:api').toBe(
          true,
        );
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
    GENERATION_TIMEOUT_MS,
  );

  it('carries the enums a form checks at runtime', () => {
    expect(reservedWorkspaceSlugValues).toContain('design-system');
    expect(reservedProjectSlugValues).toContain('projects');
    expect(roleValues).toEqual(['owner', 'admin', 'editor', 'analyst', 'viewer', 'billing']);
  });
});
