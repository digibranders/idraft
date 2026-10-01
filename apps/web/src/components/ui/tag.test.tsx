import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Tag } from './tag';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

describe('Tag', () => {
  it('shows its value with no button when it cannot be removed', () => {
    renderWithProviders(<Tag label="HubSpot CRM" />);
    expect(screen.getByText('HubSpot CRM')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('is removed by its named button, and by Backspace or Delete on it', async () => {
    const onRemove = vi.fn();
    const { user, container } = renderWithProviders(
      <Tag label="HubSpot CRM" onRemove={onRemove} removeLabel="Remove HubSpot CRM" />,
    );
    const remove = screen.getByRole('button', { name: 'Remove HubSpot CRM' });
    await user.click(remove);
    expect(onRemove).toHaveBeenCalledTimes(1);
    remove.focus();
    await user.keyboard('{Backspace}');
    await user.keyboard('{Delete}');
    expect(onRemove).toHaveBeenCalledTimes(3);
    await user.keyboard('a');
    expect(onRemove).toHaveBeenCalledTimes(3);
    expect(await axe(container)).toHaveNoViolations();
  });
});
