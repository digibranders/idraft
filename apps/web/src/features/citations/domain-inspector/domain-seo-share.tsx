'use client';

import { Gauge } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { useDomainSeoShare, type DomainSeoShare } from './use-domain-seo-share';
import { InspectorSection, type InspectorSectionStatus } from '@/components/app/inspector/inspector-section';
import { EmptyState } from '@/components/app/status/empty-state';
import { TextLink } from '@/components/ui/text-link';

export interface DomainSeoShareProps {
  /** The Rankings of the project: where the keywords this figure will be of are tracked. */
  rankingsHref: Route;
}

/** How the card is drawn for each state of the figure; a state added to the hook is a compile error until it is here. */
const CARD_STATUS = { unavailable: 'empty' } as const satisfies Record<
  DomainSeoShare['status'],
  InspectorSectionStatus
>;

/**
 * "Search share of voice" (WB-DOM-06): the domain's share of the project's tracked keywords in search results.
 * No read gives it yet, so the section says it is not available and why, and draws no figure: a 0% here would be a
 * claim that was never measured. The hook is the only part that changes when a read exists.
 */
export function DomainSeoShare({ rankingsHref }: DomainSeoShareProps): ReactElement {
  const t = useTranslations('citations.inspectors.domain');
  const share = useDomainSeoShare();
  return (
    <InspectorSection
      title={t('sovTitle')}
      icon={Gauge}
      status={CARD_STATUS[share.status]}
      empty={
        <EmptyState
          variant="inline"
          title={t('sovUnavailable')}
          reason={t('sovReason')}
          secondaryAction={
            <TextLink render={<Link href={rankingsHref} />} className="type-body">
              {t('sovAction')}
            </TextLink>
          }
          headingLevel={3}
        />
      }
    />
  );
}
