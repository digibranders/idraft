import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ViewControls } from './view-controls';
import { renderWithProviders } from '@/test/render';

const base = () => ({
  percent: 85,
  minimap: false,
  onZoomOut: vi.fn(),
  onZoomIn: vi.fn(),
  onActualSize: vi.fn(),
  onFit: vi.fn(),
  onCenterFocus: vi.fn(),
  onToggleMinimap: vi.fn(),
});

describe('ViewControls', () => {
  it('is a toolbar named Canvas view with every control a person can press', async () => {
    const props = base();
    const { user } = renderWithProviders(<ViewControls {...props} />);
    expect(screen.getByRole('toolbar', { name: 'Canvas view' })).toBeInTheDocument();
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
});
