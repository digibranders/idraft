import { redirect } from 'next/navigation';

export default async function RankingsImportRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string; project: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<never> {
  const { workspace, project } = await params;
  const sp = await searchParams;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (Array.isArray(value)) {
      for (const item of value) search.append(key, item);
    } else if (value !== undefined) {
      search.set(key, value);
    }
  }
  const query = search.toString();
  redirect(
    `/${encodeURIComponent(workspace)}/${encodeURIComponent(project)}/seo/keywords/import${query ? `?${query}` : ''}`,
  );
}
