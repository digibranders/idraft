import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FormAlert } from './form-alert';
import { axe } from '@/test/axe';

const QUOTA = 'This adds 240 keywords, but only 96 are left in your plan. Remove 144 keywords or archive unused ones.';

describe('FormAlert', () => {
  it('is announced at once when it appears after a submit', () => {
    render(<FormAlert message={QUOTA} />);
    expect(screen.getByRole('alert')).toHaveTextContent(QUOTA);
  });

  it('is a region banner in the negative family with an icon besides its color', () => {
    render(<FormAlert message={QUOTA} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveClass(
      'rounded-md',
      'border',
      'border-negative-border',
      'bg-negative-subtle',
      'px-3',
      'py-2',
      'type-body',
    );
    expect(alert.querySelector('svg')).toHaveClass('size-icon', 'text-negative-text');
    expect(alert.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('is a polite status in the warning family for a warning', () => {
    render(<FormAlert tone="warning" message="Saving will restart today's checks." />);
    const status = screen.getByRole('status');
    expect(status).toHaveClass('border-warning-border', 'bg-warning-subtle');
    expect(status.querySelector('svg')).toHaveClass('text-warning-text');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('passes other attributes on to its root', () => {
    render(<FormAlert message={QUOTA} id="form-error" className="mt-4" />);
    expect(screen.getByRole('alert')).toHaveAttribute('id', 'form-error');
    expect(screen.getByRole('alert')).toHaveClass('mt-4');
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<FormAlert message={QUOTA} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
