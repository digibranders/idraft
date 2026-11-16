'use client';

import { ChevronDown, ChevronRight, CornerUpLeft, Crosshair, PanelRightOpen } from 'lucide-react';
import type { KeyboardEvent, ReactElement } from 'react';

import { tierEdge } from '@/components/app/tier/tier-colors';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { IconButton } from '@/components/ui/icon-button';
import { Tooltip } from '@/components/ui/tooltip';
import type { TierNameLike } from '@/lib/internal-links/tiers';
import { cn } from '@/lib/utils';

/** What every node of the canvas carries for the keyboard model and the edges (spec 7.5). */
export interface CanvasNodeData {
  nodeKey: string;
  parentKey: string | null;
  column: number;
  urlId: string | null;
  kind: 'card' | 'stub' | 'group';
  /** The accessible name. */
  name: string;
  /** Dashed outline: a back link's target while its arrows show, or the original a stub found. */
  highlighted: boolean;
  /** The one node of the canvas in the Tab order (the others are reached with the arrow keys); its tools and marker follow it. */
  tabStop: boolean;
  onActivate: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}

export interface LinkCardPageProps extends CanvasNodeData {
  kind: 'card';
  path: string;
  /** The link's anchor (with its scope when not editorial), or the title on the focus card. */
  line: string;
  tier: TierNameLike | null;
  /** The tier code, or the word for Untiered. */
  tierText: string;
  linkingText: string;
  /** The status badge for a page that is not 200; `null` for a 200. */
  status: { text: string; tone: 'warning' | 'negative' | 'neutral' } | null;
  bothWaysText: string | null;
  focus: boolean;
  /** `null`: the card cannot open. */
  open: boolean | null;
  tip: { content: string; detail: string };
  tools: { focusLabel: string | null; onFocusPage: () => void; detailsLabel: string; onDetails: () => void };
  back: {
    count: number;
    label: string;
    pressed: boolean;
    tip: { content: string; detail: string };
    onToggle: () => void;
    onShow: (shown: boolean) => void;
  } | null;
}

export interface LinkCardStubProps extends CanvasNodeData {
  kind: 'stub';
  path: string;
  line: string;
  tier: TierNameLike | null;
  note: string;
}

export interface LinkCardGroupProps extends CanvasNodeData {
  kind: 'group';
  label: string;
  meta: string;
  open: boolean;
}

export type LinkCardProps = LinkCardPageProps | LinkCardStubProps | LinkCardGroupProps;

// The mock's 10 px side padding is no spacing step (04-spacing-density.md): the card takes the next step up, 12 px
const BASE = 'relative flex w-full flex-col gap-0.5 rounded-md border px-3 py-2 text-left focus-visible:focus-ring';
const HIGHLIGHT = 'outline-2 outline-offset-2 outline-primary outline-dashed';

function dataOf(props: CanvasNodeData): Record<string, string> {
  return {
    'data-node': '',
    'data-key': props.nodeKey,
    'data-kind': props.kind,
    'data-col': String(props.column),
    ...(props.parentKey === null ? {} : { 'data-parent': props.parentKey }),
    ...(props.urlId === null ? {} : { 'data-url': props.urlId }),
  };
}

/**
 * One node of the link canvas (spec 7.5 and 7.9, 25 section 14.16): a page card with a left edge in its tier color,
 * a dashed stub for a page already on the canvas, or a group card that stands for the links of another scope.
 */
export function LinkCard(props: LinkCardProps): ReactElement {
  if (props.kind === 'group') {
    return (
      <button
        type="button"
        {...dataOf(props)}
        tabIndex={props.tabStop ? 0 : -1}
        aria-label={props.name}
        aria-expanded={props.open}
        onClick={props.onActivate}
        onKeyDown={props.onKeyDown}
        className={cn(
          BASE,
          'border-border-strong bg-surface-subtle hover:bg-surface-hover',
          props.highlighted && HIGHLIGHT,
        )}
      >
        <span className="flex items-center gap-1">
          <Icon icon={props.open ? ChevronDown : ChevronRight} size="xs" className="text-foreground-tertiary" />
          <span className="type-label text-foreground">{props.label}</span>
        </span>
        <span className="type-meta text-foreground-tertiary">{props.meta}</span>
      </button>
    );
  }
  if (props.kind === 'stub') {
    return (
      <button
        type="button"
        {...dataOf(props)}
        tabIndex={props.tabStop ? 0 : -1}
        aria-label={props.name}
        onClick={props.onActivate}
        onKeyDown={props.onKeyDown}
        className={cn(
          BASE,
          'border-l-4 border-dashed border-border-strong bg-surface hover:bg-surface-hover',
          tierEdge(props.tier),
          props.highlighted && HIGHLIGHT,
        )}
      >
        <span className="truncate type-table text-foreground">{props.path}</span>
        <span className="truncate type-label text-foreground-secondary">{props.line}</span>
        <span className="type-meta text-foreground-tertiary">{props.note}</span>
      </button>
    );
  }
  const { back, tools } = props;
  return (
    <div className="group relative">
      <Tooltip content={props.tip.content} detail={props.tip.detail}>
        <button
          type="button"
          {...dataOf(props)}
          tabIndex={props.tabStop ? 0 : -1}
          aria-label={props.name}
          aria-expanded={props.open === null ? undefined : props.open}
          onClick={props.onActivate}
          onKeyDown={props.onKeyDown}
          className={cn(
            BASE,
            'border-l-4',
            tierEdge(props.tier),
            props.focus ? 'border-primary-border ring-1 ring-primary-border' : 'border-border-strong',
            props.open === true ? 'bg-primary-subtle' : 'bg-surface hover:bg-surface-hover',
            props.highlighted && HIGHLIGHT,
          )}
        >
          <span className="flex min-w-0 items-center gap-1 pr-12">
            {props.open === null ? null : (
              <Icon icon={props.open ? ChevronDown : ChevronRight} size="xs" className="text-foreground-tertiary" />
            )}
            <span className="truncate type-table text-foreground">{props.path}</span>
          </span>
          <span className="truncate type-label text-foreground-secondary">{props.line}</span>
          <span
            className={cn(
              'flex flex-wrap items-center gap-x-1.5 gap-y-0.5 type-meta text-foreground-tertiary',
              back !== null && 'pr-10',
            )}
          >
            <span className="text-foreground-secondary">{props.tierText}</span>
            <span className="num">{props.linkingText}</span>
            {props.status === null ? null : <Badge tone={props.status.tone}>{props.status.text}</Badge>}
            {props.bothWaysText === null ? null : (
              <span className="inline-flex h-badge items-center rounded-sm bg-primary-subtle px-1.5 type-label whitespace-nowrap text-primary-text">
                {props.bothWaysText}
              </span>
            )}
          </span>
        </button>
      </Tooltip>
      {/* Hidden tools take no pointer, so a tap on the corner of a card cannot hit one it does not show; a touch screen has no hover, so there they always show */}
      <div className="pointer-events-none absolute top-1 right-1 flex gap-0.5 opacity-0 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100">
        {tools.focusLabel === null ? null : (
          <IconButton
            icon={Crosshair}
            size="icon-xs"
            variant="secondary"
            label={tools.focusLabel}
            tabIndex={props.tabStop ? 0 : -1}
            onClick={tools.onFocusPage}
          />
        )}
        <IconButton
          icon={PanelRightOpen}
          size="icon-xs"
          variant="secondary"
          label={tools.detailsLabel}
          tabIndex={props.tabStop ? 0 : -1}
          onClick={tools.onDetails}
        />
      </div>
      {back === null ? null : (
        <Tooltip content={back.tip.content} detail={back.tip.detail}>
          <button
            type="button"
            tabIndex={props.tabStop ? 0 : -1}
            aria-label={back.label}
            aria-pressed={back.pressed}
            onClick={back.onToggle}
            onMouseEnter={() => back.onShow(true)}
            onMouseLeave={() => back.onShow(false)}
            onFocus={() => back.onShow(true)}
            onBlur={() => back.onShow(false)}
            className="absolute right-3 bottom-2 flex items-center gap-1 rounded-sm px-1 type-label whitespace-nowrap text-primary-text hover:underline focus-visible:focus-ring aria-pressed:bg-primary-subtle"
          >
            <Icon icon={CornerUpLeft} size="xs" />
            <span className="num">{back.count}</span>
          </button>
        </Tooltip>
      )}
    </div>
  );
}
