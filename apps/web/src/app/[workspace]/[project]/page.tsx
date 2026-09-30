import { notFound, redirect } from 'next/navigation';

import { firstDestination } from '@/features/shell/destinations';

/**
 * The project root. Overview lives here once it is built; until then the root opens the first destination
 * the member can use (the navigation registry decides what is live).
 */
export default async function ProjectPage({ params }: PageProps<'/[workspace]/[project]'>): Promise<never> {
  const { workspace, project } = await params;
  const destination = await firstDestination(workspace, project);
  if (destination === null) notFound();
  redirect(destination);
}
