import type { Metadata } from 'next';
import Image from 'next/image';

import { CtaBand } from '@/components/cta-band';
import { PageHero } from '@/components/page-hero';
import { FeaturesTeaser } from '@/components/features-teaser';
import { StickyStack } from '@/components/sticky-stack';

export const metadata: Metadata = {
  title: 'Product',
  description: 'Rank tracking, AI visibility and source intelligence on one record per topic.',
};

/** A real app screen on a warm wash, sized to its card. */
function Shot({ src, alt, priority = false }: { src: string; alt: string; priority?: boolean }) {
  return (
    <div className="absolute inset-0 grid place-items-center bg-wash p-5 lg:p-9">
      <div className="relative w-full overflow-hidden rounded-xl shadow-lift ring-1 ring-ink/10">
        <Image src={src} alt={alt} width={2880} height={1760} priority={priority} sizes="(min-width: 1024px) 50vw, 100vw" className="h-auto w-full" />
      </div>
    </div>
  );
}

const CARDS = [
  {
    title: 'Rank tracking',
    body: 'Daily Google positions for every keyword, country and device, with the ranking page, SERP features and a clear state for every gap.',
    href: '/rank-tracking',
    art: <Shot src="/screens/keywords.png" alt="The idraft keywords table with positions, change and ranking pages" />,
    cta: 'Explore rank tracking',
  },
  {
    title: 'AI visibility',
    body: 'What ChatGPT, Gemini, Google AI Overviews and AI Mode say about your topics: who is named, in what position, and which sources they cite.',
    href: '/ai-visibility',
    art: <Shot src="/screens/p-prompts.png" alt="The idraft prompts screen with mentions across AI engines" />,
    cta: 'Explore AI visibility',
  },
  {
    title: 'Sources and rivals',
    body: 'Every source an answer cites, grouped by domain, and your competitors tracked on the same keywords and prompts.',
    href: '/sources',
    art: <Shot src="/screens/p-pages.png" alt="The idraft pages screen with page-level performance" />,
    cta: 'Explore sources and rivals',
  },
] as const;

export default function ProductPage() {
  return (
    <>
      <PageHero
        eyebrow="Product"
        title="One record for every topic you care about."
        lead="Rankings, AI answers, sources and history stay together, so each question has one place to look and one set of numbers to trust."
        visual={
          <div className="relative aspect-[3/2] overflow-hidden rounded-[2rem] shadow-lift ring-1 ring-ink/[0.06]">
            <Shot src="/screens/p-overview.png" alt="The idraft overview with visibility, mention rate and rank distribution" priority />
          </div>
        }
      />
      <StickyStack cards={CARDS} />
      <div className="h-24" />
      <FeaturesTeaser />
      <CtaBand title="Start with the topics that matter most." body="Request access and tell us which keywords and questions you want to follow first." />
    </>
  );
}
