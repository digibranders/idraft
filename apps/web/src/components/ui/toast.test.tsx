import { act, screen, waitFor, within } from '@testing-library/react';
import { useEffect, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { dismissToast, toast } from './toast';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const region = (): HTMLElement => screen.getByRole('region', { name: /Notifications/ });
const toasts = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-slot="toast"]')];
const show = (options: Parameters<typeof toast>[0]): string => {
  let id = '';
  act(() => {
    id = toast(options);
  });
  return id;
};

describe('toast', () => {
  afterEach(() => {
    act(() => dismissToast());
    vi.useRealTimers();
  });

  it('shows its title and description in a region that F6 can reach', async () => {
    renderWithProviders(<p>Page</p>);
    show({ type: 'success', title: 'Import finished', description: '1,204 added, 38 skipped as duplicates' });
    const item = await within(region()).findByText('Import finished');
    expect(item).toHaveClass('type-body-strong', 'truncate');
    expect(within(region()).getByText('1,204 added, 38 skipped as duplicates')).toHaveClass(
      'type-meta',
      'line-clamp-2',
    );
  });

  it.each([
    ['success', 'text-positive-text'],
    ['info', 'text-info-text'],
    ['error', 'text-negative-text'],
  ] as const)('marks a %s toast with its icon in %s', async (type, colorClass) => {
    renderWithProviders(<p>Page</p>);
    show({ type, title: 'Result' });
    await within(region()).findByText('Result');
    expect(toasts()[0]?.querySelector('svg')).toHaveClass('size-icon', colorClass);
  });

  it('shows a spinner for work in progress and replaces the toast in place when it ends', async () => {
    renderWithProviders(<p>Page</p>);
    show({ id: 'export', type: 'progress', title: 'Preparing export' });
    await within(region()).findByText('Preparing export');
    expect(toasts()[0]?.querySelector('svg')).toHaveClass('animate-spin');
    show({ id: 'export', type: 'success', title: 'Export ready' });
    await within(region()).findByText('Export ready');
    expect(toasts()).toHaveLength(1);
    expect(within(region()).queryByText('Preparing export')).toBeNull();
  });

  it('always has a Close button, which removes it', async () => {
    const { user } = renderWithProviders(<p>Page</p>);
    show({ type: 'info', title: 'Too many requests' });
    await within(region()).findByText('Too many requests');
    // Base UI keeps the button out of the accessibility tree until the pointer or focus is in the region,
    // so a screen reader that reads the toast does not hear "Close" after every one
    expect(within(region()).queryByRole('button', { name: 'Close' })).toBeNull();
    await user.hover(region());
    await user.click(await within(region()).findByRole('button', { name: 'Close' }));
    await waitFor(() => expect(toasts()).toHaveLength(0));
  });

  it('offers one action, runs it and closes', async () => {
    const onAction = vi.fn();
    const { user } = renderWithProviders(<p>Page</p>);
    show({ type: 'success', title: '12 keywords archived', action: { label: 'Undo', onAction } });
    const undo = await within(region()).findByRole('button', { name: 'Undo' });
    expect(undo).toHaveClass('h-control-sm', 'bg-transparent');
    await user.click(undo);
    expect(onAction).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(toasts()).toHaveLength(0));
  });

  it('leaves after 6 seconds when it is a plain success or info toast', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderWithProviders(<p>Page</p>);
    show({ type: 'success', title: 'Competitor added: HubSpot' });
    await within(region()).findByText('Competitor added: HubSpot');
    act(() => {
      vi.advanceTimersByTime(5900);
    });
    expect(toasts()).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    await waitFor(() => expect(toasts()).toHaveLength(0));
  });

  it.each([
    ['an error', { type: 'error', title: 'Import failed: file has no keyword column' }],
    [
      'a toast with an action',
      { type: 'success', title: '12 keywords archived', action: { label: 'Undo', onAction: vi.fn() } },
    ],
    ['a progress toast', { type: 'progress', title: 'Preparing export' }],
  ] as const)('keeps %s until it is dismissed', async (_kind, options) => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderWithProviders(<p>Page</p>);
    show(options);
    await within(region()).findByText(options.title);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(toasts()).toHaveLength(1);
  });

  it('announces politely, and an error at once', async () => {
    renderWithProviders(<p>Page</p>);
    expect(region()).toHaveAttribute('aria-live', 'polite');
    show({ type: 'success', title: 'Competitor added' });
    await within(region()).findByText('Competitor added');
    const alerts = (): Element[] => [...document.querySelectorAll('[role="alert"]:not(#live-region-assertive)')];
    expect(alerts().some((node) => node.textContent.includes('Competitor added'))).toBe(false);
    show({ type: 'error', title: 'Import failed' });
    await within(region()).findByText('Import failed');
    await waitFor(() => expect(alerts().some((node) => node.textContent.includes('Import failed'))).toBe(true));
  });

  it('shows a toast that is asked for in a mount effect, before the provider listens', async () => {
    function Welcome(): ReactElement {
      useEffect(() => {
        toast({ id: 'welcome', type: 'info', title: 'Signed in on a new device' });
      }, []);
      return <p>Page</p>;
    }
    renderWithProviders(<Welcome />);
    expect(await within(region()).findByText('Signed in on a new device')).toBeInTheDocument();
  });

  it('shows where keyboard focus is when F6 lands on the region', () => {
    renderWithProviders(<p>Page</p>);
    expect(region()).toHaveClass('focus-visible:focus-ring');
    expect(region().className).not.toContain('outline-none');
  });

  it('shows three toasts at most, the newest at the bottom', async () => {
    renderWithProviders(<p>Page</p>);
    for (const title of ['First', 'Second', 'Third', 'Fourth']) show({ type: 'error', title });
    await within(region()).findByText('Fourth');
    expect(region()).toHaveClass('flex-col-reverse');
    const visible = toasts().filter((item) => !item.hasAttribute('data-limited'));
    expect(visible).toHaveLength(3);
    expect(toasts().find((item) => item.hasAttribute('data-limited'))).toHaveClass('data-limited:hidden');
  });

  it('sits bottom right at 360 px, above everything but tooltips, and across the bottom on a phone', async () => {
    renderWithProviders(<p>Page</p>);
    show({ type: 'info', title: 'Placed' });
    await within(region()).findByText('Placed');
    expect(region()).toHaveClass(
      'fixed',
      'bottom-3',
      'inset-x-3',
      'md:right-5',
      'md:bottom-5',
      'md:w-90',
      'z-(--z-toast)',
    );
    expect(toasts()[0]).toHaveClass('rounded-lg', 'border', 'bg-surface-elevated', 'shadow-popover');
  });

  it('has no accessibility violations', async () => {
    const { baseElement } = renderWithProviders(<p>Page</p>);
    show({
      type: 'success',
      title: '12 keywords archived',
      description: 'From the keyword table',
      action: { label: 'Undo', onAction: vi.fn() },
    });
    await within(region()).findByText('12 keywords archived');
    expect(await axe(baseElement)).toHaveNoViolations();
  });
});
