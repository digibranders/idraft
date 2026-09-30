'use client';

import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';

import { RouteError } from '@/features/shell/route-status';
import { FALLBACK_INTL } from '@/i18n/fallback';
import '@/styles/app.css';

/**
 * The root layout itself failed: this page replaces it, with its own `<html>` and catalog. It is shown in the
 * light theme: the theme script of the layout, which sets the dark class, did not run.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): ReactNode {
  return (
    <html lang={FALLBACK_INTL.locale} className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <head>
        <title>{FALLBACK_INTL.messages.status.error.title}</title>
      </head>
      <body className="bg-background text-foreground">
        <NextIntlClientProvider {...FALLBACK_INTL}>
          <main className="flex min-h-dvh flex-col items-center px-4 pt-6 pb-12 sm:pt-12">
            <RouteError error={error} reset={reset} />
          </main>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
