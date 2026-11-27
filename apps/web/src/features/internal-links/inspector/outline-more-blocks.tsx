'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';

import { OutlineBlock, OutlineFact } from './outline-block';
import { Findings, type BlockProps } from './outline-blocks';
import { Badge } from '@/components/ui/badge';
import { formatInteger } from '@/lib/format';
import type { OutlineSummaryPart } from '@/lib/pages/outline-model';

type PartProps = BlockProps & { part: OutlineSummaryPart };

/** The path of an address, as text. The page's text, so never an `href`. */
function pathOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

/** A value of the page, or "Missing" when the page does not give it. */
function PageValue({ value, missing }: { value: string | null; missing: string }): ReactElement {
  return value === null ? <span className="text-foreground-tertiary">{missing}</span> : <span>{value}</span>;
}

export function LanguagesBlock({ outline, part, open, onToggle, issueHref }: PartProps): ReactElement {
  const t = useTranslations('pages.drawer.outline');
  const { pairs } = outline.languages;
  // The ids are those of `OutlineSummary.id`, all under `languages`
  const summary = t(`languages.${part.summary.id}` as 'languages.summary', part.summary.values);
  return (
    <OutlineBlock
      id="languages"
      title={t('languages.title')}
      summary={summary}
      tone={part.tone}
      open={open}
      onToggle={onToggle}
    >
      {pairs.length === 0 ? (
        <p className="type-body text-foreground-secondary">{t('languages.none')}</p>
      ) : (
        <ul aria-label={t('languages.listLabel')} className="flex flex-col gap-1.5">
          {pairs.map((pair, index) => (
            // The order is the page's and a code can repeat, so the place in the list is its identity
            <li key={index} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="type-mono wrap-anywhere">{pair.code}</span>
              <span className="min-w-0 type-meta wrap-anywhere text-foreground-secondary">{pathOf(pair.href)}</span>
              {pair.is_self ? <Badge tone="neutral">{t('languages.thisPage')}</Badge> : null}
              {pair.valid ? null : <Badge tone="warning">{t('languages.wrongCode')}</Badge>}
            </li>
          ))}
        </ul>
      )}
      <Findings findings={part.findings} issueHref={issueHref} t={t} />
    </OutlineBlock>
  );
}

export function SharingBlock({ outline, part, open, onToggle, issueHref }: PartProps): ReactElement {
  const t = useTranslations('pages.drawer.outline');
  const { social } = outline;
  const missing = t('sharing.missing');
  // The image is shown as its address in text: it is never drawn or linked, because it is the page's own text
  const facts: [string, string | null][] = [
    [t('sharing.factTitle'), social.og_title],
    [t('sharing.factDescription'), social.og_description],
    [t('sharing.factImage'), social.og_image],
    [t('sharing.factType'), social.og_type],
    [t('sharing.factCard'), social.twitter_card],
  ];
  return (
    <OutlineBlock
      id="sharing"
      title={t('sharing.title')}
      summary={t(`sharing.${part.summary.id}` as 'sharing.summaryFine')}
      tone={part.tone}
      open={open}
      onToggle={onToggle}
    >
      <Findings findings={part.findings} issueHref={issueHref} t={t} />
      <dl className="flex flex-col gap-3">
        {facts.map(([label, value]) => (
          <OutlineFact key={label} label={label}>
            <PageValue value={value} missing={missing} />
          </OutlineFact>
        ))}
      </dl>
    </OutlineBlock>
  );
}

export function StructuredBlock({ outline, part, open, onToggle, issueHref }: PartProps): ReactElement {
  const t = useTranslations('pages.drawer.outline');
  const blocks = outline.structured_data;
  const summary = t(`structured.${part.summary.id}` as 'structured.summary', part.summary.values);
  return (
    <OutlineBlock
      id="structured"
      title={t('structured.title')}
      summary={summary}
      tone={part.tone}
      open={open}
      onToggle={onToggle}
    >
      <Findings findings={part.findings} issueHref={issueHref} t={t} />
      {blocks.length === 0 ? (
        <p className="type-body text-foreground-secondary">{t('structured.none')}</p>
      ) : (
        <ul aria-label={t('structured.listLabel')} className="flex flex-col gap-1.5">
          {blocks.map((block, index) => (
            // Blocks have no name of their own, so the place in the page is the identity
            <li key={index} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="min-w-0 type-body wrap-anywhere">
                {block.types.length === 0 ? t('structured.unnamed') : block.types.join(', ')}
              </span>
              <Badge tone={block.parses ? 'positive' : 'warning'}>
                {block.parses ? t('structured.valid') : t('structured.unreadable')}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </OutlineBlock>
  );
}

const note = (children: ReactNode): ReactElement => (
  <span className="type-meta text-foreground-secondary">{children}</span>
);

export function ContentBlock({
  outline,
  part,
  open,
  onToggle,
  issueHref,
  outlinks,
}: PartProps & {
  /** The links out of the page row the drawer holds, which the outline does not carry. Null while that read is pending. */
  outlinks: number | null;
}): ReactElement {
  const t = useTranslations('pages.drawer.outline');
  const { content } = outline;
  const summary = t('content.summary', { words: formatInteger(content.words), images: content.images });
  return (
    <OutlineBlock
      id="content"
      title={t('content.title')}
      summary={summary}
      tone={part.tone}
      open={open}
      onToggle={onToggle}
    >
      <Findings findings={part.findings} issueHref={issueHref} t={t} />
      <dl className="flex flex-col gap-3">
        <OutlineFact label={t('content.factWords')}>
          <span className="num">{formatInteger(content.words)}</span>
          {note(t('content.readTime', { minutes: content.read_minutes }))}
        </OutlineFact>
        <OutlineFact label={t('content.factImages')}>
          {content.images === 0 ? (
            <span>{t('content.noImages')}</span>
          ) : (
            <>
              <span className="num">{formatInteger(content.images)}</span>
              {note(
                content.images_without_alt > 0
                  ? t('content.noAlt', { count: formatInteger(content.images_without_alt) })
                  : t('content.allAlt'),
              )}
            </>
          )}
        </OutlineFact>
        {outlinks === null ? null : (
          <OutlineFact label={t('content.factLinksOut')}>
            <span className="num">{t('content.linksOut', { count: outlinks })}</span>
            {note(t('content.linksOutNote'))}
          </OutlineFact>
        )}
      </dl>
    </OutlineBlock>
  );
}
