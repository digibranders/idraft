import { QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { NuqsTestingAdapter, type OnUrlUpdateFunction } from 'nuqs/adapters/testing';
import type { ReactElement, ReactNode } from 'react';

import messages from '../../messages/en.json';
import { Toaster, ToastProvider } from '@/components/ui/toast';
import { TooltipProvider } from '@/components/ui/tooltip';
import { makeQueryClient } from '@/lib/api/query-client';
import { LiveRegions } from '@/providers/live-regions';

export type ProvidedRender = RenderResult & { user: UserEvent };
export interface ProvidedRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  /** The query string the component starts with, for components that keep state in the URL. */
  searchParams?: string;
  /** Called with each URL change the component makes, so a test can read the query string it wrote. */
  onUrlUpdate?: OnUrlUpdateFunction;
  /** Called when the API answers that the session is gone, after the cache is emptied; jsdom cannot navigate. */
  onSignedOut?: () => boolean;
}

/**
 * Renders with what a component gets in the app: the message catalog, a query cache of its own (so one
 * test never sees another's data, and an error arrives at once instead of after retries), URL state, toasts
 * and the live regions. Returns a `user` for interactions, so tests drive components the way a person
 * does (pointer and keyboard events in order) instead of firing single events.
 */
export function renderWithProviders(
  ui: ReactElement,
  { searchParams = '', onUrlUpdate, onSignedOut = () => false, ...options }: ProvidedRenderOptions = {},
): ProvidedRender {
  // jsdom cannot navigate, so a signed-out answer only empties the cache here
  const queryClient = makeQueryClient({ retry: false, onSignedOut });
  function TestProviders({ children }: { children: ReactNode }): ReactNode {
    return (
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <QueryClientProvider client={queryClient}>
          {/* With memory, a component reads back the URL it wrote, as it does in a browser */}
          <NuqsTestingAdapter
            searchParams={searchParams}
            hasMemory
            {...(onUrlUpdate === undefined ? {} : { onUrlUpdate })}
          >
            <ToastProvider>
              {/* No hover delay: a test waits for the tooltip, never for a timer */}
              <TooltipProvider delay={0}>
                {children}
                <Toaster label="Notifications" closeLabel="Close" />
              </TooltipProvider>
              <LiveRegions />
            </ToastProvider>
          </NuqsTestingAdapter>
        </QueryClientProvider>
      </NextIntlClientProvider>
    );
  }
  const user = userEvent.setup();
  return { user, ...render(ui, { wrapper: TestProviders, ...options }) };
}
