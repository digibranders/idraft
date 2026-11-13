'use client';

import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { EngineLogo } from '@/components/app/engine/engine-logo';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Icon } from '@/components/ui/icon';
import { Popover } from '@/components/ui/popover';
import { formatInteger } from '@/lib/format';

/** An engine the project has on: the API's code and its name. */
export interface EngineChoice {
  code: string;
  label: string;
}

export interface EnginesControlProps {
  /** Only the engines that are on, in the order the page lists them. An engine that is off is never offered. */
  engines: readonly EngineChoice[];
  /** The codes chosen, or `null` for every engine. */
  selected: readonly string[] | null;
  /** The new choice: the codes, or `null` once every engine is chosen (the scope never writes "all"). */
  onChange: (selected: readonly string[] | null) => void;
}

/**
 * The engines of the numbers: a button with the count of engines in scope, opening a list of the project's enabled
 * engines, each with its mark. At least one engine stays chosen: the last one is disabled and says why, because a
 * scope with no engine has no answers to count.
 */
export function EnginesControl({ engines, selected, onChange }: EnginesControlProps): ReactElement | null {
  const t = useTranslations('aiOverview.scope');
  if (engines.length === 0) return null;
  const named = selected === null ? engines : engines.filter((engine) => selected.includes(engine.code));
  // A link may name only engines that are off: nothing of it is in scope, so every engine is
  const chosen = named.length === 0 ? engines : named;
  const toggle = (code: string): void => {
    const next = engines.filter((engine) => (engine.code === code) !== chosen.some((on) => on.code === engine.code));
    if (next.length === 0) return;
    onChange(next.length === engines.length ? null : next.map((engine) => engine.code));
  };
  const counts = { count: chosen.length, total: engines.length };
  return (
    <Popover
      title={t('engines')}
      width="min"
      trigger={
        <Button variant="secondary" aria-label={`${t('engines')}: ${t('enginesCount', counts)}`}>
          {t('engines')}
          <Badge>{formatInteger(chosen.length)}</Badge>
          <Icon icon={ChevronDown} size="sm" className="text-foreground-tertiary" />
        </Button>
      }
    >
      <div className="flex flex-col gap-1">
        {engines.map((engine) => {
          const on = chosen.some((candidate) => candidate.code === engine.code);
          const last = on && chosen.length === 1;
          return (
            <Checkbox
              key={engine.code}
              checked={on}
              disabled={last}
              label={<EngineLogo engine={engine.code} name={engine.label} />}
              description={last ? t('enginesMin') : undefined}
              onCheckedChange={() => toggle(engine.code)}
            />
          );
        })}
      </div>
    </Popover>
  );
}
