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
    fireEvent.pointerDown(map, { pointerId: 1, clientX: 60, clientY: 30 });
    expect(onMove).toHaveBeenCalled();
    const target = onMove.mock.calls[0]?.[0] as { x: number; y: number };
    expect(target.x).toBeGreaterThan(0);
  });
});
