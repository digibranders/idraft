import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(path.join(import.meta.dirname, '../../styles/globals.css'), 'utf8');

/** The declarations of one `@utility` block in globals.css. */
function utility(name: string): string {
  const match = new RegExp(`@utility ${name} \\{([^}]*)\\}`).exec(css);
  if (match?.[1] === undefined) throw new Error(`globals.css declares no @utility ${name}`);
  return match[1].replace(/\s+/g, ' ');
}

describe('the table type utilities (owner decisions of 2026-10-29)', () => {
  it('sets table body text to 12 / 16 px, weight 400', () => {
    const block = utility('type-table');
    expect(block).toContain('font-size: 0.75rem');
    expect(block).toContain('line-height: 1rem');
    expect(block).toContain('font-weight: 400');
  });

  it('keeps weight 500 at the table size for a strong cell', () => {
    const block = utility('type-table-strong');
    expect(block).toContain('font-size: 0.75rem');
    expect(block).toContain('line-height: 1rem');
    expect(block).toContain('font-weight: 500');
  });

  it('writes header labels 12 / 16 px in capitals with 0.04em tracking in the tertiary color', () => {
    const block = utility('type-table-header');
    expect(block).toContain('font-size: 0.75rem');
    expect(block).toContain('line-height: 1rem');
    expect(block).toContain('text-transform: uppercase');
    expect(block).toContain('letter-spacing: 0.04em');
    expect(block).toContain('color: var(--foreground-tertiary)');
  });

  it('leaves type-label, the label of everything that is not a table header, in sentence case', () => {
    expect(utility('type-label')).not.toContain('text-transform');
  });
});
