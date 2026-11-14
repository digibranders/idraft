'use client';

import { TriangleAlert } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState, type MouseEvent, type ReactElement } from 'react';

import { visibleUrlText } from './visible-text';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { TextLink } from '@/components/ui/text-link';
import { Tooltip } from '@/components/ui/tooltip';
import type { components } from '@/lib/api/schema';
import { normalizeDomain } from '@/lib/domains/normalize';
import { FAVICON_MIN_WIDTH, faviconUrl } from '@/lib/favicon';
import { displayDomain } from '@/lib/format';
import { CELL_CONTROL } from '@/lib/tables/grid-focus';
import { cn } from '@/lib/utils';

/** The API's role of a cited domain; follows the schema when it changes. */
export type DomainRole = components['schemas']['CitationRow']['domain_role'];

/**
 * `show`: the site's icon from the allowlisted endpoint, the placeholder square until it loads and when the
 * service has none or it fails. `hide`: the placeholder square only (the setting is off). Left out of a part's
 * props: no icon slot at all (not a domain-first table, 07-icons.md section 5).
 */
export type FaviconMode = 'show' | 'hide';

const stop = (event: MouseEvent): void => event.stopPropagation();
/** In a grid the link is a cell control, and a click on it is its own: the row does not open. */
const GRID_LINK = { ...CELL_CONTROL, onClick: stop, onAuxClick: stop };

const ROLE_KEY = { own: 'own', competitor: 'competitor', third_party: 'thirdParty' } as const;

export interface FaviconProps {
  host: string;
  mode: FaviconMode;
}

/**
 * A 16 px box that holds the site's icon over a neutral square. The square is what shows until the icon has
 * loaded, where the service has none (it sends a 16 px globe) and when it fails; the icon is never hidden with
 * `display: none`, since a browser does not fetch a lazy image it does not lay out. A host `normalizeDomain`
 * refuses (not a public name, or not a name at all) is never sent to the service.
 */
export function Favicon({ host, mode }: FaviconProps): ReactElement {
  // `normalizeDomain` takes a scheme, a path and a query: only its bare `domain` may leave for the service
  const normalized = mode === 'show' ? normalizeDomain(host) : null;
  return (
    <span data-slot="favicon" aria-hidden="true" className="relative size-icon shrink-0">
      {normalized?.ok === true ? <FaviconImage key={normalized.domain} domain={normalized.domain} /> : <Square />}
    </span>
  );
}

const Square = (): ReactElement => (
  <span data-slot="favicon-placeholder" className="absolute inset-0 rounded-xs bg-neutral-subtle ring-1 ring-border" />
);

function FaviconImage({ domain }: Readonly<{ domain: string }>): ReactElement {
  const [found, setFound] = useState<boolean | null>(null);
  const settle = (image: HTMLImageElement): void => setFound(image.naturalWidth >= FAVICON_MIN_WIDTH);
  return (
    <>
      {found === true ? null : <Square />}
      {/* A plain image: the service is the one the CSP names, and the size is not one Next could optimize */}
      {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
      <img
        // An icon from the cache is complete before React listens for it
        ref={(image) => {
          if (image?.complete === true && image.naturalWidth > 0 && found === null) settle(image);
        }}
        src={faviconUrl(domain)}
        alt=""
        width={16}
        height={16}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        draggable={false}
        onLoad={(event) => settle(event.currentTarget)}
        onError={() => setFound(false)}
        className={cn('absolute inset-0 size-icon', found !== true && 'opacity-0')}
      />
    </>
  );
}

/**
 * "docs.hubspot.com" with "hubspot.com" is the prefix "docs." and the registrable domain. A host that does not
 * end in its registrable domain (bad data) is all registrable, so nothing is hidden. Both go through
 * `displayDomain`.
 */
export function splitHost(host: string, registrable: string): { prefix: string; registrable: string } {
  const full = displayDomain(host);
  const base = displayDomain(registrable);
  if (full === base || !full.endsWith(`.${base}`)) return { prefix: '', registrable: full };
  return { prefix: full.slice(0, full.length - base.length), registrable: base };
}

/** A neutral badge with the word: Own, Competitor, Third party. For Role columns. */
export function DomainRoleBadge({ role }: { role: DomainRole }): ReactElement {
  const t = useTranslations('common.domainCell.roles');
  return <Badge>{t(ROLE_KEY[role])}</Badge>;
}

export interface DomainCellProps {
  /** As the API sent it. Untrusted: text only. */
  host: string;
  /** The API's `registrable_domain`. Always visible: the subdomain prefix gives way first. */
  registrable: string;
  /** Own and competitor get a badge; a third party none. Own also sets `primary-text`. */
  role?: DomainRole | undefined;
  favicon?: FaviconMode | undefined;
  /** The domain inspector, built by the caller. Without it the domain is text. */
  href?: Route | undefined;
  /** A warning icon named "Redirect not resolved". */
  unresolvedRedirect?: boolean | undefined;
  /** Added to the tooltip after the full host: "Review site". */
  category?: string | undefined;
  /**
   * `grid` (default): the link carries `CELL_CONTROL` (F2 reaches it) and stops click propagation so the row does
   * not open. `list`: an ordinary tab stop (popover rows, inspector lists).
   */
  context?: 'grid' | 'list' | undefined;
}

/**
 * A domain in a table or a list (12-tables.md section 6): the registrable part in the foreground color, the
 * subdomain prefix in the tertiary one and the part that gives way first, an icon in domain-first tables, a
 * badge for the own and competitor roles. The host is always text, whatever the API sent.
 */
export function DomainCell({
  host,
  registrable,
  role,
  favicon,
  href,
  unresolvedRedirect = false,
  category,
  context = 'grid',
}: DomainCellProps): ReactElement {
  const t = useTranslations('common.domainCell');
  const split = splitHost(host, registrable);
  // A bidi control in an API host would reorder its own text: it shows as its percent encoding
  const prefix = visibleUrlText(split.prefix);
  const base = visibleUrlText(split.registrable);
  const own = role === 'own';
  const name = (
    <>
      {prefix === '' ? null : (
        <span aria-hidden="true" className="min-w-0 shrink-100 truncate text-foreground-tertiary">
          {prefix}
        </span>
      )}
      <span
        aria-hidden={prefix === '' ? undefined : 'true'}
        className={cn('min-w-0 shrink truncate', own ? 'type-table-strong text-primary-text' : 'text-foreground')}
      >
        {base}
      </span>
      {prefix === '' ? null : <span className="sr-only">{`${prefix}${base}`}</span>}
    </>
  );
  return (
    <span data-slot="domain-cell" className="flex min-w-0 items-center gap-1.5 font-mono type-table">
      {favicon === undefined ? null : <Favicon host={host} mode={favicon} />}
      <Tooltip
        content={visibleUrlText(displayDomain(host))}
        {...(category === undefined ? {} : { detail: category })}
        purpose="label"
      >
        <span dir="ltr" className="flex min-w-0 items-baseline">
          {href === undefined ? (
            name
          ) : (
            <TextLink
              render={<Link href={href} />}
              tone="inherit"
              className="flex min-w-0 items-baseline"
              {...(context === 'grid' ? GRID_LINK : {})}
            >
              {name}
            </TextLink>
          )}
        </span>
      </Tooltip>
      {/* The tooltip is for the eye; the category is text a screen reader and a keyboard user reach */}
      {category === undefined ? null : <span className="sr-only">{category}</span>}
      {role === 'own' || role === 'competitor' ? <DomainRoleBadge role={role} /> : null}
      {unresolvedRedirect ? (
        <Tooltip content={t('redirect')} purpose="label">
          <span className="flex shrink-0 text-warning-text">
            <Icon icon={TriangleAlert} size="sm" label={t('redirect')} />
          </span>
        </Tooltip>
      ) : null}
    </span>
  );
}
