import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ScreenUnderTest, box, serveLayouts, startCustomizing, stubViewport } from '@/test/customize-harness';
import { renderWithProviders } from '@/test/render';

beforeEach(() => {
  serveLayouts();
  stubViewport();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CustomizingBadge', () => {
  it('says Customizing in customize mode, as text', async () => {
    const { user } = renderWithProviders(<ScreenUnderTest />);
    await startCustomizing(user);
    expect(within(box()).getByText('Customizing')).toBeInTheDocument();
  });

  it('renders nothing in view mode', async () => {
    renderWithProviders(<ScreenUnderTest />);
    await screen.findByRole('button', { name: 'Customize' });
    expect(screen.queryByText('Customizing')).not.toBeInTheDocument();
  });

  it('goes with the mode when the person leaves it', async () => {
    const { user } = renderWithProviders(<ScreenUnderTest />);
    await startCustomizing(user);
    await user.click(screen.getByRole('button', { name: 'Leave' }));
    expect(screen.queryByText('Customizing')).not.toBeInTheDocument();
  });
});
