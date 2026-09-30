import { screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from 'next-themes';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ThemeControl } from './theme-control';
import { renderWithProviders } from '@/test/render';

/** jsdom has no matchMedia, which next-themes asks for the system theme. The system here is light. */
function lightSystem(): MediaQueryList {
  return {
    matches: false,
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  };
}

function renderControl(): ReturnType<typeof renderWithProviders> {
  return renderWithProviders(
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      storageKey="test.theme"
      themes={['light', 'dark']}
    >
      <ThemeControl />
    </ThemeProvider>,
  );
}

describe('ThemeControl', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', vi.fn(lightSystem));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    document.documentElement.className = '';
  });

  it('starts on the stored choice, System when there is none', async () => {
    renderControl();
    expect(await screen.findByRole('radio', { name: 'System' })).toBeChecked();
    expect(document.documentElement).toHaveClass('light');
  });

  it('switches the whole page to the chosen theme and remembers it', async () => {
    const { user } = renderControl();
    await user.click(await screen.findByRole('radio', { name: 'Dark' }));
    await waitFor(() => expect(document.documentElement).toHaveClass('dark'));
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeChecked();
    expect(localStorage.getItem('test.theme')).toBe('dark');

    await user.click(screen.getByRole('radio', { name: 'Light' }));
    await waitFor(() => expect(document.documentElement).not.toHaveClass('dark'));
    expect(document.documentElement).toHaveClass('light');
  });
});
