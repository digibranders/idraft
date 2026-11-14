'use client';

import { ExternalLink, TriangleAlert } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { MouseEvent, ReactElement } from 'react';

import { CopyButton } from './copy-button';
import { Favicon, type FaviconMode } from './domain-cell';
import { visibleUrlText } from './visible-text';
import { buttonVariants } from '@/components/ui/button-variants';
import { Icon } from '@/components/ui/icon';
import { TextLink } from '@/components/ui/text-link';
import { Tooltip } from '@/components/ui/tooltip';
import { displayUrl, webHref } from '@/lib/format';
import { CELL_CONTROL } from '@/lib/tables/grid-focus';
import { cn } from '@/lib/utils';

/** The end of a path keeps its room when the cell is narrow: the file or the slug is what tells pages apart. */
const PATH_END_CHARS = 16;

/**
 * A path whose start gives way to an ellipsis and whose last characters keep their room, so the shortening is
 * CSS and nothing here counts the characters of the column. A screen reader gets the whole path.
 */
function PathText({ path }: Readonly<{ path: string }>): ReactElement {
  const letters = [...path];
  if (letters.length <= PATH_END_CHARS) {
    return (
      <span data-truncate="" className="block min-w-0 truncate">
        {path}
      </span>
    );
  }
  return (
    <>
      <span aria-hidden="true" className="flex min-w-0 overflow-hidden">
        <span data-truncate="" className="min-w-0 truncate">
          {letters.slice(0, -PATH_END_CHARS).join('')}
        </span>
        <span className="shrink-0">{letters.slice(-PATH_END_CHARS).join('')}</span>
      </span>
      <span className="sr-only">{path}</span>
    </>
  );
}

const stop = (event: MouseEvent): void => event.stopPropagation();
/** In a grid a link is a cell control, and a click on it is its own: the row does not open. */
const GRID_LINK = { ...CELL_CONTROL, onClick: stop, onAuxClick: stop };

export interface URLCellProps {
  /** As the API sent it, or null. Parsed with `displayUrl`; only an address `webHref` accepts is ever an href. */
  url: string | null;
  /** `hide` in single-domain tables. */
  hostDisplay: 'show' | 'hide';
  /** What the URL is, for the names of Copy and Open: "cited page", "ranking URL". */
  label: string;
  /** A title an answer gave the page. Untrusted: text only, second line, in `<bdi>`. */
  title?: string | null | undefined;
  /** Shown for `url === null`: "Not cited". Default "No URL". */
  emptyText?: string | undefined;
  favicon?: FaviconMode | undefined;
  /**
   * The source inspector. With it the path opens the inspector and an Open button goes out in a new tab; without
   * it the path itself is the outbound link.
   */
  inspectorHref?: Route | undefined;
  /** `grid` (default): controls are cell controls and clicks do not open the row. `list`: ordinary tab stops. */
  context?: 'grid' | 'list' | undefined;
}

/**
 * A page address in a table or a list (12-tables.md section 6, 22-content-formatting.md section 5): the host in
 * the tertiary color, the path with its end in view, Copy (the original address) and Open on hover and focus.
 * An address a browser would run (a script or data scheme) or that hides its host (credentials) or is not
 * absolute is shown as text with a warning, never as a link. The host is always drawn when `hostDisplay` is
 * `show`, beside an inspector link too, so a path or a title cannot hide where the page is.
 */
export function URLCell({
  url,
  hostDisplay,
  label,
  title,
  emptyText,
  favicon,
  inspectorHref,
  context = 'grid',
}: URLCellProps): ReactElement {
  const t = useTranslations('common.urlCell');
  if (url === null) {
    return (
      <span data-slot="url-cell" className="type-table text-foreground-tertiary">
        {emptyText ?? t('none')}
      </span>
    );
  }
  const parsed = displayUrl(url);
  const href = parsed.valid ? webHref(url) : null;
  const gridProps = context === 'grid' ? GRID_LINK : {};
  const copy = (placement: 'overlay' | 'inline'): ReactElement => (
    <CopyButton
      text={url}
      label={t('copy', { label })}
      announcement={t('copied', { label })}
      placement={placement}
      inGrid={context === 'grid'}
    />
  );
  const root = cn(
    'group/cell relative flex min-w-0 items-center gap-1.5 bg-inherit font-mono type-table',
    context === 'list' && 'group',
  );
  const secondLine =
    title === undefined || title === null || title === '' ? null : (
      <bdi title={title} className="block min-w-0 truncate font-sans text-foreground-secondary">
        {title}
      </bdi>
    );

  if (href === null) {
    return (
      <span data-slot="url-cell" className={root}>
        <span className="flex min-w-0 flex-col">
          <Tooltip content={t('invalid')} purpose="label">
            <span dir="ltr" className="flex min-w-0 items-center gap-1.5 text-foreground-secondary">
              <span className="flex shrink-0 text-warning-text">
                <Icon icon={TriangleAlert} size="sm" label={t('invalid')} />
              </span>
              <span data-truncate="" className="min-w-0 truncate">
                {visibleUrlText(url)}
              </span>
            </span>
          </Tooltip>
          {secondLine}
        </span>
        {copy('overlay')}
      </span>
    );
  }

  // A bare host still has its "/", which is what the link and the Open button hang on
  const path = visibleUrlText(parsed.path);
  // Two rows with one path on two hosts must not sound alike: the names carry the host, a bare host by itself
  const target = path === '/' ? parsed.host : `${parsed.host}${path}`;
  const openName = t('open', { path: target });
  const pathText = <PathText path={path} />;
  const pathClass = 'flex min-w-0 shrink-100 overflow-hidden';
  return (
    <span data-slot="url-cell" className={root}>
      {favicon === undefined ? null : <Favicon host={parsed.host} mode={favicon} />}
      <span className="flex min-w-0 flex-col">
        <Tooltip content={visibleUrlText(parsed.display)} purpose="label">
          <span dir="ltr" className="flex min-w-0">
            {hostDisplay === 'show' ? (
              <span className="min-w-0 shrink truncate text-foreground-tertiary">{parsed.host}</span>
            ) : null}
            {inspectorHref === undefined ? (
              <TextLink
                {...gridProps}
                href={href}
                target="_blank"
                rel="noopener noreferrer nofollow"
                aria-label={openName}
                tone="inherit"
                className={cn(pathClass, 'text-foreground')}
              >
                {pathText}
              </TextLink>
            ) : (
              <TextLink
                {...gridProps}
                render={<Link href={inspectorHref} />}
                aria-label={target}
                tone="inherit"
                className={cn(pathClass, 'text-foreground')}
              >
                {pathText}
              </TextLink>
            )}
          </span>
        </Tooltip>
        {secondLine}
      </span>
      {inspectorHref === undefined ? (
        copy('overlay')
      ) : (
        <span className="absolute inset-y-0 right-0 flex items-center gap-1 bg-inherit pl-1 opacity-0 group-focus-within/cell:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100">
          {copy('inline')}
          <Tooltip content={openName} purpose="label">
            <a
              {...gridProps}
              href={href}
              target="_blank"
              rel="noopener noreferrer nofollow"
              aria-label={openName}
              className={buttonVariants({ variant: 'ghost', size: 'icon-xs' })}
            >
              <Icon icon={ExternalLink} size="sm" />
            </a>
          </Tooltip>
        </span>
      )}
    </span>
  );
}
