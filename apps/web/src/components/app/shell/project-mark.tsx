'use client';

import { useState, type ReactElement } from 'react';

import { FAVICON_MIN_WIDTH, faviconUrl } from '@/lib/favicon';
import { cn } from '@/lib/utils';

const TILE = { sm: 'size-7 rounded-md', md: 'size-8 rounded-lg' } as const;
const ICON = { sm: 'size-4', md: 'size-5' } as const;

export interface ProjectMarkProps {
  name: string;
  /** The project's primary domain, whose icon is the mark; without one, or until the icon arrives, the first letter is. */
  domain?: string | null | undefined;
  /** `sm`: 28 px, in the project list. `md`: 32 px, in the project switcher. */
  size?: keyof typeof TILE;
}

/**
 * The project's mark (11-navigation.md section 8, 07-icons.md section 5): the icon of its website on a light
 * tile, found from the primary domain with no one uploading anything, or its first letter on the near-black
 * tile where the site has no icon or it has not loaded. The project's name is always beside it or in a
 * tooltip, so the mark is decorative.
 */
export function ProjectMark({ name, domain = null, size = 'sm' }: ProjectMarkProps): ReactElement {
  // A new domain is a new icon, so it starts again from the letter
  return domain === null ? (
    <Letter name={name} size={size} />
  ) : (
    <WebsiteIcon key={domain} name={name} domain={domain} size={size} />
  );
}

function Letter({ name, size }: Readonly<{ name: string; size: keyof typeof TILE }>): ReactElement {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center bg-foreground type-subsection-title text-foreground-inverse dark:bg-primary dark:text-primary-foreground',
        TILE[size],
      )}
    >
      {[...name.trim()][0]?.toUpperCase() ?? ''}
    </span>
  );
}

function WebsiteIcon({
  name,
  domain,
  size,
}: Readonly<{ name: string; domain: string; size: keyof typeof TILE }>): ReactElement {
  const [found, setFound] = useState<boolean | null>(null);
  const settle = (image: HTMLImageElement): void => setFound(image.naturalWidth >= FAVICON_MIN_WIDTH);
  return (
    <>
      {found === true ? null : <Letter name={name} size={size} />}
      <span
        aria-hidden="true"
        className={cn(
          // Light in both themes: an icon is drawn for a light page, and many are dark
          'shrink-0 items-center justify-center bg-surface ring-1 ring-border dark:bg-foreground',
          found === true ? 'flex' : 'hidden',
          TILE[size],
        )}
      >
        {/* A plain image: the service is the one the CSP names, and the size is not one Next could optimize */}
        {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
        <img
          // An icon from the cache is complete before React listens for it
          ref={(image) => {
            if (image?.complete === true && found === null) settle(image);
          }}
          src={faviconUrl(domain)}
          alt=""
          width={64}
          height={64}
          referrerPolicy="no-referrer"
          decoding="async"
          draggable={false}
          onLoad={(event) => settle(event.currentTarget)}
          onError={() => setFound(false)}
          className={ICON[size]}
        />
      </span>
    </>
  );
}
