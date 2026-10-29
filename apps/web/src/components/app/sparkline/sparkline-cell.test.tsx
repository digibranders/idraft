import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SparklineCell } from './sparkline-cell';
import type { SparklinePoint } from '@/lib/api/types';

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
    const points: SparklinePoint[] = [
      { t: '2026-10-01T00:00:00Z', rank: 3, depth: 20, state: 'ranked' },
      { t: '2026-10-02T00:00:00Z', rank: 4, depth: 20, state: 'ranked' },
    ];
    render(<SparklineCell points={points} label="Rank trend: from 3 to 4, best 3" />);
    const canvas = screen.getByRole('img', { name: 'Rank trend: from 3 to 4, best 3' });
    expect(canvas.tagName.toLowerCase()).toBe('canvas');
    expect(canvas).toHaveAttribute('width', String(64 * (window.devicePixelRatio || 1)));
    expect(canvas).toHaveAttribute('height', String(20 * (window.devicePixelRatio || 1)));
    expect(canvas).toHaveStyle({ width: '64px', height: '20px' });
    expect(contextSpies.moveTo).toHaveBeenCalledTimes(1);
    expect(contextSpies.arc).toHaveBeenCalledTimes(1);
  });

  it('breaks into multiple segments with no arc if the last check was beyond depth', () => {
    const points: SparklinePoint[] = [
      { t: '2026-10-01T00:00:00Z', rank: 3, depth: 20, state: 'ranked' },
      { t: '2026-10-02T00:00:00Z', rank: null, depth: 20, state: 'beyond_depth' },
      { t: '2026-10-03T00:00:00Z', rank: 5, depth: 20, state: 'ranked' },
      { t: '2026-10-04T00:00:00Z', rank: null, depth: 20, state: 'beyond_depth' },
    ];
    render(<SparklineCell points={points} label="Rank trend" />);
    expect(contextSpies.moveTo).toHaveBeenCalledTimes(2);
    expect(contextSpies.arc).not.toHaveBeenCalled();
  });

  it('renders empty state when there are no points', () => {
    const { container } = render(<SparklineCell points={[]} label="Rank trend: no checks yet" />);
    const emptyWrapper = screen.getByRole('img', { name: 'Rank trend: no checks yet' });
    expect(emptyWrapper.tagName.toLowerCase()).toBe('span');
    const line = container.querySelector('.border-border');
    expect(line).toBeInTheDocument();
  });
});
