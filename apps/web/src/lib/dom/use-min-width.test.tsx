import { act, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useMinWidth } from './use-min-width';

/** Reports `widths` in turn, one for each `resize()`, to the one element observed. */
function stubObserver(): { resize: (width: number) => void } {
  let notify: ResizeObserverCallback | null = null;
  let target: Element | null = null;
  class Observer {
    constructor(callback: ResizeObserverCallback) {
      notify = callback;
    }
    observe(element: Element): void {
      target = element;
    }
    unobserve(): void {}
    disconnect(): void {}
  }
  vi.stubGlobal('ResizeObserver', Observer);
  return {
    resize: (width) => {
      if (notify === null || target === null) throw new Error('Nothing is observed');
      notify([{ target, contentRect: { width } } as unknown as ResizeObserverEntry], {} as ResizeObserver);
    },
  };
}

function Probe({ min }: { min: number }): ReactElement {
  const [ref, wide] = useMinWidth<HTMLDivElement>(min);
  return <div ref={ref}>{wide ? 'wide' : 'narrow'}</div>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useMinWidth', () => {
  it('is false until the element is measured, then follows its width across the minimum', () => {
    const observer = stubObserver();
    render(<Probe min={1280} />);
    expect(screen.getByText('narrow')).toBeInTheDocument();
    act(() => observer.resize(1280));
    expect(screen.getByText('wide')).toBeInTheDocument();
    act(() => observer.resize(1279));
    expect(screen.getByText('narrow')).toBeInTheDocument();
  });

  it('stays false where there is no ResizeObserver', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    render(<Probe min={1280} />);
    expect(screen.getByText('narrow')).toBeInTheDocument();
  });
});
