'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { ALL_ENGINES, MIN_SUPPORT_OPTIONS } from './citations-model';
import { byEngineOrder } from '@/components/app/engine/order';
import { Select } from '@/components/ui/select';
import { SegmentedControl } from '@/components/ui/segmented-control';
import type { ProjectEngine } from '@/lib/api/types';

export interface CitationsControlsProps {
  /** The enabled engines: the choices after All engines. */
  engines: readonly ProjectEngine[];
  labelOf: (engineCode: string) => string;
  /** `ALL_ENGINES` or an engine code. */
  engine: string;
  onEngineChange: (engine: string) => void;
  minSupport: number;
  onMinSupportChange: (minSupport: number) => void;
}

/**
 * The two choices of the Citations tab: which engine is read (All engines, or one, never a pool of some) and the
 * fewest citation units a row needs to be listed (WB-PIC-03, WB-PIC-10).
 */
export function CitationsControls({
  engines,
  labelOf,
  engine,
  onEngineChange,
  minSupport,
  onMinSupportChange,
}: CitationsControlsProps): ReactElement {
  const t = useTranslations('prompts.citationsTab');
  const codes = byEngineOrder(engines, (entry) => entry.engine.engine_code).map((entry) => entry.engine.engine_code);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {codes.length === 0 ? null : (
        // A wide set of labels scrolls inside its own box rather than widening the inspector
        <div className="max-w-full overflow-x-auto">
          <SegmentedControl<string>
            semantics="view"
            size="sm"
            label={t('engineLabel')}
            value={engine}
            // The primitive adds its event details to the call: the caller gets the value alone
            onValueChange={(value) => onEngineChange(value)}
            items={[
              { value: ALL_ENGINES, label: t('allEngines') },
              ...codes.map((code) => ({ value: code, label: labelOf(code) })),
            ]}
          />
        </div>
      )}
      <Select<string>
        size="sm"
        className="w-40"
        aria-label={t('minSupportLabel')}
        placeholder={t('minSupportOption', { count: minSupport })}
        value={String(minSupport)}
        onValueChange={(value) => onMinSupportChange(Number(value))}
        options={MIN_SUPPORT_OPTIONS.map((count) => ({
          value: String(count),
          label: t('minSupportOption', { count }),
        }))}
      />
    </div>
  );
}
