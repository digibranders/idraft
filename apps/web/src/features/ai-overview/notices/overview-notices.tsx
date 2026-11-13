'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState, type ReactElement, type ReactNode } from 'react';

import { useOverview } from '../overview-context';
import type { Notice } from './notice-model';
import { droppedMessageKey } from '@/components/app/date-range/range-model';
import { Banner, type BannerTone } from '@/components/app/status/banner';
import { TextLink } from '@/components/ui/text-link';
import { formatBusinessDate, formatTableDateTime } from '@/lib/format';
import { runsPath } from '@/lib/routes/paths';

export interface OverviewNoticesProps {
  /** The notice that applies; the states that replace the body (no engine, no prompts, no country) draw no banner. */
  notice: Notice | null;
  /** The reads behind the notice have answered: a banner that is there now was there when the page loaded. */
  settled: boolean;
}

interface Shown {
  /** What the banner is, to tell one from the next. */
  key: string;
  tone: BannerTone;
  message: string;
  actions?: ReactNode;
}

/** Marks that the banner on show is no longer the one the page loaded with. */
const CHANGED = 'changed';

/**
 * The notice region (24 section 9.2, WP-33 plan section 3.5): one `Banner` at a time, never stacked. A link whose
 * date range was not used says so first, since it is the scope itself that is not the one asked for; otherwise the
 * notice of the data. A banner there when the page has loaded is read with the page and has no role; one that
 * appears or changes after that is announced politely once.
 */
export function OverviewNotices({ notice, settled }: OverviewNoticesProps): ReactElement | null {
  const t = useTranslations('aiOverview.notices');
  const common = useTranslations('common');
  const { workspaceSlug, project, canViewRuns, dropped } = useOverview();

  let shown: Shown | null = null;
  if (dropped !== null) {
    shown = {
      key: 'dropped',
      tone: 'info',
      message: common(`dateRange.${droppedMessageKey(dropped)}`, {
        max: dropped.code === 'too_long' ? dropped.max : 0,
        date: dropped.code === 'before_start' ? formatBusinessDate(dropped.earliest) : '',
      }),
    };
  } else if (notice !== null) {
    switch (notice.kind) {
      case 'paused':
        shown = { key: notice.kind, tone: 'info', message: t('paused') };
        break;
      case 'firstAnswers':
        shown = {
          key: notice.kind,
          tone: 'info',
          message:
            notice.nextRunAt === null
              ? t('firstAnswersGeneric')
              : t('firstAnswers', { time: formatTableDateTime(notice.nextRunAt, project.timeZone) }),
        };
        break;
      case 'invalid':
        shown = {
          key: notice.kind,
          tone: 'warning',
          message: t('invalid', {
            count: notice.invalid,
            total: notice.total,
            engine: notice.label,
            days: notice.days,
          }),
          actions: canViewRuns ? (
            <TextLink render={<Link href={runsPath(workspaceSlug, project.slug)} />}>{t('viewRuns')}</TextLink>
          ) : undefined,
        };
        break;
      case 'stale':
        shown = { key: notice.kind, tone: 'warning', message: t('stale', { days: notice.days }) };
        break;
      case 'noEngine':
      case 'noPrompts':
      case 'noCountryPrompts':
        break;
    }
  }

  // What was on show when the page finished loading; any change after that makes every banner live
  const key = shown?.key ?? null;
  const [atLoad, setAtLoad] = useState<string | null | undefined>(undefined);
  if (settled) {
    if (atLoad === undefined) setAtLoad(key);
    else if (atLoad !== CHANGED && key !== atLoad) setAtLoad(CHANGED);
  }
  if (shown === null) return null;
  const live = atLoad !== undefined && key !== atLoad;
  return (
    <Banner
      tone={shown.tone}
      placement="region"
      message={shown.message}
      live={live}
      {...(shown.actions === undefined ? {} : { actions: shown.actions })}
    />
  );
}
