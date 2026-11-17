'use client';

import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, type ReactElement } from 'react';

import { IconButton } from '@/components/ui/icon-button';

export interface InfoFacts {
  title: string;
  tier: string;
  status: string;
  depth: string;
  /** Linking pages in the scope in view (the canvas's scope, which is editorial at first). */
  linkingScoped: string;
  linkingAll: string;
  /** This link's placement and attribute; empty on the focus card, which has no link. */
  placement: string;
  rel: string;
}

export interface InfoPanelProps {
  label: string;
  facts: InfoFacts;
  onClose: () => void;
}

/** Marks the button that opens the panel: a press on it is the panel's own toggle, not a click elsewhere. */
export const INFO_TOGGLE_ATTRIBUTE = 'data-info-toggle';

/**
 * The info panel of a card (spec 7.5 "Info panel"): title, tier, status, depth, linking pages and this link's placement
 * and attribute. It opens from the card's Info button only, never on hover or focus (it covered the cards a person was
 * reading). It closes on the button again, a press elsewhere, Escape, or a pan or zoom (the canvas does the last).
 */
export function InfoPanel({ label, facts, onClose }: InfoPanelProps): ReactElement {
  const t = useTranslations('linkCanvas.info');
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close.current();
    };
    const onPress = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (panel.current?.contains(target) === true || target.closest(`[${INFO_TOGGLE_ATTRIBUTE}]`) !== null) return;
      close.current();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPress, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPress, true);
    };
  }, []);
  const rows: [string, string][] = [
    [t('tier'), facts.tier],
    [t('status'), facts.status],
    [t('depth'), facts.depth],
    [t('linkingScoped'), facts.linkingScoped],
    [t('linkingAll'), facts.linkingAll],
  ];
  if (facts.placement !== '') rows.push([t('placement'), facts.placement], [t('rel'), facts.rel]);
  return (
    <div
      ref={panel}
      role="dialog"
      aria-label={label}
      data-canvas-control=""
      className="absolute top-full left-0 z-(--z-dropdown) mt-1 w-64 rounded-md border border-border bg-surface-elevated p-3 shadow-popover"
    >
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 type-body-strong break-words text-foreground">{facts.title}</p>
        <IconButton icon={X} label={t('close')} size="icon-xs" onClick={onClose} />
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 type-meta">
        {rows.map(([name, value]) => (
          <div key={name} className="contents">
            <dt className="text-foreground-tertiary">{name}</dt>
            <dd className="num text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
