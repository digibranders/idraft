import type { Metadata } from 'next';
import { ChatText, Crosshair, MagnifyingGlass, Quotes, Scales, Users } from '@phosphor-icons/react/dist/ssr';

import { CapabilityList } from '@/components/capability-list';
import { CtaBand } from '@/components/cta-band';
import { HorizontalEngines } from '@/components/horizontal-engines';
import { PageHero } from '@/components/page-hero';
import { Reveal } from '@/components/reveal';
import { TextReveal } from '@/components/text-reveal';

export const metadata: Metadata = {
  title: 'AI visibility',
  description: 'What ChatGPT, Gemini, Google AI Overviews and AI Mode say about your brand, with the evidence behind every mention.',
};

const ITEMS = [
  { icon: ChatText, title: 'Mentioned, and where', body: 'Whether your brand is named, its position in the answer, and whether it is recommended or only listed.' },
  { icon: Quotes, title: 'Mentions and citations apart', body: 'Being named and being cited as a source are different facts, so they are counted separately.' },
  { icon: MagnifyingGlass, title: 'The exact words', body: 'Every mention links to the passage it came from, so a number can always be checked against the answer.' },
  { icon: Scales, title: 'Rates with their sample size', body: 'Mention rate and citation rate come with the number of checks behind them, and a change is only called a change when it is larger than the noise.' },
  { icon: Users, title: 'Rivals you did not add', body: 'Brands that keep appearing in answers are surfaced as candidates, so you find competitors by evidence.' },
  { icon: Crosshair, title: 'Prompts you choose', body: 'Group the questions your buyers ask by topic, link them to your keywords and follow them on a schedule.' },
] as const;

export default function AiVisibilityPage() {
  return (
    <>
      <PageHero
        eyebrow="AI visibility"
        title="Be the answer, not only a result."
        lead="See what AI says about your topics: who is named, in what order, and which sources it trusts."
        image={{ src: '/images/scenes/ai.webp', alt: 'A paper-cut scene of a person chatting with a friendly AI assistant while answer bubbles appear, one wearing a crown' }}
      />

      <HorizontalEngines withWaves={false} />

      <CapabilityList title="What we read from every answer." lead="Extraction is rules first, so results are repeatable, and each one points back to its evidence." items={ITEMS} />

      <section className="mx-auto max-w-[1320px] px-5 py-24 md:px-8 lg:py-40">
        <Reveal>
          <TextReveal text="There is no single visibility score here. A score hides how it was made, so idraft shows the parts, and the number of checks behind each one." />
        </Reveal>
      </section>

      <CtaBand title="Find out what AI says when someone asks." />
    </>
  );
}
