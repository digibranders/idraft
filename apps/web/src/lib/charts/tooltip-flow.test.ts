import { describe, expect, it } from 'vitest';

import { positionOf, tooltipPosition, withTooltipFlow } from './tooltip-flow';

const size = { contentSize: [200, 80] as [number, number], viewSize: [600, 300] as [number, number] };

describe('tooltipPosition', () => {
  it('sits to the right of a pointer in the left half, level with it', () => {
    expect(tooltipPosition([100, 150], size)).toEqual([114, 110]);
  });

  it('sits to the left of a pointer in the right half', () => {
    expect(tooltipPosition([500, 150], size)).toEqual([286, 110]);
  });

  it('moves with the pointer and never leaves the chart', () => {
    expect(tooltipPosition([0, 0], size)).toEqual([14, 0]);
    expect(tooltipPosition([600, 300], size)).toEqual([386, 220]);
    expect(tooltipPosition([590, 290], size)[0]).toBeLessThanOrEqual(600 - 200);
  });

  it('changes side only at the middle, by the width of the gap and the tooltip', () => {
    const before = tooltipPosition([299, 100], size)[0];
    const after = tooltipPosition([301, 100], size)[0];
    expect(before).toBe(313);
    expect(after).toBe(87);
  });

  it('stays at the top left when the tooltip is bigger than the chart', () => {
    expect(tooltipPosition([300, 150], { contentSize: [700, 400], viewSize: [600, 300] })).toEqual([0, 0]);
  });
});

describe('positionOf', () => {
  it('is what ECharts calls: the pointer first and the sizes last, after the params, element and rect', () => {
    expect(positionOf([100, 150], {}, {}, {}, size)).toEqual(tooltipPosition([100, 150], size));
  });
});

describe('withTooltipFlow', () => {
  it('adds the placement and a short glide to a tooltip', () => {
    const out = withTooltipFlow({ tooltip: { trigger: 'axis' } }) as { tooltip: Record<string, unknown> };
    expect(out.tooltip['position']).toBe(positionOf);
    expect(out.tooltip['transitionDuration']).toBe(0.08);
    expect(out.tooltip['trigger']).toBe('axis');
  });

  it('keeps what the builder chose', () => {
    const own = (): [number, number] => [1, 2];
    const out = withTooltipFlow({ tooltip: { position: own, transitionDuration: 0 } }) as {
      tooltip: Record<string, unknown>;
    };
    expect(out.tooltip['position']).toBe(own);
    expect(out.tooltip['transitionDuration']).toBe(0);
  });

  it('leaves a tooltip that hangs on the page where ECharts puts it', () => {
    const out = withTooltipFlow({ tooltip: { appendToBody: true } }) as { tooltip: Record<string, unknown> };
    expect(out.tooltip).not.toHaveProperty('position');
  });

  it('leaves an option with no tooltip as it is', () => {
    const option = { series: [] };
    expect(withTooltipFlow(option)).toBe(option);
  });
});
