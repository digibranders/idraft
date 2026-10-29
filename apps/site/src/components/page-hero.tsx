import Image from 'next/image';

import { ACCESS_HREF } from '@/content';

import { Button } from './button';

type PageHeroProps = {
  eyebrow?: string;
  title: React.ReactNode;
  lead: string;
  /** A picture in a bezel. Leave out when a `visual` carries the page. */
  image?: { src: string; alt: string };
  /** A live piece of the product (see components/mock), shown instead of a picture. */
  visual?: React.ReactNode;
  /** A soft abstract image behind the visual, for atmosphere only. */
  backdrop?: string;
  /** `frame` is a landscape bezel, `arch` a tall rounded arch. */
  shape?: 'frame' | 'arch';
  action?: boolean;
};

const rise = (index: number) => ({ '--i': index }) as React.CSSProperties;

/** The top of every inner page: large type on the left, a piece of the product (or one picture in a bezel) on the right. */
export function PageHero({ eyebrow, title, lead, image, visual, backdrop, shape = 'frame', action = true }: PageHeroProps) {
  const arch = shape === 'arch';
  return (
    <section className="relative isolate mx-auto grid max-w-[1320px] items-center gap-12 px-5 pt-36 pb-16 md:px-8 lg:min-h-[88dvh] lg:grid-cols-12 lg:gap-8 lg:pt-32">
      <div aria-hidden="true" className="absolute -top-40 -left-40 -z-10 size-[44rem] rounded-full bg-wash blur-[120px]" />
      <div className={visual ? 'lg:col-span-5' : 'lg:col-span-6'}>
        {eyebrow ? (
          <p className="rise mb-6 inline-block rounded-full bg-wash px-3 py-1 text-[11px] font-medium tracking-[0.18em] text-cobalt-deep uppercase" style={rise(0)}>
            {eyebrow}
          </p>
        ) : null}
        <h1 className="rise text-[clamp(2.6rem,5.4vw,5rem)] leading-[1] font-semibold tracking-[-0.055em] text-balance text-ink" style={rise(1)}>
          {title}
        </h1>
        <p className="rise mt-7 max-w-[44ch] text-lg leading-relaxed text-pretty text-ink-2 md:text-xl" style={rise(2)}>
          {lead}
        </p>
        {action ? (
          <div className="rise mt-9" style={rise(3)}>
            <Button href={ACCESS_HREF}>Request access</Button>
          </div>
        ) : null}
      </div>
      {visual ? (
        <div className="rise relative lg:col-span-7" style={rise(2)}>
          {backdrop ? (
            <div aria-hidden="true" className="absolute -inset-6 -z-10 overflow-hidden rounded-[3rem] opacity-60 [mask-image:radial-gradient(closest-side,black_55%,transparent)]">
              <Image src={backdrop} alt="" fill sizes="60vw" className="object-cover blur-[2px]" />
            </div>
          ) : null}
          {visual}
        </div>
      ) : image ? (
        <div className={`rise lg:col-span-6 ${arch ? 'lg:pl-16' : 'lg:pl-4'}`} style={rise(2)}>
          <div className={`rounded-[2rem] bg-ink/[0.04] p-1.5 shadow-lift ring-1 ring-ink/[0.06] ${arch ? 'mx-auto max-w-sm rounded-t-[12rem]' : ''}`}>
            <div className={`relative overflow-hidden ${arch ? 'aspect-[4/5] rounded-t-[11.6rem] rounded-b-[1.6rem]' : 'aspect-[4/3] rounded-[calc(2rem-0.375rem)]'}`}>
              <Image src={image.src} alt={image.alt} fill priority sizes="(min-width: 1024px) 48vw, 100vw" className="object-cover" />
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
