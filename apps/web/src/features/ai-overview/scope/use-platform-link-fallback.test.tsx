import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { usePlatformLinkFallback } from './use-platform-link-fallback';

const ON = ['chatgpt_web', 'gemini_web', 'google_ai_mode'];

function run(
  linked: readonly string[] | null,
  enabled: readonly string[],
): { setScope: ReturnType<typeof vi.fn>; said: boolean } {
  const setScope = vi.fn();
  const { result } = renderHook(() => usePlatformLinkFallback({ linked, enabled, setScope }));
  return { setScope, said: result.current };
}

describe('usePlatformLinkFallback', () => {
  it('writes All platforms back for a link that names several, and says so', () => {
    const { setScope, said } = run(['chatgpt_web', 'gemini_web'], ON);
    expect(setScope).toHaveBeenCalledWith({ engines: null });
    expect(said).toBe(true);
  });

  it('tidies a link that names every platform that is on without a word', () => {
    const { setScope, said } = run(['gemini_web', 'chatgpt_web', 'google_ai_mode'], ON);
    expect(setScope).toHaveBeenCalledWith({ engines: null });
    expect(said).toBe(false);
  });

  it('leaves a link with one platform, none, or a platform that is off alone', () => {
    for (const linked of [null, ['gemini_web'], ['chatgpt_web', 'google_ai_overview']]) {
      expect(run(linked, ON).setScope).not.toHaveBeenCalled();
    }
    expect(run(['chatgpt_web', 'gemini_web'], []).setScope).not.toHaveBeenCalled();
  });
});
