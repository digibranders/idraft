import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ColumnChooser } from './column-chooser';
import { Button } from '@/components/ui/button';
import { renderWithProviders } from '@/test/render';

const COLUMNS = [
  { id: 'prompt', label: 'Prompt', visible: true, locked: true },
  { id: 'topic', label: 'Group', visible: true, locked: false },
];

function Chooser({ compact }: { compact?: boolean }): React.ReactElement {
  return (
    <ColumnChooser
      trigger={<Button>Columns</Button>}
      columns={COLUMNS}
      onToggle={vi.fn()}
      onMove={vi.fn()}
      onReset={vi.fn()}
      compact={compact}
      width={{
        column: 'Prompt',
        atMin: false,
        atMax: false,
        isDefault: true,
        onNarrower: vi.fn(),
        onWider: vi.fn(),
        onReset: vi.fn(),
      }}
    />
  );
}

describe('ColumnChooser groups', () => {
  const GROUPED = [
    { id: 'prompt', label: 'Prompt', visible: true, locked: true, group: 'A' },
    { id: 'topic', label: 'Group', visible: true, locked: false, group: 'A' },
    { id: 'volume', label: 'Volume', visible: false, locked: false, group: 'B' },
    { id: 'plain', label: 'Plain', visible: false, locked: false },
  ];
  const open = async (columns: typeof GROUPED | typeof COLUMNS, onMove = vi.fn()): Promise<HTMLElement> => {
    const { user } = renderWithProviders(
      <ColumnChooser
        trigger={<Button>Columns</Button>}
        columns={columns}
        onToggle={vi.fn()}
        onMove={onMove}
        onReset={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Columns' }));
    return screen.findByRole('dialog', { name: 'Columns' });
  };

  it('draws one heading per run of a group, in order, and none for a column without a group', async () => {
    const dialog = await open(GROUPED);
    const headings = [...dialog.querySelectorAll('li[role="presentation"]')];
    expect(headings.map((heading) => heading.textContent)).toEqual(['A', 'B']);
    // The headings take no focus, and each box keeps its own name
    expect(dialog.querySelectorAll('li[role="presentation"] [tabindex], li[role="presentation"] button')).toHaveLength(
      0,
    );
    expect(screen.getByRole('checkbox', { name: 'Volume' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Plain' })).toBeInTheDocument();
  });

  it('draws no heading when no column has a group', async () => {
    const dialog = await open(COLUMNS);
    expect(dialog.querySelectorAll('li[role="presentation"]')).toHaveLength(0);
    expect(dialog.querySelectorAll('ul > li')).toHaveLength(COLUMNS.length);
  });

  it('still announces the place of a moved column', async () => {
    const onMove = vi.fn();
    const columns = GROUPED.map((column) => (column.id === 'volume' ? { ...column, visible: true } : column));
    const { user } = renderWithProviders(
      <ColumnChooser
        trigger={<Button>Columns</Button>}
        columns={columns}
        onToggle={vi.fn()}
        onMove={onMove}
        onReset={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Columns' }));
    await user.click(await screen.findByRole('button', { name: 'Move Volume up' }));
    expect(onMove).toHaveBeenCalledWith('volume', -1);
    expect(document.getElementById('live-region-polite')).toHaveTextContent('Volume moved to position 2 of 3');
  });
});

describe('ColumnChooser width', () => {
  it('takes the width of its content by default, and the narrow 280 px popover with compact', async () => {
    const plain = renderWithProviders(<Chooser />);
    await plain.user.click(screen.getByRole('button', { name: 'Columns' }));
    expect(await screen.findByRole('dialog', { name: 'Columns' })).not.toHaveClass('w-popover-min');
    plain.unmount();
    const compact = renderWithProviders(<Chooser compact />);
    await compact.user.click(screen.getByRole('button', { name: 'Columns' }));
    const dialog = await screen.findByRole('dialog', { name: 'Columns' });
    expect(dialog).toHaveClass('w-popover-min');
    // The width row wraps under its label instead of widening the popover
    expect(screen.getByRole('group', { name: 'Prompt column width' })).toHaveClass('flex-wrap');
  });
});
