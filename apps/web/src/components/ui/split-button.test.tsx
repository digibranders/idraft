import { screen } from '@testing-library/react';
import { Plus, Upload } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';

import { SplitButton } from './split-button';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

function setup(onClick = vi.fn(), onImport = vi.fn()): ReturnType<typeof renderWithProviders> {
  return renderWithProviders(
    <SplitButton
      variant="primary"
      size="sm"
      icon={Plus}
      groupLabel="Add keywords options"
      menuLabel="More ways to add keywords"
      items={[{ id: 'import', label: 'Import from a file', icon: Upload, onSelect: onImport }]}
      onClick={onClick}
    >
      Add keywords
    </SplitButton>,
  );
}

describe('SplitButton', () => {
  it('is a named group of the default action and the menu that sits beside it', () => {
    setup();
    const group = screen.getByRole('group', { name: 'Add keywords options' });
    expect(group).toContainElement(screen.getByRole('button', { name: 'Add keywords' }));
    expect(group).toContainElement(screen.getByRole('button', { name: 'More ways to add keywords' }));
  });

  it('runs the default action from its own half, and the alternatives from the menu', async () => {
    const onClick = vi.fn();
    const onImport = vi.fn();
    const { user } = setup(onClick, onImport);
    await user.click(screen.getByRole('button', { name: 'Add keywords' }));
    expect(onClick).toHaveBeenCalledOnce();
    expect(onImport).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'More ways to add keywords' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Import from a file' }));
    expect(onImport).toHaveBeenCalledOnce();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('has no accessibility violations', async () => {
    const { container } = setup();
    expect(await axe(container)).toHaveNoViolations();
  });
});
