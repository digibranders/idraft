'use client';

import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import type { FaviconMode } from '@/components/app/cells/domain-cell';
import { CountPopover, type CountPopoverDomain } from '@/components/app/cells/count-popover';
import { Badge } from '@/components/ui/badge';
import { Tooltip } from '@/components/ui/tooltip';
import type { FanoutCitedDomain } from '@/lib/fanout';
import { EMPTY_VALUE, formatInteger, formatTableDate } from '@/lib/format';

/**
 * The parts of one fan-out query that a list and a table both draw: how often it was used, whether it is new, and
 * the domains cited beside it. Each is words with their counts, never a bare figure, and none is coloured (no fan-out
 * figure has a test of change, so nothing here may look like a verdict).
 */

/** A tooltip on text needs a tab stop, or no keyboard user reaches it (20 section 6.2 rule 6). */
const TIP_STOP = { tabIndex: 0 } as const;
const TIP_CLASS = 'num rounded-xs outline-none focus-visible:focus-ring';

export interface TimesUsedProps {
  /** The answers that issued the query (each once). */
  count: number;
  /** The valid answers read on the query's engine, the denominator. */
  total: number;
  /** The name of the engine: the counts are of its answers alone. */
  engineLabel: string;
}

/**
 * "In 6 of 12 ChatGPT answers" (WB-PIF-01). A total of 0 has no "of": it reads n/a, because no answer was read and
 * "In 0 of 0" would be a ratio of nothing.
 */
export function TimesUsed({ count, total, engineLabel }: TimesUsedProps): ReactElement {
  const t = useTranslations('fanout');
  if (total <= 0) {
    return (
      <Tooltip content={t('strip.noAnswers', { engine: engineLabel })}>
        <span {...TIP_STOP} className={TIP_CLASS}>
          {EMPTY_VALUE}
        </span>
      </Tooltip>
    );
  }
  return (
    <Tooltip content={t('timesUsedTip', { count, total, engine: engineLabel })}>
      <span {...TIP_STOP} className={TIP_CLASS}>
        {t('timesUsed', { count, total, engine: engineLabel })}
      </span>
    </Tooltip>
  );
}

export interface NewBadgeProps {
  /** `first_seen_at` of the row: an instant. */
  firstSeen: string;
  /** The days of the window, which is also how many days before it were read. */
  days: number;
  timeZone: string;
}

/**
 * "New in window" (WB-PIF-02): the query was not issued in the period before the window. It is neutral, an outline
 * badge, as the New marker of the prompt inspector is: new is a fact, not a good or a bad.
 */
export function NewBadge({ firstSeen, days, timeZone }: NewBadgeProps): ReactElement {
  const t = useTranslations('fanout');
  return (
    <Tooltip content={t('newTip', { date: formatTableDate(firstSeen, timeZone), days })}>
      <Badge variant="outline" tabIndex={0}>
        {t('newBadge')}
      </Badge>
    </Tooltip>
  );
}

export interface CitedDomainsProps {
  /** The domains cited in the answers that issued the query: at most 5, the route's bound. */
  domains: readonly FanoutCitedDomain[];
  /** `grid` in a table cell, `list` in a stacked row. */
  context: 'grid' | 'list';
  /** The domain's inspector, where the page has one; without it a domain is text. */
  hrefOf?: ((registrable: string) => Route | undefined) | undefined;
  favicon?: FaviconMode | undefined;
}

const popoverDomain = (
  {
    registrable_domain: registrable,
    domain_role: role,
    role_entity_id: entity,
    citation_units: units,
  }: FanoutCitedDomain,
  words: (units: number) => string,
  hrefOf: CitedDomainsProps['hrefOf'],
): CountPopoverDomain => {
  const href = hrefOf?.(registrable);
  return {
    // The same domain can be cited under two roles of two entities: the three tell the entries apart
    id: `${registrable}|${role}|${entity ?? ''}`,
    host: registrable,
    registrable,
    role,
    countText: words(units),
    ...(href === undefined ? {} : { href }),
  };
};

/**
 * The domains cited in the same answers (WB-PIF-03, SC-09): a count that opens them with their units. It is an
 * association, not a lineage: the data does not say which query found which source, and the surface that draws this
 * says so once (`citedAssociation`). No cited domain is words, not a count of 0 that opens nothing.
 */
export function CitedDomains({ domains, context, hrefOf, favicon }: CitedDomainsProps): ReactElement {
  const t = useTranslations('fanout');
  if (domains.length === 0) return <span className="type-meta">{t('citedNone')}</span>;
  return (
    <CountPopover
      countText={formatInteger(domains.length)}
      label={t('citedLabel', { count: domains.length })}
      title={t('citedTitle')}
      domains={domains.map((domain) => popoverDomain(domain, (units) => t('citedUnits', { units }), hrefOf))}
      total={domains.length}
      context={context}
      {...(favicon === undefined ? {} : { favicon })}
    />
  );
}
