import { createContext, useContext } from 'react';

import { useCompare, type CompareMode } from './use-compare';
import type { Schemas } from '@/lib/api/types';

export type ComparedWindow = Pick<Schemas['MetricWindow'], 'from' | 'to'> | null;

const ComparedWindowContext = createContext<ComparedWindow>(null);

export const ComparedWindowProvider = ComparedWindowContext.Provider;

export const useComparedWindow = (): ComparedWindow => useContext(ComparedWindowContext);

/**
 * What the comparison on screen is with, as the rows shown were read. The page holds the last rows while the read for a
 * new choice loads, so the words ("the same period last year") follow these rows and not the select that just changed.
 */
const ComparedModeContext = createContext<CompareMode | null>(null);

export const ComparedModeProvider = ComparedModeContext.Provider;

/** The mode the rows on screen were read with; the address's own while there is no page holding rows (a lone part). */
export function useShownMode(): CompareMode {
  const shown = useContext(ComparedModeContext);
  const { mode } = useCompare();
  return shown ?? mode;
}
