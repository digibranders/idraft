import { afterEach, describe, expect, it, vi } from 'vitest';

import { usePlatformLinkFallback } from './use-platform-link-fallback';
import { toast } from '@/components/ui/toast';
import { renderWithProviders } from '@/test/render';

import type { ReactElement } from 'react';

vi.mock('@/components/ui/toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/ui/toast')>()),
  toast: vi.fn(),
}));

const ON = ['chatgpt_web', 'gemini_web', 'google_ai_mode'];

afterEach(() => {
  vi.clearAllMocks();
});

function Probe(input: Parameters<typeof usePlatformLinkFallback>[0]): ReactElement | null {
  usePlatformLinkFallback(input);
  return null;
}

function run(linked: readonly string[] | null, enabled: readonly string[]): ReturnType<typeof vi.fn> {
  const setScope = vi.fn();
  renderWithProviders(<Probe linked={linked} enabled={enabled} setScope={setScope} />);
  return setScope;
}

describe('usePlatformLinkFallback', () => {
  it('writes All platforms back for a link that names several, and says so once', () => {
    const setScope = run(['chatgpt_web', 'gemini_web'], ON);
    expect(setScope).toHaveBeenCalledWith({ engines: null });
    expect(toast).toHaveBeenCalledOnce();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'The link named several platforms' }));
  });

  it('tidies a link that names every platform that is on without a word', () => {
    const setScope = run(['gemini_web', 'chatgpt_web', 'google_ai_mode'], ON);
    expect(setScope).toHaveBeenCalledWith({ engines: null });
    expect(toast).not.toHaveBeenCalled();
  });

  it('leaves a link with one platform, none, or a platform that is off alone', () => {
    for (const linked of [null, ['gemini_web'], ['chatgpt_web', 'google_ai_overview']]) {
      expect(run(linked, ON)).not.toHaveBeenCalled();
    }
    expect(run(['chatgpt_web', 'gemini_web'], [])).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });
});
