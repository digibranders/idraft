import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PREVIEW_SECTIONS, previewSection } from './registry';
import { PREVIEW_SECTION_SLUGS } from './section-slugs';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

// The canvas stub of the test setup cannot draw: the Charts section mounts real charts, so the canvas is stood in for
vi.mock('@/components/app/chart/echart', () => ({ EChart: () => <div data-testid="echart-canvas" /> }));

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
      'filters',
      'inspector',
      'data-display',
      'charts',
      'chart-parts',
      'overlays',
      'feedback',
      'metric-parts',
      'chart-grids',
      'domains-feeds',
      'controls',
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
      // Every section is titled by an h2, except the sections of a StatisticsPanel, which are h3 by design
      const groups = Array.from(container.querySelectorAll('section')).filter(
        (group) => group.closest('[data-slot="statistics-panel"]') === null,
      );
      expect(groups.length).toBeGreaterThan(0);
      for (const group of groups) expect(group.querySelector('h2')?.textContent).toBeTruthy();
      expect(await axe(container)).toHaveNoViolations();
    },
    SECTION_TIMEOUT_MS,
  );
});
