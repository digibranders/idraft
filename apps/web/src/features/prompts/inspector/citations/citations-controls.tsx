'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { ALL_ENGINES } from './citations-model';
import { byEngineOrder } from '@/components/app/engine/order';
import { SegmentedControl } from '@/components/ui/segmented-control';
import type { ProjectEngine } from '@/lib/api/types';

export interface CitationsControlsProps {
  /** The enabled engines: the choices after All platforms. */
  engines: readonly ProjectEngine[];
  labelOf: (engineCode: string) => string;
  /** `ALL_ENGINES` or an engine code. */
  engine: string;
  onEngineChange: (engine: string) => void;
}

/**
 * The one choice of the Citations tab: which platform is read, All platforms or one, never a pool of some (WB-PIC-03).
 * There is no minimum of citation units: the lists count answers, and that threshold is of another unit.
 */
export function CitationsControls({
  engines,
  labelOf,
  engine,
  onEngineChange,
}: CitationsControlsProps): ReactElement | null {
  const t = useTranslations('prompts.citationsTab');
  const codes = byEngineOrder(engines, (entry) => entry.engine.engine_code).map((entry) => entry.engine.engine_code);
  if (codes.length === 0) return null;
  return (
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
  );
}
