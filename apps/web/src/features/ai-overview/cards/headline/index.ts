import { HeadlineSkeleton } from './headline-skeleton';
import type { CardRegistration } from '@/features/layouts';

/**
 * The cards of the headline family (O-headline): the catalog key of each card and where its code is. A card listed
 * here replaces its pending placeholder (../registry.ts).
 */
export const HEADLINE_CARDS: Readonly<Record<string, CardRegistration>> = {
  'ai.visibility_split': { load: () => import('./headline-card'), skeleton: HeadlineSkeleton },
};
