'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, type RefObject } from 'react';

/**
 * What a screen with several steps does when its step changes (20-accessibility.md section 4.3, WCAG
 * 2.4.2): the page title follows the step's heading, and, when the new step has no field to take focus,
 * focus moves to the heading so the change is read. The first step keeps what the page did on load.
 *
 * Returns the ref for the `AuthCard` heading.
 */
export function useStep(
  title: string,
  { focusHeading }: { focusHeading: boolean },
): RefObject<HTMLHeadingElement | null> {
  const app = useTranslations('app');
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const shown = useRef<string | null>(null);
  useEffect(() => {
    // The template of the root layout's metadata, which a client change of title has to repeat
    document.title = `${title} · ${app('name')}`;
    if (shown.current !== null && shown.current !== title && focusHeading) headingRef.current?.focus();
    shown.current = title;
  }, [title, focusHeading, app]);
  return headingRef;
}
