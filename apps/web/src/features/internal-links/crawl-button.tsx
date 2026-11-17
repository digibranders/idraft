'use client';

import type { LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';

export interface CrawlButtonProps {
  label: string;
  icon?: LucideIcon | undefined;
  /** Whether the role holds `runs:trigger`. Without it the button stays in the tab order and says why. */
  canCrawl: boolean;
  /** The start request is in flight. */
  pending: boolean;
  /** When the crawl that runs now started ("12m ago"), or `null` when none runs. */
  startedAgo: string | null;
  onClick: () => void;
}

/**
 * The button that starts a crawl (Crawl now, Try again). While a crawl runs, or the request is in flight, it is
 * busy and ignores presses, but stays enabled and reachable, so the tooltip that says when the crawl started can be
 * read. Without the permission it is disabled with its reason in a tooltip (09-buttons-controls.md section 2.4).
 */
export function CrawlButton({ label, icon, canCrawl, pending, startedAgo, onClick }: CrawlButtonProps): ReactElement {
  const t = useTranslations('internalLinks.header');
  const tip = startedAgo !== null ? t('crawlingSince', { time: startedAgo }) : canCrawl ? '' : t('crawlNeedsRole');
  return (
    <Tooltip content={tip} disabled={tip === ''}>
      <Button
        variant="primary"
        size="sm"
        icon={icon}
        disabled={!canCrawl}
        focusableWhenDisabled
        loading={startedAgo !== null || pending}
        onClick={onClick}
      >
        {label}
      </Button>
    </Tooltip>
  );
}
