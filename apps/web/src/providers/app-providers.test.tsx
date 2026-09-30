import { render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import messages from '../../messages/en.json';
import { AppProviders } from './app-providers';

// The Next.js adapter needs the App Router, which a component test does not mount
vi.mock('nuqs/adapters/next/app', () => ({
  NuqsAdapter: ({ children }: { children: ReactNode }): ReactNode => children,
}));
vi.mock('@/lib/env/public', () => ({ publicEnv: { NEXT_PUBLIC_API_MOCKING: 'off' } }));

interface NonceProps {
  nonce?: string;
  children: ReactNode;
}
// The two providers that take the nonce show what they were given. next-themes puts it on its script only
// when rendering on the server, so the real script would not tell.
vi.mock('next-themes', () => ({
  ThemeProvider: ({ nonce, children }: NonceProps): ReactNode => (
    <div data-testid="theme" data-nonce={nonce}>
      {children}
    </div>
  ),
}));
vi.mock('@base-ui/react/csp-provider', () => ({
  CSPProvider: ({ nonce, children }: NonceProps): ReactNode => (
    <div data-testid="csp" data-nonce={nonce}>
      {children}
    </div>
  ),
}));

const app = (nonce: string | undefined): ReactElement => (
  <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
    <AppProviders nonce={nonce}>{null}</AppProviders>
  </NextIntlClientProvider>
);

const noncesOf = (container: HTMLElement): (string | undefined)[] =>
  ['csp', 'theme'].map(
    (id) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`)?.dataset.nonce ?? undefined,
  );

describe('AppProviders', () => {
  it('hands the nonce of the response to Base UI and to next-themes', () => {
    const { container } = render(app('first-nonce'));
    expect(noncesOf(container)).toEqual(['first-nonce', 'first-nonce']);
  });

  it('keeps the first nonce when a refresh renders the layout with a new one', () => {
    const { container, rerender } = render(app('first-nonce'));
    rerender(app('second-nonce'));
    expect(noncesOf(container)).toEqual(['first-nonce', 'first-nonce']);
  });

  it('passes no nonce when the response has none', () => {
    const { container } = render(app(undefined));
    expect(noncesOf(container)).toEqual([undefined, undefined]);
  });
});
