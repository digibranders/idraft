import { screen } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { BoardPanel } from './board-panel';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

/** The screen holds the search in the address; the test holds it in state, so typing reads back. */
function Harness({ onSearchChange }: { onSearchChange: (search: string) => void }): ReactElement {
  const [search, setSearch] = useState('');
  return (
    <BoardPanel
      tabs={<nav aria-label="Citations views">tabs</nav>}
      search={search}
      onSearchChange={(next) => {
        setSearch(next);
        onSearchChange(next);
      }}
      searchPlaceholder="Search pages"
      controls={<button type="button">Your site</button>}
      summary={<p>summary</p>}
      refetching={false}
      footerText="278 pages · 405 citations"
      updated="Updated Sep 28, 02:15 · run 48"
    >
      <p>body</p>
    </BoardPanel>
  );
}

describe('the Citations table panel', () => {
  it('lays out the tabs, the search, the controls, the summary, the body and the footer (C 291 to 330)', async () => {
    const onSearchChange = vi.fn();
    const { user, container } = renderWithProviders(<Harness onSearchChange={onSearchChange} />);
    const search = screen.getByRole('searchbox', { name: 'Search in table' });
    expect(search).toHaveAttribute('placeholder', 'Search pages');
    expect(search).toHaveAttribute('maxlength', '200');
    expect(search).toHaveAttribute('aria-keyshortcuts', '/');
    expect(screen.getByText('278 pages · 405 citations')).toBeVisible();
    expect(screen.getByText('Updated Sep 28, 02:15 · run 48')).toBeVisible();
    expect(screen.getByText('body')).toBeVisible();
    await user.keyboard('/');
    expect(search).toHaveFocus();
    await user.keyboard('crm');
    expect(onSearchChange).toHaveBeenLastCalledWith('crm');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('leaves the footer text out while the first rows load and before any answer', () => {
    renderWithProviders(
      <BoardPanel
        tabs={null}
        search=""
        onSearchChange={vi.fn()}
        searchPlaceholder="Search pages"
        controls={null}
        refetching={false}
        footerText={null}
        updated={null}
      >
        <p>body</p>
      </BoardPanel>,
    );
    expect(screen.queryByText(/Updated/)).toBeNull();
  });
});
