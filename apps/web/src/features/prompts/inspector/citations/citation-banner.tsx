'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { Banner } from '@/components/app/status/banner';
import { formatTableDateTime } from '@/lib/format';

export interface CitationBannerProps {
  /** The answers of the window that cite a page of the own domain. */
  cited: number;
  /** The answers of the window. */
  answers: number;
  /** The newest answer; `null` until it is known, and the banner waits for it. */
  lastAnswerAt: string | null;
  /** The own pages the prompt cites; `null` where the read has not answered, and the count is left out. */
  ownPages: number | null;
  timeZone: string;
}

/**
 * The first line of the Citations tab (WB-PI-21): in how many of the answers the own domain is cited, when the
 * last answer came and how many own pages were cited. It states a fact and judges nothing: the info tone when the
 * domain is cited, the neutral tone when it is not. With no answer there is nothing to count, and it says so
 * in a line rather than a banner. It sits in the tab, not above it (plan Q2).
 */
export function CitationBanner({
  cited,
  answers,
  lastAnswerAt,
  ownPages,
  timeZone,
}: CitationBannerProps): ReactElement | null {
  const t = useTranslations('prompts.citationsTab.banner');
  if (answers === 0) return <p className="type-meta">{t('noAnswers')}</p>;
  if (lastAnswerAt === null) return null;
  const time = formatTableDateTime(lastAnswerAt, timeZone);
  const message =
    cited === 0
      ? t('notCited', { answers, time })
      : ownPages === null
        ? t('citedNoPages', { cited, answers, time })
        : t('cited', { cited, answers, time, pages: ownPages });
  return <Banner tone={cited === 0 ? 'neutral' : 'info'} placement="region" message={message} live />;
}
