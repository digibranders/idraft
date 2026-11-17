import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ViewControls } from './view-controls';
import { renderWithProviders } from '@/test/render';

const base = () => ({
  percent: 85,
  minimap: false,
  atMin: false,
  atMax: false,
  onZoomOut: vi.fn(),
  onZoomIn: vi.fn(),
  onActualSize: vi.fn(),
  onFit: vi.fn(),
  onCenterFocus: vi.fn(),
  onToggleMinimap: vi.fn(),
  canReset: false,
  onReset: vi.fn(),
  helpOpen: false,
  onToggleHelp: vi.fn(),
});

describe('ViewControls', () => {
  it('is a group named Canvas view with every control a person can press', async () => {
    const props = base();
    const { user } = renderWithProviders(<ViewControls {...props} />);
    expect(screen.getByRole('group', { name: 'Canvas view' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Zoom out' }));
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    await user.click(screen.getByRole('button', { name: 'Fit everything' }));
    await user.click(screen.getByRole('button', { name: 'Centre on focus' }));
    await user.click(screen.getByRole('button', { name: '85%, return to 100%' }));
    expect(props.onZoomOut).toHaveBeenCalled();
    expect(props.onZoomIn).toHaveBeenCalled();
    expect(props.onFit).toHaveBeenCalled();
    expect(props.onCenterFocus).toHaveBeenCalled();
    expect(props.onActualSize).toHaveBeenCalled();
  });

  it('says whether the map is shown, and toggles it from the keyboard', async () => {
    const props = base();
    const { user, rerender } = renderWithProviders(<ViewControls {...props} />);
    const off = screen.getByRole('button', { name: 'Show the map' });
    expect(off).toHaveAttribute('aria-pressed', 'false');
    off.focus();
    await user.keyboard('{Enter}');
    expect(props.onToggleMinimap).toHaveBeenCalledTimes(1);
    rerender(<ViewControls {...props} minimap />);
    expect(screen.getByRole('button', { name: 'Hide the map' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('resets card positions only when a card was moved, and opens the legend and controls', async () => {
    const props = base();
    const { user, rerender } = renderWithProviders(<ViewControls {...props} />);
    const reset = screen.getByRole('button', { name: 'Reset card positions' });
    expect(reset).toHaveAttribute('aria-disabled', 'true');
    await user.click(reset);
    expect(props.onReset).not.toHaveBeenCalled();
    rerender(<ViewControls {...props} canReset />);
    await user.click(screen.getByRole('button', { name: 'Reset card positions' }));
    expect(props.onReset).toHaveBeenCalledTimes(1);
    const help = screen.getByRole('button', { name: 'Legend and controls' });
    expect(help).toHaveAttribute('aria-expanded', 'false');
    await user.click(help);
    expect(props.onToggleHelp).toHaveBeenCalledTimes(1);
    rerender(<ViewControls {...props} helpOpen />);
    expect(screen.getByRole('button', { name: 'Legend and controls' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('turns the map button off where the map is not drawn (under 640 px)', () => {
    renderWithProviders(<ViewControls {...base()} />);
    const toggle = screen.getByRole('button', { name: 'Show the map' });
    expect(toggle.className).toContain('hidden');
    expect(toggle.className).toContain('sm:inline-flex');
  });

  it('disables zoom in at 200 percent and zoom out at 25 percent, keeping them focusable, and the percent works', async () => {
    const props = { ...base(), atMax: true, percent: 200 };
    const { user, rerender } = renderWithProviders(<ViewControls {...props} />);
    const zoomIn = screen.getByRole('button', { name: 'Zoom in' });
    expect(zoomIn).toHaveAttribute('aria-disabled', 'true');
    await user.click(zoomIn);
    expect(props.onZoomIn).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Zoom out' })).not.toHaveAttribute('aria-disabled', 'true');
    await user.click(screen.getByRole('button', { name: '200%, return to 100%' }));
    expect(props.onActualSize).toHaveBeenCalled();
    rerender(<ViewControls {...props} atMax={false} atMin percent={25} />);
    expect(screen.getByRole('button', { name: 'Zoom out' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: 'Zoom in' })).not.toHaveAttribute('aria-disabled', 'true');
  });
});
