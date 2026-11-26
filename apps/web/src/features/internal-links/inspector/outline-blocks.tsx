'use client';

import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { LengthMeter, OutlineBlock, OutlineFact, OutlineFindingRow } from './outline-block';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatInteger } from '@/lib/format';
import type { PageOutlineBody } from '@/lib/internal-links/types';
import {
  DESCRIPTION_MAX,
  DESCRIPTION_MIN,
  TITLE_MAX,
  TITLE_MIN,
  type OutlineBlockId,
  type OutlineFinding,
  type OutlineModel,
} from '@/lib/pages/outline-model';

export interface BlockProps {
  outline: PageOutlineBody;
  open: boolean;
  onToggle: (id: OutlineBlockId) => void;
  /** The route of the Issues page for a check, or null: no check, or that page is not on the branch. */
  issueHref: (checkId: string | null) => Route | null;
}

/** The title is cut at this many characters in the preview, as a search result cuts it. */
const PREVIEW_TITLE_CHARS = 60;

export type Translate = ReturnType<typeof useTranslations<'pages.drawer.outline'>>;

export function Findings({
  findings,
  issueHref,
  t,
}: {
  findings: readonly OutlineFinding[];
  issueHref: BlockProps['issueHref'];
  t: Translate;
}): ReactElement | null {
  if (findings.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2">
      {findings.map((finding, index) => (
        <OutlineFindingRow
          // A page can have the same finding twice (two blocks that do not parse), so the place is part of the key
          key={`${finding.id}-${String(index)}`}
          // The ids are those of `OutlineFinding.id`, all under `finding`
          text={t(`finding.${finding.id}` as 'finding.noindex', finding.values)}
          href={issueHref(finding.checkId)}
        />
      ))}
    </ul>
  );
}

/** The address as a search result shows it: the host and the path. The page's text, so never an `href`. */
function hostAndPath(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return url;
  }
}

function lengthText(t: Translate, text: PageOutlineBody['title'], limits: { min: number; max: number }): string {
  switch (text.state) {
    case 'ok':
      return t('listing.lengthOk', { chars: text.chars });
    case 'short':
      return t('listing.lengthShort', { chars: text.chars, min: limits.min });
    case 'long':
      return t('listing.lengthLong', { chars: text.chars, max: limits.max });
    case 'missing':
      return t('listing.lengthMissing');
  }
}

export function ListingBlock({
  outline,
  part,
  open,
  onToggle,
  issueHref,
}: BlockProps & { part: OutlineModel['listing'] }): ReactElement {
  const t = useTranslations('pages.drawer.outline');
  const { title, description, canonical, robots } = outline;
  // Characters, not UTF-16 units, so the cut agrees with the backend's counts
  const titleChars = title.text === null ? [] : Array.from(title.text);
  const shownTitle =
    title.text === null
      ? t('listing.noTitle')
      : titleChars.length > PREVIEW_TITLE_CHARS
        ? `${titleChars.slice(0, PREVIEW_TITLE_CHARS).join('')}...`
        : title.text;
  return (
    <OutlineBlock
      id="listing"
      title={t('listing.title')}
      summary={
        part.findings.length === 0
          ? t('listing.summaryFine')
          : t('listing.summaryToFix', { count: part.findings.length })
      }
      tone={part.tone}
      open={open}
      onToggle={onToggle}
    >
      <div
        role="group"
        aria-label={t('listing.previewLabel')}
        className="flex flex-col gap-0.5 rounded-md border border-border-subtle bg-surface-subtle p-3"
      >
        <span className="type-meta wrap-anywhere text-foreground-secondary">{hostAndPath(outline.url)}</span>
        <span className="type-body-strong wrap-anywhere">{shownTitle}</span>
        <span
          className={
            description.text === null
              ? 'type-meta text-foreground-tertiary'
              : 'line-clamp-2 type-meta wrap-anywhere text-foreground-secondary'
          }
        >
          {description.text ?? t('listing.noDescription')}
        </span>
      </div>
      <Findings findings={part.findings} issueHref={issueHref} t={t} />
      <dl className="flex flex-col gap-3">
        <OutlineFact label={t('listing.factTitle')}>
          <LengthMeter
            chars={title.chars}
            max={TITLE_MAX}
            ok={title.state === 'ok'}
            label={lengthText(t, title, { min: TITLE_MIN, max: TITLE_MAX })}
          />
        </OutlineFact>
        <OutlineFact label={t('listing.factDescription')}>
          <LengthMeter
            chars={description.chars}
            max={DESCRIPTION_MAX}
            ok={description.state === 'ok'}
            label={lengthText(t, description, { min: DESCRIPTION_MIN, max: DESCRIPTION_MAX })}
          />
        </OutlineFact>
        <OutlineFact label={t('listing.factCanonical')}>
          {canonical.state === 'none' ? (
            t('listing.canonicalNone')
          ) : (
            <>
              <span>{canonical.state === 'self' ? t('listing.canonicalSelf') : (canonical.href ?? '')}</span>
              <Badge tone={canonical.state === 'self' ? 'positive' : 'warning'}>
                {canonical.state === 'self' ? t('listing.canonicalSelfChip') : t('listing.canonicalElsewhereChip')}
              </Badge>
            </>
          )}
        </OutlineFact>
        <OutlineFact label={t('listing.factRobots')}>
          <span>{robots.meta ?? t('listing.robotsNone')}</span>
          <Badge tone={robots.noindex ? 'warning' : 'positive'}>
            {robots.noindex ? t('listing.notIndexed') : t('listing.indexable')}
          </Badge>
        </OutlineFact>
        <OutlineFact label={t('listing.factLanguage')}>{outline.html_lang ?? t('listing.languageNone')}</OutlineFact>
      </dl>
    </OutlineBlock>
  );
}

/** One fixed class per level, so the indent is never built from page data. */
const INDENT = ['pl-0', 'pl-2', 'pl-4', 'pl-6', 'pl-8', 'pl-10'] as const;

export function HeadingsBlock({
  outline,
  part,
  open,
  onToggle,
  issueHref,
  showAll,
  onToggleAll,
}: BlockProps & {
  part: OutlineModel['headings'];
  showAll: boolean;
  onToggleAll: () => void;
}): ReactElement {
  const t = useTranslations('pages.drawer.outline');
  const total = outline.headings_total;
  const summary =
    total === 0
      ? t('headings.none')
      : part.h1Text === null
        ? t('headings.summary', { count: total })
        : t('headings.summaryWithH1', { count: total, h1: part.h1Text });
  const shown = showAll ? [...part.first, ...part.rest] : part.first;
  return (
    <OutlineBlock
      id="headings"
      title={t('headings.title')}
      summary={summary}
      tone={part.tone}
      open={open}
      onToggle={onToggle}
    >
      <Findings findings={part.findings} issueHref={issueHref} t={t} />
      {shown.length === 0 ? null : (
        <ol aria-label={t('headings.listLabel')} className="flex flex-col gap-1.5">
          {shown.map((heading, index) => (
            <li
              // The order is the page's and a heading can repeat, so the place in the list is its identity
              key={index}
              className={`flex items-baseline gap-2 ${INDENT[heading.level - 1] ?? INDENT[0]}`}
            >
              <Badge tone="neutral">{t('headings.level', { level: heading.level })}</Badge>
              {heading.text === '' ? (
                <span className="type-meta text-foreground-tertiary">{t('headings.emptyText')}</span>
              ) : (
                <span className="min-w-0 type-body wrap-anywhere">{heading.text}</span>
              )}
            </li>
          ))}
        </ol>
      )}
      {part.rest.length === 0 ? null : (
        <div>
          <Button variant="link" size="sm" onClick={onToggleAll}>
            {showAll
              ? t('headings.showFewer')
              : t('headings.showAll', { count: formatInteger(part.first.length + part.rest.length) })}
          </Button>
        </div>
      )}
      {part.withoutText === 0 ? null : (
        <p className="type-meta text-foreground-secondary">{t('headings.withoutText', { count: part.withoutText })}</p>
      )}
      {part.capped === null ? null : (
        <p className="type-meta text-foreground-secondary">
          {t('headings.capped', { shown: formatInteger(part.capped.shown), total: formatInteger(part.capped.total) })}
        </p>
      )}
    </OutlineBlock>
  );
}
