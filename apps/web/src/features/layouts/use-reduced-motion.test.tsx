import { act, cleanup, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useReducedMotion } from './use-reduced-motion';

function stubOsPreference(reduce: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query === '(prefers-reduced-motion: reduce)',
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

function Probe(): ReactElement {
  return <p data-testid="reduced">{String(useReducedMotion())}</p>;
}
const answer = (view: ReturnType<typeof render>): string => view.getByTestId('reduced').textContent ?? '';

afterEach(() => {
  // Unmount first: the Probe reads the media query again when the attribute below goes
  cleanup();
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.motion;
});

describe('useReducedMotion', () => {
  it('is false when neither the system nor the app asks for less motion', () => {
    stubOsPreference(false);
    expect(answer(render(<Probe />))).toBe('false');
  });

  it('is true when the system asks for less motion', () => {
    stubOsPreference(true);
    expect(answer(render(<Probe />))).toBe('true');
  });

  it('is true when the in-app setting asks for less motion (data-motion on the page), and follows it', async () => {
    stubOsPreference(false);
    document.documentElement.dataset.motion = 'reduced';
    const view = render(<Probe />);
    expect(answer(view)).toBe('true');
    await act(async () => {
      delete document.documentElement.dataset.motion;
      await Promise.resolve();
    });
    expect(answer(view)).toBe('false');
    await act(async () => {
      document.documentElement.dataset.motion = 'reduced';
      await Promise.resolve();
    });
    expect(answer(view)).toBe('true');
  });
});
