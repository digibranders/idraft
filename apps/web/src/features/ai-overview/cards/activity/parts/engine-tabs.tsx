'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { CountTabs } from '@/components/app/feed/count-tabs';
import type { EngineCode } from '@/lib/api/types';

export interface EngineTab {
  code: EngineCode;
  label: string;
  /** The answers collected on the engine in the window, formatted. */
  countText: string;
}

export interface EngineTabsProps {
  /** In tab order; the first is the one the card opens on. */
  engines: readonly EngineTab[];
  value: EngineCode;
  onChange: (engine: EngineCode) => void;
}

/**
 * One engine at a time for the cards of the collection days: engines are never pooled, so there is no "All" tab. The
 * toolbar is `CountTabs`, whose first entry is its "All" entry, which here is simply the first engine: no engine
 * pressed means the first is shown, and pressing any engine shows that engine alone.
 */
export function EngineTabs({ engines, value, onChange }: EngineTabsProps): ReactElement | null {
  const t = useTranslations('aiOverview.activity.daily');
  const [first, ...rest] = engines;
  if (first === undefined) return null;
  const pressed: readonly EngineCode[] = value === first.code ? [] : [value];
  return (
    <CountTabs<EngineCode>
      label={t('engineToolbar')}
      allLabel={first.label}
      allCountText={first.countText}
      size="sm"
      items={rest.map((engine) => ({ value: engine.code, label: engine.label, countText: engine.countText }))}
      value={pressed}
      // Pressing the engine that is shown clears the selection, which is the first engine again
      onValueChange={(next) => onChange(next.find((code) => !pressed.includes(code)) ?? first.code)}
    />
  );
}
