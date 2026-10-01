import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PREVIEW_SECTIONS, previewSection } from './registry';
import { PREVIEW_SECTION_SLUGS } from './section-slugs';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

// A whole section holds every variant of a dozen components, and axe walks all of it
const SECTION_TIMEOUT_MS = 30_000;

describe('the preview registry', () => {
  it('lists the sections, in order, each once', () => {
    expect(PREVIEW_SECTIONS.map((section) => section.slug)).toEqual([
      'tokens',
      'typography',
      'sizes',
      'icons',
      'buttons',
      'forms',
      'badges',
      'tables',
      'overlays',
      'feedback',
    ]);
    expect(new Set(PREVIEW_SECTIONS.map((section) => section.title)).size).toBe(PREVIEW_SECTIONS.length);
    // The end-to-end and visual tests visit the sections by this list
    expect(PREVIEW_SECTIONS.map((section) => section.slug)).toEqual([...PREVIEW_SECTION_SLUGS]);
  });

  it('finds a section by its slug and nothing for an unknown one', () => {
    expect(previewSection('forms')?.title).toBe('Forms');
    expect(previewSection('display')).toBeUndefined();
    expect(previewSection('')).toBeUndefined();
  });
});

/*
 * Each section is rendered with the class next-themes puts on <html>. jsdom paints nothing, so this checks
 * structure (names, roles, table headers, nesting) in both themes, not contrast: the token tests cover
 * contrast in both themes, and the Playwright run checks it on the rendered pages.
 */
describe.each(PREVIEW_SECTIONS)('the $slug section', ({ title, render: Section }) => {
  // jsdom has no media queries; a table hides columns by the viewport's width
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });
  afterEach(() => {
    document.documentElement.className = '';
    vi.unstubAllGlobals();
  });

  it.each(['light', 'dark'])(
    'renders in the %s theme without an accessibility violation',
    async (theme) => {
      document.documentElement.className = theme;
      const { container } = renderWithProviders(
        <>
          <h1>{title}</h1>
          <Section />
        </>,
      );
      // Every specimen group is a titled section
      const groups = container.querySelectorAll('section');
      expect(groups.length).toBeGreaterThan(0);
      for (const group of groups) expect(group.querySelector('h2')?.textContent).toBeTruthy();
      expect(await axe(container)).toHaveNoViolations();
    },
    SECTION_TIMEOUT_MS,
  );
});
