import { screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { SidebarNav } from './sidebar';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const TOGGLE = {
  label: 'Collapse sidebar',
  visibleLabel: 'Collapse',
  onToggle: vi.fn(),
  controls: 'primary-navigation',
};

function sidebar(collectionLine?: ReactNode, mode: 'page' | 'drawer' = 'page'): ReactElement {
  return (
    <nav id={TOGGLE.controls} aria-label="Primary">
      <SidebarNav
        mode={mode}
        rail={false}
        sections={[]}
        projectSwitcher={<span>Fynix</span>}
        toggle={mode === 'page' ? TOGGLE : null}
        close={null}
        {...(collectionLine === undefined ? {} : { collectionLine })}
      />
    </nav>
  );
}

describe('SidebarNav collection line', () => {
  it('the sidebar renders the line above the toggle in type-label', async () => {
    const { container } = renderWithProviders(sidebar(<span>Last run 06:12, 141 of 150 answers</span>));
    const line = screen.getByText('Last run 06:12, 141 of 150 answers');
    const toggle = screen.getByRole('button', { name: 'Collapse sidebar' });
    // Above the toggle in the reading order, in the quiet label type of the sidebar
    expect(line.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(line.parentElement).toHaveClass('type-label', 'text-foreground-tertiary');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('draws nothing without a line, and nothing but the toggle when the line renders nothing', () => {
    const none = renderWithProviders(sidebar());
    expect(none.container.querySelector('[data-slot="sidebar-collection-line"]')).toBeNull();
    none.unmount();
    // An empty wrapper is hidden by `empty:hidden`, so a member who cannot read the line has no gap for it
    const empty = renderWithProviders(sidebar(<Nothing />));
    expect(empty.container.querySelector('[data-slot="sidebar-collection-line"]')).toBeEmptyDOMElement();
    expect(empty.container.querySelector('[data-slot="sidebar-collection-line"]')).toHaveClass('empty:hidden');
  });

  it('shows the line in the drawer, which has no toggle', () => {
    renderWithProviders(sidebar(<span>Running now</span>, 'drawer'));
    expect(screen.getByText('Running now')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Collapse sidebar' })).toBeNull();
  });
});

function Nothing(): ReactNode {
  return null;
}
