import type { ReactNode } from 'react';

import { SettingsFrame } from '@/features/settings';

/** The settings navigation and the form column, without the Project settings group. */
export default async function WorkspaceSettingsSectionsLayout({
  children,
  params,
}: LayoutProps<'/[workspace]/settings'>): Promise<ReactNode> {
  const { workspace } = await params;
  return (
    <SettingsFrame workspace={workspace} project={null}>
      {children}
    </SettingsFrame>
  );
}
