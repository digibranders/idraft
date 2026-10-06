import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MonthSelect } from './month-select';
import { recentMonths } from '@/lib/format/month';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const NOW = new Date('2026-10-06T12:00:00Z');

describe('MonthSelect', () => {
  it('names the month chosen, and offers the recent months newest first', async () => {
    const { user, container } = renderWithProviders(
      <MonthSelect months={recentMonths(NOW, 3)} value="2026-10" label="Month" onValueChange={() => undefined} />,
    );
    const trigger = screen.getByRole('combobox', { name: 'Month' });
    expect(trigger).toHaveTextContent('October 2026');
    await user.click(trigger);
    expect((await screen.findAllByRole('option')).map((option) => option.textContent)).toEqual([
      'October 2026',
      'September 2026',
      'August 2026',
    ]);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('tells the month that was chosen', async () => {
    const onValueChange = vi.fn();
    const { user } = renderWithProviders(
      <MonthSelect months={recentMonths(NOW, 3)} value="2026-10" label="Month" onValueChange={onValueChange} />,
    );
    await user.click(screen.getByRole('combobox', { name: 'Month' }));
    await user.click(await screen.findByRole('option', { name: 'September 2026' }));
    expect(onValueChange).toHaveBeenCalledWith('2026-09');
  });
});
