import 'server-only';

import { cookies } from 'next/headers';
import type { ComponentProps, ReactNode } from 'react';

import { WorkspaceShell } from './workspace-shell';
import { parseSidebarPreference, SIDEBAR_COOKIE } from '@/lib/navigation/sidebar-state';

/** The workspace shell with the person's sidebar choice, read from its cookie as the project shell's is. */
export async function WorkspaceFrame(
  props: Readonly<Omit<ComponentProps<typeof WorkspaceShell>, 'sidebarPreference'>>,
): Promise<ReactNode> {
  const sidebarPreference = parseSidebarPreference((await cookies()).get(SIDEBAR_COOKIE)?.value);
  return <WorkspaceShell {...props} sidebarPreference={sidebarPreference} />;
}
