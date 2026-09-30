import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Spinner } from './spinner';
import { axe } from '@/test/axe';

describe('Spinner', () => {
  it('is a status with its label when no visible text sits beside it', () => {
    render(<Spinner label="Loading keywords" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading keywords');
  });

  it('is decoration when visible text carries the state', () => {
    const { container } = render(
      <p>
        <Spinner /> Updating
      </p>,
    );
    expect(screen.queryByRole('status')).toBeNull();
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it.each([
    ['sm', 'size-icon-sm'],
    ['md', 'size-icon'],
  ] as const)('size %s is %s and turns', (size, sizeClass) => {
    const { container } = render(<Spinner size={size} />);
    expect(container.querySelector('svg')).toHaveClass(sizeClass, 'animate-spin');
  });

  it('passes other attributes on to its root', () => {
    const { container } = render(<Spinner id="busy" className="ml-auto" />);
    expect(container.firstElementChild).toHaveAttribute('id', 'busy');
    expect(container.firstElementChild).toHaveClass('ml-auto', 'inline-flex');
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<Spinner label="Loading" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
