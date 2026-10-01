import { redirect } from 'next/navigation';

import { workspaceSettingsPath } from '@/lib/routes/paths';

/** Settings opens on the first section, Profile. */
export default async function WorkspaceSettingsPage({ params }: PageProps<'/[workspace]/settings'>): Promise<never> {
  const { workspace } = await params;
  redirect(workspaceSettingsPath(workspace, 'profile'));
}
