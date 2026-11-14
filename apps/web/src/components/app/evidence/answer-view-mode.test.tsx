import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AnswerViewMode, type AnswerView } from './answer-view-mode';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

function renderMode(
  props: Partial<{ value: AnswerView; canViewRaw: boolean; onValueChange: (value: AnswerView) => void }> = {},
): ReturnType<typeof renderWithProviders> {
  return renderWithProviders(<AnswerViewMode value="evidence" canViewRaw onValueChange={vi.fn()} {...props} />);
}

describe('AnswerViewMode', () => {
  it('is a radio group named Answer view with Evidence, Formatted and Raw, and the value is the one checked', async () => {
    const { container } = renderMode({ value: 'formatted' });
    expect(screen.getByRole('radiogroup', { name: 'Answer view' })).toBeInTheDocument();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect(radios[0]).toHaveAccessibleName('Evidence');
    expect(radios[1]).toHaveAccessibleName('Formatted');
    expect(radios[2]).toHaveAccessibleName('Raw');
    expect(screen.getByRole('radio', { name: 'Formatted' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Evidence' })).not.toBeChecked();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('has no Raw mode without canViewRaw', () => {
    renderMode({ canViewRaw: false });
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(screen.queryByRole('radio', { name: 'Raw' })).toBeNull();
  });

  it('reports the mode chosen, and moves with the arrow keys', async () => {
    const onValueChange = vi.fn<(value: AnswerView) => void>();
    const { user } = renderMode({ onValueChange });
    await user.click(screen.getByRole('radio', { name: 'Raw' }));
    expect(onValueChange).toHaveBeenLastCalledWith('raw');
    screen.getByRole('radio', { name: 'Evidence' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(onValueChange).toHaveBeenLastCalledWith('formatted');
  });
});
