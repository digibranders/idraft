import { redirect } from 'next/navigation';

import { integrationsPath, queryOf, withQuery } from '@/lib/routes/paths';

/**
 * `/integrations/gsc` was the page before Search Console and GA4 shared one Google connection. Bookmarks, and
 * a return from Google that began before the change, still arrive here: they go to the Google page with the
 * query they came with (`?connection_id=` or `?error=`).
 */
export default async function GscRedirect({
  params,
  searchParams,
}: PageProps<'/[workspace]/[project]/integrations/gsc'>): Promise<never> {
  const [{ workspace, project }, query] = await Promise.all([params, searchParams]);
  redirect(withQuery(integrationsPath(workspace, project, 'google'), queryOf(query)));
}
