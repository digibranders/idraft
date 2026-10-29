import Image from 'next/image';

import { Reveal } from './reveal';
import { SpotlightCell } from './spotlight-cell';

const H3 = 'text-2xl font-semibold leading-tight tracking-[-0.035em]';
const P = 'mt-3 max-w-[40ch] leading-relaxed';

/** History with a gap: a missed check is drawn as a gap, never filled in. */
function HistoryGap() {
  return (
    <svg viewBox="0 0 360 110" role="img" aria-label="Illustrative history line with a gap where a check was missed." className="h-auto w-full">
      <path d="M4 82 L40 74 L76 78 L112 58 L148 62 L172 44" fill="none" stroke="#1E65E3" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M172 44 L226 40" fill="none" stroke="#626A76" strokeWidth="2" strokeDasharray="2 6" strokeLinecap="round" />
      <path d="M226 40 L262 30 L298 34 L334 18 L356 14" fill="none" stroke="#1E65E3" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <text x="199" y="68" textAnchor="middle" className="fill-ink-3 font-mono text-[10px]">
        no check
      </text>
    </svg>
  );
}

/*
 * Five cells for five features: 7 + 5 on the first row, 3 + 4 + 5 on the second (the widths add to 12 each).
 * Variety on purpose: a contour field, a lens photo, a photo stack, a solid cobalt block, a tinted chart cell.
 */
export function Bento() {
  return (
    <section id="product" className="mx-auto max-w-[1320px] px-5 py-24 md:px-8 lg:py-32">
      <Reveal>
        <h2 className="max-w-[18ch] text-[clamp(2.1rem,3.8vw,3.4rem)] leading-[1.05] font-semibold tracking-[-0.04em]">Everything on one record per topic.</h2>
        <p className="mt-5 max-w-[52ch] text-lg leading-relaxed text-ink-2">Rankings, AI answers, sources and history, kept together so each question has one place to look.</p>
      </Reveal>

      <div className="mt-14 grid gap-4 lg:grid-cols-12">
        <Reveal className="lg:col-span-7">
          <SpotlightCell className="h-full">
            <div className="relative flex min-h-[26rem] flex-col justify-between p-8 sm:p-10">
              <Image src="/images/contour.png" alt="" fill sizes="(min-width: 1024px) 55vw, 100vw" className="object-cover object-bottom" />
              <div className="relative">
                <h3 className={H3}>Daily rankings that stay honest</h3>
                <p className={`${P} text-ink-2`}>Position, change since the last check, the ranking URL and SERP features for every keyword. A missing check is shown as missing.</p>
              </div>
            </div>
          </SpotlightCell>
        </Reveal>

        <Reveal delay={0.08} className="lg:col-span-5">
          <SpotlightCell className="h-full">
            <div className="relative flex min-h-[26rem] flex-col p-8 sm:p-10">
              <div className="relative z-10">
                <h3 className={H3}>Be the answer, not only the result</h3>
                <p className={`${P} text-ink-2`}>Mentions, position in the answer and tone across ChatGPT, Gemini and Google AI.</p>
              </div>
              <Image src="/images/lens.png" alt="" fill sizes="(min-width: 1024px) 40vw, 100vw" className="object-cover object-bottom" />
              <div aria-hidden="true" className="absolute inset-x-0 top-0 h-3/5 bg-gradient-to-b from-surface via-surface/90 to-transparent" />
            </div>
          </SpotlightCell>
        </Reveal>

        <Reveal delay={0.04} className="lg:col-span-3">
          <SpotlightCell className="h-full">
            <div className="flex min-h-[24rem] flex-col">
              <div className="relative h-44 shrink-0">
                <Image src="/images/sources.png" alt="" fill sizes="(min-width: 1024px) 25vw, 100vw" className="object-cover" />
              </div>
              <div className="p-7">
                <h3 className="text-xl font-semibold leading-tight tracking-[-0.03em]">See who the AI trusts</h3>
                <p className="mt-2 leading-relaxed text-ink-2">Every source an answer cites, grouped by domain.</p>
              </div>
            </div>
          </SpotlightCell>
        </Reveal>

        <Reveal delay={0.1} className="lg:col-span-4">
          <SpotlightCell className="h-full" innerClassName="bg-cobalt text-white">
            <div className="flex min-h-[24rem] flex-col justify-between p-8 sm:p-10">
              <p className="text-[clamp(2.4rem,4vw,3.6rem)] leading-[0.98] font-semibold tracking-[-0.05em]">Same scale, for your rivals.</p>
              <p className="max-w-[34ch] leading-relaxed text-white/85">Track competitors on the same keywords and prompts, and see who is gaining ground.</p>
            </div>
          </SpotlightCell>
        </Reveal>

        <Reveal delay={0.16} className="lg:col-span-5">
          <SpotlightCell className="h-full" innerClassName="bg-wash">
            <div className="flex min-h-[24rem] flex-col justify-between gap-8 p-8 sm:p-10">
              <HistoryGap />
              <div>
                <h3 className={H3}>A history you can trust</h3>
                <p className={`${P} text-ink-2`}>Each check is stored with its date, so a trend is real data and a gap is labeled, never guessed.</p>
              </div>
            </div>
          </SpotlightCell>
        </Reveal>
      </div>
    </section>
  );
}
