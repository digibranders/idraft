import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MinSupportControl } from './min-support-control';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const NAME = 'Fewest answers';

describe('MinSupportControl', () => {
  it('offers 1, 2, 3, 5 and 10, and shows 2 by default', async () => {
    const { user } = renderWithProviders(<MinSupportControl minSupport={2} onMinSupportChange={() => undefined} />);
    const trigger = screen.getByRole('combobox', { name: NAME });
    expect(trigger).toHaveTextContent('At least 2 answers');
    await user.click(trigger);
    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'At least 1 answer',
      'At least 2 answers',
      'At least 3 answers',
      'At least 5 answers',
      'At least 10 answers',
    ]);
  });

  it('offers the current value too when a link names another', async () => {
    const { user } = renderWithProviders(<MinSupportControl minSupport={7} onMinSupportChange={() => undefined} />);
    const trigger = screen.getByRole('combobox', { name: NAME });
    expect(trigger).toHaveTextContent('At least 7 answers');
    await user.click(trigger);
    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'At least 1 answer',
      'At least 2 answers',
      'At least 3 answers',
      'At least 5 answers',
      'At least 7 answers',
      'At least 10 answers',
    ]);
  });

  it('reports the choice, and null for the default', async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(<MinSupportControl minSupport={2} onMinSupportChange={onChange} />);
    await user.click(screen.getByRole('combobox', { name: NAME }));
    await user.click(await screen.findByRole('option', { name: 'At least 5 answers' }));
    expect(onChange).toHaveBeenLastCalledWith(5);
    await user.click(screen.getByRole('combobox', { name: NAME }));
    await user.click(await screen.findByRole('option', { name: 'At least 2 answers' }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('says queries below it are left out and the counts do not change, as its description', () => {
    renderWithProviders(<MinSupportControl minSupport={2} onMinSupportChange={() => undefined} />);
    expect(screen.getByRole('combobox', { name: NAME })).toHaveAccessibleDescription(
      'Queries issued by fewer answers are left out. The counts above do not change.',
    );
  });

  it('is axe clean', async () => {
    const { container } = renderWithProviders(
      <MinSupportControl minSupport={2} onMinSupportChange={() => undefined} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
