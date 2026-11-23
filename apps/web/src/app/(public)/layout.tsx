import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('app');
  return {
    title: t('name'),
    robots: { index: false, follow: false },
    // The secret of a shared link is in its address: no page it links to may be told the address
    referrer: 'no-referrer',
  };
}

/**
 * The shell of the pages a shared link opens: no sidebar, no top bar and no way into the app. It needs no session,
 * so it asks for none (the proxy lets `/public` through).
 */
export default function PublicLayout({ children }: Readonly<{ children: ReactNode }>): ReactNode {
  return <main className="flex min-h-dvh flex-col bg-background">{children}</main>;
}
