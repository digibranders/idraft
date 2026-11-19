import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CanvasViewport } from './canvas-viewport';
import { toScreen, type View } from '@/lib/internal-links/canvas-view';

// Animation frames run by hand, so a test decides when a frame comes
const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 1;
const cancelFrame = vi.fn((id: number) => void frames.delete(id));
const runFrames = (): void => {
  const batch = [...frames.values()];
  frames.clear();
  for (const callback of batch) callback(0);
};

beforeEach(() => {
  frames.clear();
  nextFrame = 1;
  cancelFrame.mockClear();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(nextFrame, callback);
    return nextFrame++;
  });
  vi.stubGlobal('cancelAnimationFrame', cancelFrame);
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('data-motion');
});

function setup(view: View = { x: 0, y: 0, scale: 1 }, onKey?: (key: string) => void) {
  const onViewChange = vi.fn();
  const element = (v: View) => (
    <CanvasViewport
      label="Journey"
      view={v}
      onViewChange={onViewChange}
      size={{ width: 1000, height: 600 }}
      onKey={onKey === undefined ? undefined : (event) => onKey(event.key)}
    >
      <button type="button">card</button>
      <input aria-label="field" />
    </CanvasViewport>
  );
  const { rerender, unmount } = render(element(view));
  const region = screen.getByRole('group', { name: 'Journey' });
  return { region, onViewChange, unmount, rerender: (v: View) => rerender(element(v)) };
}

const last = (fn: ReturnType<typeof vi.fn>): View => fn.mock.lastCall?.[0] as View;

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

  it('puts a scroll offset back to zero, so focus never scrolls the hidden overflow', () => {
    const { region } = setup();
    region.scrollLeft = 50;
    fireEvent.scroll(region);
    expect(region.scrollLeft).toBe(0);
  });

  describe('wheel', () => {
    it('pans on a plain wheel or a two finger scroll', () => {
      const { region, onViewChange } = setup();
      fireEvent.wheel(region, { deltaX: 30, deltaY: 50 });
      runFrames();
      expect(onViewChange).toHaveBeenCalledWith({ x: -30, y: -50, scale: 1 });
    });

    it('keeps every delta when two events come before a frame, and reports once', () => {
      const { region, onViewChange } = setup();
      fireEvent.wheel(region, { deltaX: 0, deltaY: 50 });
      fireEvent.wheel(region, { deltaX: 0, deltaY: 30 });
      expect(onViewChange).not.toHaveBeenCalled();
      runFrames();
      expect(onViewChange).toHaveBeenCalledTimes(1);
      expect(onViewChange).toHaveBeenCalledWith({ x: 0, y: -80, scale: 1 });
    });

    it('reads a page scroll as a screen of pixels', () => {
      const { region, onViewChange } = setup();
      fireEvent.wheel(region, { deltaY: 1, deltaMode: 2 });
      runFrames();
      expect(last(onViewChange).y).toBe(-600);
    });

    it('zooms with Ctrl or Cmd and the wheel, and the point under the cursor stays where it is', () => {
      const { region, onViewChange } = setup({ x: 30, y: 20, scale: 1 });
      region.getBoundingClientRect = () => new DOMRect(10, 5, 1000, 600);
      const world = { x: (200 - 30) / 1, y: (100 - 20) / 1 };
      fireEvent.wheel(region, { deltaY: -200, ctrlKey: true, clientX: 210, clientY: 105 });
      runFrames();
      const zoomedIn = last(onViewChange);
      expect(zoomedIn.scale).toBeGreaterThan(1);
      expect(toScreen(zoomedIn, world).x).toBeCloseTo(200, 6);
      expect(toScreen(zoomedIn, world).y).toBeCloseTo(100, 6);
      onViewChange.mockClear();
      fireEvent.wheel(region, { deltaY: 200, metaKey: true, clientX: 210, clientY: 105 });
      runFrames();
      expect(last(onViewChange).scale).toBeLessThan(zoomedIn.scale);
    });

    it('stops at 25 and 200 percent', () => {
      const { region, onViewChange } = setup();
      fireEvent.wheel(region, { deltaY: -100000, ctrlKey: true });
      runFrames();
      expect(last(onViewChange).scale).toBe(2);
      fireEvent.wheel(region, { deltaY: 100000, ctrlKey: true });
      runFrames();
      expect(last(onViewChange).scale).toBe(0.25);
    });

    it('stops the page from scrolling, and lets go of the wheel when it unmounts', () => {
      const { region, onViewChange, unmount } = setup();
      const event = createEvent.wheel(region, { deltaY: 10 });
      fireEvent(region, event);
      expect(event.defaultPrevented).toBe(true);
      runFrames();
      onViewChange.mockClear();
      unmount();
      const after = createEvent.wheel(region, { deltaY: 10 });
      fireEvent(region, after);
      expect(after.defaultPrevented).toBe(false);
      runFrames();
      expect(onViewChange).not.toHaveBeenCalled();
    });
  });

  describe('drag', () => {
    it('pans when the empty background is dragged, and not when a card is', () => {
      const { region, onViewChange } = setup();
      fireEvent.pointerDown(region, { pointerId: 1, clientX: 100, clientY: 100, button: 0 });
      fireEvent.pointerMove(region, { pointerId: 1, clientX: 140, clientY: 110 });
      runFrames();
      expect(onViewChange).toHaveBeenCalledWith({ x: 40, y: 10, scale: 1 });
      onViewChange.mockClear();
      fireEvent.pointerUp(region, { pointerId: 1 });
      fireEvent.pointerDown(screen.getByRole('button', { name: 'card' }), { pointerId: 2, clientX: 0, clientY: 0 });
      fireEvent.pointerMove(region, { pointerId: 2, clientX: 50, clientY: 50 });
      runFrames();
      expect(onViewChange).not.toHaveBeenCalled();
    });

    it('lets the canvas take a press of the background, and then does not pan', () => {
      const onBackgroundPointerDown = vi.fn(() => true);
      const onViewChange = vi.fn();
      render(
        <CanvasViewport
          label="Journey"
          view={{ x: 0, y: 0, scale: 1 }}
          onViewChange={onViewChange}
          size={{ width: 1000, height: 600 }}
          onBackgroundPointerDown={onBackgroundPointerDown}
        >
          <button type="button">card</button>
        </CanvasViewport>,
      );
      const region = screen.getByRole('group', { name: 'Journey' });
      fireEvent.pointerDown(region, { pointerId: 1, clientX: 100, clientY: 100, button: 0, shiftKey: true });
      fireEvent.pointerMove(region, { pointerId: 1, clientX: 140, clientY: 110 });
      runFrames();
      expect(onBackgroundPointerDown).toHaveBeenCalledTimes(1);
      expect(onViewChange).not.toHaveBeenCalled();
      // A press on a card is never offered to the canvas as background
      fireEvent.pointerUp(region, { pointerId: 1 });
      fireEvent.pointerDown(screen.getByRole('button', { name: 'card' }), { pointerId: 2, clientX: 0, clientY: 0 });
      expect(onBackgroundPointerDown).toHaveBeenCalledTimes(1);
    });

    it('keeps the first delta when a second move comes before the view has been rendered', () => {
      const { region, onViewChange } = setup();
      fireEvent.pointerDown(region, { pointerId: 1, clientX: 100, clientY: 100, button: 0 });
      fireEvent.pointerMove(region, { pointerId: 1, clientX: 140, clientY: 100 });
      fireEvent.pointerMove(region, { pointerId: 1, clientX: 150, clientY: 100 });
      expect(onViewChange).not.toHaveBeenCalled();
      runFrames();
      expect(onViewChange).toHaveBeenCalledTimes(1);
      expect(onViewChange).toHaveBeenCalledWith({ x: 50, y: 0, scale: 1 });
    });

    it('reports the final view when the pointer is lifted before a frame comes', () => {
      const { region, onViewChange } = setup();
      fireEvent.pointerDown(region, { pointerId: 1, clientX: 0, clientY: 0, button: 0 });
      fireEvent.pointerMove(region, { pointerId: 1, clientX: 12, clientY: 0 });
      fireEvent.pointerUp(region, { pointerId: 1 });
      expect(onViewChange).toHaveBeenLastCalledWith({ x: 12, y: 0, scale: 1 });
    });

    it('ends on pointercancel', () => {
      const { region, onViewChange } = setup();
      fireEvent.pointerDown(region, { pointerId: 1, clientX: 0, clientY: 0, button: 0 });
      fireEvent.pointerMove(region, { pointerId: 1, clientX: 12, clientY: 0 });
      fireEvent.pointerCancel(region, { pointerId: 1 });
      onViewChange.mockClear();
      fireEvent.pointerMove(region, { pointerId: 1, clientX: 90, clientY: 0 });
      runFrames();
      expect(onViewChange).not.toHaveBeenCalled();
    });

    it('pans on Space and drag even from a card', () => {
      const { region, onViewChange } = setup();
      region.focus();
      fireEvent.keyDown(region, { key: ' ' });
      fireEvent.pointerDown(screen.getByRole('button', { name: 'card' }), { pointerId: 3, clientX: 0, clientY: 0 });
      fireEvent.pointerMove(region, { pointerId: 3, clientX: 20, clientY: 5 });
      runFrames();
      expect(onViewChange).toHaveBeenCalledWith({ x: 20, y: 5, scale: 1 });
    });
  });

  describe('pinch', () => {
    const touch = { pointerType: 'touch' };

    it('zooms by the ratio of the finger distance around the middle of the fingers, and holds both fingers', () => {
      const { region, onViewChange } = setup();
      const capture = vi.fn();
      region.setPointerCapture = capture;
      fireEvent.pointerDown(region, { pointerId: 1, clientX: 400, clientY: 300, ...touch });
      fireEvent.pointerDown(region, { pointerId: 2, clientX: 500, clientY: 300, ...touch });
      fireEvent.pointerMove(region, { pointerId: 2, clientX: 600, clientY: 300, ...touch });
      runFrames();
      // Fingers 100 apart go 200 apart: twice the zoom, the point between the fingers (500, 300) stays put
      expect(last(onViewChange)).toEqual({ x: -500, y: -300, scale: 2 });
      expect(capture).toHaveBeenCalledWith(1);
      expect(capture).toHaveBeenCalledWith(2);
    });

    it('goes from one finger to two and back to one without a jump', () => {
      const { region, onViewChange } = setup();
      fireEvent.pointerDown(region, { pointerId: 1, clientX: 400, clientY: 300, ...touch });
      fireEvent.pointerDown(region, { pointerId: 2, clientX: 500, clientY: 300, ...touch });
      fireEvent.pointerMove(region, { pointerId: 2, clientX: 600, clientY: 300, ...touch });
      runFrames();
      const zoomed = last(onViewChange);
      fireEvent.pointerUp(region, { pointerId: 2, ...touch });
      fireEvent.pointerMove(region, { pointerId: 1, clientX: 410, clientY: 300, ...touch });
      runFrames();
      expect(last(onViewChange)).toEqual({ ...zoomed, x: zoomed.x + 10 });
    });
  });

  describe('glide', () => {
    const drag = (region: HTMLElement): void => {
      const spy = vi.spyOn(performance, 'now');
      spy.mockReturnValue(0);
      fireEvent.pointerDown(region, { pointerId: 1, clientX: 0, clientY: 0, button: 0 });
      spy.mockReturnValue(16);
      fireEvent.pointerMove(region, { pointerId: 1, clientX: 80, clientY: 0 });
      fireEvent.pointerUp(region, { pointerId: 1 });
      spy.mockRestore();
    };

    it('glides to a stop after a fast drag', () => {
      const { region, onViewChange } = setup();
      drag(region);
      expect(frames.size).toBe(1);
      runFrames();
      expect(last(onViewChange).x).toBeCloseTo(80 + 73.6, 1);
      expect(frames.size).toBe(1);
    });

    it('does not glide under reduced motion', () => {
      document.documentElement.dataset.motion = 'reduced';
      const { region } = setup();
      drag(region);
      expect(frames.size).toBe(0);
    });

    it('is cancelled by a press, a wheel, a key and a view that someone else set', () => {
      const { region, rerender } = setup();
      drag(region);
      fireEvent.pointerDown(region, { pointerId: 2, clientX: 5, clientY: 5, button: 0 });
      expect(frames.size).toBe(0);
      fireEvent.pointerUp(region, { pointerId: 2 });
      drag(region);
      fireEvent.wheel(region, { deltaY: 1 });
      runFrames();
      frames.clear();
      drag(region);
      fireEvent.keyDown(region, { key: 'ArrowLeft' });
      expect(frames.size).toBe(0);
      drag(region);
      expect(frames.size).toBe(1);
      rerender({ x: 500, y: 500, scale: 1 });
      expect(frames.size).toBe(0);
    });
  });

  it('cancels a frame that is still waiting when it unmounts', () => {
    const { region, onViewChange, unmount } = setup();
    fireEvent.wheel(region, { deltaY: 10 });
    expect(frames.size).toBe(1);
    unmount();
    expect(frames.size).toBe(0);
    expect(cancelFrame).toHaveBeenCalled();
    expect(onViewChange).not.toHaveBeenCalled();
  });

  describe('keys', () => {
    it('answers the keys of the canvas when the empty canvas has focus, at once', () => {
      const { region, onViewChange } = setup();
      region.focus();
      fireEvent.keyDown(region, { key: 'ArrowRight' });
      expect(onViewChange).toHaveBeenLastCalledWith({ x: -40, y: 0, scale: 1 });
      fireEvent.keyDown(region, { key: 'ArrowRight', shiftKey: true });
      expect(onViewChange).toHaveBeenLastCalledWith({ x: -200, y: 0, scale: 1 });
      fireEvent.keyDown(region, { key: '+' });
      expect(last(onViewChange).scale).toBe(1.25);
      fireEvent.keyDown(region, { key: '-' });
      expect(last(onViewChange).scale).toBe(1);
    });

    it('1 returns to 100 percent from another zoom, and zoom stops at the limits', () => {
      const { region, onViewChange } = setup({ x: 0, y: 0, scale: 0.5 });
      fireEvent.keyDown(region, { key: '1' });
      expect(last(onViewChange).scale).toBe(1);
      for (let press = 0; press < 12; press += 1) fireEvent.keyDown(region, { key: '+' });
      expect(last(onViewChange).scale).toBe(2);
      for (let press = 0; press < 12; press += 1) fireEvent.keyDown(region, { key: '-' });
      expect(last(onViewChange).scale).toBe(0.25);
    });

    it('hands the keys it does not own to the canvas', () => {
      const keys: string[] = [];
      const { region } = setup(undefined, (key) => keys.push(key));
      fireEvent.keyDown(region, { key: '0' });
      fireEvent.keyDown(region, { key: 'Home' });
      fireEvent.keyDown(region, { key: 'Escape' });
      expect(keys).toEqual(['0', 'Home', 'Escape']);
    });

    it('ignores keys from a card or a field inside it, and keys with a modifier', () => {
      const { region, onViewChange } = setup();
      fireEvent.keyDown(screen.getByRole('button', { name: 'card' }), { key: 'ArrowRight' });
      fireEvent.keyDown(screen.getByRole('textbox', { name: 'field' }), { key: '+' });
      fireEvent.keyDown(screen.getByRole('textbox', { name: 'field' }), { key: '1' });
      fireEvent.keyDown(region, { key: 'ArrowRight', ctrlKey: true });
      expect(onViewChange).not.toHaveBeenCalled();
    });
  });
});
