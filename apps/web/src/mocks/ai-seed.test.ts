import { afterEach, describe, expect, it, vi } from 'vitest';

import { isAiSeeded, setAiSeeded } from './ai-seed';
import { resetMockState } from './state';

/** A fresh copy of the switch, as a process started with these two variables would have it. */
async function startedWith(appEnv: string, mocking: string): Promise<boolean> {
  vi.stubEnv('NEXT_PUBLIC_APP_ENV', appEnv);
  vi.stubEnv('NEXT_PUBLIC_API_MOCKING', mocking);
  vi.resetModules();
  return (await import('./ai-seed')).isAiSeeded();
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('the Eventus Security data switch', () => {
  it('is off in a test, so the older fixtures and their tests see what they always saw', () => {
    expect(isAiSeeded()).toBe(false);
  });

  it('turns on for a test that wants the data, and a reset turns it off again', () => {
    setAiSeeded(true);
    expect(isAiSeeded()).toBe(true);
    resetMockState();
    expect(isAiSeeded()).toBe(false);
  });

  it('starts on for the development server: the app in development with every API mocked', async () => {
    expect(await startedWith('development', 'all')).toBe(true);
  });

  it('starts off anywhere else: an end to end run, a build against the API, or only the missing routes mocked', async () => {
    expect(await startedWith('test', 'all')).toBe(false);
    expect(await startedWith('development', 'off')).toBe(false);
    expect(await startedWith('development', 'pending')).toBe(false);
    expect(await startedWith('production', 'off')).toBe(false);
  });
});
