import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RetentionScreen } from './retention-screen';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

// States: the page is static, the platform's fixed policy with no read behind it. So loading, empty, error,
// partial and stale do not apply: there is nothing to wait for, nothing to fail and nothing to refetch.

const KEPT: readonly (readonly [name: string, period: string])[] = [
  ['Search results', '400 days'],
  ['AI answers', 'Kept indefinitely'],
  ['Search Console and other first-party imports', '90 days'],
  ['Error responses', '30 days'],
];

describe('Data retention', () => {
  it('lists the four kinds of raw data with how long each is kept', () => {
    renderWithProviders(<RetentionScreen />);
    const table = screen.getByRole('table', { name: 'Retention of raw data by kind' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Data', 'What it is', 'Kept for']);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(KEPT.length);
    for (const [index, [name, period]] of KEPT.entries()) {
      const row = rows[index];
      if (row === undefined) throw new Error(`no row ${String(index)}`);
      expect(within(row).getByRole('rowheader')).toHaveTextContent(name);
      expect(within(row).getAllByRole('cell').at(-1)).toHaveTextContent(new RegExp(`^${period}$`));
    }
  });

  it('keeps AI answers indefinitely, with no number of days', () => {
    renderWithProviders(<RetentionScreen />);
    const row = screen.getByRole('rowheader', { name: 'AI answers' }).closest('tr');
    if (row === null) throw new Error('no row');
    expect(within(row).getByText('Kept indefinitely')).toBeInTheDocument();
    expect(within(row).queryByText(/days/)).toBeNull();
  });

  it('says retention is set by the platform, and what an answer past it leaves behind', () => {
    renderWithProviders(<RetentionScreen />);
    expect(screen.getByText('Retention is set by the platform and cannot be changed here.')).toBeInTheDocument();
    expect(
      screen.getByText(
        'When a raw answer is past its retention it is no longer kept. The numbers, mentions and citations read from it stay.',
      ),
    ).toBeInTheDocument();
  });

  it('has nothing to change: no button, link, field, switch or menu', () => {
    renderWithProviders(<RetentionScreen />);
    for (const role of ['button', 'link', 'textbox', 'combobox', 'checkbox', 'switch', 'radio', 'spinbutton']) {
      expect(screen.queryAllByRole(role)).toEqual([]);
    }
  });

  it('has a title for the section, and no accessibility violation', async () => {
    const { container } = renderWithProviders(<RetentionScreen />);
    expect(screen.getByRole('heading', { name: 'Data retention' })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});
