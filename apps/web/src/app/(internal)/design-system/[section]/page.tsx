import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { PREVIEW_SECTIONS, previewSection, type PreviewSection } from '@/components/design-system/registry';
import { publicEnv } from '@/lib/env/public';

interface SectionPageProps {
  params: Promise<{ section: string }>;
}

/**
 * The section a slug names, or nothing: an unknown slug, and every slug in production. The page checks this
 * itself instead of trusting the layout's gate, because a client navigation can render a page without
 * running the layout again.
 */
function sectionFor(slug: string): PreviewSection | undefined {
  return publicEnv.NEXT_PUBLIC_APP_ENV === 'production' ? undefined : previewSection(slug);
}

/** Only the registered sections exist: any other slug is a 404 without rendering. */
export const dynamicParams = false;

/** No section is built in production, so with `dynamicParams` off every slug there is a 404 at the route. */
export const generateStaticParams = (): { section: string }[] =>
  publicEnv.NEXT_PUBLIC_APP_ENV === 'production' ? [] : PREVIEW_SECTIONS.map((section) => ({ section: section.slug }));

export async function generateMetadata({ params }: SectionPageProps): Promise<Metadata> {
  const section = sectionFor((await params).section);
  return section ? { title: section.title } : {};
}

export default async function SectionPage({ params }: SectionPageProps): Promise<ReactNode> {
  const section = sectionFor((await params).section);
  if (!section) notFound();
  const Section = section.render;
  return (
    <>
      <h1 className="type-page-title">{section.title}</h1>
      <Section />
    </>
  );
}
