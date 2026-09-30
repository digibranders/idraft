import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import type { ReactElement, ReactNode } from 'react';

/** The providers a component needs to render as it does in the app. */
function TestProviders({ children }: { children: ReactNode }): ReactNode {
  return children;
}

export type ProvidedRender = RenderResult & { user: UserEvent };

/**
 * Renders inside the app's providers and returns a `user` for interactions, so tests drive components the
 * way a person does (pointer and keyboard events in order) instead of firing single events.
 */
export function renderWithProviders(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>): ProvidedRender {
  const user = userEvent.setup();
  return { user, ...render(ui, { wrapper: TestProviders, ...options }) };
}
