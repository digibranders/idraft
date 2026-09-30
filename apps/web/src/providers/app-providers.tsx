'use client';

import { Toast } from '@base-ui/react/toast';
import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import type { ReactNode } from 'react';

import { LiveRegions } from './live-regions';
import { TooltipProvider } from '@/components/ui/tooltip';
import { getQueryClient } from '@/lib/api/query-client';

const THEME_STORAGE_KEY = 'sightline.theme';
const THEMES = ['light', 'dark'];
/** Follow the operating system until the person chooses (01-foundations.md section 3). */
const DEFAULT_THEME = 'system';

/**
 * Everything a client component may rely on, in one place: the theme class on <html>, the query cache,
 * URL state, toasts, the shared tooltip delay and the live regions. The message catalog is provided by the root layout, which is a
 * Server Component and hands the messages down.
 */
export function AppProviders({ children }: Readonly<{ children: ReactNode }>): ReactNode {
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
          <Toast.Provider>
            <TooltipProvider>{children}</TooltipProvider>
            <LiveRegions />
          </Toast.Provider>
        </NuqsAdapter>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
