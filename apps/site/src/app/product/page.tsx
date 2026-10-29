import type { Metadata } from 'next';

import { CtaBand } from '@/components/cta-band';
import { AnswerArt, RankArt, SourcesArt } from '@/components/art/illustrations';
import { PageHero } from '@/components/page-hero';
import { RecordScene } from '@/components/art/scenes';
import { FeaturesTeaser } from '@/components/features-teaser';
import { StickyStack } from '@/components/sticky-stack';

export const metadata: Metadata = {
  title: 'Product',
  description: 'Rank tracking, AI visibility and source intelligence on one record per topic.',
};

const CARDS = [
  {
    title: 'Rank tracking',
    body: 'Daily Google positions for every keyword, country and device, with the ranking page, SERP features and a clear state for every gap.',
    href: '/rank-tracking',
    art: <RankArt />,
    cta: 'Explore rank tracking',
  },
  {
    title: 'AI visibility',
    body: 'What ChatGPT, Gemini, Google AI Overviews and AI Mode say about your topics: who is named, in what position, and which sources they cite.',
    href: '/ai-visibility',
    art: <AnswerArt />,
    cta: 'Explore AI visibility',
  },
  {
    title: 'Sources and rivals',
    body: 'Every source an answer cites, grouped by domain, and your competitors tracked on the same keywords and prompts.',
    href: '/sources',
    art: <SourcesArt />,
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
        visual={<RecordScene />}
      />
      <StickyStack cards={CARDS} />
      <div className="h-24" />
      <FeaturesTeaser />
      <CtaBand title="Start with the topics that matter most." body="Request access and tell us which keywords and questions you want to follow first." />
    </>
  );
}
