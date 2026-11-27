'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { AlertTriangle, ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, type ReactElement, type ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { TextLink } from '@/components/ui/text-link';
import type { OutlineBlockId, OutlineTone } from '@/lib/pages/outline-model';
import { cn } from '@/lib/utils';

export interface OutlineBlockProps {
  id: OutlineBlockId;
  title: string;
  summary: string;
  tone: OutlineTone;
  open: boolean;
  onToggle: (id: OutlineBlockId) => void;
  children: ReactNode;
}

/**
 * One folding block of the Outline tab (spec 9.6.3): a card whose header is one button. It is the one card of an
 * inspector that folds (design system 16, section 2.4).
 */
export function OutlineBlock({ id, title, summary, tone, open, onToggle, children }: OutlineBlockProps): ReactElement {
  const t = useTranslations('pages.drawer.outline');
  const titleId = useId();
  const regionId = useId();
  return (
    <section className="min-w-0 rounded-lg border border-border bg-surface">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={regionId}
          onClick={() => onToggle(id)}
          className="flex min-h-12 w-full items-center gap-2 rounded-lg px-4 py-3 text-left focus-visible:focus-ring-inset"
        >
          <Icon
            icon={ChevronDown}
            size="default"
            className={cn('text-foreground-tertiary transition-transform duration-150', !open && '-rotate-90')}
          />
          <span id={titleId} className="shrink-0 type-subsection-title">
            {title}
          </span>
          <span className="min-w-0 flex-1 truncate type-meta text-foreground-secondary">{summary}</span>
          {tone === 'neutral' ? null : (
            <Badge tone={tone === 'ok' ? 'positive' : 'warning'}>{tone === 'ok' ? t('fine') : t('toFix')}</Badge>
          )}
        </button>
      </h3>
      <div id={regionId} role="region" aria-labelledby={titleId} hidden={!open}>
        <div className="flex min-w-0 flex-col gap-3 px-4 pb-4">{children}</div>
      </div>
    </section>
  );
}

/** A finding: a warning icon, the sentence, and "See in Issues" only when the host gave a route (spec 9.6.3). */
export function OutlineFindingRow({ text, href }: { text: string; href: Route | null }): ReactElement {
  const t = useTranslations('pages.drawer.outline');
  return (
    <li className="flex flex-wrap items-start gap-x-2 gap-y-1">
      <Icon icon={AlertTriangle} size="sm" className="mt-1 text-warning-text" />
      <span className="min-w-0 flex-1 type-body wrap-anywhere">{text}</span>
      {href === null ? null : (
        <TextLink render={<Link href={href} />} className="type-meta">
          {t('seeInIssues')}
        </TextLink>
      )}
    </li>
  );
}

/** A label and its value; it goes inside a `dl`. */
export function OutlineFact({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="type-label text-foreground-tertiary">{label}</dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 type-body wrap-anywhere">{children}</dd>
    </div>
  );
}

/** The bar is decoration; the label beside it carries the verdict (spec 9.6.3). */
export function LengthMeter({
  chars,
  max,
  ok,
  label,
}: {
  chars: number;
  max: number;
  ok: boolean;
  label: string;
}): ReactElement {
  // A computed size, not a design token
  const width = `${String(Math.round(Math.min(1, chars / max) * 100))}%`;
  return (
    <div className="flex w-full flex-col gap-1">
      <div aria-hidden="true" className="h-1 w-full overflow-hidden rounded-xs bg-surface-subtle">
        <div className={cn('h-full', ok ? 'bg-positive-solid' : 'bg-warning-solid')} style={{ width }} />
      </div>
      <span className="type-meta text-foreground-secondary">{label}</span>
    </div>
  );
}
