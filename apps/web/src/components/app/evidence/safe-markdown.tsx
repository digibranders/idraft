import { Fragment, type ReactElement, type ReactNode } from 'react';

import { parseMarkdown, type Block, type Inline } from './markdown-subset';
import { TextLink } from '@/components/ui/text-link';
import { displayDomain } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface SafeMarkdownProps {
  /** The answer as the engine wrote it: collected text, never trusted. */
  source: string;
  /** The language of the answer, for hyphenation and screen readers. */
  lang?: string | undefined;
  className?: string | undefined;
}

/** A heading in an answer sits below the card's own `h3`: `#` is an `h4`, and none goes deeper than `h6`. */
const HEADING_TAG = { 1: 'h4', 2: 'h5', 3: 'h6', 4: 'h6', 5: 'h6', 6: 'h6' } as const;
/** An http or https link leaves the app: a new tab that cannot reach back into it. */
const NEW_TAB = { target: '_blank', rel: 'noopener noreferrer' } as const;
const DEPTH_INDENT: readonly string[] = [cn(''), cn('ms-4'), cn('ms-8')];

/** What shows beside a link: the host an http or https address goes to, or the mailbox of a mailto address. */
function hostOf(href: string): string {
  const url = new URL(href);
  if (url.protocol !== 'mailto:') return displayDomain(url.hostname);
  try {
    return decodeURIComponent(url.pathname);
  } catch {
    // Not valid percent-encoding (`%zz`): shown as written, never an error in the page
    return url.pathname;
  }
}

function Inlines({ nodes }: { nodes: readonly Inline[] }): ReactNode {
  return nodes.map((node, place) => {
    // The tree is static data, rebuilt whole from the source: an index is a stable key
    const key = place;
    switch (node.kind) {
      case 'text':
        return <Fragment key={key}>{node.text}</Fragment>;
      case 'strong':
        return (
          <strong key={key} className="type-body-strong">
            <Inlines nodes={node.children} />
          </strong>
        );
      case 'em':
        return (
          <em key={key}>
            <Inlines nodes={node.children} />
          </em>
        );
      case 'code':
        return (
          <code key={key} className="rounded-xs bg-surface-subtle px-1 type-mono">
            {node.text}
          </code>
        );
      case 'link': {
        const web = node.href.toLowerCase().startsWith('http');
        return (
          <Fragment key={key}>
            <TextLink href={node.href} variant="inline" {...(web ? NEW_TAB : {})}>
              <Inlines nodes={node.children} />
            </TextLink>
            {/* The title of a link is chosen by the page it came from: where it goes is always shown */}
            <span className="ms-1 type-meta">{hostOf(node.href)}</span>
          </Fragment>
        );
      }
    }
  });
}

function BlockView({ block }: { block: Block }): ReactElement {
  switch (block.kind) {
    case 'heading': {
      const Tag = HEADING_TAG[block.level];
      return (
        <Tag className="type-body-strong">
          <Inlines nodes={block.children} />
        </Tag>
      );
    }
    case 'paragraph':
      return (
        <p className="whitespace-pre-wrap">
          <Inlines nodes={block.children} />
        </p>
      );
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul';
      return (
        <Tag className={cn('flex flex-col gap-1 ps-6', block.ordered ? 'list-decimal' : 'list-disc')}>
          {block.items.map((item, place) => (
            // Static data again: items have no identity but their place
            <li key={place} className={cn('whitespace-pre-wrap', DEPTH_INDENT[item.depth])}>
              <Inlines nodes={item.children} />
            </li>
          ))}
        </Tag>
      );
    }
    case 'code':
      return (
        <pre className="rounded-md bg-surface-subtle p-3 type-mono whitespace-pre-wrap">
          <code>{block.text}</code>
        </pre>
      );
    case 'rule':
      return <hr className="border-border-subtle" />;
  }
}

/**
 * The Formatted view of an answer (23-application-patterns.md sections 5.1 and 5.6): a subset of Markdown as
 * React elements, with no highlights. Text from the outside never becomes markup here: HTML in it is text, an image is
 * its alt text, a table is its rows, and a link that is not http, https or mailto is its label. A link opens in a new
 * tab with `noopener noreferrer` and shows its host. There is no `dangerouslySetInnerHTML` in the way from the source to
 * the page, and no library to trust.
 */
export function SafeMarkdown({ source, lang, className }: SafeMarkdownProps): ReactElement {
  return (
    <div
      data-slot="safe-markdown"
      lang={lang}
      className={cn('flex flex-col gap-3 type-prose wrap-anywhere', className)}
    >
      {parseMarkdown(source).map((block, place) => (
        // The blocks are rebuilt whole from the source, so a block has no identity but its place
        <BlockView key={place} block={block} />
      ))}
    </div>
  );
}
