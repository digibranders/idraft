import { AnswerCard, MiniRanks, MiniSources } from './mock/fragments';

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
 * Variety on purpose: a wash with a rank table, an answer card, a source list, a solid cobalt block, a tinted chart cell.
 */
export function Bento() {
  return (
    <section id="product" className="mx-auto max-w-[1320px] px-5 py-24 md:px-8 lg:py-32">
      <Reveal>
        <h2 className="max-w-[22ch] text-[clamp(2.2rem,4.2vw,3.8rem)] leading-[1.1] font-semibold tracking-[-0.045em]">
          Every rank
          <span aria-hidden="true" className="mx-3 inline-block h-[0.78em] w-[1.7em] rounded-full bg-cover bg-center align-middle shadow-lift ring-1 ring-ink/10" style={{ backgroundImage: 'url(/images/bars.png)' }} />
          and every answer
          <span aria-hidden="true" className="mx-3 inline-block h-[0.78em] w-[1.7em] rounded-full bg-cover bg-center align-middle shadow-lift ring-1 ring-ink/10" style={{ backgroundImage: 'url(/images/orb.png)' }} />
          on one record.
        </h2>
        <p className="mt-5 max-w-[52ch] text-lg leading-relaxed text-ink-2">Rankings, AI answers, sources and history, kept together so each question has one place to look.</p>
      </Reveal>

      <div className="mt-14 grid gap-4 lg:grid-cols-12">
        <Reveal className="lg:col-span-7">
          <SpotlightCell className="h-full">
            <div className="relative flex min-h-[26rem] flex-col justify-between p-8 sm:p-10">
              <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-br from-wash/70 via-surface to-surface" />
              <div className="relative">
                <h3 className={H3}>Daily rankings that stay honest</h3>
                <p className={`${P} text-ink-2`}>Position, change since the last check, the ranking URL and SERP features for every keyword. A missing check is shown as missing.</p>
              </div>
              <div className="relative mt-10 sm:max-w-md">
                <MiniRanks />
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
              <div className="relative mt-8 flex flex-1 items-end">
                <AnswerCard index={2} className="w-full shadow-lift" />
              </div>
            </div>
          </SpotlightCell>
        </Reveal>

        <Reveal delay={0.04} className="lg:col-span-3">
          <SpotlightCell className="h-full">
            <div className="flex min-h-[24rem] flex-col">
              <div className="p-5 pb-0">
                <MiniSources />
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
