import { ArrowUpRight } from '@phosphor-icons/react/dist/ssr';

type ButtonProps = {
  href: string;
  children: React.ReactNode;
  variant?: 'primary' | 'secondary';
};

/** Pill button with the arrow nested in its own circle, which moves on hover. */
export function Button({ href, children, variant = 'primary' }: ButtonProps) {
  const tone =
    variant === 'primary'
      ? 'bg-cobalt text-white hover:bg-cobalt-deep'
      : 'bg-surface text-ink ring-1 ring-ink/10 hover:ring-ink/30';
  const disc = variant === 'primary' ? 'bg-white/15' : 'bg-ink/5';
  return (
    <a
      href={href}
      className={`group inline-flex items-center gap-3 rounded-full py-2 pl-6 pr-2 text-[15px] font-medium whitespace-nowrap transition duration-500 ease-heavy active:scale-[0.98] ${tone}`}
    >
      {children}
      <span
        className={`grid size-9 place-items-center rounded-full transition duration-500 ease-heavy group-hover:-translate-y-px group-hover:translate-x-0.5 group-hover:scale-105 ${disc}`}
      >
        <ArrowUpRight size={16} weight="bold" aria-hidden="true" />
      </span>
    </a>
  );
}
