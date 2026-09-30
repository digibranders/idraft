import { screen, waitFor } from '@testing-library/react';
import { X } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';

import { IconButton } from './icon-button';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

describe('IconButton', () => {
  it('is named by its label and hides the icon from assistive technology', () => {
    const { container } = renderWithProviders(<IconButton icon={X} label="Close inspector" />);
    expect(screen.getByRole('button', { name: 'Close inspector' })).toBeInTheDocument();
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('is ghost at 32 px with a 14 px icon by default', () => {
    const { container } = renderWithProviders(<IconButton icon={X} label="Close" />);
    expect(screen.getByRole('button')).toHaveClass('size-control-sm', 'bg-transparent', 'text-foreground-secondary');
    expect(container.querySelector('svg')).toHaveClass('size-icon-sm');
  });

  it.each([
    ['icon-xs', 'size-6', 'size-icon-sm'],
    ['icon-sm', 'size-control-sm', 'size-icon-sm'],
    ['icon', 'size-control', 'size-icon'],
  ] as const)('size %s is %s with a %s icon', (size, box, glyph) => {
    const { container } = renderWithProviders(<IconButton icon={X} label="Close" size={size} />);
    expect(screen.getByRole('button')).toHaveClass(box);
    expect(container.querySelector('svg')).toHaveClass(glyph);
  });

  it('draws an 18 px icon in the top bar', () => {
    const { container } = renderWithProviders(<IconButton icon={X} label="Help" size="icon" iconSize="md" />);
    expect(container.querySelector('svg')).toHaveClass('size-icon-md');
  });

  it('shows its label as a tooltip on focus, without announcing it twice', async () => {
    const { user, baseElement } = renderWithProviders(<IconButton icon={X} label="Close inspector" />);
    await user.tab();
    const button = screen.getByRole('button', { name: 'Close inspector' });
    expect(button).toHaveFocus();
    expect(button).not.toHaveAttribute('aria-describedby');
    await waitFor(() =>
      expect(baseElement.querySelector('[data-slot="tooltip"]')).toHaveTextContent('Close inspector'),
    );
    expect(baseElement.querySelector('[data-slot="tooltip"]')).toHaveAttribute('aria-hidden', 'true');
  });

  it('exposes its shortcut and shows it in the tooltip', async () => {
    const { user } = renderWithProviders(<IconButton icon={X} label="Search" shortcut={['mod', 'k']} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-keyshortcuts', 'Control+k');
    await user.hover(screen.getByRole('button'));
    await screen.findByText('Search');
    expect([...document.querySelectorAll('kbd')].map((node) => node.textContent)).toEqual(['Ctrl', 'K']);
  });

  it.each(['bottom', 'right'] as const)(
    'opens its tooltip on the %s side where the layout asks for it',
    async (side) => {
      const { user, baseElement } = renderWithProviders(<IconButton icon={X} label="Keywords" tooltipSide={side} />);
      await user.hover(screen.getByRole('button'));
      await waitFor(() => expect(baseElement.querySelector('[data-side]')).toHaveAttribute('data-side', side));
    },
  );

  it('calls the handler', async () => {
    const onClick = vi.fn();
    const { user } = renderWithProviders(<IconButton icon={X} label="Close" onClick={onClick} />);
    await user.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('has no accessibility violations', async () => {
    const { container } = renderWithProviders(<IconButton icon={X} label="Close inspector" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
