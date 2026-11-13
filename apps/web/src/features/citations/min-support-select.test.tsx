import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MinSupportSelect } from './min-support-select';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const NAME = 'Fewest citation units';

describe('MinSupportSelect', () => {
  it('defaults to 2 and offers 1, 2, 3, 5 and 10', async () => {
    const { user } = renderWithProviders(<MinSupportSelect minSupport={2} onMinSupportChange={() => undefined} />);
    const trigger = screen.getByRole('combobox', { name: NAME });
    expect(trigger).toHaveTextContent('At least 2 units');
    await user.click(trigger);
    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'At least 1 unit',
      'At least 2 units',
      'At least 3 units',
      'At least 5 units',
      'At least 10 units',
    ]);
  });

  it('writes the choice, and nothing for the default', async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(<MinSupportSelect minSupport={2} onMinSupportChange={onChange} />);
    await user.click(screen.getByRole('combobox', { name: NAME }));
    await user.click(await screen.findByRole('option', { name: 'At least 5 units' }));
    expect(onChange).toHaveBeenLastCalledWith(5);
    await user.click(screen.getByRole('combobox', { name: NAME }));
    await user.click(await screen.findByRole('option', { name: 'At least 2 units' }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('keeps a value from a link that the list does not offer', async () => {
    const { user } = renderWithProviders(<MinSupportSelect minSupport={7} onMinSupportChange={() => undefined} />);
    const trigger = screen.getByRole('combobox', { name: NAME });
    expect(trigger).toHaveTextContent('At least 7 units');
    await user.click(trigger);
    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'At least 1 unit',
      'At least 2 units',
      'At least 3 units',
      'At least 5 units',
      'At least 7 units',
      'At least 10 units',
    ]);
  });

  it('says rows below it are left out and shares do not change', () => {
    renderWithProviders(<MinSupportSelect minSupport={2} onMinSupportChange={() => undefined} />);
    expect(screen.getByRole('combobox', { name: NAME })).toHaveAccessibleDescription(
      'Rows below it are left out. Shares and totals do not change.',
    );
  });

  it('is axe clean', async () => {
    const { container } = renderWithProviders(<MinSupportSelect minSupport={2} onMinSupportChange={() => undefined} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
