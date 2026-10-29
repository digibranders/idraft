'use client';

import { useEffect, useState } from 'react';

import { ACCESS_HREF, NAV_LINKS } from '@/content';

import { Logo } from './logo';

/*
 * z-index scale: overlay 30, nav 40, grain 60. The nav stays above the overlay so its toggle stays usable.
 * The nav is a floating glass pill; on small screens the toggle morphs into an X and the links reveal in a stagger.
 */
export function Nav() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <>
      <header className="fixed inset-x-0 top-4 z-40 flex justify-center px-4">
        <nav
          aria-label="Primary"
          className="flex w-full max-w-3xl items-center justify-between rounded-full bg-surface/75 py-2 pl-5 pr-2 shadow-[0_18px_50px_-24px_rgb(20_23_28/0.25)] ring-1 ring-ink/[0.07] backdrop-blur-xl"
        >
          <a href="#top" aria-label="idraft home" onClick={() => setOpen(false)}>
            <Logo />
          </a>
          <ul className="hidden items-center gap-1 md:flex">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  className="rounded-full px-4 py-2 text-sm text-ink-2 transition duration-300 ease-heavy hover:bg-ink/5 hover:text-ink"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-1">
            <a
              href={ACCESS_HREF}
              className="hidden rounded-full bg-cobalt px-5 py-2.5 text-sm font-medium whitespace-nowrap text-white transition duration-500 ease-heavy hover:bg-cobalt-deep active:scale-[0.98] sm:inline-block"
            >
              Request access
            </a>
            <button
              type="button"
              aria-expanded={open}
              aria-controls="mobile-menu"
              aria-label={open ? 'Close menu' : 'Open menu'}
              onClick={() => setOpen((value) => !value)}
              className="relative grid size-10 place-items-center rounded-full transition duration-300 hover:bg-ink/5 md:hidden"
            >
              <span
                className={`absolute h-0.5 w-[18px] rounded-full bg-ink transition duration-500 ease-heavy ${open ? 'rotate-45' : '-translate-y-[3px]'}`}
              />
              <span
                className={`absolute h-0.5 w-[18px] rounded-full bg-ink transition duration-500 ease-heavy ${open ? '-rotate-45' : 'translate-y-[3px]'}`}
              />
            </button>
          </div>
        </nav>
      </header>

      <div
        id="mobile-menu"
        aria-hidden={!open}
        className={`fixed inset-0 z-30 bg-paper/85 backdrop-blur-2xl transition duration-500 ease-heavy md:hidden ${open ? 'visible opacity-100' : 'invisible opacity-0'}`}
      >
        <ul className="flex h-full flex-col justify-center gap-2 px-8 pt-16">
          {[...NAV_LINKS, { label: 'Request access', href: ACCESS_HREF }].map((link, index) => (
            <li key={link.href} className="overflow-hidden">
              <a
                href={link.href}
                tabIndex={open ? 0 : -1}
                onClick={() => setOpen(false)}
                style={{ transitionDelay: open ? `${index * 70 + 120}ms` : '0ms' }}
                className={`block py-2 text-4xl font-semibold tracking-[-0.04em] text-ink transition duration-700 ease-heavy ${open ? 'translate-y-0 opacity-100' : 'translate-y-12 opacity-0'}`}
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
