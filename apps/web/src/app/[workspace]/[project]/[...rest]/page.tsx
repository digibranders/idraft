import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('errors.notFound');
  return { title: t('title') };
}

/**
 * Any path of a project that is not a page, a planned destination among them: the 404 page inside the
 * shell (20-frontend-specification.md section 3.10), not the bare one. Next.js shows a segment's own
 * `not-found.tsx` only when a route of the segment calls `notFound()`, so this route catches the rest.
 */
export default function UnknownProjectPage(): never {
  notFound();
}
