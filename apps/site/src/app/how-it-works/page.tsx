import type { Metadata } from 'next';

import { CtaBand } from '@/components/cta-band';
import { PageHero } from '@/components/page-hero';
import { PathScene } from '@/components/art/scenes';
import { StepsTimeline } from '@/components/steps-timeline';

export const metadata: Metadata = {
  title: 'How it works',
  description: 'From your domain to one matrix of rankings and AI answers, in four moves.',
};

const STEPS = [
  {
    title: 'Add your site and rivals',
    body: 'Enter your domain and the competitors you watch, then choose the countries and devices that matter to you.',
    detail: 'A project per site or client',
  },
  {
    title: 'Add keywords and prompts',
    body: 'Paste or import the keywords you rank for and the questions people ask AI. Group them by topic and link the ones that belong together.',
    detail: 'CSV import up to 10,000 rows',
  },
  {
    title: 'We collect on a schedule',
    body: 'Rankings are checked daily and AI answers weekly. Each check is stored with its date, and a missed one is shown as missed.',
    detail: 'Daily rankings, weekly answers',
  },
  {
    title: 'Read one matrix',
    body: 'Rankings and AI answers land on the same rows, so a gap between them is easy to spot, easy to explain and easy to show.',
    detail: 'Keyword by prompt, side by side',
  },
] as const;

export default function HowItWorksPage() {
  return (
    <>
      <PageHero
        eyebrow="How it works"
        title="From your domain to one matrix, in four moves."
        lead="You choose what to follow. idraft collects it on a schedule and keeps the evidence behind every number."
        visual={<PathScene />}
      />
      <section className="px-5 py-16 md:px-8 lg:py-28">
        <StepsTimeline steps={STEPS} />
      </section>
      <CtaBand title="Ready to see your first matrix?" />
    </>
  );
}
