import { describe, expect, it } from 'vitest';

import { parseMarkdown, safeHref, type Block } from './markdown-subset';

const heading = (block: Block | undefined): { level: number; text: string } | null => {
  if (block?.kind !== 'heading') return null;
  return { level: block.level, text: block.children.map((node) => (node.kind === 'text' ? node.text : '')).join('') };
};

describe('parseMarkdown: headings', () => {
  it('reads one to six hashes, up to three spaces of indent, and drops closing hashes', () => {
    expect(heading(parseMarkdown('# One')[0])).toEqual({ level: 1, text: 'One' });
    expect(heading(parseMarkdown('###### Six')[0])).toEqual({ level: 6, text: 'Six' });
    expect(heading(parseMarkdown('   # Indented')[0])).toEqual({ level: 1, text: 'Indented' });
    expect(heading(parseMarkdown('## Title ##')[0])).toEqual({ level: 2, text: 'Title' });
    expect(heading(parseMarkdown('## Title   ##   ')[0])).toEqual({ level: 2, text: 'Title' });
  });

  it('keeps a hash that is not a closing sequence, and refuses what is not a heading', () => {
    expect(heading(parseMarkdown('# a #b')[0])).toEqual({ level: 1, text: 'a #b' });
    expect(heading(parseMarkdown('# a#')[0])).toEqual({ level: 1, text: 'a#' });
    expect(parseMarkdown('    # four spaces')[0]?.kind).toBe('paragraph');
    expect(parseMarkdown('#nospace')[0]?.kind).toBe('paragraph');
    expect(parseMarkdown('####### seven')[0]?.kind).toBe('paragraph');
  });

  it('ends a paragraph at a heading line', () => {
    expect(parseMarkdown('text\n# Head').map((block) => block.kind)).toEqual(['paragraph', 'heading']);
  });
});

describe('parseMarkdown: hostile input stays fast', () => {
  // Generous bound: the point is to catch a quadratic scan (a second or more at this size), not to time the machine
  const LIMIT_MS = 1000;
  const timed = (source: string): number => {
    const start = performance.now();
    parseMarkdown(source);
    return performance.now() - start;
  };

  it('parses a heading line with a long run of spaces and a trailing character in well under a second', () => {
    expect(timed(`# a${' '.repeat(50_000)}x`)).toBeLessThan(LIMIT_MS);
  });

  it('parses a heading line with many closing-hash lookalikes in well under a second', () => {
    expect(timed(`# a${' #'.repeat(25_000)} x`)).toBeLessThan(LIMIT_MS);
    expect(timed(`#${' '.repeat(50_000)}`)).toBeLessThan(LIMIT_MS);
  });

  it('parses long runs of other delimiters in well under a second', () => {
    expect(timed('- '.repeat(25_000))).toBeLessThan(LIMIT_MS);
    expect(timed('*a '.repeat(16_000))).toBeLessThan(LIMIT_MS);
    expect(timed(`[${'a'.repeat(50_000)}`)).toBeLessThan(LIMIT_MS);
    expect(timed('`'.repeat(50_000))).toBeLessThan(LIMIT_MS);
  });
});

describe('safeHref', () => {
  it('lets http, https and mailto through as given, and nothing else', () => {
    expect(safeHref('https://example.com/a')).toBe('https://example.com/a');
    expect(safeHref('mailto:a@example.com')).toBe('mailto:a@example.com');
    expect(safeHref('mailto:')).toBeNull();
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('https://user:pw@example.com/')).toBeNull();
  });
});
