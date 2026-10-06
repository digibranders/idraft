'use client';

import { useTranslations } from 'next-intl';

import { DEPTH_KEYS, type DepthProfile } from './depth-profiles';

/** The name of a depth profile, the same wherever one is shown: Rankings, its inspector and the keyword defaults. */
export function useDepthLabel(): (profile: DepthProfile) => string {
  const t = useTranslations('common.depths');
  return (profile) => t(DEPTH_KEYS[profile]);
}
