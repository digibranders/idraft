import { ACCESS_HREF } from '@/content';

import { Button } from './button';
import { Reveal } from './reveal';

type CtaBandProps = { title: string; body?: string };

/** The closing call to action of a page: a large cobalt-washed panel with one action. */
export function CtaBand({ title, body }: CtaBandProps) {
  return (
    <section className="mx-auto max-w-[1320px] px-5 py-8 md:px-8 lg:py-12">
      <Reveal>
        <div className="relative isolate overflow-hidden rounded-[2.5rem] bg-cobalt px-8 py-16 text-white sm:px-14 lg:px-20 lg:py-24">
          <div aria-hidden="true" className="absolute -top-1/2 -right-1/4 -z-10 size-[60rem] rounded-full bg-white/25 blur-[140px]" />
          <div aria-hidden="true" className="absolute -bottom-2/3 -left-1/4 -z-10 size-[44rem] rounded-full bg-[#0f3fa6]/60 blur-[120px]" />
          <div className="grid gap-10 lg:grid-cols-12 lg:items-end">
            <div className="lg:col-span-8">
              <h2 className="text-[clamp(2.2rem,4.8vw,4.4rem)] leading-[1] font-semibold tracking-[-0.05em] text-balance">{title}</h2>
              {body ? <p className="mt-6 max-w-[46ch] text-lg leading-relaxed text-white/70">{body}</p> : null}
            </div>
            <div className="lg:col-span-4 lg:justify-self-end">
              <Button href={ACCESS_HREF} variant="light">
                Request access
              </Button>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
