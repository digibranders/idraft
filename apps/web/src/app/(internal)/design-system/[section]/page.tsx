import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { PREVIEW_SECTIONS, previewSection } from '@/components/design-system/registry';

interface SectionPageProps {
  params: Promise<{ section: string }>;
}

export const generateStaticParams = (): { section: string }[] =>
  PREVIEW_SECTIONS.map((section) => ({ section: section.slug }));

export async function generateMetadata({ params }: SectionPageProps): Promise<Metadata> {
  const section = previewSection((await params).section);
  return section ? { title: section.title } : {};
}

export default async function SectionPage({ params }: SectionPageProps): Promise<ReactNode> {
  const section = previewSection((await params).section);
  if (!section) notFound();
  const Section = section.render;
  return (
    <>
      <h1 className="type-page-title">{section.title}</h1>
      <Section />
    </>
  );
}
