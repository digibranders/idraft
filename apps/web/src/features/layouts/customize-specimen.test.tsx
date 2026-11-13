import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LayoutsCustomizeLive } from './customize-specimen';
import { mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { renderWithProviders } from '@/test/render';

// The canvas stub of the test setup cannot draw: the gallery cards hold a real chart, so the canvas is stood in for
// The screen's leave guard reads the router and the address
vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);
vi.mock('@/components/app/chart/echart', () => ({ EChart: () => <div data-testid="echart-canvas" /> }));

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: true,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the customize specimen', () => {
  it('says that nobody is signed in while there is no session', async () => {
    renderWithProviders(<LayoutsCustomizeLive />);
    expect(await screen.findByRole('heading', { level: 2, name: 'Customize mode, live' })).toBeInTheDocument();
    expect(await screen.findByText(/Sign in to try customize mode/)).toBeInTheDocument();
  });

  it('renders the group with the Customize button and the cards of the first workspace', async () => {
    document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('admin').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
    renderWithProviders(<LayoutsCustomizeLive />);
    expect(await screen.findByRole('heading', { level: 2, name: 'Customize mode, live' })).toBeInTheDocument();
    const button = await screen.findByRole('button', { name: 'Customize' });
    await waitFor(() => {
      expect(button).not.toHaveAttribute('aria-disabled', 'true');
    });
    expect(screen.getByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Customizable overview cards' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Project' })).toBeInTheDocument();
  });

  it('shows the headline numbers as links, and as arranged cells once Customize is pressed', async () => {
    document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('admin').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
    const { user } = renderWithProviders(<LayoutsCustomizeLive />);
    const strip = await screen.findByRole('group', { name: 'Overview numbers' });
    expect(within(strip).getAllByRole('link').length).toBeGreaterThan(0);
    const button = await screen.findByRole('button', { name: 'Customize' });
    await waitFor(() => {
      expect(button).not.toHaveAttribute('aria-disabled', 'true');
    });
    await user.click(button);
    expect((await screen.findAllByRole('button', { name: /^Reorder / })).length).toBeGreaterThan(0);
    expect(within(screen.getByRole('group', { name: 'Overview numbers' })).queryAllByRole('link')).toHaveLength(0);
  });

  it('shows the badge beside the title once Customize is pressed', async () => {
    document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('admin').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
    const { user } = renderWithProviders(<LayoutsCustomizeLive />);
    const button = await screen.findByRole('button', { name: 'Customize' });
    await waitFor(() => {
      expect(button).not.toHaveAttribute('aria-disabled', 'true');
    });
    expect(screen.queryByText('Customizing')).not.toBeInTheDocument();
    await user.click(button);
    expect(await screen.findByText('Customizing')).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-pressed', 'true');
  });

  it('offers the two fixture presets in the Start from menu', async () => {
    document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('admin').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
    const { user } = renderWithProviders(<LayoutsCustomizeLive />);
    const button = await screen.findByRole('button', { name: 'Customize' });
    await waitFor(() => {
      expect(button).not.toHaveAttribute('aria-disabled', 'true');
    });
    await user.click(button);
    await user.click(await screen.findByRole('button', { name: 'Start from' }));
    const menu = await screen.findByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Built-in default', 'Executive summary', 'SEO focus']);
  });

  it('shows the save bar while Customize is on and takes it away when the mode ends', async () => {
    document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('admin').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
    const { user } = renderWithProviders(<LayoutsCustomizeLive />);
    const button = await screen.findByRole('button', { name: 'Customize' });
    await waitFor(() => {
      expect(button).not.toHaveAttribute('aria-disabled', 'true');
    });
    expect(screen.queryByRole('group', { name: 'No changes' })).not.toBeInTheDocument();
    await user.click(button);
    const bar = await screen.findByRole('group', { name: 'No changes' });
    await user.click(within(bar).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('group', { name: 'No changes' })).not.toBeInTheDocument();
    });
  });
});
