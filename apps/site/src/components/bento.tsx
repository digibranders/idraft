import Image from 'next/image';

import { Reveal } from './reveal';
import { SpotlightCell } from './spotlight-cell';

/** One generated scene, cropped to the card's art window. */
function Scene({ src, alt, position = 'center' }: { src: string; alt: string; position?: string }) {
  return <Image src={src} alt={alt} fill sizes="(min-width: 1024px) 40vw, 100vw" className="object-cover" style={{ objectPosition: position }} />;
}

const H3 = 'text-2xl font-semibold leading-tight tracking-[-0.035em]';
const P = 'mt-3 max-w-[40ch] leading-relaxed text-ink-2';

/** An illustration with the copy under it. The art runs edge to edge and clips to the card's corners. */
function ArtCard({ art, title, body, artHeight }: { art: React.ReactNode; title: string; body: string; artHeight: string }) {
  return (
    <div className="flex h-full flex-col">
      <div className={`relative overflow-hidden ${artHeight}`}>{art}</div>
      <div className="px-6 pt-6 pb-7 sm:px-8">
        <h3 className={H3}>{title}</h3>
        <p className={P}>{body}</p>
      </div>
    </div>
  );
}

/*
 * Five cells for five features: 7 + 5 on the first row, 4 + 4 + 4 on the second (each row adds to 12). Each
 * illustration has its own color family so the grid does not read as one flat block; the cobalt cell is the anchor.
 */
export function Bento() {
  return (
    <section id="product" className="mx-auto max-w-[1320px] px-5 py-16 md:px-8 lg:py-20">
      <Reveal>
        <h2 className="max-w-[22ch] text-[clamp(2.2rem,4.2vw,3.8rem)] leading-[1.1] font-semibold tracking-[-0.045em]">Every rank and every answer on one record.</h2>
        <p className="mt-5 max-w-[52ch] text-lg leading-relaxed text-ink-2">Rankings, AI answers, sources and history, kept together so each question has one place to look.</p>
      </Reveal>

      <div className="mt-14 grid gap-4 lg:grid-cols-12">
        <Reveal className="lg:col-span-7">
          <SpotlightCell className="h-full">
            <ArtCard art={<Scene src="/images/scenes/b-rank.webp" alt="A hiker with a flag at the summit of a numbered stepped mountain" position="50% 40%" />} artHeight="h-72" title="Daily rankings that stay honest" body="Position, change since the last check, the ranking URL and SERP features for every keyword. A missing check is shown as missing." />
          </SpotlightCell>
        </Reveal>

        <Reveal delay={0.08} className="lg:col-span-5">
          <SpotlightCell className="h-full">
            <ArtCard art={<Scene src="/images/scenes/b-answer.webp" alt="A spotlit stage with a microphone and three speech bubbles, one wearing a crown" position="60% 40%" />} artHeight="h-72" title="Be the answer, not only the result" body="Mentions, position in the answer and tone across ChatGPT, Gemini and Google AI." />
          </SpotlightCell>
        </Reveal>

        <Reveal delay={0.04} className="lg:col-span-4">
          <SpotlightCell className="h-full">
            <ArtCard art={<Scene src="/images/scenes/b-sources.webp" alt="An engraved library with red threads leading to one glowing book" position="50% 45%" />} artHeight="h-64" title="See who the AI trusts" body="Every source an answer cites, grouped by domain." />
          </SpotlightCell>
        </Reveal>

        <Reveal delay={0.1} className="lg:col-span-4">
          <SpotlightCell className="h-full" innerClassName="bg-ink text-white">
            <div className="flex h-full min-h-[24rem] flex-col justify-between p-8 sm:p-10">
              <p className="text-[clamp(2.4rem,4vw,3.6rem)] leading-[0.98] font-semibold tracking-[-0.05em]">Same scale, for your rivals.</p>
              <p className="max-w-[34ch] leading-relaxed text-white/85">Track competitors on the same keywords and prompts, and see who is gaining ground.</p>
            </div>
          </SpotlightCell>
        </Reveal>

        <Reveal delay={0.16} className="lg:col-span-4">
          <SpotlightCell className="h-full">
            <ArtCard art={<Scene src="/images/scenes/b-history.webp" alt="A calendar grid of small bars forming a rising trend, one square left empty" position="50% 50%" />} artHeight="h-64" title="A history you can trust" body="Each check is stored with its date, so a trend is real data and a gap is labeled, never guessed." />
          </SpotlightCell>
        </Reveal>
      </div>
    </section>
  );
}
