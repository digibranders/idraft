import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CompareSelect } from './compare-select';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

/** The address that turns the comparison on: the page opens without one. */
const ON = '?cmp=previous';
const WINDOW = { from: '2026-09-18', to: '2026-10-15', timezone: 'Europe/Berlin' };

interface Write {
  queryString: string;
  history: string | undefined;
}

function render(
  searchParams = '',
  window: typeof WINDOW | null = null,
): ReturnType<typeof renderWithProviders> & { writes: Write[] } {
  const writes: Write[] = [];
  const rendered = renderWithProviders(<CompareSelect window={window} />, {
    searchParams,
    onUrlUpdate: ({ queryString, options }) => writes.push({ queryString, history: options.history }),
  });
  return { ...rendered, writes };
}

describe('CompareSelect', () => {
  it('shows No comparison by default, named Compare with', () => {
    render();
    expect(screen.getByRole('combobox', { name: 'Compare with' })).toHaveTextContent('No comparison');
  });

  it('shows vs previous period for cmp=previous', () => {
    render(ON);
    expect(screen.getByRole('combobox', { name: 'Compare with' })).toHaveTextContent('vs previous period');
  });

  it('writes cmp=previous with history replace for the previous period and removes it again', async () => {
    const { user, writes } = render();
    await user.click(screen.getByRole('combobox', { name: 'Compare with' }));
    await user.click(await screen.findByRole('option', { name: 'vs previous period' }));
    await waitFor(() => expect(writes.at(-1)?.queryString).toContain('cmp=previous'));
    expect(writes.at(-1)?.history).toBe('replace');
    await user.click(screen.getByRole('combobox', { name: 'Compare with' }));
    await user.click(await screen.findByRole('option', { name: 'No comparison' }));
    await waitFor(() => expect(writes.at(-1)?.queryString).not.toContain('cmp'));
  });

  it('offers the previous period, the same period last year and no comparison', async () => {
    const { user } = render();
    await user.click(screen.getByRole('combobox', { name: 'Compare with' }));
    expect((await screen.findAllByRole('option')).map((option) => option.textContent)).toEqual([
      'vs previous period',
      'vs same period last year',
      'No comparison',
    ]);
  });

  it('shows vs same period last year for cmp=year, and writes it', async () => {
    const { user, writes } = render('?cmp=year');
    const trigger = screen.getByRole('combobox', { name: 'Compare with' });
    expect(trigger).toHaveTextContent('vs same period last year');
    await user.click(trigger);
    await user.click(await screen.findByRole('option', { name: 'vs previous period' }));
    await waitFor(() => expect(writes.at(-1)?.queryString).toContain('cmp=previous'));
    await user.click(screen.getByRole('combobox', { name: 'Compare with' }));
    await user.click(await screen.findByRole('option', { name: 'vs same period last year' }));
    await waitFor(() => expect(writes.at(-1)?.queryString).toContain('cmp=year'));
    expect(writes.at(-1)?.history).toBe('replace');
  });

  it('names the same dates a year earlier in the tooltip of cmp=year', () => {
    render('?cmp=year', { from: '2025-09-18', to: '2025-10-15', timezone: 'Europe/Berlin' });
    expect(screen.getByRole('combobox', { name: 'Compare with' })).toHaveAccessibleDescription(
      'Same period last year: Sep 18 to Oct 15, 2025',
    );
  });

  it('names the previous window in a tooltip when the response has one', async () => {
    const { user } = render(ON, WINDOW);
    const trigger = screen.getByRole('combobox', { name: 'Compare with' });
    expect(trigger).toHaveAccessibleDescription('Previous period: Sep 18 to Oct 15, 2026');
    await user.hover(trigger);
    // The hidden description and the popup both carry it
    await waitFor(() => expect(screen.getAllByText('Previous period: Sep 18 to Oct 15, 2026')).toHaveLength(2));
  });

  it('has no tooltip while the response has no window', () => {
    render(ON);
    expect(screen.getByRole('combobox', { name: 'Compare with' })).not.toHaveAccessibleDescription();
  });

  it('says in the tooltip that no change is read while comparison is off', () => {
    render('', WINDOW);
    expect(screen.getByRole('combobox', { name: 'Compare with' })).toHaveAccessibleDescription(
      'No change is read while comparison is off',
    );
  });

  it('closes with Escape and writes nothing', async () => {
    const { user, writes } = render();
    screen.getByRole('combobox', { name: 'Compare with' }).focus();
    await user.keyboard('{ArrowDown}');
    await screen.findByRole('listbox');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(writes).toEqual([]);
  });

  it('chooses with the arrows and Enter', async () => {
    const { user, writes } = render();
    screen.getByRole('combobox', { name: 'Compare with' }).focus();
    await user.keyboard('{ArrowDown}');
    await screen.findByRole('listbox');
    await waitFor(() =>
      expect(document.querySelector('[data-slot="select-popup"]')?.contains(document.activeElement)).toBe(true),
    );
    // The choice above No comparison is the same period last year
    await user.keyboard('{ArrowUp}');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(writes.at(-1)?.queryString).toContain('cmp=year'));
  });

  it('is axe clean', async () => {
    const { container } = render('', WINDOW);
    expect(await axe(container)).toHaveNoViolations();
  });
});
