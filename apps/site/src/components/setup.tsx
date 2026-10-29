import { Globe, ListMagnifyingGlass, SquaresFour } from '@phosphor-icons/react/dist/ssr';

import { SETUP_STEPS } from '@/content';

import { Reveal } from './reveal';

const ICONS = [Globe, ListMagnifyingGlass, SquaresFour] as const;

/** Heading pinned on the left while the three moves scroll past on the right. */
export function Setup() {
  return (
    <section id="setup" className="mx-auto max-w-[1320px] px-5 py-24 md:px-8 lg:py-32">
      <div className="grid gap-12 lg:grid-cols-12 lg:gap-16">
        <div className="lg:col-span-4">
          <div className="lg:sticky lg:top-32">
            <Reveal>
              <h2 className="text-[clamp(2.1rem,3.6vw,3.2rem)] leading-[1.05] font-semibold tracking-[-0.04em]">From domain to matrix in three moves.</h2>
            </Reveal>
          </div>
        </div>
        <ol className="lg:col-span-8">
          {SETUP_STEPS.map((step, index) => {
            const Icon = ICONS[index] ?? Globe;
            return (
              <li key={step.title}>
                <Reveal>
                  <div className="flex flex-col gap-6 border-t border-line py-10 sm:flex-row sm:gap-10 lg:py-14">
                    <span className="grid size-16 shrink-0 place-items-center rounded-full bg-wash text-cobalt-deep">
                      <Icon size={28} weight="light" aria-hidden="true" />
                    </span>
                    <div>
                      <h3 className="text-[clamp(1.6rem,2.6vw,2.2rem)] leading-tight font-semibold tracking-[-0.035em]">{step.title}</h3>
                      <p className="mt-3 max-w-[48ch] text-lg leading-relaxed text-ink-2">{step.body}</p>
                    </div>
                  </div>
                </Reveal>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
