import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CompareSelect } from './compare-select';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

describe('CompareSelect', () => {
  it('defaults to vs previous period and writes the choice for No comparison', async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(<CompareSelect compare onCompareChange={onChange} />);
    const trigger = screen.getByRole('combobox', { name: 'Compare with' });
    expect(trigger).toHaveTextContent('vs previous period');
    await user.click(trigger);
    await user.click(await screen.findByRole('option', { name: 'No comparison' }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('shows No comparison when the comparison is off and turns it back on', async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(<CompareSelect compare={false} onCompareChange={onChange} />);
    const trigger = screen.getByRole('combobox', { name: 'Compare with' });
    expect(trigger).toHaveTextContent('No comparison');
    await user.click(trigger);
    await user.click(await screen.findByRole('option', { name: 'vs previous period' }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('is axe clean', async () => {
    const { container } = renderWithProviders(<CompareSelect compare onCompareChange={() => undefined} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
