'use client';

import { ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { TopBarControls } from './top-bar-controls';
import { SkipLink } from '@/components/app/shell/skip-link';
import { TopBar } from '@/components/app/shell/top-bar';
import { Icon } from '@/components/ui/icon';
import { workspacePath, workspaceSettingsPath } from '@/lib/routes/paths';

const MAIN_ID = 'main-content';

export interface WorkspaceShellProps {
  workspace: { slug: string; name: string };
  /**
   * The page below the workspace root (Settings), as the breadcrumb's current item; the workspace is then a
   * link to its root. Omitted on the root itself, where the workspace is the current item.
   */
  page?: string | undefined;
  children: ReactNode;
}

/**
 * The pages of a workspace outside any project (the root, New project, the workspace's own settings): the
 * top bar without the sidebar, since no project is open. The account menu's Account settings opens the
 * workspace's Settings > Profile, which every member can reach whatever projects they can open.
 */
export function WorkspaceShell({ workspace, page, children }: Readonly<WorkspaceShellProps>): ReactNode {
  const t = useTranslations('shell');
  return (
    <>
      <SkipLink label={t('skipToMain')} targetId={MAIN_ID} />
      <div className="flex min-h-dvh flex-col">
        <TopBar
          navigation={null}
          breadcrumb={
            <nav aria-label={t('breadcrumb')} className="min-w-0">
              <ol className="flex min-w-0 items-center gap-2 type-body">
                <li className="min-w-0">
                  {page === undefined ? (
                    <span aria-current="page" className="block truncate type-body-strong text-foreground">
                      {workspace.name}
                    </span>
                  ) : (
                    <Link
                      href={workspacePath(workspace.slug)}
                      className="block truncate rounded-sm text-foreground-tertiary hover:text-foreground focus-visible:focus-ring"
                    >
                      {workspace.name}
                    </Link>
                  )}
                </li>
                {page === undefined ? null : (
                  <li className="flex shrink-0 items-center gap-2">
                    <Icon icon={ChevronRight} size="sm" className="shrink-0 text-foreground-muted" />
                    <span aria-current="page" className="type-body-strong whitespace-nowrap text-foreground">
                      {page}
                    </span>
                  </li>
                )}
              </ol>
            </nav>
          }
          controls={
            <TopBarControls
              accountSettings={<Link href={workspaceSettingsPath(workspace.slug, 'profile')} />}
              shortcuts={[]}
            />
          }
        />
        <main id={MAIN_ID} tabIndex={-1} className="flex min-w-0 flex-1 flex-col outline-none">
          {children}
        </main>
      </div>
    </>
  );
}
