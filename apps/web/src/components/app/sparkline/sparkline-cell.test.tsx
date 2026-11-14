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

  /** The y of every point the line is drawn through, in the order they are drawn. */
  const drawnYs = (): number[] =>
    [...contextSpies.moveTo.mock.calls, ...contextSpies.lineTo.mock.calls].map((call) => Number(call[1]));

  it('draws a rate that moves a point nearly flat without being told a least span', () => {
    render(<SparklineCell values={[0.4, 0.41, 0.4, 0.41]} label="Mention rate trend" kind="rate" />);
    const ys = drawnYs();
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(2);
  });

  it('lets a count fill the box with a move as small as that', () => {
    render(<SparklineCell values={[0.4, 0.41, 0.4, 0.41]} label="Search volume trend" />);
    const ys = drawnYs();
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(10);
  });

  it('draws rank 1 above rank 5', () => {
    render(<SparklineCell values={[1, 5]} label="Rank trend" kind="rank" />);
    const [top] = contextSpies.moveTo.mock.calls;
    const [bottom] = contextSpies.lineTo.mock.calls;
    expect(Number(top?.[1])).toBeLessThan(Number(bottom?.[1]));
  });

  it('breaks the line at a rank beyond the depth of the scale', () => {
    const { unmount } = render(<SparklineCell values={[3, 4, 25, 5, 6]} label="Rank trend" kind="rank" />);
    expect(contextSpies.moveTo).toHaveBeenCalledTimes(2);
    unmount();
    vi.clearAllMocks();
    render(<SparklineCell values={[3, 4, 25, 5, 6]} label="Rank trend" kind="rank" rankDepth={30} />);
    expect(contextSpies.moveTo).toHaveBeenCalledTimes(1);
  });

  it('draws tone own in --chart-1', () => {
    const read = vi.spyOn(tokens, 'readColorToken').mockReturnValue('');
    render(<SparklineCell values={[1, 2, 3]} label="Mention rate trend" tone="own" />);
    expect(read).toHaveBeenCalledWith('--chart-1');
  });

  it.each([
    ['compact', 16],
    ['default', 20],
    [undefined, 20],
  ] as const)('is 64 px wide at density %s, and %s px high', (density, height) => {
    const ratio = window.devicePixelRatio || 1;
    render(<SparklineCell values={[1, 2]} label="Trend" density={density} />);
    const canvas = screen.getByRole('img', { name: 'Trend' });
    expect(canvas).toHaveAttribute('width', String(64 * ratio));
    expect(canvas).toHaveAttribute('height', String(height * ratio));
    expect(canvas).toHaveStyle({ width: '64px', height: `${String(height)}px` });
  });

  it('sizes the empty line to the density as well', () => {
    render(<SparklineCell values={[null]} label="Trend: none" density="compact" />);
    expect(screen.getByRole('img', { name: 'Trend: none' })).toHaveStyle({ width: '64px', height: '16px' });
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
