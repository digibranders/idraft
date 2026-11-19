'use client';

import { UserSearch } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { EmptyState } from '@/components/app/status/empty-state';

/**
 * The Candidates tab's seam (plan section 3.15): brand discovery does not exist yet (`entity-candidates` is not
 * built). WP-56 replaces these two exports with its own `features/competitors/candidates/` ones, editing only the
 * import of this file's users.
 */

/** The number of candidate brands, or `null` while it is not known: the tab label then shows no number, never 0. */
export function useCandidatesCount(): number | null {
  return null;
}

export function CandidatesTabPanel(): ReactElement {
  const t = useTranslations('competitors.candidates');
  return <EmptyState icon={UserSearch} title={t('title')} reason={t('reason')} headingLevel={2} />;
}
