import { screen } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { TreeView, type TreeViewNode } from './tree-view';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const NODES: readonly TreeViewNode[] = [
  {
    id: 'crm',
    label: 'CRM',
    children: [
      { id: 'startups', label: 'CRM for startups', children: [] },
      { id: 'agencies', label: 'CRM for agencies', children: [] },
    ],
  },
  { id: 'email', label: 'Email marketing', detail: 'email-marketing', children: [] },
];

function Topics({ initial = [] }: { initial?: readonly string[] }): ReactElement {
  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set(initial));
  return (
    <>
      <TreeView
        label="Topics"
        nodes={NODES}
        selected={selected}
        onSelect={setSelected}
        expanded={expanded}
        onExpandedChange={setExpanded}
      />
      <output>{selected}</output>
    </>
  );
}
const item = (name: string): HTMLElement => screen.getByRole('treeitem', { name });

describe('TreeView', () => {
  it('is a named tree with one tab stop, levels and positions, and no violations', async () => {
    const { container } = renderWithProviders(<Topics initial={['crm']} />);
    expect(screen.getByRole('tree', { name: 'Topics' })).toBeInTheDocument();
    expect(item('CRM')).toHaveAttribute('aria-expanded', 'true');
    expect(item('CRM')).toHaveAttribute('tabindex', '0');
    expect(item('CRM for agencies')).toHaveAttribute('aria-level', '2');
    expect(item('CRM for agencies')).toHaveAttribute('aria-posinset', '2');
    expect(item('CRM for agencies')).toHaveAttribute('tabindex', '-1');
    expect(item('Email marketing')).not.toHaveAttribute('aria-expanded');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('moves, opens and closes from the keyboard, with selection following focus', async () => {
    const { user } = renderWithProviders(<Topics />);
    await user.tab();
    expect(item('CRM')).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(item('CRM')).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{ArrowRight}');
    expect(item('CRM for startups')).toHaveFocus();
    expect(screen.getByText('startups', { selector: 'output' })).toBeInTheDocument();
    expect(item('CRM for startups')).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowLeft}');
    expect(item('CRM')).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(item('CRM')).toHaveAttribute('aria-expanded', 'false');
    await user.keyboard('{End}');
    expect(item('Email marketing')).toHaveFocus();
    await user.keyboard('{Home}');
    expect(item('CRM')).toHaveFocus();
    await user.keyboard('e');
    expect(item('Email marketing')).toHaveFocus();
  });

  it('selects an item on click, and opens it from its chevron', async () => {
    const { user } = renderWithProviders(<Topics />);
    await user.click(screen.getByText('Email marketing'));
    expect(item('Email marketing')).toHaveAttribute('aria-selected', 'true');
    const toggle = item('CRM').querySelector('[data-tree-toggle]');
    if (!(toggle instanceof HTMLElement)) throw new Error('The chevron is missing');
    await user.click(toggle);
    expect(item('CRM')).toHaveAttribute('aria-expanded', 'true');
    // A click on a child selects the child, not its parent
    await user.click(screen.getByText('CRM for agencies'));
    expect(item('CRM for agencies')).toHaveAttribute('aria-selected', 'true');
    expect(item('CRM')).toHaveAttribute('aria-selected', 'false');
  });
});
