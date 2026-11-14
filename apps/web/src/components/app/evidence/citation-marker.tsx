'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

export interface CitationMarkerProps {
  /** The citation's number in the list: the marker shows it as `[2]`. */
  index: number;
  /** What a screen reader says: "Citation 2: g2.com". */
  label: string;
  /** The list item of this citation is the one marked: the marker is drawn solid. */
  active?: boolean | undefined;
  onActivate: (index: number) => void;
}

/**
 * The `[n]` that stands after a cited address in an answer, a button that takes the reader to the citation's item in
 * the list (23-application-patterns.md section 5.4, inventory 15.14). It sits inside a sentence, so the inline target
 * exception of WCAG 2.5.8 applies to its size; it is a tab stop with a visible focus ring.
 */
export function CitationMarker({ index, label, active = false, onActivate }: CitationMarkerProps): ReactElement {
  const t = useTranslations('evidence.citationMarker');
  return (
    <button
      type="button"
      data-slot="citation-marker"
      data-citation-marker={index}
      data-active={active ? '' : undefined}
      aria-label={label}
      onClick={() => onActivate(index)}
      className="cursor-pointer rounded-xs bg-primary-subtle px-0.5 align-baseline type-micro text-primary-text hover:underline focus-visible:focus-ring data-active:bg-primary data-active:text-primary-foreground"
    >
      {t('text', { index })}
    </button>
  );
}
