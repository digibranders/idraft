import { render, screen } from '@testing-library/react';
import { Search } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { Icon } from './icon';
import { axe } from '@/test/axe';

const glyph = (container: HTMLElement): SVGElement => {
  const svg = container.querySelector('svg');
  if (!svg) throw new Error('No svg rendered');
  return svg;
};

describe('Icon', () => {
  it('is hidden from assistive technology unless it has a label', () => {
    const { container } = render(<Icon icon={Search} />);
    expect(glyph(container)).toHaveAttribute('aria-hidden', 'true');
    expect(glyph(container)).not.toHaveAttribute('role');
  });

  it('is an image with a name when it has a label', () => {
    render(<Icon icon={Search} label="Search results" />);
    expect(screen.getByRole('img', { name: 'Search results' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Search results' })).not.toHaveAttribute('aria-hidden', 'true');
  });

  it.each([
    ['xs', 'size-icon-xs', '1.5'],
    ['sm', 'size-icon-sm', '1.75'],
    ['default', 'size-icon', '1.75'],
    ['md', 'size-icon-md', '1.75'],
    ['lg', 'size-icon-lg', '1.5'],
  ] as const)('size %s uses %s and a stroke of %s', (size, sizeClass, stroke) => {
    const { container } = render(<Icon icon={Search} size={size} />);
    expect(glyph(container)).toHaveClass(sizeClass, 'shrink-0');
    expect(glyph(container)).toHaveAttribute('stroke-width', stroke);
  });

  it('keeps the stroke at its width however the glyph is scaled', () => {
    const { container } = render(<Icon icon={Search} />);
    expect(container.querySelector('[vector-effect="non-scaling-stroke"]')).not.toBeNull();
  });

  it('cannot take keyboard focus', () => {
    const { container } = render(<Icon icon={Search} />);
    expect(glyph(container)).toHaveAttribute('focusable', 'false');
  });

  it('passes other attributes on, and keeps the size and stroke it fixes', () => {
    const { container } = render(<Icon icon={Search} id="glyph" className="text-foreground-tertiary" />);
    expect(glyph(container)).toHaveAttribute('id', 'glyph');
    expect(glyph(container)).toHaveAttribute('data-slot', 'icon');
    expect(glyph(container)).toHaveClass('text-foreground-tertiary', 'size-icon');
  });

  it('has no accessibility violations, decorative or named', async () => {
    const { container } = render(
      <p>
        <Icon icon={Search} /> Search <Icon icon={Search} label="Search results" />
      </p>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
