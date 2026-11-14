'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useRef, type ReactElement } from 'react';

import { visibleUrlText } from './visible-text';
import { Popover } from '@/components/ui/popover';
import { TextLink } from '@/components/ui/text-link';
import { Tooltip } from '@/components/ui/tooltip';
import { formatInteger } from '@/lib/format';
import { cn } from '@/lib/utils';

/** The neutral look of a badge (14-badges-status.md), which also holds a link and the overflow button. */
const CHIP =
  'inline-flex h-badge max-w-48 min-w-0 items-center rounded-sm border border-neutral-border bg-neutral-subtle px-2 type-micro text-neutral-text';

export interface DomainChipProps {
  /** `displayDomain` output. Untrusted: text only. */
  domain: string;
  /** The domain inspector. */
  href?: Route | undefined;
}

/** A cited source domain as a static chip, or a link to the domain inspector (23-application-patterns.md section 4.4). */
export function DomainChip({ domain, href }: DomainChipProps): ReactElement {
  // A bidi control in the domain would reorder its own text: it shows as its percent encoding
  const safe = visibleUrlText(domain);
  const value = useRef<HTMLSpanElement | null>(null);
  const isClipped = (): boolean => value.current !== null && value.current.scrollWidth > value.current.clientWidth;
  const text = (
    <span ref={value} data-truncate="" dir="ltr" className="block min-w-0 truncate">
      {safe}
    </span>
  );
  // The chip itself is the tooltip's trigger, so a linked chip shows the whole name on keyboard focus too
  return (
    <Tooltip content={safe} purpose="label" shouldOpen={isClipped}>
      {href === undefined ? (
        <span data-slot="domain-chip" className={CHIP}>
          {text}
        </span>
      ) : (
        <TextLink data-slot="domain-chip" render={<Link href={href} />} tone="inherit" className={CHIP}>
          {text}
        </TextLink>
      )}
    </Tooltip>
  );
}

export interface DomainChipListProps {
  /** Names the `ul`: "Cited sources". Also the overflow popover's title. */
  label: string;
  domains: readonly DomainChipProps[];
  /** Visible chips; the rest collapse into "+N". Default 3. */
  max?: number | undefined;
}

const DEFAULT_MAX = 3;

/** Up to `max` chips, then a "+N" chip that opens the rest in a popover. Nothing for no domains. */
export function DomainChipList({ label, domains, max = DEFAULT_MAX }: DomainChipListProps): ReactElement | null {
  const t = useTranslations('common.domainChip');
  if (domains.length === 0) return null;
  const visible = domains.slice(0, Math.max(0, max));
  const rest = domains.slice(visible.length);
  const count = formatInteger(rest.length);
  return (
    <ul aria-label={label} className="flex flex-wrap items-center gap-2">
      {visible.map((chip) => (
        <li key={chip.domain} className="flex min-w-0">
          <DomainChip {...chip} />
        </li>
      ))}
      {rest.length === 0 ? null : (
        <li className="flex">
          <Popover
            title={label}
            trigger={
              <button
                type="button"
                className={cn(CHIP, 'cursor-pointer hover:bg-neutral-border focus-visible:focus-ring')}
              >
                <span aria-hidden="true" className="num">{`+${count}`}</span>
                <span className="sr-only">{t('more', { count })}</span>
              </button>
            }
          >
            <ul className="flex flex-wrap gap-2">
              {rest.map((chip) => (
                <li key={chip.domain} className="flex min-w-0">
                  <DomainChip {...chip} />
                </li>
              ))}
            </ul>
          </Popover>
        </li>
      )}
    </ul>
  );
}
