import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { overviewAs } from '@/test/ai-overview-harness';
import { stubViewport } from '@/test/customize-harness';
import { renderWithProviders } from '@/test/render';

// The screen's leave guard reads the router and the address
vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  stubViewport();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the Platform select by keyboard', () => {
  it('opens with Enter, moves with the arrows, chooses with Enter and keeps focus on its trigger', async () => {
    const { user } = renderWithProviders(overviewAs('admin'));
    const trigger = await screen.findByRole('combobox', { name: 'Platform: All platforms' });
    trigger.focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('listbox')).toBeInTheDocument();
    await user.keyboard('{ArrowDown}{Enter}');
    await waitFor(() => {
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });
    expect(await screen.findByRole('combobox', { name: 'Platform: ChatGPT' })).toHaveFocus();
  });

  it('closes with Escape and returns focus to the trigger, choosing nothing', async () => {
    const { user } = renderWithProviders(overviewAs('admin'));
    const trigger = await screen.findByRole('combobox', { name: 'Platform: All platforms' });
    await user.click(trigger);
    expect(await screen.findByRole('listbox')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAccessibleName('Platform: All platforms');
  });
});

describe('the Group select by keyboard', () => {
  it('opens with the search field focused, filters by typing, chooses with Enter', async () => {
    const { user } = renderWithProviders(overviewAs('admin'));
    const trigger = await screen.findByRole('combobox', { name: 'Group: All groups' });
    trigger.focus();
    await user.keyboard('{Enter}');
    const search = await screen.findByRole('combobox', { name: 'Search groups' });
    expect(search).toHaveFocus();
    await user.keyboard('paid');
    expect(await screen.findByRole('option', { name: 'Paid Search' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'SEO' })).not.toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('combobox', { name: 'Group: Paid Search' })).toBeInTheDocument();
  });

  it('closes with Escape and returns focus to the trigger', async () => {
    const { user } = renderWithProviders(overviewAs('admin'));
    const trigger = await screen.findByRole('combobox', { name: 'Group: All groups' });
    await user.click(trigger);
    await screen.findByRole('combobox', { name: 'Search groups' });
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('combobox', { name: 'Search groups' })).not.toBeInTheDocument();
    });
    expect(trigger).toHaveFocus();
  });

  it('clears the search each time it opens and lists every group again (OV-SCOPE-06)', async () => {
    const { user } = renderWithProviders(overviewAs('admin'));
    await user.click(await screen.findByRole('combobox', { name: 'Group: All groups' }));
    await user.type(await screen.findByRole('combobox', { name: 'Search groups' }), 'paid');
    await user.click(await screen.findByRole('option', { name: 'Paid Search' }));
    const trigger = await screen.findByRole('combobox', { name: 'Group: Paid Search' });
    await user.click(trigger);
    const search = await screen.findByRole('combobox', { name: 'Search groups' });
    expect(search).toHaveValue('');
    expect(await screen.findByRole('option', { name: 'All groups' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'SEO / Technical SEO' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Paid Search' })).toBeInTheDocument();
  });
});
