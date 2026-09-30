import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Skeleton } from './skeleton';
import { axe } from '@/test/axe';

const root = (container: HTMLElement): Element => {
  const node = container.firstElementChild;
  if (!node) throw new Error('Nothing rendered');
  return node;
};

describe('Skeleton', () => {
  it('is hidden from assistive technology: the region around it says what is loading', () => {
    const { container } = render(<Skeleton shape="block" />);
    expect(root(container)).toHaveAttribute('aria-hidden', 'true');
  });

  it('pulses on the subtle surface with a 4 px radius', () => {
    const { container } = render(<Skeleton shape="block" />);
    expect(root(container)).toHaveClass('bg-surface-subtle', 'rounded-sm', 'animate-skeleton-pulse');
  });

  it.each([
    ['text-14', 'h-5', 'h-3'],
    ['text-13', 'h-5', 'h-3'],
    ['text-12', 'h-4', 'h-2.5'],
  ] as const)(
    '%s keeps the line height of the text it stands for, with a shorter bar centered inside',
    (shape, line, bar) => {
      const { container } = render(<Skeleton shape={shape} widthPct={64} />);
      expect(root(container)).toHaveClass(line, 'w-[64%]', 'flex', 'items-center');
      expect(root(container).firstElementChild).toHaveClass(
        'bg-surface-subtle',
        'animate-skeleton-pulse',
        'w-full',
        bar,
      );
    },
  );

  it('stays hidden whatever the caller passes', () => {
    const { container } = render(<Skeleton shape="block" aria-hidden={false} />);
    expect(root(container)).toHaveAttribute('aria-hidden', 'true');
  });

  it('passes other attributes on to its root', () => {
    const { container } = render(<Skeleton shape="badge" id="status-placeholder" className="ml-auto" />);
    expect(root(container)).toHaveAttribute('id', 'status-placeholder');
    expect(root(container)).toHaveAttribute('data-slot', 'skeleton');
    expect(root(container)).toHaveClass('ml-auto', 'h-badge');
  });

  it('has no accessibility violations', async () => {
    const { container } = render(
      <div aria-busy="true">
        <Skeleton shape="text-14" widthPct={72} />
        <Skeleton shape="block" height="chart-140" />
      </div>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('is as tall as a badge or a sparkline for those shapes', () => {
    expect(root(render(<Skeleton shape="badge" />).container)).toHaveClass('h-badge');
    expect(root(render(<Skeleton shape="sparkline" />).container)).toHaveClass('h-6', 'w-24');
  });

  it.each([
    ['row', 'h-row'],
    ['chart-140', 'h-35'],
    ['chart-180', 'h-45'],
    ['chart-240', 'h-60'],
    ['chart-280', 'h-70'],
  ] as const)('a block of height %s is %s', (height, heightClass) => {
    const { container } = render(<Skeleton shape="block" height={height} />);
    expect(root(container)).toHaveClass(heightClass, 'w-full');
  });

  it.each([
    [48, 'w-[48%]'],
    [56, 'w-[56%]'],
    [72, 'w-[72%]'],
    [80, 'w-4/5'],
    [100, 'w-full'],
  ] as const)('width %i%% is %s', (widthPct, widthClass) => {
    const { container } = render(<Skeleton shape="text-13" widthPct={widthPct} />);
    expect(root(container)).toHaveClass(widthClass);
  });
});
