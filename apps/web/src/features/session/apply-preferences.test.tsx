import { screen, waitFor } from '@testing-library/react';
import { Suspense, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApplyPreferences } from './apply-preferences';
import { useShortcut } from '@/lib/a11y/use-shortcut';
import { clearPreferences, preferenceKey } from '@/lib/preferences/storage';
import { mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { renderWithProviders } from '@/test/render';

const EDITOR = mockUser('editor');
const store = (preferences: Record<string, unknown>): void =>
  localStorage.setItem(preferenceKey(EDITOR.user_id, 'settings'), JSON.stringify(preferences));

function Page({ onKey }: { onKey: () => void }): ReactNode {
  useShortcut('?', onKey, { kind: 'single-key' });
  return <p>Page</p>;
}

describe('ApplyPreferences', () => {
  beforeEach(() => {
    document.cookie = `${SESSION_COOKIE}=mock.active.${EDITOR.user_id}.0; Path=/; Secure`;
  });
  afterEach(() => {
    clearPreferences();
    delete document.documentElement.dataset.motion;
  });

  it('turns motion off on the page when the person asked for it', async () => {
    store({ reduceMotion: true });
    renderWithProviders(
      <Suspense fallback={null}>
        <ApplyPreferences>
          <p>Page</p>
        </ApplyPreferences>
      </Suspense>,
    );
    await screen.findByText('Page');
    await waitFor(() => expect(document.documentElement.dataset.motion).toBe('reduced'));
  });

  it.each([
    [true, 1],
    [false, 0],
  ])('with single-key shortcuts %s, the key acts %i times', async (singleKeys, calls) => {
    store({ singleKeys });
    const onKey = vi.fn();
    const { user } = renderWithProviders(
      <Suspense fallback={null}>
        <ApplyPreferences>
          <Page onKey={onKey} />
        </ApplyPreferences>
      </Suspense>,
    );
    await screen.findByText('Page');
    await user.keyboard('?');
    expect(onKey).toHaveBeenCalledTimes(calls);
  });
});
