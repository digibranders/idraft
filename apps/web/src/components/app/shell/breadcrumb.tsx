import { ChevronRight, House } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import type { ReactElement, ReactNode } from 'react';

import { Icon } from '@/components/ui/icon';

export interface BreadcrumbProps {
  /** "Breadcrumb": the landmark's name. */
  label: string;
  /** The leading House icon links to the project root. */
  projectRoot: { href: Route; label: string };
  /** From 1680 px: the workspace, a link to its root. */
  workspace: { href: Route; label: string };
  /** The project switcher, in its top bar presentation. */
  project: ReactNode;
  /** The current page, when it is not the project root. */
  page: string | null;
}

const Separator = ({ className }: { className?: string }): ReactElement => (
  <Icon icon={ChevronRight} size="sm" className={`shrink-0 text-foreground-muted ${className ?? ''}`} />
);

/**
 * Where the page is (11-navigation.md section 4, 25 section 5.5): the project root, the workspace (from
 * 1680 px), the project (a switcher) and the current page. Below 1024 px only the project switcher stays.
 */
export function Breadcrumb({ label, projectRoot, workspace, project, page }: BreadcrumbProps): ReactElement {
  return (
    <nav aria-label={label} className="min-w-0">
      <ol className="flex min-w-0 items-center gap-2 type-body">
        <li className="hidden items-center lg:flex">
          <Link
            href={projectRoot.href}
            aria-label={projectRoot.label}
            className="flex items-center rounded-sm text-foreground-tertiary hover:text-foreground focus-visible:focus-ring"
          >
            <Icon icon={House} />
          </Link>
        </li>
        <li className="hidden items-center gap-2 3xl:flex">
          <Separator />
          <Link
            href={workspace.href}
            className="truncate rounded-sm text-foreground-tertiary hover:text-foreground focus-visible:focus-ring"
          >
            {workspace.label}
          </Link>
        </li>
        <li className="flex min-w-0 items-center gap-2">
          <Separator className="hidden lg:block" />
          {project}
        </li>
        {page === null ? null : (
          <li className="hidden shrink-0 items-center gap-2 lg:flex">
            <Separator />
            <span aria-current="page" className="type-body-strong whitespace-nowrap text-foreground">
              {page}
            </span>
          </li>
        )}
      </ol>
    </nav>
  );
}
