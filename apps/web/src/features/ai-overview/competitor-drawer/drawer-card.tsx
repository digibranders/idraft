'use client';

import type { LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';

import { CardInfoButton, type CardInfo } from '@/components/app/chart/card-info';
import { InspectorSection, type InspectorSectionStatus } from '@/components/app/inspector/inspector-section';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';

/** What a card of the drawer shows while its read is not ready. */
export type DrawerCardState =
  | { status: 'loading' | 'ready' }
  | { status: 'empty'; title: string; reason: string }
  | { status: 'error'; errorId: string | null; retry: () => void };

export interface DrawerCardProps {
  title: string;
  icon: LucideIcon;
  /** The small text before the info button: what the numbers cover ("weekly runs"). */
  meta?: string | null | undefined;
  info: CardInfo;
  state: DrawerCardState;
  /** The words of a failed read ("Could not load this competitor"). */
  errorTitle: string;
  /** A table that runs edge to edge in the card. */
  flush?: boolean | undefined;
  children?: ReactNode;
}

/**
 * One card of the competitor drawer (OV-DRW-50): the frame of the inspector's sections with the title, the meta line
 * and the "i" button of the page cards. Each card loads, fails and says it is empty on its own.
 */
export function DrawerCard({
  title,
  icon,
  meta,
  info,
  state,
  errorTitle,
  flush = false,
  children,
}: DrawerCardProps): ReactElement {
  const t = useTranslations('aiOverview.competitorDrawer');
  const status = useTranslations('status.error');
  const common = useTranslations('common');
  const sectionStatus: InspectorSectionStatus = state.status;
  return (
    <InspectorSection
      title={title}
      icon={icon}
      status={sectionStatus}
      action={
        <span className="flex items-center gap-1">
          {meta === null || meta === undefined ? null : <span className="type-meta">{meta}</span>}
          <CardInfoButton title={title} info={info} />
        </span>
      }
      error={
        state.status === 'error' ? (
          <InlineError
            title={errorTitle}
            reason={t('errorReason')}
            errorId={
              state.errorId === null
                ? null
                : {
                    id: state.errorId,
                    label: status('errorId', { id: state.errorId }),
                    copyLabel: status('copyErrorId'),
                    copiedLabel: status('copied'),
                  }
            }
            onRetry={state.retry}
            retrying={false}
            retryLabel={common('retry')}
          />
        ) : undefined
      }
      empty={
        state.status === 'empty' ? (
          <EmptyState variant="inline" title={state.title} reason={state.reason} headingLevel={3} />
        ) : undefined
      }
    >
      {flush ? <div className="-mx-4 -mb-4 overflow-x-auto">{children}</div> : children}
    </InspectorSection>
  );
}
