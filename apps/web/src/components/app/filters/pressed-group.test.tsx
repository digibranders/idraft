import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PressedGroup } from './pressed-group';
import { axe } from '@/test/axe';

describe('PressedGroup', () => {
  it('presses one item, shows each count, and reports a change', async () => {
    const onValueChange = vi.fn();
    const { container } = render(
      <PressedGroup
        label="Domain type"
        value="own"
        onValueChange={onValueChange}
        items={[
          { value: 'own', label: 'Your site', count: '13' },
          { value: 'all', label: 'All', count: '278' },
        ]}
      />,
    );
    expect(screen.getByRole('group', { name: 'Domain type' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Your site 13' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'All 278' }));
    expect(onValueChange).toHaveBeenCalledWith('all');
    expect(await axe(container)).toHaveNoViolations();
  });
});
