import { redirect } from 'next/navigation';

import { integrationsPath, withQuery, queryOf } from '@/lib/routes/paths';

/**
 * `/integrations` is the sidebar's entry (11-navigation.md section 1.1); Google (Search Console and GA4) is the first
 * source and the only one built, so it opens there, keeping the query it came with.
 */
export default async function IntegrationsRedirect({
  params,
  searchParams,
}: PageProps<'/[workspace]/[project]/integrations'>): Promise<never> {
  const [{ workspace, project }, query] = await Promise.all([params, searchParams]);
  redirect(withQuery(integrationsPath(workspace, project, 'google'), queryOf(query)));
}
