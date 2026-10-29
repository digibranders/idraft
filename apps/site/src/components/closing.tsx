import Image from 'next/image';

import { ACCESS_HREF, SIGN_IN_HREF } from '@/content';

import { Button } from './button';
import { Logo } from './logo';
import { Reveal } from './reveal';
import { Wordmark } from './wordmark';

const LINK = 'text-ink-2 transition duration-300 hover:text-cobalt-deep';

/** The closing call to action, then the footer: link columns and the oversized wordmark. */
export function Closing() {
  return (
    <footer className="relative isolate overflow-hidden">
      <Image src="/images/contour.png" alt="" fill sizes="100vw" className="-z-10 object-cover object-bottom opacity-80" />
      {/* The lines fade out toward the top so the headline and the link columns stay legible. */}
      <div aria-hidden="true" className="absolute inset-x-0 top-0 -z-10 h-3/5 bg-gradient-to-b from-paper via-paper/85 to-transparent" />
      <div className="mx-auto grid max-w-[1320px] gap-10 px-5 pt-28 pb-20 md:px-8 lg:grid-cols-12 lg:items-end lg:pt-40">
        <Reveal className="lg:col-span-8">
          <h2 className="text-[clamp(2.4rem,5.4vw,5rem)] leading-[1] font-semibold tracking-[-0.05em]">See your rank and your answer together.</h2>
        </Reveal>
        <Reveal delay={0.1} className="lg:col-span-4 lg:justify-self-end">
          <Button href={ACCESS_HREF}>Request access</Button>
        </Reveal>
      </div>

      <div className="mx-auto max-w-[1320px] px-5 md:px-8">
        <div className="grid gap-10 border-t border-ink/10 py-12 sm:grid-cols-2 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <Logo />
            <p className="mt-4 max-w-[34ch] leading-relaxed text-ink-2">Search rankings and AI answers on one record.</p>
          </div>
          <nav aria-label="Product" className="lg:col-span-3 lg:col-start-7">
            <p className="mb-4 text-sm text-ink-3">Product</p>
            <ul className="flex flex-col gap-3">
              <li><a className={LINK} href="#how">How it works</a></li>
              <li><a className={LINK} href="#product">Features</a></li>
              <li><a className={LINK} href="#faq">FAQ</a></li>
            </ul>
          </nav>
          <nav aria-label="Account" className="lg:col-span-3">
            <p className="mb-4 text-sm text-ink-3">Account</p>
            <ul className="flex flex-col gap-3">
              <li><a className={LINK} href={SIGN_IN_HREF}>Sign in</a></li>
              <li><a className={LINK} href="mailto:hello@idraft.ai">hello@idraft.ai</a></li>
            </ul>
          </nav>
        </div>
      </div>

      <Wordmark />
      <p className="mx-auto max-w-[1320px] px-5 pb-8 text-sm text-ink-3 md:px-8">© 2026 idraft.ai</p>
    </footer>
  );
}
