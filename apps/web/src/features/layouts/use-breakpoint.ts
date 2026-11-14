'use client';

import { MEDIA, useMediaQuery } from '@/lib/dom/use-media-query';
import type { Breakpoint } from '@/lib/layouts';

/** 768 px: where the page grid goes from one column to two (`md:` in SPAN_CLASS). */
export const MEDIUM_MEDIA = '(width >= 48rem)';

/**
 * The page grid's column rules as `packRows` names them: `wide` from 1280 px (`xl:`), `medium` from 768 px (`md:`),
 * `narrow` below. The server and the first render answer `narrow`; the CSS spans are right from the first paint.
 */
export function useBreakpoint(): Breakpoint {
  const wide = useMediaQuery(MEDIA.xl);
  const medium = useMediaQuery(MEDIUM_MEDIA);
  return wide ? 'wide' : medium ? 'medium' : 'narrow';
}
