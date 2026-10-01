import type { ReactNode } from 'react';

import { SettingsFrame } from '@/features/settings';

/** Settings: the local navigation and the form column, inside the shell. */
export default async function SettingsLayout({
  children,
  params,
}: LayoutProps<'/[workspace]/[project]/settings'>): Promise<ReactNode> {
  const { workspace, project } = await params;
  return (
    <SettingsFrame workspace={workspace} project={project}>
      {children}
    </SettingsFrame>
  );
}
