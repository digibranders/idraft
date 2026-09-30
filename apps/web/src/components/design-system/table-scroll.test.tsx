import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TableScroll } from './table-scroll';
import { renderWithProviders } from '@/test/render';

/** jsdom lays nothing out, so the widths the scroller compares are set by hand. */
function widths(scroll: number, client: number): void {
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(scroll);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(client);
}

function renderTable(): void {
  renderWithProviders(
    <TableScroll label="Named sizes">
      <table>
        <tbody>
          <tr>
            <td>control</td>
          </tr>
        </tbody>
      </table>
    </TableScroll>,
  );
}

describe('TableScroll', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is a named tab stop while the table is wider than the page', () => {
    widths(562, 381);
    renderTable();
    expect(screen.getByRole('region', { name: 'Named sizes' })).toHaveAttribute('tabindex', '0');
  });

  it('is no tab stop while the table fits', () => {
    widths(381, 381);
    renderTable();
    expect(screen.getByRole('region', { name: 'Named sizes' })).not.toHaveAttribute('tabindex');
  });
});
