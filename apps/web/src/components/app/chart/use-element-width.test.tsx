import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useElementWidth } from './use-element-width';

let report: ((width: number) => void) | null = null;

class FakeObserver {
  constructor(callback: ResizeObserverCallback) {
    report = (width) => {
      callback([{ contentRect: { width } } as ResizeObserverEntry], this as unknown as ResizeObserver);
    };
  }
  observe(): void {}
  disconnect(): void {}
  unobserve(): void {}
}

function Probe() {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  return (
    <div ref={ref} data-testid="probe">
      {width}
    </div>
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  report = null;
});

describe('useElementWidth', () => {
  it('is 0 until the element has been measured, and then its width rounded to a 16 px step', () => {
    vi.stubGlobal('ResizeObserver', FakeObserver);
    render(<Probe />);
    expect(screen.getByTestId('probe')).toHaveTextContent('0');
    act(() => report?.(381));
    expect(screen.getByTestId('probe')).toHaveTextContent('384');
    act(() => report?.(390));
    expect(screen.getByTestId('probe')).toHaveTextContent('384');
  });

  it('stays 0 where there is no ResizeObserver', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    render(<Probe />);
    expect(screen.getByTestId('probe')).toHaveTextContent('0');
  });
});
