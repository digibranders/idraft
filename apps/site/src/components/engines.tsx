import Image from 'next/image';

// Each engine is a pill with its own mark and a tint of its brand color, so the row reads as four real places.
const ENGINES = [
  { name: 'Google AI Overviews', mark: '/logos/google-mark.svg', tint: 'bg-amber-wash', ring: 'ring-amber/30' },
  { name: 'Google AI Mode', mark: '/logos/google-mark.svg', tint: 'bg-violet-wash', ring: 'ring-violet/25' },
  { name: 'ChatGPT', mark: '/logos/openai-mark.svg', tint: 'bg-mint-wash', ring: 'ring-mint/30' },
  { name: 'Gemini', mark: '/logos/gemini-mark.svg', tint: 'bg-wash', ring: 'ring-cobalt/25' },
] as const;

/** The engines idraft reads, under the hero: a labeled pill for each, with its mark in full color. */
export function Engines() {
  return (
    <section aria-label="Answer engines tracked" className="mx-auto max-w-[1320px] px-5 py-10 md:px-8">
      <div className="flex flex-col items-start gap-5 lg:flex-row lg:items-center lg:gap-10">
        <p className="shrink-0 text-sm font-medium text-ink-2">We read answers from</p>
        <ul className="flex flex-wrap gap-3">
          {ENGINES.map((engine) => (
            <li
              key={engine.name}
              className={`flex items-center gap-2.5 rounded-full py-2 pr-5 pl-2.5 text-[15px] font-semibold tracking-[-0.01em] ring-1 transition duration-300 ease-heavy hover:-translate-y-0.5 hover:shadow-lift ${engine.tint} ${engine.ring}`}
            >
              <span className="grid size-8 place-items-center rounded-full bg-surface shadow-[0_2px_6px_-2px_rgb(20_23_28/0.25)]">
                <Image src={engine.mark} alt="" width={18} height={18} unoptimized className="size-[18px]" />
              </span>
              {engine.name}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
