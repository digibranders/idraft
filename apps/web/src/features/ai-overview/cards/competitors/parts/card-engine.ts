'use client';

import { useMemo } from 'react';

import { askedEngines } from '../../../data/overview-queries';
import { useOverview } from '../../../overview-context';
import { singlePlatform } from '../../../scope/scope-model';
import { inCatalogOrder } from '../../engines/engine-role';
import type { EngineCode } from '@/lib/api/types';
import { engineLabel } from '@/lib/layouts';

/**
 * - `asked`: the engine is on and inside the engine filter, so the summary carries it.
 * - `off`: the project has not turned it on.
 * - `outside`: it is on, and the page's engine filter leaves it out.
 */
export type EngineAvailability = 'asked' | 'off' | 'outside';

/** The engine a card of the family is an instance of (D-4: the card's option, never an in-card switcher). */
export interface CardEngine {
  /** The API engine code, such as `gemini_web`. */
  code: string;
  /** "Gemini": the name the card shows beside the engine mark. */
  label: string;
  availability: EngineAvailability;
}

/**
 * The engine of a card from its `engine` option, and whether the scope asks it. A card whose engine is not asked
 * says so and why (`mapReadToFrame`); it never draws a zero for an engine it does not know. The page mounts its
 * cards once the engines of the project are read, so `off` is a fact and not a loading state.
 */
export function useCardEngine(options: Readonly<Record<string, string>>): CardEngine {
  const { scope, enabledEngines } = useOverview();
  const code = options.engine;
  if (code === undefined) throw new Error('A card of the competitors family needs an "engine" option');
  return useMemo((): CardEngine => {
    const enabled = enabledEngines.some((engine) => engine === code);
    const asked = askedEngines({ scope, enabledEngines }).some((engine) => engine === code);
    return { code, label: engineLabel(code), availability: asked ? 'asked' : enabled ? 'outside' : 'off' };
  }, [code, scope, enabledEngines]);
}

/** What the three competitor cards read of the page scope: the platforms asked, and whether it is All platforms. */
export interface CardPlatforms {
  /** The platforms that are on and inside the scope, in catalog order; empty when the chosen one is off. */
  codes: readonly EngineCode[];
  /** All platforms: the equal-weight average of the platforms, labelled "avg of N". One platform is its own figures. */
  average: boolean;
  /** The one platform chosen, or `null` for All platforms. */
  single: string | null;
}

/**
 * The platforms of a card that follows the page scope (`ai.share_of_voice`, `ai.sov_over_time`,
 * `ai.lost_to_competitor`): no engine option and no in-card picker. A leftover `engine` option of an older saved
 * layout is not read.
 */
export function useCardPlatforms(): CardPlatforms {
  const { scope, enabledEngines } = useOverview();
  return useMemo((): CardPlatforms => {
    const single = singlePlatform(scope);
    return {
      codes: inCatalogOrder(askedEngines({ scope, enabledEngines })),
      average: single === null,
      single,
    };
  }, [scope, enabledEngines]);
}
