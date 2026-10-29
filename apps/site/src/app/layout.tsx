import type { Metadata, Viewport } from 'next';
import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';

import './globals.css';

const TITLE = 'idraft | Rank on Google. Get named by AI.';
const DESCRIPTION =
  'idraft tracks your Google rankings and what ChatGPT, Gemini and Google AI say about your brand, in one view.';

export const metadata: Metadata = {
  metadataBase: new URL('https://idraft.ai'),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: 'https://idraft.ai',
    siteName: 'idraft',
    images: [{ url: '/images/hero.png', width: 1264, height: 848 }],
    type: 'website',
  },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION, images: ['/images/hero.png'] },
};

export const viewport: Viewport = { themeColor: '#F7F8FA', colorScheme: 'light' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="grain">{children}</body>
    </html>
  );
}
