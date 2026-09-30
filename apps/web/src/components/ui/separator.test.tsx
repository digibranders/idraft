import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Separator } from './separator';
import { axe } from '@/test/axe';

describe('Separator', () => {
  it('is decoration by default: a subtle horizontal line hidden from assistive technology', () => {
    const { container } = render(<Separator />);
    const line = container.firstElementChild;
    expect(line).toHaveAttribute('aria-hidden', 'true');
    expect(line).toHaveClass('h-px', 'w-full', 'bg-border-subtle');
    expect(screen.queryByRole('separator')).toBeNull();
  });

  it('is a vertical line that takes the height of its row', () => {
    const { container } = render(<Separator orientation="vertical" />);
    expect(container.firstElementChild).toHaveClass('w-px', 'self-stretch');
  });

  it('uses the stronger border between channel groups', () => {
    const { container } = render(<Separator tone="default" />);
    expect(container.firstElementChild).toHaveClass('bg-border');
    expect(container.firstElementChild).not.toHaveClass('bg-border-subtle');
  });

  it('exposes the separator role and its orientation when it carries structure', () => {
    render(<Separator semantics="separator" orientation="vertical" />);
    expect(screen.getByRole('separator')).toHaveAttribute('aria-orientation', 'vertical');
  });

  it('takes a height from the caller, as the 24 px divider of a toolbar does', () => {
    const { container } = render(<Separator orientation="vertical" className="h-6 self-center" />);
    expect(container.firstElementChild).toHaveClass('h-6', 'self-center');
    expect(container.firstElementChild).not.toHaveClass('self-stretch');
  });

  it('passes other attributes on to its root, in both forms', () => {
    const decorative = render(<Separator id="rule" />).container;
    expect(decorative.firstElementChild).toHaveAttribute('id', 'rule');
    render(<Separator semantics="separator" id="group-rule" />);
    expect(screen.getByRole('separator')).toHaveAttribute('id', 'group-rule');
  });

  it('has no accessibility violations in either form', async () => {
    const { container } = render(
      <div>
        <Separator />
        <Separator semantics="separator" />
      </div>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
