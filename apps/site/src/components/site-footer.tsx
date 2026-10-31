import Image from 'next/image';
import Link from 'next/link';

import { CONTACT_EMAIL, NAV_LINKS, PRODUCT_LINKS, SIGN_IN_HREF } from '@/content';

import { Logo } from './logo';
import { Wordmark } from './wordmark';

const LINK = 'text-ink-2 transition duration-300 hover:text-cobalt-deep';

/** The global footer: link columns, then the oversized wordmark over a contour field. */
export function SiteFooter() {
  return (
    <footer className="relative isolate mt-8 overflow-hidden">
      <Image src="/images/contour.png" alt="" fill sizes="100vw" className="-z-10 object-cover object-bottom opacity-80" />
      {/* The lines fade out toward the top so the link columns stay legible. */}
      <div aria-hidden="true" className="absolute inset-x-0 top-0 -z-10 h-3/5 bg-gradient-to-b from-paper via-paper/85 to-transparent" />

      <div className="mx-auto max-w-[1320px] px-5 md:px-8">
        <div className="grid gap-10 border-t border-ink/10 py-14 sm:grid-cols-2 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <Logo />
            <p className="mt-4 max-w-[34ch] leading-relaxed text-ink-2">Search rankings and AI answers on one record, with every number showing its evidence.</p>
          </div>
          <nav aria-label="Product" className="lg:col-span-2 lg:col-start-7">
            <p className="mb-4 text-sm text-ink-3">Product</p>
            <ul className="flex flex-col gap-3">
              <li><Link className={LINK} href="/product">Overview</Link></li>
              {PRODUCT_LINKS.map((item) => (
                <li key={item.href}><Link className={LINK} href={item.href}>{item.label}</Link></li>
              ))}
            </ul>
          </nav>
          <nav aria-label="Company" className="lg:col-span-2">
            <p className="mb-4 text-sm text-ink-3">Company</p>
            <ul className="flex flex-col gap-3">
              {NAV_LINKS.map((item) => (
                <li key={item.href}><Link className={LINK} href={item.href}>{item.label}</Link></li>
              ))}
              <li><a className={LINK} href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a></li>
            </ul>
          </nav>
          <nav aria-label="Account" className="lg:col-span-2">
            <p className="mb-4 text-sm text-ink-3">Account</p>
            <ul className="flex flex-col gap-3">
              <li><a className={LINK} href={SIGN_IN_HREF}>Sign in</a></li>
              <li><Link className={LINK} href="/request-access">Request access</Link></li>
            </ul>
          </nav>
        </div>
      </div>

      <Wordmark />
      <p className="mx-auto max-w-[1320px] px-5 pb-8 text-sm text-ink-3 md:px-8">© 2026 idraft.ai</p>
    </footer>
  );
}
