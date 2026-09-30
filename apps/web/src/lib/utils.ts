import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

import {
  FOCUS_RINGS,
  NAMED_ANIMATIONS,
  NAMED_CONTAINERS,
  NAMED_EASINGS,
  NAMED_RADII,
  NAMED_SHADOWS,
  NAMED_SIZES,
  TYPE_STYLES,
} from './design/class-names';

const merge = extendTailwindMerge<'type-style' | 'focus-ring'>({
  extend: {
    theme: {
      spacing: [...NAMED_SIZES],
      container: [...NAMED_CONTAINERS],
      radius: [...NAMED_RADII],
      shadow: [...NAMED_SHADOWS],
      ease: [...NAMED_EASINGS],
      animate: [...NAMED_ANIMATIONS],
    },
    classGroups: {
      // The composite type utilities (03-typography.md section 2): one per element, the last one wins.
      'type-style': [{ type: [...TYPE_STYLES] }],
      'focus-ring': [...FOCUS_RINGS],
    },
    // A focus ring is an outline, so it replaces an outline class written before it, such as outline-none.
    conflictingClassGroups: { 'focus-ring': ['outline-style', 'outline-w', 'outline-offset', 'outline-color'] },
  },
});

/** Joins class names, drops falsy ones, and lets a later class override an earlier one that sets the same thing. */
export function cn(...inputs: ClassValue[]): string {
  return merge(clsx(inputs));
}
