import type { Metadata } from 'next';

import { CtaBand } from '@/components/cta-band';
import { PageHero } from '@/components/page-hero';
import { Reveal } from '@/components/reveal';
import { TextReveal } from '@/components/text-reveal';

export const metadata: Metadata = {
  title: 'About',
  description: 'Why idraft shows its work: every number with its denominator, every gap labeled, every claim linked to evidence.',
};

const PRINCIPLES = [
  { title: 'Every number shows its denominator', body: 'A rate means little without the number of checks behind it. We print both.' },
  { title: 'A gap is data', body: 'A missed check is shown as missed. We never fill a hole to make a chart look smoother.' },
  { title: 'Evidence before opinion', body: 'A mention links to the passage, a rank to the check, a source to the answer. You can verify what we say.' },
  { title: 'Parts, not a magic score', body: 'We would rather show you mention rate and citation rate than one number nobody can take apart.' },
] as const;

export default function AboutPage() {
  return (
    <>
      <PageHero
        eyebrow="About"
        title="Numbers should show their work."
        lead="Search has changed twice in a few years. Teams are asked what it means for their brand, and most tools answer with a score. We think the answer should come with evidence."
        image={{ src: '/images/fold.png', alt: 'A heavy sheet of paper folded into a ridge with a pane of blue glass behind it.' }}
        action={false}
      />

      <section className="mx-auto max-w-[1320px] px-5 py-24 md:px-8 lg:py-40">
        <Reveal>
          <TextReveal text="We are building one place for search and AI visibility, then the tools around it, for people who need to explain their numbers to someone else." />
        </Reveal>
      </section>

      <section className="mx-auto max-w-[1320px] px-5 pb-24 md:px-8 lg:pb-32">
        <ul className="grid gap-x-12 md:grid-cols-2">
          {PRINCIPLES.map((item, index) => (
            <li key={item.title}>
              <Reveal delay={(index % 2) * 0.07}>
                <div className="border-t border-line py-10">
                  <h2 className="text-[clamp(1.5rem,2.4vw,2rem)] leading-tight font-semibold tracking-[-0.04em]">{item.title}</h2>
                  <p className="mt-3 max-w-[44ch] text-lg leading-relaxed text-ink-2">{item.body}</p>
                </div>
              </Reveal>
            </li>
          ))}
        </ul>
      </section>

      <CtaBand title="Want to see it with your own data?" />
    </>
  );
}
