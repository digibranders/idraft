'use client';

import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';

import { TopBarControls } from './top-bar-controls';
import { SkipLink } from '@/components/app/shell/skip-link';
import { TopBar } from '@/components/app/shell/top-bar';

const MAIN_ID = 'main-content';

/**
 * The value of `promise` once it settles, `null` until then or when it fails: the shell renders at once and
 * does not wait for it.
 */
function useSettled<Value>(promise: Promise<Value | null>): Value | null {
  const [settled, setSettled] = useState<{ promise: Promise<Value | null>; value: Value | null } | null>(null);
  useEffect(() => {
    let current = true;
    promise.then(
      (value) => {
        if (current) setSettled({ promise, value });
      },
      () => {
        if (current) setSettled({ promise, value: null });
      },
    );
    return () => {
      current = false;
    };
  }, [promise]);
  // A new promise (another render of the page) starts from nothing again
  return settled?.promise === promise ? settled.value : null;
}

export interface WorkspaceShellProps {
  workspace: string;
  /**
   * Settings > Profile of the first listed project, or `null` when the member can open none. Account
   * settings live under a project until they have a route of their own, so the account menu has the item
   * once the list is known.
   */
  accountSettings: Promise<Route | null>;
  children: ReactNode;
}

/**
 * The workspace root around its page (Task 14): the top bar without the sidebar, since no project is
 * open. The breadcrumb is the workspace alone.
 */
export function WorkspaceShell({ workspace, accountSettings, children }: Readonly<WorkspaceShellProps>): ReactNode {
  const t = useTranslations('shell');
  const settings = useSettled(accountSettings);
  return (
    <>
      <SkipLink label={t('skipToMain')} targetId={MAIN_ID} />
      <div className="flex min-h-dvh flex-col">
        <TopBar
          navigation={null}
          breadcrumb={
            <nav aria-label={t('breadcrumb')} className="min-w-0">
              <ol className="flex min-w-0 items-center type-body">
                <li className="min-w-0">
                  <span aria-current="page" className="block truncate type-body-strong text-foreground">
                    {workspace}
                  </span>
                </li>
              </ol>
            </nav>
          }
          controls={
            <TopBarControls accountSettings={settings === null ? null : <Link href={settings} />} shortcuts={[]} />
          }
        />
        <main id={MAIN_ID} tabIndex={-1} className="flex min-w-0 flex-1 flex-col outline-none">
          {children}
        </main>
      </div>
    </>
  );
}
