import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useFocusReturn } from './use-focus-return';

afterEach(() => {
  document.body.replaceChildren();
});

const button = (): HTMLButtonElement => {
  const element = document.createElement('button');
  document.body.append(element);
  return element;
};

describe('focus returning to the row that opened a drawer', () => {
  it('focuses the row when the drawer closes', () => {
    const row = button();
    const { result, rerender } = renderHook(({ open }) => useFocusReturn(open), { initialProps: { open: false } });
    act(() => result.current(row));
    rerender({ open: true });
    expect(document.activeElement).not.toBe(row);
    rerender({ open: false });
    expect(document.activeElement).toBe(row);
  });

  it('leaves focus alone for a drawer that came with the address, which no row opened', () => {
    const other = button();
    other.focus();
    const { rerender } = renderHook(({ open }) => useFocusReturn(open), { initialProps: { open: true } });
    rerender({ open: false });
    expect(document.activeElement).toBe(other);
  });

  it('leaves focus alone when the row is gone', () => {
    const row = button();
    const other = button();
    const { result, rerender } = renderHook(({ open }) => useFocusReturn(open), { initialProps: { open: false } });
    act(() => result.current(row));
    rerender({ open: true });
    row.remove();
    other.focus();
    rerender({ open: false });
    expect(document.activeElement).toBe(other);
  });

  it('returns focus once: the next close has no row until another opens', () => {
    const row = button();
    const other = button();
    const { result, rerender } = renderHook(({ open }) => useFocusReturn(open), { initialProps: { open: false } });
    act(() => result.current(row));
    rerender({ open: true });
    rerender({ open: false });
    other.focus();
    rerender({ open: true });
    rerender({ open: false });
    expect(document.activeElement).toBe(other);
  });
});
