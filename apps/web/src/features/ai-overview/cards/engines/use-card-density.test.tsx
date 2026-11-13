import { screen, waitFor } from '@testing-library/react';
import { Suspense, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useCardDensity } from './use-card-density';
import { clearPreferences, preferenceKey } from '@/lib/preferences/storage';
import { mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { renderWithProviders } from '@/test/render';

const EDITOR = mockUser('editor');

function Probe(): ReactElement {
  return <p>{useCardDensity()}</p>;
}

function renderProbe(): void {
  renderWithProviders(
    <Suspense fallback={null}>
      <Probe />
    </Suspense>,
  );
}

describe('useCardDensity', () => {
  beforeEach(() => {
    document.cookie = `${SESSION_COOKIE}=mock.active.${EDITOR.user_id}.0; Path=/; Secure`;
  });
  afterEach(() => {
    clearPreferences();
  });

  it('is compact for a person who has not chosen, as the Preferences page says', async () => {
    renderProbe();
    expect(await screen.findByText('compact')).toBeInTheDocument();
  });

  it('is default once the person chose the 40 px rows, and reads their own record only', async () => {
    localStorage.setItem(preferenceKey(EDITOR.user_id, 'settings'), JSON.stringify({ tableDensity: 'default' }));
    localStorage.setItem(preferenceKey(mockUser('admin').user_id, 'settings'), JSON.stringify({}));
    renderProbe();
    await waitFor(() => {
      expect(screen.getByText('default')).toBeInTheDocument();
    });
  });
});
