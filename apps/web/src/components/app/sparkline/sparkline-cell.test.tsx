import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SparklineCell } from './sparkline-cell';
import * as tokens from '@/lib/design/read-tokens';

describe('SparklineCell', () => {
  const contextSpies = {
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    setTransform: vi.fn(),
    clearRect: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((contextId: string) => {
      if (contextId === '2d') {
        return contextSpies as unknown as CanvasRenderingContext2D;
      }
      return null;
    }) as unknown as typeof HTMLCanvasElement.prototype.getContext);
  });

  it('renders a canvas with role="img", aria-label, and scaled pixel dimensions', () => {
    render(<SparklineCell values={[1300, 1900]} label="Search volume trend: from 1,300 to 1,900" />);
    const canvas = screen.getByRole('img', { name: 'Search volume trend: from 1,300 to 1,900' });
    expect(canvas.tagName.toLowerCase()).toBe('canvas');
    expect(canvas).toHaveAttribute('width', String(64 * (window.devicePixelRatio || 1)));
    expect(canvas).toHaveAttribute('height', String(20 * (window.devicePixelRatio || 1)));
    expect(canvas).toHaveStyle({ width: '64px', height: '20px' });
    expect(contextSpies.moveTo).toHaveBeenCalledTimes(1);
    expect(contextSpies.arc).toHaveBeenCalledTimes(1);
  });

  it('breaks the line at a month without a volume, and puts no dot on a last month that has none', () => {
    render(<SparklineCell values={[300, 400, null]} label="Search volume trend" />);
    expect(contextSpies.moveTo).toHaveBeenCalledTimes(1);
    expect(contextSpies.lineTo).toHaveBeenCalledTimes(1);
    expect(contextSpies.arc).not.toHaveBeenCalled();
  });

  it('draws a dot for a run of one month in [none, volume, none]', () => {
    render(<SparklineCell values={[null, 700, null]} label="Search volume trend" />);
    expect(contextSpies.arc).toHaveBeenCalledTimes(1);
    expect(contextSpies.fill).toHaveBeenCalledTimes(1);
  });

  it('renders the dashed treatment when no month has a volume', () => {
    const { container } = render(<SparklineCell values={[null, null]} label="Search volume trend: none" />);
    const emptyWrapper = screen.getByRole('img', { name: 'Search volume trend: none' });
    expect(emptyWrapper.tagName.toLowerCase()).toBe('span');
    expect(container.querySelector('.border-border')).toBeInTheDocument();
  });

  it('renders the dashed treatment when there are no months', () => {
    const { container } = render(<SparklineCell values={[]} label="Search volume trend: no monthly volumes yet" />);
    const emptyWrapper = screen.getByRole('img', { name: 'Search volume trend: no monthly volumes yet' });
    expect(emptyWrapper.tagName.toLowerCase()).toBe('span');
    expect(container.querySelector('.border-border')).toBeInTheDocument();
  });

  it.each([
    [undefined, '--chart-reference'],
    ['reference', '--chart-reference'],
    ['positive', '--positive-solid'],
    ['negative', '--negative-solid'],
  ] as const)('draws tone %s in %s', (tone, token) => {
    const read = vi.spyOn(tokens, 'readColorToken').mockReturnValue('');
    render(<SparklineCell values={[1, 2, 3]} label="Clicks trend" tone={tone} />);
    expect(read).toHaveBeenCalledWith(token);
  });
});
