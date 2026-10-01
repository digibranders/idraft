import { act, screen, waitFor, within } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FilterBar } from './filter-bar';
import type { FilterField, FilterValues } from './types';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const FIELDS: FilterField[] = [
  { id: 'kw', kind: 'text', label: 'Keyword', operators: ['contains', 'starts_with', 'equals', 'not_contains'] },
  {
    id: 'intent',
    kind: 'enum',
    label: 'Intent',
    multi: true,
    options: [
      { value: 'commercial', label: 'Commercial', count: 120 },
      { value: 'transactional', label: 'Transactional', count: 40 },
      { value: 'informational', label: 'Informational', count: 300 },
      { value: 'navigational', label: 'Navigational', count: 12 },
    ],
  },
  {
    id: 'device',
    kind: 'enum',
    label: 'Device',
    multi: false,
    options: [
      { value: 'desktop', label: 'Desktop' },
      { value: 'mobile', label: 'Mobile' },
    ],
  },
  { id: 'vol', kind: 'range', label: 'Volume' },
  { id: 'kd', kind: 'range', label: 'KD', ends: 'max', bounds: { min: 0, max: 100 } },
];

let latest: FilterValues = {};

function Harness({ initial = {} }: { initial?: FilterValues }): ReactElement {
  const [values, setValues] = useState<FilterValues>(initial);
  return (
    <FilterBar
      fields={FIELDS}
      values={values}
      onChange={(next) => {
        latest = next;
        setValues(next);
      }}
    />
  );
}

describe('FilterBar', () => {
  beforeEach(() => {
    latest = {};
    // Base UI waits for the popup's animations before it unmounts it; jsdom has none to wait for
    Object.defineProperty(Element.prototype, 'getAnimations', { configurable: true, value: () => [] });
  });
  afterEach(() => {
    Reflect.deleteProperty(Element.prototype, 'getAnimations');
  });

  it('names each chip and its remove button from the field and value', async () => {
    const { container } = renderWithProviders(
      <Harness
        initial={{
          intent: { kind: 'enum', values: ['commercial', 'transactional', 'informational'] },
          vol: { kind: 'range', min: 1000, max: 10_000 },
          kw: { kind: 'text', operator: 'contains', text: 'crm' },
          device: { kind: 'enum', values: ['desktop'] },
        }}
      />,
    );
    const bar = screen.getByRole('group', { name: 'Filters' });
    expect(within(bar).getByRole('button', { name: 'Keyword contains: crm. Edit filter' })).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: 'Intent: 3 selected. Edit filter' })).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: 'Device: Desktop. Edit filter' })).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: 'Volume: 1,000 to 10,000. Edit filter' })).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: 'Remove filter Volume: 1,000 to 10,000' })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('applies a multi choice only on Apply, and Escape discards the draft', async () => {
    const { user } = renderWithProviders(<Harness initial={{ intent: { kind: 'enum', values: ['commercial'] } }} />);
    await user.click(screen.getByRole('button', { name: 'Intent: Commercial. Edit filter' }));
    const apply = await screen.findByRole('button', { name: 'Apply' });
    expect(apply).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'Transactional' }));
    expect(latest).toEqual({});
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Intent: Commercial. Edit filter' })).toHaveFocus();
    });

    await user.click(screen.getByRole('button', { name: 'Intent: Commercial. Edit filter' }));
    expect(screen.getByRole('checkbox', { name: 'Transactional' })).not.toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: 'Transactional' }));
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(latest).toEqual({ intent: { kind: 'enum', values: ['commercial', 'transactional'] } });
    expect(screen.getByRole('button', { name: 'Intent: Commercial, Transactional. Edit filter' })).toBeInTheDocument();
  });

  it('keeps Only to one option, and Clear then Apply removes the filter', async () => {
    const { user } = renderWithProviders(
      <Harness initial={{ intent: { kind: 'enum', values: ['commercial', 'transactional'] } }} />,
    );
    await user.click(screen.getByRole('button', { name: 'Intent: Commercial, Transactional. Edit filter' }));
    await user.click(await screen.findByRole('button', { name: 'Only Informational' }));
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(latest).toEqual({ intent: { kind: 'enum', values: ['informational'] } });

    await user.click(screen.getByRole('button', { name: 'Intent: Informational. Edit filter' }));
    await user.click(await screen.findByRole('button', { name: 'Clear' }));
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(latest).toEqual({});
  });

  it('adds a filter through the field picker, and a single choice applies at once', async () => {
    const { user } = renderWithProviders(<Harness />);
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add a filter' }));
    await user.click(await screen.findByRole('button', { name: 'Device' }));
    expect(screen.getByRole('radio', { name: 'Desktop' })).toHaveFocus();
    await user.click(screen.getByRole('radio', { name: 'Mobile' }));
    expect(latest).toEqual({ device: { kind: 'enum', values: ['mobile'] } });
    expect(screen.getByRole('button', { name: 'Device: Mobile. Edit filter' })).toBeInTheDocument();
  });

  it('refuses a range whose minimum is above its maximum', async () => {
    const { user } = renderWithProviders(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Add a filter' }));
    await user.click(await screen.findByRole('button', { name: 'Volume' }));
    // Focus moves into the editor, so typing goes straight to Minimum
    await user.keyboard('500');
    expect(screen.getByRole('textbox', { name: 'Minimum' })).toHaveValue('500');
    await user.type(screen.getByRole('textbox', { name: 'Maximum' }), '50');
    expect(screen.getByRole('textbox', { name: 'Maximum' })).toHaveAccessibleDescription(
      'The minimum is above the maximum.',
    );
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    await user.keyboard('{Enter}');
    expect(latest).toEqual({});

    await user.clear(screen.getByRole('textbox', { name: 'Maximum' }));
    await user.type(screen.getByRole('textbox', { name: 'Maximum' }), '5000{Enter}');
    expect(latest).toEqual({ vol: { kind: 'range', min: 500, max: 5000 } });
    expect(screen.getByRole('button', { name: 'Volume: 500 to 5,000. Edit filter' })).toBeInTheDocument();
  });

  it('shows a field of one end as that end only', async () => {
    const { user } = renderWithProviders(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Add a filter' }));
    await user.click(await screen.findByRole('button', { name: 'KD' }));
    expect(screen.queryByRole('textbox', { name: 'Minimum' })).not.toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'At most' }), '40{Enter}');
    expect(latest).toEqual({ kd: { kind: 'range', min: null, max: 40 } });
    expect(screen.getByRole('button', { name: 'KD: at most 40. Edit filter' })).toBeInTheDocument();
  });

  it('moves focus to the next chip on remove, and to + Filter when none is left', async () => {
    const { user } = renderWithProviders(
      <Harness
        initial={{
          kw: { kind: 'text', operator: 'starts_with', text: 'best' },
          vol: { kind: 'range', min: 1000, max: null },
        }}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Remove filter Keyword starts with: best' }));
    expect(latest).toEqual({ vol: { kind: 'range', min: 1000, max: null } });
    expect(screen.getByRole('button', { name: 'Volume: at least 1,000. Edit filter' })).toHaveFocus();

    // Delete on a focused remove button removes the filter too
    await user.click(screen.getByRole('button', { name: 'Add a filter' }));
    await user.click(await screen.findByRole('button', { name: 'Device' }));
    await user.click(screen.getByRole('radio', { name: 'Mobile' }));
    act(() => screen.getByRole('button', { name: 'Remove filter Device: Mobile' }).focus());
    await user.keyboard('{Delete}');
    expect(latest).toEqual({ vol: { kind: 'range', min: 1000, max: null } });

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(latest).toEqual({});
    expect(screen.getByRole('button', { name: 'Add a filter' })).toHaveFocus();
  });

  it('applies a single choice on Space, not while the arrows move through the options', async () => {
    const { user } = renderWithProviders(<Harness initial={{ device: { kind: 'enum', values: ['desktop'] } }} />);
    await user.click(screen.getByRole('button', { name: 'Device: Desktop. Edit filter' }));
    const desktop = await screen.findByRole('radio', { name: 'Desktop' });
    act(() => desktop.focus());
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('radio', { name: 'Mobile' })).toHaveFocus();
    expect(latest).toEqual({});
    await user.keyboard(' ');
    expect(latest).toEqual({ device: { kind: 'enum', values: ['mobile'] } });
  });

  it('reads group separators in a range, and refuses text that is not a whole number', async () => {
    const { user } = renderWithProviders(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Add a filter' }));
    await user.click(await screen.findByRole('button', { name: 'Volume' }));
    await user.keyboard('2,000');
    await user.type(screen.getByRole('textbox', { name: 'Maximum' }), 'lots');
    expect(screen.getByRole('textbox', { name: 'Maximum' })).toHaveAccessibleDescription('Enter a whole number.');
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    await user.keyboard('{Enter}');
    expect(latest).toEqual({});
    await user.clear(screen.getByRole('textbox', { name: 'Maximum' }));
    await user.keyboard('{Enter}');
    expect(latest).toEqual({ vol: { kind: 'range', min: 2000, max: null } });
  });

  it('keeps filters it does not show, and moves focus to + Filter after the last chip', async () => {
    const other = { kind: 'enum', values: ['x'] } as const;
    const { user } = renderWithProviders(
      <Harness
        initial={{
          other,
          kw: { kind: 'text', operator: 'equals', text: 'crm' },
          vol: { kind: 'range', min: 1, max: 9 },
        }}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Remove filter Volume: 1 to 9' }));
    expect(latest).toEqual({ other, kw: { kind: 'text', operator: 'equals', text: 'crm' } });
    expect(screen.getByRole('button', { name: 'Add a filter' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(latest).toEqual({ other });
  });
});
