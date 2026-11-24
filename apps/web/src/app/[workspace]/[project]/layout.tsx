import type { ReactNode } from 'react';

import { NotificationBell } from '@/features/alerts/notification-bell';
import { ProjectRoot } from '@/features/shell/project-root';

/** Every page of a project, inside the application shell. An unknown slug is the 404 page. */
export default async function ProjectLayout({
  children,
  params,
}: LayoutProps<'/[workspace]/[project]'>): Promise<ReactNode> {
  const { workspace, project } = await params;
  return (
    <ProjectRoot workspace={workspace} project={project} notifications={(slot) => <NotificationBell {...slot} />}>
      {children}
    </ProjectRoot>
  );
}
