import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useMultiSelectHints } from './use-multi-select-hints';
import { renderWithProviders } from '@/test/render';

function Hints({ count }: { count: number }): React.ReactElement {
  const hints = useMultiSelectHints();
  return (
    <p>
      {hints.chipsHint(count)} {hints.chipHint}
    </p>
  );
}

describe('useMultiSelectHints', () => {
  it('reads one way for one value and for several', () => {
    const { rerender } = renderWithProviders(<Hints count={1} />);
    expect(
      screen.getByText(
        '1 chosen. From the start of the field, press Left Arrow to reach it. Press Backspace or Delete to remove',
      ),
    ).toBeInTheDocument();
    rerender(<Hints count={3} />);
    expect(
      screen.getByText(
        '3 chosen. From the start of the field, press Left Arrow to reach them. Press Backspace or Delete to remove',
      ),
    ).toBeInTheDocument();
  });
});
