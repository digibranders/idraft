import type { Metadata } from 'next';
import Image from 'next/image';
import { ChatText, Crosshair, MagnifyingGlass, Quotes, Scales, Users } from '@phosphor-icons/react/dist/ssr';

import { CapabilityList } from '@/components/capability-list';
import { CtaBand } from '@/components/cta-band';
import { PageHero } from '@/components/page-hero';
import { Reveal } from '@/components/reveal';
import { TextReveal } from '@/components/text-reveal';

export const metadata: Metadata = {
  title: 'AI visibility',
  description: 'What ChatGPT, Gemini, Google AI Overviews and AI Mode say about your brand, with the evidence behind every mention.',
};

const ENGINES = [
  { name: 'Google', src: '/logos/google.svg', width: 77, note: 'AI Overviews and AI Mode' },
  { name: 'ChatGPT by OpenAI', src: '/logos/openai.svg', width: 86, note: 'Answers with cited sources' },
  { name: 'Gemini', src: '/logos/gemini.svg', width: 98, note: 'Answers with citations' },
] as const;

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

      <section className="mx-auto max-w-[1320px] px-5 py-12 md:px-8 lg:py-20">
        <Reveal>
          <h2 className="max-w-[22ch] text-[clamp(2.1rem,3.8vw,3.4rem)] leading-[1.05] font-semibold tracking-[-0.045em] text-balance">Four places people now get answers.</h2>
        </Reveal>
        <ul className="mt-12 grid gap-4 md:grid-cols-3">
          {ENGINES.map((engine, index) => (
            <li key={engine.name}>
              <Reveal delay={index * 0.07}>
                <div className="rounded-[2rem] bg-ink/[0.04] p-1.5 ring-1 ring-ink/[0.06]">
                  <div className="flex min-h-56 flex-col justify-between rounded-[calc(2rem-0.375rem)] bg-surface p-8">
                    <Image src={engine.src} alt={engine.name} width={engine.width} height={24} unoptimized className="h-7 w-auto" />
                    <p className="text-lg tracking-[-0.02em] text-ink-2">{engine.note}</p>
                  </div>
                </div>
              </Reveal>
            </li>
          ))}
        </ul>
      </section>

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
