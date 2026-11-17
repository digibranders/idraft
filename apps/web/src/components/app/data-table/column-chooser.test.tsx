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
