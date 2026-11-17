import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CanvasViewport } from './canvas-viewport';
import type { View } from '@/lib/internal-links/canvas-view';

function setup(view: View = { x: 0, y: 0, scale: 1 }, onKey?: (key: string) => void) {
  const onViewChange = vi.fn();
  render(
    <CanvasViewport
      label="Journey"
      view={view}
      onViewChange={onViewChange}
      size={{ width: 1000, height: 600 }}
      onKey={onKey === undefined ? undefined : (event) => onKey(event.key)}
    >
      <button type="button">card</button>
    </CanvasViewport>,
  );
  const region = screen.getByRole('group', { name: 'Journey' });
  return { region, onViewChange };
}

const last = (fn: ReturnType<typeof vi.fn>): View => fn.mock.lastCall?.[0] as View;

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('data-motion');
});

describe('CanvasViewport', () => {
  it('places the world with one transform, and nothing scrolls', () => {
    const { region } = setup({ x: 40, y: 20, scale: 0.5 });
    const world = region.firstElementChild as HTMLElement;
    expect(world.style.transform).toBe('translate(40px, 20px) scale(0.5)');
    expect(region.className).toContain('overflow-hidden');
  });

  it('draws a dot grid that follows the view', () => {
    const { region } = setup({ x: 10, y: 6, scale: 0.5 });
    expect(region.style.backgroundSize).toBe('12px 12px');
    expect(region.style.backgroundPosition).toBe('10px 6px');
  });

  it('is a labelled region with a tab stop', () => {
    const { region } = setup();
    expect(region).toHaveAttribute('tabindex', '0');
  });

  it('zooms toward the cursor on Ctrl and wheel, and on Cmd and wheel', () => {
    const { region, onViewChange } = setup();
    fireEvent.wheel(region, { deltaY: -100, ctrlKey: true, clientX: 200, clientY: 100 });
    expect(last(onViewChange).scale).toBeGreaterThan(1);
    onViewChange.mockClear();
    fireEvent.wheel(region, { deltaY: 100, metaKey: true, clientX: 200, clientY: 100 });
    expect(last(onViewChange).scale).toBeLessThan(1);
  });

  it('pans on a plain wheel or a two finger scroll', () => {
    const { region, onViewChange } = setup();
    fireEvent.wheel(region, { deltaX: 30, deltaY: 50 });
    expect(onViewChange).toHaveBeenCalledWith({ x: -30, y: -50, scale: 1 });
  });

  it('pans when the empty background is dragged, and not when a card is', () => {
    const { region, onViewChange } = setup();
    fireEvent.pointerDown(region, { pointerId: 1, clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerMove(region, { pointerId: 1, clientX: 140, clientY: 110 });
    expect(onViewChange).toHaveBeenCalledWith({ x: 40, y: 10, scale: 1 });
    onViewChange.mockClear();
    fireEvent.pointerUp(region, { pointerId: 1 });
    fireEvent.pointerDown(screen.getByRole('button', { name: 'card' }), { pointerId: 2, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(region, { pointerId: 2, clientX: 50, clientY: 50 });
    expect(onViewChange).not.toHaveBeenCalled();
  });

  it('pans on Space and drag even from a card', () => {
    const { region, onViewChange } = setup();
    region.focus();
    fireEvent.keyDown(region, { key: ' ' });
    fireEvent.pointerDown(screen.getByRole('button', { name: 'card' }), { pointerId: 3, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(region, { pointerId: 3, clientX: 20, clientY: 5 });
    expect(onViewChange).toHaveBeenCalledWith({ x: 20, y: 5, scale: 1 });
  });

  it('pinches: two fingers moving apart zoom in', () => {
    const { region, onViewChange } = setup();
    fireEvent.pointerDown(region, { pointerId: 1, clientX: 400, clientY: 300, pointerType: 'touch' });
    fireEvent.pointerDown(region, { pointerId: 2, clientX: 500, clientY: 300, pointerType: 'touch' });
    fireEvent.pointerMove(region, { pointerId: 2, clientX: 600, clientY: 300, pointerType: 'touch' });
    expect(last(onViewChange).scale).toBeGreaterThan(1);
  });

  describe('after a fast drag', () => {
    const frames: FrameRequestCallback[] = [];
    const drag = (region: HTMLElement): void => {
      const spy = vi.spyOn(performance, 'now');
      spy.mockReturnValue(0);
      fireEvent.pointerDown(region, { pointerId: 1, clientX: 0, clientY: 0, button: 0 });
      spy.mockReturnValue(16);
      fireEvent.pointerMove(region, { pointerId: 1, clientX: 80, clientY: 0 });
      fireEvent.pointerUp(region, { pointerId: 1 });
      spy.mockRestore();
    };
    beforeEach(() => {
      frames.length = 0;
      vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
      vi.stubGlobal('cancelAnimationFrame', vi.fn());
    });

    it('glides to a stop', () => {
      const { region, onViewChange } = setup();
      drag(region);
      expect(frames).toHaveLength(1);
      frames[0]?.(0);
      // The view prop is fixed in this test, so the first step is the release speed times the friction
      expect(last(onViewChange).x).toBeCloseTo(73.6, 1);
      expect(frames).toHaveLength(2);
    });

    it('does not glide under reduced motion', () => {
      document.documentElement.dataset.motion = 'reduced';
      const { region } = setup();
      drag(region);
      expect(frames).toHaveLength(0);
    });
  });

  it('answers the keys of the canvas when the empty canvas has focus', () => {
    const { region, onViewChange } = setup();
    region.focus();
    fireEvent.keyDown(region, { key: 'ArrowRight' });
    expect(onViewChange).toHaveBeenLastCalledWith({ x: -40, y: 0, scale: 1 });
    fireEvent.keyDown(region, { key: 'ArrowRight', shiftKey: true });
    expect(onViewChange).toHaveBeenLastCalledWith({ x: -160, y: 0, scale: 1 });
    fireEvent.keyDown(region, { key: '+' });
    expect(last(onViewChange).scale).toBe(1.25);
    fireEvent.keyDown(region, { key: '-' });
    expect(last(onViewChange).scale).toBe(0.75);
    fireEvent.keyDown(region, { key: '1' });
    expect(onViewChange.mock.calls.length).toBe(5);
  });

  it('1 returns to 100 percent from another zoom', () => {
    const { region, onViewChange } = setup({ x: 0, y: 0, scale: 0.5 });
    fireEvent.keyDown(region, { key: '1' });
    expect(last(onViewChange).scale).toBe(1);
  });

  it('hands the keys it does not own to the canvas, and ignores keys from a card or with a modifier', () => {
    const keys: string[] = [];
    const { region, onViewChange } = setup(undefined, (key) => keys.push(key));
    fireEvent.keyDown(region, { key: '0' });
    fireEvent.keyDown(region, { key: 'Home' });
    fireEvent.keyDown(region, { key: 'Escape' });
    expect(keys).toEqual(['0', 'Home', 'Escape']);
    fireEvent.keyDown(screen.getByRole('button', { name: 'card' }), { key: 'ArrowRight' });
    fireEvent.keyDown(region, { key: 'ArrowRight', ctrlKey: true });
    expect(onViewChange).not.toHaveBeenCalled();
  });

  it('puts a scroll offset back to zero, so focus never scrolls the hidden overflow', () => {
    const { region } = setup();
    region.scrollLeft = 50;
    fireEvent.scroll(region);
    expect(region.scrollLeft).toBe(0);
  });
});
