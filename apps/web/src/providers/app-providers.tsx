'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { useTranslations } from 'next-intl';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import type { ReactNode } from 'react';

import { LiveRegions } from './live-regions';
import { Toaster, ToastProvider } from '@/components/ui/toast';
import { TooltipProvider } from '@/components/ui/tooltip';
import { MockGate } from './mock-gate';
import { getQueryClient } from '@/lib/api/query-client';
import { publicEnv } from '@/lib/env/public';

const THEME_STORAGE_KEY = 'sightline.theme';
const THEMES = ['light', 'dark'];
/** Follow the operating system until the person chooses (01-foundations.md section 3). */
const DEFAULT_THEME = 'system';

/**
 * Everything a client component may rely on, in one place: the theme class on <html>, the query cache,
 * URL state, toasts, the shared tooltip delay and the live regions. The message catalog is provided by the root layout, which is a
 * Server Component and hands the messages down. With API mocking on, the page waits for the mock worker.
 */
export function AppProviders({ children }: Readonly<{ children: ReactNode }>): ReactNode {
  const t = useTranslations('common');
  return (
    // The theme changes at once: a color transition on every element would read as a flicker (21-motion.md).
    // The storage key is the app's own: the default, "theme", is shared with whatever else ran on this origin.
    <ThemeProvider
      attribute="class"
      defaultTheme={DEFAULT_THEME}
      enableSystem
      disableTransitionOnChange
      storageKey={THEME_STORAGE_KEY}
      themes={THEMES}
    >
      <QueryClientProvider client={getQueryClient()}>
        <NuqsAdapter>
          <ToastProvider>
            <TooltipProvider>
              {publicEnv.NEXT_PUBLIC_API_MOCKING === 'off' ? (
                children
              ) : (
                <MockGate mode={publicEnv.NEXT_PUBLIC_API_MOCKING}>{children}</MockGate>
              )}
              <Toaster label={t('notifications')} closeLabel={t('close')} />
            </TooltipProvider>
            <LiveRegions />
          </ToastProvider>
        </NuqsAdapter>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
