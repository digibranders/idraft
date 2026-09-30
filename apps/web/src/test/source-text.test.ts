import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The house writing rule: no em-dash and no en-dash anywhere a person reads, which includes comments and
 * the message catalog. ESLint sees string literals and JSX text only, so this reads the files themselves.
 */
const APP_ROOT = path.join(import.meta.dirname, '../..');
const SKIPPED_DIRECTORIES = new Set(['node_modules', '.next', '.tmp', 'vendor', 'public']);
const READ_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.css', '.json', '.html', '.md']);
const GENERATED_FILES = new Set(['preview.compiled.css', 'schema.d.ts', 'tsconfig.tsbuildinfo']);
// Built from code points, so this file does not contain the characters it looks for.
const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return SKIPPED_DIRECTORIES.has(entry.name) ? [] : sourceFiles(entryPath);
    return READ_EXTENSIONS.has(path.extname(entry.name)) && !GENERATED_FILES.has(entry.name) ? [entryPath] : [];
  });
}

describe('source text', () => {
  const files = sourceFiles(APP_ROOT);

  it('finds the sources it is meant to read', () => {
    const names = files.map((file) => path.relative(APP_ROOT, file));
    expect(names).toContain('src/app/layout.tsx');
    expect(names).toContain('eslint.config.mjs');
    expect(names).toContain('design-preview/index.html');
    expect(names.some((name) => name.includes('node_modules'))).toBe(false);
  });

  it('has no em-dash or en-dash in any file, comments included', () => {
    const offenders = files.flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line, index) => (DASHES.test(line) ? [`${path.relative(APP_ROOT, file)}:${index + 1}`] : [])),
    );
    expect(offenders).toEqual([]);
  });
});
