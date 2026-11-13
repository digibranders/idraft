import { createContext, useContext } from 'react';

import type { Schemas } from '@/lib/api/types';

export type ComparedWindow = Pick<Schemas['MetricWindow'], 'from' | 'to'> | null;

const ComparedWindowContext = createContext<ComparedWindow>(null);

export const ComparedWindowProvider = ComparedWindowContext.Provider;

export const useComparedWindow = (): ComparedWindow => useContext(ComparedWindowContext);
