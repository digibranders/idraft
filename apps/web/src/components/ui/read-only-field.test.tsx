import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ReadOnlyField, ReadOnlyList } from './read-only-field';
import { axe } from '@/test/axe';

describe('ReadOnlyField', () => {
  it('is a term and its value in a description list', () => {
    render(
      <ReadOnlyList>
        <ReadOnlyField label="Workspace ID" value="ws_01J9ZK4T2M" font="mono" />
      </ReadOnlyList>,
    );
    expect(screen.getByRole('term')).toHaveTextContent('Workspace ID');
    expect(screen.getByRole('definition')).toHaveTextContent('ws_01J9ZK4T2M');
    expect(screen.getByRole('term')).toHaveClass('type-label');
  });

  it('shows the value on the subtle surface at control height, selectable and not a tab stop', () => {
    render(
      <ReadOnlyList>
        <ReadOnlyField label="Email" value="ana@digibranders.com" />
      </ReadOnlyList>,
    );
    const value = screen.getByText('ana@digibranders.com');
    expect(value).toHaveClass('min-h-control', 'rounded-md', 'bg-surface-subtle', 'px-3', 'type-body', 'select-text');
    expect(value).not.toHaveAttribute('tabindex');
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('uses the mono style for identifiers', () => {
    render(
      <ReadOnlyList>
        <ReadOnlyField label="Slug" value="digibranders" font="mono" />
      </ReadOnlyList>,
    );
    expect(screen.getByText('digibranders')).toHaveClass('type-mono');
  });

  it('says why the value cannot change here when that is not obvious', () => {
    render(
      <ReadOnlyList>
        <ReadOnlyField
          label="Keyword"
          value="crm pricing"
          reason="The keyword text cannot change. Add a new keyword instead."
        />
      </ReadOnlyList>,
    );
    expect(screen.getByText('The keyword text cannot change. Add a new keyword instead.')).toHaveClass('type-meta');
  });

  it('passes other attributes on to its root, and the list spaces fields like a form', () => {
    const { container } = render(
      <ReadOnlyList id="facts">
        <ReadOnlyField label="Plan" value="Team" id="plan" className="col-span-2" />
      </ReadOnlyList>,
    );
    expect(container.querySelector('dl')).toHaveClass('flex', 'flex-col', 'gap-4');
    expect(container.querySelector('dl')).toHaveAttribute('id', 'facts');
    expect(container.querySelector('[data-slot="read-only-field"]')).toHaveAttribute('id', 'plan');
    expect(container.querySelector('[data-slot="read-only-field"]')).toHaveClass('col-span-2', 'gap-1.5');
  });

  it('has no accessibility violations', async () => {
    const { container } = render(
      <ReadOnlyList>
        <ReadOnlyField label="Workspace ID" value="ws_01J9ZK4T2M" font="mono" />
        <ReadOnlyField label="Keyword" value="crm pricing" reason="Fixed after creation." />
      </ReadOnlyList>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
