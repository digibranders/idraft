'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

export interface SectionNavItem {
  readonly slug: string;
  readonly title: string;
}

/** The section list of the preview. The section on screen carries `aria-current="page"`. */
export function SectionNav({ sections }: { sections: readonly SectionNavItem[] }): ReactNode {
  const pathname = usePathname();
  return (
    <ul className="flex flex-wrap gap-1 lg:flex-col">
      {sections.map((section) => {
        const href = `/design-system/${section.slug}` as const;
        return (
          <li key={section.slug}>
            <Link
              href={href}
              aria-current={pathname === href ? 'page' : undefined}
              className="flex h-sidebar-item items-center rounded-md px-2 type-body text-foreground-secondary hover:bg-surface-hover hover:text-foreground focus-visible:focus-ring-inset aria-[current=page]:bg-surface-selected aria-[current=page]:type-body-strong aria-[current=page]:text-primary-text"
            >
              {section.title}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
