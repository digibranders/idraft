import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CitationMarker } from './citation-marker';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const NAME = 'Citation 2: g2.com';

describe('CitationMarker', () => {
  it('is a button named for its citation, with the number in brackets', async () => {
    const { container } = renderWithProviders(
      <p>
        Agencies list it
        <CitationMarker index={2} label={NAME} onActivate={vi.fn()} />.
      </p>,
    );
    const button = screen.getByRole('button', { name: NAME });
    expect(button).toHaveTextContent('[2]');
    expect(button).toHaveAttribute('type', 'button');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('reports its index on a click, on Enter and on Space', async () => {
    const onActivate = vi.fn<(index: number) => void>();
    const { user } = renderWithProviders(<CitationMarker index={2} label={NAME} onActivate={onActivate} />);
    await user.click(screen.getByRole('button', { name: NAME }));
    screen.getByRole('button', { name: NAME }).focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onActivate.mock.calls).toEqual([[2], [2], [2]]);
  });

  it('is a tab stop with a visible focus ring, and says which citation it is for the page to find it', async () => {
    const { user } = renderWithProviders(
      <CitationMarker index={7} label="Citation 7: a.example" onActivate={vi.fn()} />,
    );
    await user.tab();
    const button = screen.getByRole('button', { name: 'Citation 7: a.example' });
    expect(button).toHaveFocus();
    expect(button).toHaveClass('focus-visible:focus-ring');
    expect(button).toHaveAttribute('data-citation-marker', '7');
  });

  it('marks itself when its citation is the active one', () => {
    renderWithProviders(<CitationMarker index={2} label={NAME} active onActivate={vi.fn()} />);
    expect(screen.getByRole('button', { name: NAME })).toHaveAttribute('data-active');
  });
});
