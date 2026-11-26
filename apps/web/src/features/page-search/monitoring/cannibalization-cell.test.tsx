import { screen } from '@testing-library/react';
import type { Route } from 'next';
import { describe, expect, it, vi } from 'vitest';

import { CannibalizationCell } from './cannibalization-cell';
import type { PageCannibalization } from '../types';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const push = vi.fn();
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}));

const filled = (keywords: number, likely: number, co_ranking: number, unstable: number): PageCannibalization => ({
  keywords,
  likely,
  co_ranking,
  unstable,
});
const HREF = '/acme/eventus/seo/cannibalization' as Route;

describe('CannibalizationCell', () => {
  it('is a button with the count in the warning tone when a verdict is likely, and a tooltip that splits it', () => {
    renderWithProviders(<CannibalizationCell value={filled(3, 1, 1, 1)} path="/pricing" href={HREF} />);
    const button = screen.getByRole('button', {
      name: '/pricing competes with another page on 3 keywords. Opens Cannibalization.',
    });
    expect(button).toHaveAccessibleDescription(
      'Competes with another of your pages on 3 tracked keywords: 1 likely, 1 co-ranking, 1 unstable. Opens Cannibalization.',
    );
    expect(screen.getByText('3 keywords')).toHaveClass('text-warning-text');
  });

  it('is neutral with no likely verdict, and leaves the zero parts out of the tooltip', () => {
    renderWithProviders(<CannibalizationCell value={filled(1, 0, 1, 0)} path="/blog" href={HREF} />);
    const badge = screen.getByText('1 keyword');
    expect(badge).not.toHaveClass('text-warning-text');
    expect(screen.getByRole('button')).toHaveAccessibleDescription(
      'Competes with another of your pages on 1 tracked keyword: 1 co-ranking. Opens Cannibalization.',
    );
  });

  it('reads None in quiet text, and is no button', () => {
    renderWithProviders(<CannibalizationCell value={filled(0, 0, 0, 0)} path="/about" href={HREF} />);
    expect(screen.getByText('None')).toHaveClass('text-foreground-tertiary');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('draws nothing for a page without the field', () => {
    renderWithProviders(<CannibalizationCell value={null} path="/about" href={HREF} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText(/keyword|None/)).not.toBeInTheDocument();
  });

  it('goes to the page once, and does not open the row', async () => {
    push.mockClear();
    const onRow = vi.fn();
    const { user } = renderWithProviders(
      // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- stands for the table's row
      <div onClick={onRow}>
        <CannibalizationCell value={filled(3, 1, 1, 1)} path="/pricing" href={HREF} />
      </div>,
    );
    await user.click(screen.getByRole('button'));
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith(HREF);
    expect(onRow).not.toHaveBeenCalled();
  });

  it('is the badge alone, as text, when there is no page to go to', () => {
    renderWithProviders(<CannibalizationCell value={filled(3, 1, 1, 1)} path="/pricing" href={null} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('3 keywords')).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const { container } = renderWithProviders(
      <CannibalizationCell value={filled(3, 1, 1, 1)} path="/pricing" href={HREF} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
