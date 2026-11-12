import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ChartLegend, type LegendItem } from './chart-legend';
import { announce } from '@/lib/a11y/announcer';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

// The real announcer, watched: the legend speaks through it and never through a live region of its own
vi.mock('@/lib/a11y/announcer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/a11y/announcer')>();
  return { ...actual, announce: vi.fn(actual.announce) };
});

const ITEMS: LegendItem[] = [
  { id: 'a', name: 'ChatGPT', role: { kind: 'brand' }, pressed: true },
  { id: 'b', name: 'Gemini', role: { kind: 'palette', index: 2 }, pressed: false },
  { id: 'p', name: 'Previous period', role: { kind: 'reference' }, pressed: true },
  { id: 'o', name: 'Other engines', role: { kind: 'other' }, pressed: true },
];

const LABEL = 'Series in Mention rate';
const swatchOf = (name: string): Element | null =>
  screen.getByText(name).closest('li')?.querySelector('[aria-hidden="true"]') ?? null;

describe('ChartLegend', () => {
  it('renders nothing for one item', () => {
    renderWithProviders(<ChartLegend title="Mention rate" items={ITEMS.slice(0, 1)} />);
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.queryByText('ChatGPT')).toBeNull();
  });

  it('is a list named by the chart it belongs to', () => {
    renderWithProviders(<ChartLegend title="Mention rate" items={ITEMS} />);
    const list = screen.getByRole('list', { name: LABEL });
    expect(within(list).getAllByRole('listitem')).toHaveLength(4);
  });

  it('makes each item a toggle that says whether it is shown, and calls back with the id', async () => {
    const onToggle = vi.fn<(id: string) => void>();
    const { user } = renderWithProviders(<ChartLegend title="Mention rate" items={ITEMS} onToggle={onToggle} />);
    expect(screen.getByRole('button', { name: 'ChatGPT' })).toHaveAttribute('aria-pressed', 'true');
    const gemini = screen.getByRole('button', { name: 'Gemini' });
    expect(gemini).toHaveAttribute('aria-pressed', 'false');
    await user.click(gemini);
    expect(onToggle).toHaveBeenCalledWith('b');
  });

  it('shows a hidden series by strike-through and a muted colour, never by opacity (text contrast)', () => {
    const toggles = renderWithProviders(
      <ChartLegend title="Mention rate" items={ITEMS} onToggle={vi.fn<(id: string) => void>()} />,
    );
    const hidden = screen.getByRole('button', { name: 'Gemini' });
    expect(hidden.className).toContain('aria-[pressed=false]:line-through');
    expect(hidden.className).not.toContain('opacity-50');
    toggles.unmount();
    renderWithProviders(<ChartLegend title="Key" items={ITEMS} />);
    const key = screen.getByText('Gemini');
    expect(key.className).toContain('line-through');
    expect(key.className).not.toContain('opacity-50');
  });

  it('toggles from the keyboard with Enter and Space', async () => {
    const onToggle = vi.fn<(id: string) => void>();
    const { user } = renderWithProviders(<ChartLegend title="Mention rate" items={ITEMS} onToggle={onToggle} />);
    await user.tab();
    expect(screen.getByRole('button', { name: 'ChatGPT' })).toHaveFocus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onToggle.mock.calls).toEqual([['a'], ['a']]);
  });

  it('announces what a toggle hid or showed', async () => {
    const { user } = renderWithProviders(<ChartLegend title="Mention rate" items={ITEMS} onToggle={() => undefined} />);
    await user.click(screen.getByRole('button', { name: 'ChatGPT' }));
    expect(announce).toHaveBeenLastCalledWith('ChatGPT hidden');
    await user.click(screen.getByRole('button', { name: 'Gemini' }));
    expect(announce).toHaveBeenLastCalledWith('Gemini shown');
  });

  it('has no button without a toggle, and still lists the series', () => {
    renderWithProviders(<ChartLegend title="Mention rate" items={ITEMS} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('ChatGPT')).toBeInTheDocument();
  });

  it('draws a dot for a solid series and a dashed line for a reference or other series', () => {
    renderWithProviders(<ChartLegend title="Mention rate" items={ITEMS} />);
    expect(swatchOf('ChatGPT')).toHaveClass('size-2', 'rounded-full');
    expect(swatchOf('Gemini')).toHaveClass('size-2', 'rounded-full');
    expect(swatchOf('Previous period')).toHaveClass('w-3', 'border-t-2', 'border-dashed');
    expect(swatchOf('Other engines')).toHaveClass('w-3', 'border-t-2', 'border-dashed');
  });

  it('colours the swatch by role', () => {
    renderWithProviders(<ChartLegend title="Mention rate" items={ITEMS} />);
    expect(swatchOf('ChatGPT')).toHaveStyle({ backgroundColor: 'var(--chart-1)' });
    expect(swatchOf('Gemini')).toHaveStyle({ backgroundColor: 'var(--chart-2)' });
    // jsdom drops a border shorthand it cannot parse, so the custom property is read from the attribute
    expect(swatchOf('Previous period')?.getAttribute('style')).toContain('var(--chart-reference)');
  });

  it('draws the swatch it is given: a line for a solid series, a marker shape for a series with markers', () => {
    renderWithProviders(
      <ChartLegend
        title="Mention rate"
        items={[
          { id: 'a', name: 'ChatGPT', role: { kind: 'brand' }, pressed: true, swatch: 'line' },
          {
            id: 'b',
            name: 'Gemini',
            role: { kind: 'palette', index: 2 },
            pressed: true,
            swatch: { marker: 'triangle' },
          },
        ]}
      />,
    );
    expect(swatchOf('ChatGPT')).toHaveClass('w-3', 'border-t-2');
    expect(swatchOf('ChatGPT')).not.toHaveClass('border-dashed');
    const marker = swatchOf('Gemini');
    expect(marker?.tagName.toLowerCase()).toBe('svg');
    expect(marker?.querySelector('path, rect, circle')).not.toBeNull();
  });

  it('has no accessibility violations, as a list and as toggles', async () => {
    const plain = renderWithProviders(<ChartLegend title="Mention rate" items={ITEMS} />);
    expect(await axe(plain.container)).toHaveNoViolations();
    plain.unmount();
    const toggles = renderWithProviders(<ChartLegend title="Mention rate" items={ITEMS} onToggle={() => undefined} />);
    expect(await axe(toggles.container)).toHaveNoViolations();
  });
});
