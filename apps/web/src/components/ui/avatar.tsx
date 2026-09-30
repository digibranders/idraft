import { Avatar as AvatarPrimitive } from '@base-ui/react/avatar';
import type { ReactElement } from 'react';

import { cn } from '@/lib/utils';

export interface AvatarProps extends Omit<AvatarPrimitive.Root.Props, 'children' | 'className' | 'render'> {
  /** The person's name. Its initials show when there is no photo, or while and if the photo fails to load. */
  name: string;
  imageUrl?: string | null | undefined;
  /** 20 or 32 px. */
  size?: 'sm' | 'md' | undefined;
  className?: string | undefined;
}

/** Up to two initials: the first letters of the first and the last word of the name. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0];
  const last = words.length > 1 ? words[words.length - 1] : undefined;
  return [first, last]
    .map((word) => (word ? [...word][0] : ''))
    .join('')
    .toUpperCase();
}

/**
 * A person's photo or initials (11-navigation.md section 4). It is decorative: the name is always beside
 * it, or on the button that contains it, so the image has no text alternative of its own.
 */
export function Avatar({ name, imageUrl, size = 'md', className, ...props }: AvatarProps): ReactElement {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      aria-hidden="true"
      {...props}
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-neutral-subtle type-micro text-neutral-text select-none',
        size === 'md' ? 'size-avatar' : 'size-5',
        className,
      )}
    >
      {imageUrl ? <AvatarPrimitive.Image src={imageUrl} alt="" className="size-full object-cover" /> : null}
      <AvatarPrimitive.Fallback>
        {size === 'md' ? initialsOf(name) : initialsOf(name).slice(0, 1)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}
