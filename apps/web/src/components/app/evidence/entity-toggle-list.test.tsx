import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EntityToggleList, type EntityToggleItem } from './entity-toggle-list';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const ITEMS: readonly EntityToggleItem[] = [
  { entityId: 'e-own', name: 'Fynix', own: true, colorIndex: 1, spanCount: 3, visible: true },
  { entityId: 'e-rival', name: 'Rankforge', own: false, colorIndex: 3, spanCount: 1, visible: true },
  { entityId: 'e-late', name: 'Zoomly', own: false, colorIndex: null, spanCount: 2, visible: false },
];

describe('EntityToggleList', () => {
  it('is a group named Entities, with a checkbox for each entity that says whether its marks show', async () => {
    const { container } = renderWithProviders(<EntityToggleList items={ITEMS} onToggle={vi.fn()} />);
    const group = screen.getByRole('group', { name: 'Entities' });
    const boxes = within(group).getAllByRole('checkbox');
    expect(boxes.map((box) => box.getAttribute('aria-checked'))).toEqual(['true', 'true', 'false']);
    expect(within(group).getByRole('checkbox', { name: 'Fynix' })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('says how many marks each entity has in the answer, in words', () => {
    renderWithProviders(<EntityToggleList items={ITEMS} onToggle={vi.fn()} />);
    expect(screen.getByRole('checkbox', { name: 'Fynix' })).toHaveAccessibleDescription('3 marks');
    expect(screen.getByRole('checkbox', { name: 'Rankforge' })).toHaveAccessibleDescription('1 mark');
  });

  it('reports the entity and the new state when a box is toggled, by mouse and by keyboard', async () => {
    const onToggle = vi.fn<(entityId: string, visible: boolean) => void>();
    const { user } = renderWithProviders(<EntityToggleList items={ITEMS} onToggle={onToggle} />);
    await user.click(screen.getByRole('checkbox', { name: 'Fynix' }));
    screen.getByRole('checkbox', { name: 'Zoomly' }).focus();
    await user.keyboard(' ');
    expect(onToggle.mock.calls).toEqual([
      ['e-own', false],
      ['e-late', true],
    ]);
  });

  it('draws a swatch in the entity color, the own brand in chart 1 and one past the sixth in chart-other', () => {
    renderWithProviders(<EntityToggleList items={ITEMS} onToggle={vi.fn()} />);
    const swatch = (name: string): HTMLElement | null =>
      screen.getByRole('checkbox', { name }).closest('[data-slot="entity-toggle"]')?.querySelector('[data-swatch]') ??
      null;
    expect(swatch('Fynix')).toHaveClass('bg-chart-1');
    expect(swatch('Rankforge')).toHaveClass('bg-chart-3');
    expect(swatch('Zoomly')).toHaveClass('bg-chart-other', 'border-dashed');
    expect(swatch('Fynix')).toHaveAttribute('aria-hidden', 'true');
  });

  it('shows a name that holds markup as text', () => {
    renderWithProviders(
      <EntityToggleList
        items={[
          {
            entityId: 'x',
            name: '<img src=x onerror=alert(1)>',
            own: false,
            colorIndex: 2,
            spanCount: 1,
            visible: true,
          },
        ]}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByRole('checkbox', { name: '<img src=x onerror=alert(1)>' })).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });

  it('renders nothing for an answer with no marked entity', () => {
    renderWithProviders(<EntityToggleList items={[]} onToggle={vi.fn()} />);
    expect(screen.queryByRole('group')).toBeNull();
    expect(screen.queryByText('Entities')).toBeNull();
  });
});
