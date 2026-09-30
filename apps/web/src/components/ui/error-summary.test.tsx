import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ErrorSummary, type ErrorSummaryItem } from './error-summary';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const ERRORS: readonly ErrorSummaryItem[] = [
  { fieldId: 'limit', label: 'Monthly limit', message: 'Enter an amount from $1.00 to $100,000.00' },
  { fieldId: 'soft', label: 'Soft limit', message: 'Enter a percentage from 1 to 100' },
];

describe('ErrorSummary', () => {
  it('lists every error under a heading that can take focus', () => {
    const headingRef = { current: null as HTMLHeadingElement | null };
    renderWithProviders(<ErrorSummary title="Fix 2 fields to save" errors={ERRORS} headingRef={headingRef} />);
    const heading = screen.getByRole('heading', { name: 'Fix 2 fields to save' });
    expect(heading).toHaveAttribute('tabindex', '-1');
    expect(headingRef.current).toBe(heading);
    headingRef.current?.focus();
    expect(heading).toHaveFocus();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent(
      'Monthly limit Enter an amount from $1.00 to $100,000.00',
    );
    expect(screen.getByText('Monthly limit')).toHaveClass('type-body-strong', 'text-link', 'underline');
  });

  it('is not a live region: focus moving to it is what reads it', () => {
    const { container } = renderWithProviders(<ErrorSummary title="Fix 2 fields to save" errors={ERRORS} />);
    const root = container.querySelector('[data-slot="error-summary"]');
    expect(root).not.toBeNull();
    expect(root).not.toHaveAttribute('aria-live');
    expect(root).not.toHaveAttribute('role');
    expect(root?.querySelector('[aria-live], [role="alert"], [role="status"]')).toBeNull();
  });

  it('puts focus in the field whose error is clicked', async () => {
    const { user } = renderWithProviders(
      <>
        <ErrorSummary title="Fix 2 fields to save" errors={ERRORS} />
        <input id="limit" aria-label="Monthly limit" />
        <input id="soft" aria-label="Soft limit" />
      </>,
    );
    const link = screen.getByRole('link', { name: 'Soft limit Enter a percentage from 1 to 100' });
    expect(link).toHaveAttribute('href', '#soft');
    await user.click(link);
    expect(screen.getByRole('textbox', { name: 'Soft limit' })).toHaveFocus();
  });

  it('falls back to a plain jump when the target cannot take focus', () => {
    renderWithProviders(
      <>
        <ErrorSummary
          title="Fix 1 field to save"
          errors={[{ fieldId: 'group', label: 'Device', message: 'Choose a device' }]}
        />
        <div id="group">A group that is not focusable</div>
      </>,
    );
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    screen.getByRole('link').dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
  });

  it('renders nothing once every error is fixed', () => {
    const { container } = renderWithProviders(<ErrorSummary title="Fix 0 fields to save" errors={[]} />);
    expect(container.querySelector('[data-slot="error-summary"]')).toBeNull();
  });

  it('is a negative region banner, and passes other attributes on', () => {
    const { container } = renderWithProviders(
      <ErrorSummary title="Fix 2 fields to save" errors={ERRORS} id="summary" className="mb-4" />,
    );
    const root = container.querySelector('[data-slot="error-summary"]');
    expect(root).toHaveClass(
      'rounded-md',
      'border',
      'border-negative-border',
      'bg-negative-subtle',
      'px-3',
      'py-2',
      'mb-4',
    );
    expect(root).toHaveAttribute('id', 'summary');
    expect(root?.querySelector('svg')).toHaveClass('size-icon', 'text-negative-text');
    expect(screen.getByRole('heading')).toHaveClass('type-subsection-title');
  });

  it('has no accessibility violations', async () => {
    const { container } = renderWithProviders(
      <>
        <ErrorSummary title="Fix 2 fields to save" errors={ERRORS} />
        <input id="limit" aria-label="Monthly limit" />
        <input id="soft" aria-label="Soft limit" />
      </>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
