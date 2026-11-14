import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CompareSelect } from './compare-select';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

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
  it('shows vs previous period by default, named Compare with', () => {
    render();
    expect(screen.getByRole('combobox', { name: 'Compare with' })).toHaveTextContent('vs previous period');
  });

  it('shows No comparison for cmp=off', () => {
    render('?cmp=off');
    expect(screen.getByRole('combobox', { name: 'Compare with' })).toHaveTextContent('No comparison');
  });

  it('writes cmp=off with history replace for No comparison and removes it again', async () => {
    const { user, writes } = render();
    await user.click(screen.getByRole('combobox', { name: 'Compare with' }));
    await user.click(await screen.findByRole('option', { name: 'No comparison' }));
    await waitFor(() => expect(writes.at(-1)?.queryString).toContain('cmp=off'));
    expect(writes.at(-1)?.history).toBe('replace');
    await user.click(screen.getByRole('combobox', { name: 'Compare with' }));
    await user.click(await screen.findByRole('option', { name: 'vs previous period' }));
    await waitFor(() => expect(writes.at(-1)?.queryString).not.toContain('cmp'));
  });

  it('offers the two choices only', async () => {
    const { user } = render();
    await user.click(screen.getByRole('combobox', { name: 'Compare with' }));
    expect((await screen.findAllByRole('option')).map((option) => option.textContent)).toEqual([
      'vs previous period',
      'No comparison',
    ]);
  });

  it('names the previous window in a tooltip when the response has one', async () => {
    const { user } = render('', WINDOW);
    const trigger = screen.getByRole('combobox', { name: 'Compare with' });
    expect(trigger).toHaveAccessibleDescription('Previous period: Sep 18 to Oct 15, 2026');
    await user.hover(trigger);
    // The hidden description and the popup both carry it
    await waitFor(() => expect(screen.getAllByText('Previous period: Sep 18 to Oct 15, 2026')).toHaveLength(2));
  });

  it('has no tooltip while the response has no window', () => {
    render();
    expect(screen.getByRole('combobox', { name: 'Compare with' })).not.toHaveAccessibleDescription();
  });

  it('says in the tooltip that no change is read while comparison is off', () => {
    render('?cmp=off', WINDOW);
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
    await user.keyboard('{ArrowDown}{Enter}');
    await waitFor(() => expect(writes.at(-1)?.queryString).toContain('cmp=off'));
  });

  it('is axe clean', async () => {
    const { container } = render('', WINDOW);
    expect(await axe(container)).toHaveNoViolations();
  });
});
