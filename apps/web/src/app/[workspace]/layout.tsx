import type { ReactNode } from 'react';

import { WorkspaceRoot } from '@/features/session/workspace-root';

/**
 * Every page of a workspace: the caller's membership of it, from `/me` on the server (20 section 3.3). An
 * unknown slug, or one of a workspace the caller is not in, is the 404 page.
 */
export default async function WorkspaceLayout({ children, params }: LayoutProps<'/[workspace]'>): Promise<ReactNode> {
  const { workspace } = await params;
  return <WorkspaceRoot slug={workspace}>{children}</WorkspaceRoot>;
}
