import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { parseBoard } from './board-state';
import { ScopeToolbar, type ScopeToolbarProps } from './scope-toolbar';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const TRACKED = ['HubSpot', 'Pipedrive', 'Salesforce', 'Zoho', 'Freshsales', 'Close'].map((name, index) => ({
  id: `c${String(index + 1)}`,
  name,
  colorIndex: index + 2,
  domain: `${name.toLowerCase()}.com`,
}));
const DAYS = ['09-28', '09-21', '09-14', '09-07', '08-31', '08-24', '08-17', '08-10'];
const TREND = [8, 7, 6, 5, 4, 3, 2, 1].map((slot) => ({
  slot,
  first_at: `2026-${DAYS[slot - 1] ?? ''}T00:10:00.000Z`,
  last_at: `2026-${DAYS[slot - 1] ?? ''}T00:15:00.000Z`,
  answers: 10,
}));

function setup(overrides: Partial<ScopeToolbarProps> = {}) {
  const onChange = vi.fn();
  const props: ScopeToolbarProps = {
    state: parseBoard(
      {},
      { engines: ['chatgpt_web', 'gemini_web'], terms: new Set(['t1']), tracked: TRACKED.map((c) => c.id) },
    ),
    engines: [
      { code: 'chatgpt_web', label: 'ChatGPT' },
      { code: 'gemini_web', label: 'Gemini' },
    ],
    terms: [{ id: 't1', name: 'Pricing' }],
    tracked: TRACKED,
    trend: TREND,
    timeZone: 'Europe/Berlin',
    latest: '2026-09-28T00:15:00.000Z',
    isDefaultScope: true,
    onChange,
    onReset: vi.fn(),
    onExport: vi.fn(),
    exporting: false,
    canExport: true,
    pickerOpen: false,
    onPickerOpenChange: vi.fn(),
    ...overrides,
  };
  return { onChange, props, ...renderWithProviders(<ScopeToolbar {...props} />) };
}

describe('the Citations toolbar', () => {
  it('names the page and its three selects after their choice', () => {
    setup();
    expect(screen.getByRole('heading', { level: 1, name: 'Citations' })).toHaveClass('sr-only');
    const scope = screen.getByRole('group', { name: 'Scope' });
    expect(within(scope).getByRole('combobox', { name: 'Platform: All platforms' })).toBeVisible();
    // The Combobox trigger is a combobox for assistive technology, though it draws as a button
    expect(within(scope).getByRole('combobox', { name: 'Group: All groups' })).toBeVisible();
    expect(within(scope).getByRole('combobox', { name: 'Runs: Last 4 runs' })).toBeVisible();
  });

  it('gives every trigger the hover and open states of the preview', () => {
    setup();
    const scope = screen.getByRole('group', { name: 'Scope' });
    for (const name of ['Platform: All platforms', 'Group: All groups', 'Runs: Last 4 runs']) {
      expect(within(scope).getByRole('combobox', { name })).toHaveClass(
        'whitespace-nowrap',
        'hover:bg-surface-hover',
        'aria-expanded:bg-surface-hover',
      );
    }
  });

  it('notes the runs choices with their dates (C 116)', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('combobox', { name: 'Runs: Last 4 runs' }));
    expect(await screen.findByRole('option', { name: /Last 4 runs/ })).toHaveTextContent('28 days');
    expect(screen.getByRole('option', { name: /Last 2 runs/ })).toHaveTextContent('Sep 21 to Sep 28');
    expect(screen.getByRole('option', { name: /Last run/ })).toHaveTextContent('Sep 28');
  });

  it('chooses a platform', async () => {
    const { user, onChange } = setup();
    await user.click(screen.getByRole('combobox', { name: 'Platform: All platforms' }));
    await user.click(await screen.findByRole('option', { name: /Gemini/ }));
    expect(onChange).toHaveBeenCalledWith({ platform: 'gemini_web' });
  });

  it('says the first two competitors and how many more (C 135 to 140)', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Competitors: HubSpot, Pipedrive, Salesforce' })).toHaveTextContent(
      'Competitors:HubSpot, Pipedrive +1',
    );
  });

  it('keeps the tracked order, counts the choice and disables the rest at five (C 142 to 167)', async () => {
    const onPickerOpenChange = vi.fn();
    const { user, onChange } = setup({
      pickerOpen: true,
      onPickerOpenChange,
      state: { ...parseBoard({}, { engines: null, terms: null, tracked: null }), competitors: ['c3', 'c1'] },
    });
    const dialog = await screen.findByRole('dialog', { name: 'Competitors to compare' });
    expect(within(dialog).getByText('2 of 5')).toBeInTheDocument();
    const pipedrive = within(dialog).getByRole('checkbox', { name: 'Pipedrive' });
    // The label's ::after covers the row, so a click anywhere on it toggles (jsdom cannot click a pseudo-element):
    // the Checkbox's wrapper hands the classes to its label, and the row is the positioning context
    const checkbox = pipedrive.closest('[data-slot="checkbox"]');
    expect(checkbox).toHaveClass('*:after:absolute', '*:after:inset-0');
    expect(checkbox?.querySelector('label')).toContainElement(pipedrive);
    expect(checkbox?.parentElement).toHaveClass('relative');
    await user.click(pipedrive);
    expect(onChange).toHaveBeenCalledWith({ competitors: ['c1', 'c2', 'c3'] });
    expect(onPickerOpenChange).not.toHaveBeenCalledWith(false);
    expect(within(dialog).getByText('Up to 5 tracked competitors. Manage the list in Settings.')).toBeInTheDocument();
  });

  it('disables the competitors past five', async () => {
    setup({
      pickerOpen: true,
      state: {
        ...parseBoard({}, { engines: null, terms: null, tracked: null }),
        competitors: ['c1', 'c2', 'c3', 'c4', 'c5'],
      },
    });
    // Base UI's checkbox is a span with `role="checkbox"`, so it carries `aria-disabled`, not `disabled`
    expect(await screen.findByRole('checkbox', { name: 'Close' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('checkbox', { name: 'HubSpot' })).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('keeps Reset in the row but out of reach at the default scope, and shows it otherwise (C 696 to 698)', () => {
    const { unmount } = setup();
    expect(screen.queryByRole('button', { name: 'Reset scope' })).not.toBeInTheDocument();
    const hidden = screen.getByRole('button', { name: 'Reset scope', hidden: true });
    expect(hidden).toBeDisabled();
    expect(hidden).toHaveAttribute('tabindex', '-1');
    unmount();
    setup({ isDefaultScope: false });
    expect(screen.getByRole('button', { name: 'Reset scope' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Reset scope' })).toBeEnabled();
  });

  it('moves focus to the Platform select when Reset is used, as the button leaves the row', async () => {
    const { user, props } = setup({ isDefaultScope: false });
    await user.click(screen.getByRole('button', { name: 'Reset scope' }));
    expect(props.onReset).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('combobox', { name: 'Platform: All platforms' })).toHaveFocus();
  });

  it('draws Reset as a plain 36 px box and the Export icon at 14 px, as the preview does', () => {
    setup({ isDefaultScope: false });
    const reset = screen.getByRole('button', { name: 'Reset scope' });
    expect(reset).toHaveClass('border-0', 'type-body');
    expect(reset).not.toHaveClass('border', 'type-body-strong');
    const icon = screen.getByRole('button', { name: 'Export' }).querySelector('svg');
    expect(icon).toHaveClass('size-icon-sm');
  });

  it('disables Export until the engines are known', () => {
    setup({ canExport: false });
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();
  });

  it('is accessible', async () => {
    const { container } = setup({ isDefaultScope: false });
    expect(await axe(container)).toHaveNoViolations();
  });
});
