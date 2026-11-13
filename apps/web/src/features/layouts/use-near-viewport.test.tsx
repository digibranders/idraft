import { act, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NEAR_MARGIN, useNearViewport } from './use-near-viewport';

/** An IntersectionObserver the test drives by hand. */
class StubObserver {
  static all: StubObserver[] = [];
  observed: Element[] = [];
  disconnected = false;
  constructor(
    private readonly callback: IntersectionObserverCallback,
    readonly options: IntersectionObserverInit | undefined,
  ) {
    StubObserver.all.push(this);
  }
  observe(node: Element): void {
    this.observed.push(node);
  }
  disconnect(): void {
    this.disconnected = true;
  }
  report(isIntersecting: boolean): void {
    act(() => {
      this.callback([{ isIntersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    });
  }
}

function Probe(): ReactElement {
  const { ref, near } = useNearViewport();
  return (
    <div ref={ref} data-testid="probe">
      {near ? 'near' : 'far'}
    </div>
  );
}

beforeEach(() => {
  StubObserver.all = [];
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useNearViewport', () => {
  it('is far until the element is within one viewport, and then stays near', () => {
    vi.stubGlobal('IntersectionObserver', StubObserver);
    render(<Probe />);
    const [observer] = StubObserver.all;
    if (observer === undefined) throw new Error('nothing observed');
    expect(observer.options?.rootMargin).toBe(NEAR_MARGIN);
    expect(NEAR_MARGIN).toBe('100% 0px');
    expect(observer.observed).toEqual([screen.getByTestId('probe')]);
    expect(screen.getByTestId('probe')).toHaveTextContent('far');

    observer.report(false);
    expect(screen.getByTestId('probe')).toHaveTextContent('far');
    expect(observer.disconnected).toBe(false);

    observer.report(true);
    expect(screen.getByTestId('probe')).toHaveTextContent('near');
    expect(observer.disconnected).toBe(true);
  });

  it('stops observing when the element goes', () => {
    vi.stubGlobal('IntersectionObserver', StubObserver);
    const { unmount } = render(<Probe />);
    unmount();
    expect(StubObserver.all.every((observer) => observer.disconnected)).toBe(true);
  });

  it('counts the element as near where there is no IntersectionObserver', () => {
    // jsdom has none; this keeps the case true if a later jsdom adds one
    Reflect.deleteProperty(window, 'IntersectionObserver');
    render(<Probe />);
    expect(screen.getByTestId('probe')).toHaveTextContent('near');
  });
});
