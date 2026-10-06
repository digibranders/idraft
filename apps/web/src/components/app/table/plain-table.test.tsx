import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PlainTable, type PlainColumn } from './plain-table';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

interface Row {
  id: string;
  name: string;
  next: string;
}

const ROWS: Row[] = [
  { id: 'a', name: 'Daily rankings', next: 'Oct 2, 02:00' },
  { id: 'b', name: 'Keyword metrics', next: 'Oct 20, 03:00' },
];

const COLUMNS: PlainColumn<Row>[] = [
  { id: 'name', header: 'Schedule', align: 'left', cell: (row) => row.name },
  {
    id: 'next',
    header: 'Next run',
    description: 'Times in Europe/Berlin (project time zone)',
    align: 'left',
    wrap: true,
    cell: (row) => row.next,
  },
  {
    id: 'actions',
    header: 'Actions',
    hideHeader: true,
    align: 'right',
    cell: () => <button type="button">Open</button>,
  },
];

const render = (props: Partial<Parameters<typeof PlainTable<Row>>[0]> = {}): ReturnType<typeof renderWithProviders> =>
  renderWithProviders(
    <PlainTable<Row>
      caption="Schedules of this project"
      columns={COLUMNS}
      rows={ROWS}
      rowKey={(row) => row.id}
      status="ready"
      errorState={<p>Did not load</p>}
      emptyText="Nothing here"
      {...props}
    />,
  );

describe('PlainTable', () => {
  it('is a named table with the first column as the row header', async () => {
    const { container } = render();
    const table = screen.getByRole('table', { name: 'Schedules of this project' });
    expect(
      within(table)
        .getAllByRole('rowheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Daily rankings', 'Keyword metrics']);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('describes a header by the header cell itself, and keeps a hidden header readable', () => {
    render();
    expect(screen.getByRole('columnheader', { name: /Next run/ })).toHaveAccessibleDescription(
      'Times in Europe/Berlin (project time zone)',
    );
    // The actions column has a name for assistive technology and draws no text
    expect(screen.getByRole('columnheader', { name: 'Actions' })).toBeInTheDocument();
    expect(screen.getByText('Actions')).toHaveClass('sr-only');
  });

  it('shows skeleton rows while loading, the error state, and an empty row', () => {
    const { rerender } = render({ status: 'loading' });
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(document.querySelector('tbody')).toHaveAttribute('aria-busy', 'true');
    rerender(
      <PlainTable<Row>
        caption="x"
        columns={COLUMNS}
        rows={[]}
        rowKey={(row) => row.id}
        status="error"
        errorState={<p>Did not load</p>}
        emptyText="Nothing here"
      />,
    );
    expect(screen.getByText('Did not load')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    rerender(
      <PlainTable<Row>
        caption="x"
        columns={COLUMNS}
        rows={[]}
        rowKey={(row) => row.id}
        status="ready"
        errorState={null}
        emptyText="Nothing here"
      />,
    );
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
  });

  it('draws a footer row when it is given and there are rows', () => {
    render({ footer: ['Total', '', ''] });
    expect(screen.getByText('Total')).toBeInTheDocument();
  });
});
