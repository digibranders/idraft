import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

type KeywordKey = 'one' | 'two' | 'three' | 'four' | 'five';

interface LadderRow {
  key: KeywordKey;
  position: number;
  /** Positive: moved up. Negative: moved down. Zero: unchanged. */
  change: number;
  /** The row's indent, which makes the stack read as a ladder. */
  indent: string;
}

const LADDER: readonly LadderRow[] = [
  { key: 'one', position: 1, change: 3, indent: 'ml-0' },
  { key: 'two', position: 3, change: 1, indent: 'ml-4' },
  { key: 'three', position: 4, change: 0, indent: 'ml-8' },
  { key: 'four', position: 7, change: -2, indent: 'ml-12' },
  { key: 'five', position: 9, change: 2, indent: 'ml-16' },
];

function ChangeMark({ change }: Readonly<{ change: number }>): ReactNode {
  const tone = change > 0 ? 'text-positive-text' : change < 0 ? 'text-negative-text' : 'text-foreground-tertiary';
  const Icon = change > 0 ? ArrowUp : change < 0 ? ArrowDown : Minus;
  return (
    <span className={cn('flex items-center gap-1 num type-micro', tone)}>
      <Icon className="size-icon-sm" />
      {change === 0 ? null : Math.abs(change)}
    </span>
  );
}

/**
 * The brand panel of the auth split layout. It repeats nothing the form does not say and holds nothing to
 * operate, so it is hidden from assistive technology. Below 1024 px only the brand line and one sentence show.
 */
export async function AuthShowcase(): Promise<ReactNode> {
  const [app, t] = await Promise.all([getTranslations('app'), getTranslations('auth.showcase')]);
  return (
    <aside
      aria-hidden="true"
      className="relative flex flex-col gap-3 overflow-hidden border-b border-border bg-surface-subtle px-4 py-5 lg:min-h-dvh lg:w-5/12 lg:justify-between lg:gap-10 lg:border-r lg:border-b-0 lg:p-12"
    >
      <div className="showcase-grid pointer-events-none absolute inset-0 hidden opacity-60 lg:block" />
      <div className="relative flex animate-showcase-in flex-col gap-3">
        <p className="type-section-title text-primary-text">{app('name')}</p>
        <p className="type-body text-foreground-secondary lg:hidden">{t('compactTagline')}</p>
      </div>
      <div className="relative hidden animate-showcase-in flex-col gap-4 lg:flex">
        <p className="max-w-dialog-sm type-page-title text-foreground">{t('statement')}</p>
        <p className="max-w-dialog-sm type-body text-foreground-secondary">{t('tagline')}</p>
      </div>
      <ul className="relative hidden animate-showcase-rise flex-col gap-3 lg:flex">
        {LADDER.map((row) => (
          <li
            key={row.key}
            className={cn(
              'flex h-control-lg items-center gap-3 rounded-lg border border-border bg-surface px-4 shadow-popover',
              row.indent,
            )}
          >
            <span className="w-6 num type-metric-sm">{row.position}</span>
            <span className="min-w-0 flex-1 truncate type-body text-foreground-secondary">
              {t(`keywords.${row.key}`)}
            </span>
            <ChangeMark change={row.change} />
          </li>
        ))}
      </ul>
    </aside>
  );
}
