import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { PREVIEW_SECTIONS } from '@/components/design-system/registry';
import { SectionNav } from '@/components/design-system/section-nav';
import { ThemeControl } from '@/components/design-system/theme-control';
import { publicEnv } from '@/lib/env/public';

// In production the route is a 404, and its title must not say that it exists
export const metadata: Metadata =
  publicEnv.NEXT_PUBLIC_APP_ENV === 'production'
    ? {}
    : { title: { default: 'Design system', template: '%s: design system' } };

/**
 * The component preview (26 section 10). It renders with the real build, fonts, tokens and providers, so
 * what it shows is what ships. It does not exist in production.
 */
export default function DesignSystemLayout({ children }: Readonly<{ children: ReactNode }>): ReactNode {
  if (publicEnv.NEXT_PUBLIC_APP_ENV === 'production') notFound();
  // Only the slug and the title cross to the client: `render` is a function and stays on the server
  const sections = PREVIEW_SECTIONS.map(({ slug, title }) => ({ slug, title }));
  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <header className="flex shrink-0 flex-col gap-3 border-b border-border-subtle bg-sidebar p-3 lg:sticky lg:top-0 lg:h-dvh lg:w-sidebar lg:overflow-y-auto lg:border-r lg:border-b-0">
        <p className="px-2 type-label">Design system</p>
        <nav aria-label="Design system sections">
          <SectionNav sections={sections} />
        </nav>
        {/* Below the list, not pinned to the bottom edge, where the development indicator of Next.js sits */}
        {/* Holds the control's height before hydration, when the control is not rendered yet */}
        <div className="min-h-control-sm px-2">
          <ThemeControl />
        </div>
      </header>
      <main className="flex min-w-0 flex-1 flex-col gap-4 p-5">{children}</main>
    </div>
  );
}
