import type { Metadata } from 'next';

import { CtaBand } from '@/components/cta-band';
import { PageHero } from '@/components/page-hero';
import { Reveal } from '@/components/reveal';
import { PLANNED } from '@/content';

export const metadata: Metadata = {
  title: 'Roadmap',
  description: 'What idraft does today and what is planned next, including website audits and more SEO tools.',
};

const CORE = [
  { title: 'Rank tracking', body: 'Daily Google positions by country and device, with the ranking page and SERP features.' },
  { title: 'AI visibility', body: 'Mentions, citations and position in the answers of ChatGPT, Gemini, Google AI Overviews and AI Mode.' },
  { title: 'Sources and rivals', body: 'Every cited source, grouped by domain, and your competitors on the same scale.' },
  { title: 'History and evidence', body: 'Every check stored with its date, and every number linked to what it came from.' },
] as const;

function Column({ heading, note, items, planned }: { heading: string; note: string; items: readonly { title: string; body: string }[]; planned?: boolean }) {
  return (
    <div className="rounded-[2rem] bg-ink/[0.04] p-1.5 ring-1 ring-ink/[0.06]">
      <div className="h-full rounded-[calc(2rem-0.375rem)] bg-surface p-8 sm:p-10">
        <h2 className="text-2xl font-semibold tracking-[-0.035em]">{heading}</h2>
        <p className="mt-2 text-ink-3">{note}</p>
        <ul className="mt-8">
          {items.map((item) => (
            <li key={item.title} className="flex items-start justify-between gap-5 border-t border-line py-6">
              <div>
                <h3 className="text-lg font-semibold tracking-[-0.025em]">{item.title}</h3>
                <p className="mt-1.5 max-w-[42ch] leading-relaxed text-ink-2">{item.body}</p>
              </div>
              {planned ? <span className="mt-1 shrink-0 rounded-full bg-wash px-3 py-1 text-xs font-medium text-cobalt-deep">Planned</span> : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default function RoadmapPage() {
  return (
    <>
      <PageHero
        eyebrow="Roadmap"
        title="A platform that grows around one record."
        lead="idraft starts with rankings and AI answers. A website audit and other SEO tools are planned, and they will land next to the data you already trust."
        image={{ src: '/images/fold.png', alt: 'A heavy sheet of paper folded into a ridge with a pane of blue glass behind it.' }}
      />
      <section className="mx-auto max-w-[1320px] px-5 py-12 md:px-8 lg:py-20">
        <div className="grid gap-4 lg:grid-cols-2">
          <Reveal>
            <Column heading="The core" note="What idraft is built around." items={CORE} />
          </Reveal>
          <Reveal delay={0.1}>
            <Column heading="Planned" note="No dates, and the order can change." items={PLANNED} planned />
          </Reveal>
        </div>
        <Reveal>
          <p className="mx-auto mt-12 max-w-[56ch] text-center text-lg leading-relaxed text-ink-2">The list is not closed. If a tool would change how your team works, tell us when you request access.</p>
        </Reveal>
      </section>
      <CtaBand title="Tell us what you would build on it." />
    </>
  );
}
