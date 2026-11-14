import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearJustAdded, JUST_ADDED_MS, markJustAdded, useJustAdded } from './just-added-store';

function Ids(): React.ReactElement {
  const ids = useJustAdded();
  return <p>{`ids: ${[...ids].join(',')}`}</p>;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  clearJustAdded();
  vi.useRealTimers();
});

describe('the just-added store', () => {
  it('holds the created ids for 4 seconds and then lets them go', () => {
    expect(JUST_ADDED_MS).toBe(4000);
    render(<Ids />);
    expect(screen.getByText('ids:')).toBeInTheDocument();
    act(() => markJustAdded(['a', 'b']));
    expect(screen.getByText('ids: a,b')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(3999));
    expect(screen.getByText('ids: a,b')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByText('ids:')).toBeInTheDocument();
  });

  it('starts the 4 seconds again with a later add, and the older ids give way to the newer', () => {
    render(<Ids />);
    act(() => markJustAdded(['a']));
    act(() => vi.advanceTimersByTime(3000));
    act(() => markJustAdded(['b']));
    act(() => vi.advanceTimersByTime(3000));
    expect(screen.getByText('ids: b')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText('ids:')).toBeInTheDocument();
  });

  it('keeps nothing for an add that created nothing, and clears on request', () => {
    render(<Ids />);
    act(() => markJustAdded([]));
    expect(screen.getByText('ids:')).toBeInTheDocument();
    act(() => markJustAdded(['a']));
    act(() => clearJustAdded());
    expect(screen.getByText('ids:')).toBeInTheDocument();
  });
});
