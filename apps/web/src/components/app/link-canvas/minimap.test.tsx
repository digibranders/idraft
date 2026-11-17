import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Minimap } from './minimap';

describe('Minimap', () => {
  it('draws a box per card and the part in view, hidden under 640 px, and moves the view when pressed', () => {
    const onMove = vi.fn();
    render(
      <Minimap
        label="Map of the journey"
        content={{ left: 0, top: 0, width: 2000, height: 1000 }}
        cards={[
          { key: 'a', left: 0, top: 0, width: 240, height: 42 },
          { key: 'b', left: 400, top: 200, width: 240, height: 42 },
        ]}
        shown={{ left: 0, top: 0, width: 1000, height: 600 }}
        onMove={onMove}
      />,
    );
    const map = screen.getByRole('img', { name: 'Map of the journey' });
    expect(map.querySelectorAll('[data-card]')).toHaveLength(2);
    expect(map.querySelector('[data-shown]')).not.toBeNull();
    expect(map.getAttribute('class')).toContain('hidden');
    expect(map.getAttribute('class')).toContain('sm:block');
    // A finger on the map moves the view, not the page
    expect(map.getAttribute('class')).toContain('touch-none');
  });

  it('asks for the clicked world point to be centred, from a map that is not at the corner of the page', () => {
    const onMove = vi.fn();
    render(
      <Minimap
        label="Map of the journey"
        content={{ left: 100, top: 50, width: 2000, height: 1000 }}
        cards={[]}
        shown={{ left: 100, top: 50, width: 1000, height: 600 }}
        onMove={onMove}
      />,
    );
    const map = screen.getByRole('img', { name: 'Map of the journey' });
    map.getBoundingClientRect = () => new DOMRect(10, 20, 176, 112);
    // The map is 0.088 of the world (176 over 2000): 88 px across is 1000 world px, 44 px down is 500
    fireEvent.pointerDown(map, { pointerId: 1, clientX: 10 + 88, clientY: 20 + 44 });
    const point = onMove.mock.calls[0]?.[0] as { x: number; y: number };
    expect(point.x).toBeCloseTo(1100, 6);
    expect(point.y).toBeCloseTo(550, 6);
    onMove.mockClear();
    fireEvent.pointerMove(map, { pointerId: 1, clientX: 10, clientY: 20, buttons: 1 });
    expect(onMove).toHaveBeenCalledTimes(1);
    onMove.mockClear();
    fireEvent.pointerMove(map, { pointerId: 1, clientX: 10, clientY: 20, buttons: 0 });
    expect(onMove).not.toHaveBeenCalled();
  });
});
