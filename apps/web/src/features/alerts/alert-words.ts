'use client';

import { useTranslations } from 'next-intl';

import { readEvidence } from './alert-evidence';
import { PLATFORM_CODES, PLATFORM_KEY, type PlatformCode } from './alert-model';
import type { AlertEvent } from '@/lib/api/types';

const isPlatformCode = (code: string): code is PlatformCode => (PLATFORM_CODES as readonly string[]).includes(code);

export interface AlertWords {
  /** The name of a platform code, or `null` for a code this version does not know. */
  platformName: (code: string) => string | null;
  /** What changed, in a sentence built from the alert's evidence counts. */
  evidenceText: (event: AlertEvent) => string;
}

/** The sentences of alerts: they come from the counts in the evidence, since the API sends no text. */
export function useAlertWords(brandName: string): AlertWords {
  const t = useTranslations('alerts');
  const platformName = (code: string): string | null =>
    isPlatformCode(code) ? t(`platforms.${PLATFORM_KEY[code]}`) : null;
  const evidenceText = (event: AlertEvent): string => {
    const evidence = readEvidence(event);
    if (evidence === null) return t('evidence.unknown');
    if (evidence.kind === 'rank') {
      return t('evidence.rankDrop', { from: evidence.from, to: evidence.to, positions: evidence.positions });
    }
    const platform = evidence.platform === null ? null : platformName(evidence.platform);
    return t('evidence.mentionChange', {
      subject: evidence.competitor ?? brandName,
      beforeMentioning: evidence.before.mentioning,
      beforeValid: evidence.before.valid,
      afterMentioning: evidence.after.mentioning,
      afterValid: evidence.after.valid,
      answers: platform === null ? t('evidence.answers') : t('evidence.answersOn', { platform }),
    });
  };
  return { platformName, evidenceText };
}
