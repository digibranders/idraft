import { redirect } from 'next/navigation';

import { projectPath } from '@/lib/routes/paths';

/** Settings opens on the first section, Profile. */
export default async function SettingsPage({ params }: PageProps<'/[workspace]/[project]/settings'>): Promise<never> {
  const { workspace, project } = await params;
  redirect(projectPath(workspace, project, '/settings/profile'));
}
