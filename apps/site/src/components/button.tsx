import Link from 'next/link';
import { ArrowUpRight } from '@phosphor-icons/react/dist/ssr';

type Variant = 'primary' | 'secondary' | 'light';

type ButtonProps = {
  /** An internal path, an external URL or a mailto link. Leave out for a form submit button. */
  href?: string;
  children: React.ReactNode;
  variant?: Variant;
  /** A smaller pill without the arrow, for the nav. */
  compact?: boolean;
};

// One rule for every variant: the pill darkens to ink and its text goes white. Enter and leave are the same
// transition run forwards and back, so nothing can look half-way or broken when the cursor moves off.
const TONES: Record<Variant, { pill: string; disc: string }> = {
  primary: { pill: 'bg-cobalt text-white shadow-[0_14px_30px_-14px_rgb(30_101_227/0.7)] hover:bg-ink', disc: 'bg-white/15' },
  secondary: { pill: 'bg-surface text-ink ring-1 ring-ink/10 hover:bg-ink hover:text-white hover:ring-ink', disc: 'bg-ink/5 group-hover:bg-white/15' },
  // On a cobalt panel: a white pill, so the action stays the strongest thing in view.
  light: { pill: 'bg-white text-ink hover:bg-ink hover:text-white', disc: 'bg-cobalt text-white' },
};

/**
 * The call to action: a pill with its arrow in a circle. Hover darkens the pill, turns the arrow a quarter
 * turn and lifts the button a pixel. Press scales it down slightly.
 */
export function Button({ href, children, variant = 'primary', compact = false }: ButtonProps) {
  const tone = TONES[variant];
  const className = `group inline-flex items-center rounded-full text-[15px] font-medium whitespace-nowrap transition-[background-color,color,box-shadow,transform] duration-200 ease-out hover:-translate-y-px active:translate-y-0 active:scale-[0.98] motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${tone.pill} ${compact ? 'px-5 py-2.5 text-sm' : 'gap-3 py-2 pl-6 pr-2'}`;

  const content = (
    <>
      {children}
      {compact ? null : (
        <span className={`grid size-9 place-items-center rounded-full transition-colors duration-200 ease-out ${tone.disc}`}>
          <ArrowUpRight size={16} weight="bold" aria-hidden="true" className="transition-transform duration-200 ease-out group-hover:rotate-45 motion-reduce:transition-none" />
        </span>
      )}
    </>
  );

  if (!href) {
    return (
      <button type="submit" className={className}>
        {content}
      </button>
    );
  }
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
