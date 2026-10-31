import Image from 'next/image';
import { MagnifyingGlass, ChatCircleDots, Plus } from '@phosphor-icons/react/dist/ssr';
import type { ReactElement } from 'react';

import { ACCESS_HREF } from '@/content';

import { Button } from './button';
import { Reveal } from './reveal';

type CtaBandProps = { title: string; body?: string };

/** A closing invitation that brings search rankings and AI answers into one illustrated scene. */
export function CtaBand({ title, body }: CtaBandProps): ReactElement {
  return (
    <section aria-label="Request access to idraft" className="mx-auto max-w-[1320px] px-5 py-8 md:px-8 lg:py-12">
      <Reveal>
        <div className="rounded-[2rem]">
          <div className="grid gap-9 overflow-hidden rounded-[2rem] bg-cobalt-deep p-6 text-white sm:p-9 md:grid-cols-2 md:items-center lg:grid-cols-12 lg:gap-12 lg:p-14">
            <div className="lg:col-span-7">
              <h2 className="max-w-[16ch] text-[clamp(2.2rem,4.5vw,4rem)] leading-[1.03] font-semibold tracking-[-0.05em] text-balance">{title}</h2>
              {body ? <p className="mt-5 max-w-[40ch] text-base leading-relaxed text-white/90 lg:text-lg">{body}</p> : null}
              <div className="mt-7 w-fit rounded-full focus-within:outline-2 focus-within:outline-offset-4 focus-within:outline-white">
                <Button href={ACCESS_HREF} variant="light">
                  Request access
                </Button>
              </div>
            </div>
            <div className="relative rounded-[1.5rem] bg-paper p-3 text-ink shadow-[0_20px_40px_-24px_rgb(8_35_92/0.55)] sm:p-4 lg:col-span-5">
              <div className="relative aspect-square">
                <Image src="/images/scenes/cta-together.webp" alt="" fill sizes="(min-width: 1320px) 420px, (min-width: 768px) 38vw, 80vw" className="object-contain" />
              </div>
              <div className="flex items-center justify-center gap-3 border-t border-ink/10 px-1 pt-4 pb-1 text-[11px] font-medium sm:text-xs">
                <span className="flex items-center gap-1.5"><MagnifyingGlass size={16} aria-hidden="true" />Search rankings</span>
                <Plus size={13} aria-hidden="true" className="shrink-0 text-cobalt" />
                <span className="flex items-center gap-1.5"><ChatCircleDots size={16} aria-hidden="true" />AI answers</span>
              </div>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
