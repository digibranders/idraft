import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
import type { Metadata, Viewport } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';

import { AppProviders } from '@/providers/app-providers';
import '@/styles/app.css';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('app');
  return {
    title: { default: t('name'), template: `%s · ${t('name')}` },
    // Every page sits behind sign-in and shows tenant data, so nothing here belongs in a search index.
    robots: { index: false, follow: false },
  };
}

export const viewport: Viewport = { colorScheme: 'light dark' };

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>): Promise<ReactNode> {
  const locale = await getLocale();
  // The nonce the proxy made for this response. Reading a request header makes every page dynamic, which
  // a nonce needs: a page rendered at build time could not carry one.
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    // The font classes define --font-geist-sans and --font-geist-mono, which tokens.css reads.
    // suppressHydrationWarning: the theme class is set on <html> before hydration.
    <html lang={locale} className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <body>
        <NextIntlClientProvider>
          <AppProviders nonce={nonce}>{children}</AppProviders>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
