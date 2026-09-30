import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { PREVIEW_SECTIONS } from '@/components/design-system/registry';
import { publicEnv } from '@/lib/env/public';

export const metadata: Metadata = { title: 'Design system' };

/**
 * The component preview (26 section 10). It renders with the real build, fonts, tokens and providers, so
 * what it shows is what ships. It does not exist in production.
 */
export default function DesignSystemLayout({ children }: Readonly<{ children: ReactNode }>): ReactNode {
  if (publicEnv.NEXT_PUBLIC_APP_ENV === 'production') notFound();
  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <nav
        aria-label="Sections"
        className="shrink-0 border-b border-border-subtle bg-sidebar p-3 lg:w-sidebar lg:border-r lg:border-b-0"
      >
        <p className="px-2 pb-2 type-label">Design system</p>
        <ul className="flex flex-wrap gap-1 lg:flex-col">
          {PREVIEW_SECTIONS.map((section) => (
            <li key={section.slug}>
              <Link
                href={`/design-system/${section.slug}`}
                className="flex h-sidebar-item items-center rounded-md px-2 type-body text-foreground-secondary hover:bg-surface-hover hover:text-foreground focus-visible:focus-ring-inset"
              >
                {section.title}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <main className="flex min-w-0 flex-1 flex-col gap-4 p-5">{children}</main>
    </div>
  );
}
