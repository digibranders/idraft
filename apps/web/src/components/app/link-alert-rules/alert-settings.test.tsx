import { screen, within } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  alertDirty,
  alertPatch,
  AlertFields,
  checkThreshold,
  draftOf,
  tierChoices,
  type AlertDraft,
} from './alert-settings';
import type { AlertSettings } from '@/lib/internal-links/types';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const SAVED: AlertSettings = { enabled: true, max_position: 2, threshold: 1, channel: 'app' };

afterEach(() => {
  document.documentElement.classList.remove('dark');
});

describe('checkThreshold', () => {
  it.each(['1', '50', ' 7 ', '12', '05', '0050'])('accepts %j', (text) => {
    expect(checkThreshold(text)).toBeNull();
  });
  it.each(['0', '51', '', ' ', '2.5', '1e1', 'abc', '-3', '050x', '99999999999999999999999'])('refuses %j', (text) => {
    expect(checkThreshold(text)).toBe('range');
  });
});

describe('alertDirty', () => {
  it('is false for an untouched draft and for an equivalent threshold text', () => {
    expect(alertDirty(SAVED, draftOf(SAVED))).toBe(false);
    expect(alertDirty(SAVED, { ...draftOf(SAVED), threshold: '01' })).toBe(false);
    expect(alertDirty(SAVED, { ...draftOf(SAVED), threshold: ' 1 ' })).toBe(false);
  });
  it('is true for a changed member and for a threshold that is not valid yet', () => {
    expect(alertDirty(SAVED, { ...draftOf(SAVED), enabled: false })).toBe(true);
    expect(alertDirty(SAVED, { ...draftOf(SAVED), threshold: '2' })).toBe(true);
    expect(alertDirty(SAVED, { ...draftOf(SAVED), threshold: '' })).toBe(true);
    expect(alertDirty(SAVED, { ...draftOf(SAVED), threshold: '99' })).toBe(true);
  });
});

describe('alertPatch', () => {
  it('is empty for an untouched draft', () => {
    expect(alertPatch(SAVED, draftOf(SAVED))).toEqual({});
  });
  it('holds only the members that changed, the threshold as a number', () => {
    expect(alertPatch(SAVED, { ...draftOf(SAVED), max_position: 3 })).toEqual({ max_position: 3 });
    expect(alertPatch(SAVED, { ...draftOf(SAVED), threshold: ' 4 ', enabled: false })).toEqual({
      enabled: false,
      threshold: 4,
    });
  });
  it('leaves out a threshold text that is not valid', () => {
    expect(alertPatch(SAVED, { ...draftOf(SAVED), threshold: '99' })).toEqual({});
  });
});

describe('tierChoices', () => {
  it('lists the tiers the workspace has, never past 8, always the saved one', () => {
    expect(tierChoices(3, 2)).toEqual([1, 2, 3]);
    expect(tierChoices(null, 2)).toEqual([1, 2]);
    expect(tierChoices(12, 2)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(tierChoices(2, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(tierChoices(0, 1)).toEqual([1]);
  });
});

function Host({
  canEdit = true,
  tierCount = 3,
  error = null,
}: {
  canEdit?: boolean;
  tierCount?: number | null;
  error?: 'range' | null;
}): ReactElement {
  const [draft, setDraft] = useState<AlertDraft>(draftOf(SAVED));
  return (
    <AlertFields
      draft={draft}
      saved={SAVED}
      tierCount={tierCount}
      canEdit={canEdit}
      busy={false}
      thresholdError={error}
      onChange={(next) => setDraft((current) => ({ ...current, ...next }))}
    />
  );
}

describe('AlertFields', () => {
  it('shows the saved rules in a form', () => {
    renderWithProviders(<Host />);
    expect(screen.getByRole('switch', { name: 'Alert me when links to important pages are lost' })).toBeChecked();
    expect(screen.getByRole('combobox', { name: 'Important pages' })).toHaveTextContent('T1 and T2');
    expect(screen.getByRole('textbox', { name: 'Lost links that raise an alert' })).toHaveValue('1');
    expect(screen.getByRole('combobox', { name: 'Channel' })).toHaveTextContent('In the app');
  });

  it('offers the tiers the workspace has, as T1 only, T1 and T2, T1 to T3', async () => {
    const { user } = renderWithProviders(<Host />);
    await user.click(screen.getByRole('combobox', { name: 'Important pages' }));
    const list = await screen.findByRole('listbox');
    expect(
      within(list)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['T1 only', 'T1 and T2', 'T1 to T3']);
  });

  it('lists email and Slack as disabled with the reason, never selectable', async () => {
    const { user } = renderWithProviders(<Host />);
    await user.click(screen.getByRole('combobox', { name: 'Channel' }));
    const list = await screen.findByRole('listbox');
    const options = within(list).getAllByRole('option');
    expect(options).toHaveLength(3);
    expect(options[0]).not.toHaveAttribute('aria-disabled', 'true');
    for (const option of options.slice(1)) {
      expect(option).toHaveAttribute('aria-disabled', 'true');
      expect(option).toHaveTextContent('Available when the alerts service ships');
    }
    await user.click(options[1] as HTMLElement);
    expect(screen.getByRole('combobox', { name: 'Channel' })).toHaveTextContent('In the app');
  });

  it('shows the threshold message the host passes', () => {
    renderWithProviders(<Host error="range" />);
    expect(screen.getByText('Enter a whole number from 1 to 50.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Lost links that raise an alert' })).toBeInvalid();
  });

  it('shows the values as text, with no control, to a member who cannot change them', () => {
    renderWithProviders(<Host canEdit={false} />);
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText('T1 and T2')).toBeInTheDocument();
    expect(screen.getByText('In the app')).toBeInTheDocument();
  });

  it('never names equity', () => {
    renderWithProviders(<Host />);
    expect(document.body.textContent.toLowerCase()).not.toContain('equity');
  });

  it.each(['light', 'dark'])('has no axe violations in %s', async (theme) => {
    if (theme === 'dark') document.documentElement.classList.add('dark');
    const { container } = renderWithProviders(<Host />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
