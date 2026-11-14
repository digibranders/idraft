import { within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MetricPartsSection } from './metric-parts-section';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

// The panel specimens hold four inspector sections each, and axe walks all of it
const SECTION_TIMEOUT_MS = 30_000;

const GROUP_TITLES = [
  'Delta',
  'DeltaCell',
  'EngineLogo',
  'EngineBadge',
  'Meter',
  'BudgetMeter',
  'Banner in the inspector',
  'SampleCount',
  'ConfidenceIndicator',
  'MetricInfo',
  'StatisticsPanel',
];

const PANEL_STATES = ['Loading', 'Ready', 'Interim comparison', 'Insufficient', 'Empty', 'Error', 'Partial', 'Stale'];

describe('the metric parts section', () => {
  it(
    'shows one titled group per part, with every state of the statistics panel',
    async () => {
      document.documentElement.className = 'light';
      const { container } = renderWithProviders(<MetricPartsSection />);
      // The specimens hold sections of their own (the panel's), so only the groups' own headings count
      const headings = Array.from(container.querySelectorAll('section > header > h2')).map((node) => node.textContent);
      expect(headings).toEqual(GROUP_TITLES);

      const group = within(container).getByRole('heading', { level: 2, name: 'StatisticsPanel' }).closest('section');
      if (group === null) throw new Error('The StatisticsPanel group is missing');
      expect(group.querySelectorAll('[data-slot="statistics-panel"]')).toHaveLength(PANEL_STATES.length);
      // A row is named by its state ("Loading" is also read out by the loading panel itself)
      for (const state of PANEL_STATES) expect(within(group).getAllByText(state).length).toBeGreaterThan(0);

      expect(await axe(container)).toHaveNoViolations();
    },
    SECTION_TIMEOUT_MS,
  );

  it('shows each form of the confidence indicator', () => {
    document.documentElement.className = 'light';
    const { container } = renderWithProviders(<MetricPartsSection />);
    const group = within(container).getByRole('heading', { level: 2, name: 'ConfidenceIndicator' }).closest('section');
    if (group === null) throw new Error('The ConfidenceIndicator group is missing');

    const rowOf = (label: string): HTMLElement => {
      const row = within(group).getByText(label).parentElement;
      if (row === null) throw new Error(`The ${label} row is missing`);
      return row;
    };
    const labels = Array.from(group.querySelectorAll('.type-label')).map((node) => node.textContent);
    expect(labels).toEqual(['Text', 'Text and bar', 'Bar', 'Unknown']);

    const text = rowOf('Text');
    expect(text.querySelector('[data-slot="confidence-bar"]')).toBeNull();
    expect(text.textContent).toMatch(/%/);

    const both = rowOf('Text and bar');
    expect(both.querySelector('[data-slot="confidence-bar"]')).not.toBeNull();
    expect(both.textContent).toMatch(/%/);

    const bar = rowOf('Bar');
    expect(bar.querySelector('[data-slot="confidence-bar"]')).not.toBeNull();
    expect(bar.textContent).not.toMatch(/%/);

    const unknown = rowOf('Unknown');
    expect(unknown.querySelector('[data-slot="confidence-bar"]')).toBeNull();
    expect(unknown.textContent).not.toMatch(/%/);
    expect(unknown.textContent).toContain('n/a');
  });
});
