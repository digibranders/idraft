'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { CaretDown, ChartLineUp, ChatsCircle, Graph } from '@phosphor-icons/react';

import { ACCESS_HREF, NAV_LINKS, PRODUCT_LINKS } from '@/content';

import { Button } from './button';
import { Logo } from './logo';

const ICONS = [ChartLineUp, ChatsCircle, Graph] as const;

/*
 * z-index scale: overlay 30, nav 40, grain 60. The nav stays above the overlay so its toggle stays usable.
 * A floating glass pill with a product menu that opens on hover or focus. On small screens the toggle morphs
 * into an X and the links reveal in a stagger.
 */
export function Nav() {
  const pathname = usePathname();
  // Each flag remembers the route it was opened on, so a route change closes both without an effect.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const [menuOn, setMenuOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const menu = menuOn === pathname;
  const setOpen = (next: boolean | ((value: boolean) => boolean)) => setOpenOn((typeof next === 'function' ? next(open) : next) ? pathname : null);
  const setMenu = (next: boolean | ((value: boolean) => boolean)) => setMenuOn((typeof next === 'function' ? next(menu) : next) ? pathname : null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenOn(null);
        setMenuOn(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const showMenu = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setMenu(true);
  };
  const hideMenu = () => {
    closeTimer.current = setTimeout(() => setMenu(false), 140);
  };

  const link = (href: string) =>
    `rounded-full px-4 py-2 text-sm transition duration-300 ease-heavy hover:bg-ink/5 hover:text-ink ${pathname === href ? 'text-ink' : 'text-ink-2'}`;

  return (
    <>
      <header className="fixed inset-x-0 top-4 z-40 flex justify-center px-4">
        <div className="relative w-full max-w-3xl" onMouseLeave={hideMenu}>
          <nav
            aria-label="Primary"
            className="flex items-center justify-between rounded-full bg-surface/75 py-2 pl-5 pr-2 shadow-[0_18px_50px_-24px_rgb(20_23_28/0.25)] ring-1 ring-ink/[0.07] backdrop-blur-xl"
          >
            <Link href="/" aria-label="idraft home">
              <Logo />
            </Link>
            <ul className="hidden items-center gap-1 md:flex">
              <li onMouseEnter={showMenu}>
                <button
                  type="button"
                  aria-expanded={menu}
                  aria-controls="product-menu"
                  onClick={() => setMenu((value) => !value)}
                  onFocus={showMenu}
                  className={`${link('/product')} inline-flex items-center gap-1`}
                >
                  Product
                  <CaretDown size={12} weight="bold" aria-hidden="true" className={`transition duration-500 ease-heavy ${menu ? 'rotate-180' : ''}`} />
                </button>
              </li>
              {NAV_LINKS.map((item) => (
                <li key={item.href} onMouseEnter={hideMenu}>
                  <Link href={item.href} className={link(item.href)}>
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
            <div className="flex items-center gap-1">
              <span className="hidden sm:inline-flex">
                <Button href={ACCESS_HREF} compact>
                  Request access
                </Button>
              </span>
              <button
                type="button"
                aria-expanded={open}
                aria-controls="mobile-menu"
                aria-label={open ? 'Close menu' : 'Open menu'}
                onClick={() => setOpen((value) => !value)}
                className="relative grid size-10 place-items-center rounded-full transition duration-300 hover:bg-ink/5 md:hidden"
              >
                <span className={`absolute h-0.5 w-[18px] rounded-full bg-ink transition duration-500 ease-heavy ${open ? 'rotate-45' : '-translate-y-[3px]'}`} />
                <span className={`absolute h-0.5 w-[18px] rounded-full bg-ink transition duration-500 ease-heavy ${open ? '-rotate-45' : 'translate-y-[3px]'}`} />
              </button>
            </div>
          </nav>

          <AnimatePresence>
            {menu && (
              <motion.div
                id="product-menu"
                initial={{ opacity: 0, y: -8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.98 }}
                transition={{ duration: 0.35, ease: [0.32, 0.72, 0, 1] }}
                onMouseEnter={showMenu}
                className="absolute inset-x-0 top-full mt-3 hidden rounded-[2rem] bg-surface/85 p-2 shadow-lift ring-1 ring-ink/[0.07] backdrop-blur-2xl md:block"
              >
                <ul className="grid grid-cols-3 gap-1">
                  {PRODUCT_LINKS.map((item, index) => {
                    const Icon = ICONS[index] ?? ChartLineUp;
                    return (
                      <li key={item.href}>
                        <Link href={item.href} className="group flex h-full flex-col gap-3 rounded-[1.5rem] p-5 transition duration-500 ease-heavy hover:bg-wash">
                          <Icon size={30} weight="thin" aria-hidden="true" className="text-ink transition duration-500 ease-heavy group-hover:text-cobalt" />
                          <span className="text-[15px] font-medium tracking-[-0.02em]">{item.label}</span>
                          <span className="text-sm leading-snug text-ink-3">{item.body}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
                <Link href="/product" className="mt-1 flex items-center justify-between rounded-[1.5rem] px-5 py-3 text-sm text-ink-2 transition duration-300 hover:bg-ink/5 hover:text-ink">
                  See the whole product
                  <span aria-hidden="true">→</span>
                </Link>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </header>

      <div
        id="mobile-menu"
        aria-hidden={!open}
        className={`fixed inset-0 z-30 overflow-y-auto bg-paper/90 backdrop-blur-2xl transition duration-500 ease-heavy md:hidden ${open ? 'visible opacity-100' : 'invisible opacity-0'}`}
      >
        <ul className="flex min-h-full flex-col justify-center gap-1 px-8 pt-24 pb-12">
          {[{ label: 'Product', href: '/product' }, ...PRODUCT_LINKS.map((p) => ({ label: p.label, href: p.href })), ...NAV_LINKS, { label: 'Request access', href: ACCESS_HREF }].map((item, index) => {
            const sub = PRODUCT_LINKS.some((p) => p.href === item.href);
            return (
              <li key={item.href} className="overflow-hidden">
                <Link
                  href={item.href}
                  tabIndex={open ? 0 : -1}
                  style={{ transitionDelay: open ? `${index * 60 + 120}ms` : '0ms' }}
                  className={`block py-1.5 font-semibold tracking-[-0.04em] text-ink transition duration-700 ease-heavy ${sub ? 'pl-5 text-2xl text-ink-2' : 'text-4xl'} ${open ? 'translate-y-0 opacity-100' : 'translate-y-12 opacity-0'}`}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}
