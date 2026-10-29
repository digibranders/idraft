import Link from 'next/link';
import { ArrowUpRight } from '@phosphor-icons/react/dist/ssr';

type ButtonProps = {
  href: string;
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'light';
};

const TONES = {
  primary: ['bg-cobalt text-white shadow-[0_14px_30px_-14px_rgb(30_101_227/0.7)] hover:bg-cobalt-deep', 'bg-white/15'],
  secondary: ['bg-surface text-ink ring-1 ring-ink/10 hover:ring-ink/30', 'bg-ink/5'],
  // On a cobalt panel: a white pill so the action stays the brightest thing in view.
  light: ['bg-white text-ink hover:bg-white/90', 'bg-cobalt text-white'],
} as const;

/** Pill button with the arrow nested in its own circle, which moves on hover. */
export function Button({ href, children, variant = 'primary' }: ButtonProps) {
  const [tone, disc] = TONES[variant];
  const className = `group inline-flex items-center gap-3 rounded-full py-2 pl-6 pr-2 text-[15px] font-medium whitespace-nowrap transition duration-500 ease-heavy active:scale-[0.98] ${tone}`;
  const content = (
    <>
      {children}
      <span
        className={`grid size-9 place-items-center rounded-full transition duration-500 ease-heavy group-hover:-translate-y-px group-hover:translate-x-0.5 group-hover:scale-105 ${disc}`}
      >
        <ArrowUpRight size={16} weight="bold" aria-hidden="true" />
      </span>
    </>
  );
  return href.startsWith('/') ? (
    <Link href={href} className={className}>
      {content}
    </Link>
  ) : (
    <a href={href} className={className}>
      {content}
    </a>
  );
}
