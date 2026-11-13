import { readFileSync } from 'node:fs';
import path from 'node:path';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MEDIUM_MEDIA, useBreakpoint } from './use-breakpoint';
import { MEDIA } from '@/lib/dom/use-media-query';

let setWidth: (rem: number) => void;

beforeEach(() => {
  let width = 90;
  const listeners = new Set<() => void>();
  const wanted: Record<string, number> = { [MEDIUM_MEDIA]: 48, [MEDIA.xl]: 80 };
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches(): boolean {
      return width >= (wanted[query] ?? Infinity);
    },
    media: query,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  }));
  setWidth = (rem) => {
    width = rem;
    act(() => {
      listeners.forEach((listener) => {
        listener();
      });
    });
  };
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useBreakpoint', () => {
  it('names the two media queries the span classes use: md and xl, as the theme sets them', () => {
    const theme = readFileSync(path.join(import.meta.dirname, '../../styles/globals.css'), 'utf8');
    const breakpoint = (name: string): string | undefined =>
      new RegExp(`--breakpoint-${name}:\\s*([0-9.]+rem)`).exec(theme)?.[1];
    expect(MEDIUM_MEDIA).toBe(`(width >= ${breakpoint('md') ?? 'missing'})`);
    expect(MEDIA.xl).toBe(`(width >= ${breakpoint('xl') ?? 'missing'})`);
  });

  it('is wide from 80rem, medium from 48rem and narrow below', () => {
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe('wide');
    setWidth(80);
    expect(result.current).toBe('wide');
    setWidth(79);
    expect(result.current).toBe('medium');
    setWidth(48);
    expect(result.current).toBe('medium');
    setWidth(47);
    expect(result.current).toBe('narrow');
  });
});
