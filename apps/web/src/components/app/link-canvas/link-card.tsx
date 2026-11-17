'use client';

import { ArrowLeftRight, ChevronDown, ChevronRight, CornerUpLeft, Crosshair, Info, PanelRightOpen } from 'lucide-react';
import { memo, useId, type KeyboardEvent, type PointerEvent, type ReactElement } from 'react';

import { InfoPanel, INFO_TOGGLE_ATTRIBUTE, type InfoFacts } from './info-panel';
import { tierEdge } from '@/components/app/tier/tier-colors';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { IconButton } from '@/components/ui/icon-button';
import { Tooltip } from '@/components/ui/tooltip';
import type { Offset } from '@/lib/internal-links/canvas-selection';
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
  /**
   * Handlers take what they act on, so the canvas can hand every card the same functions and a card can be memoised.
   * `modified` is Shift, Cmd or Ctrl held: the card is added to the selection instead of opening.
   */
  onActivate: (nodeKey: string, modified: boolean) => void;
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
  /** "N in": the pages that link here. */
  linkingText: string;
  /** The status badge for a page that is not 200; `null` for a 200. */
  status: { text: string; tone: 'warning' | 'negative' | 'neutral' } | null;
  /** The words for the two-way arrow; `null` when the page does not link back. */
  bothWaysText: string | null;
  focus: boolean;
  /** The focus card's third line: "N out" and "N clicks from home". */
  focusFacts: { out: string; depth: string } | null;
  /** `null`: the card cannot open. */
  open: boolean | null;
  /** What a screen reader hears after the name: status, depth, linking pages, this link. Hidden from the eye. */
  description: string;
  selected: boolean;
  /** Where the person moved the card to, from where the layout puts it; `null` when it was not moved. */
  offset: Offset | null;
  /** A press that may start moving the card (the canvas decides: not on touch, not with a modifier key). */
  onDragStart: (nodeKey: string, event: PointerEvent<HTMLButtonElement>) => void;
  /** The "i" button: the panel opens from it only, never on hover. */
  info: {
    facts: InfoFacts;
    label: string;
    buttonLabel: string;
    open: boolean;
    onToggle: (nodeKey: string) => void;
    onClose: (nodeKey: string, restoreFocus: boolean) => void;
  };
  tools: {
    focusLabel: string | null;
    onFocusPage: (urlId: string) => void;
    detailsLabel: string;
    onDetails: (urlId: string) => void;
  };
  back: {
    count: number;
    label: string;
    pressed: boolean;
    tip: { content: string; detail: string };
    onToggle: (nodeKey: string) => void;
    onShow: (nodeKey: string, shown: boolean) => void;
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

/** Equal by value, and by identity for functions: a card whose text and state did not change is not drawn again. */
function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const left = Object.entries(a);
  return (
    left.length === Object.keys(b).length &&
    left.every(([key, value]) => same(value, Object.getOwnPropertyDescriptor(b, key)?.value))
  );
}

/**
 * One node of the link canvas (spec 7.5 and 7.9, 25 section 14.16): a page card with a left edge in its tier color,
 * a dashed stub for a page already on the canvas, or a group card that stands for the links of another scope. A pan or
 * a zoom of the canvas does not draw the cards again (the canvas can hold 300).
 */
export const LinkCard = memo(LinkCardView, (previous, next) => same(previous, next));

function LinkCardView(props: LinkCardProps): ReactElement {
  const describedBy = useId();
  if (props.kind === 'group') {
    return (
      <button
        type="button"
        {...dataOf(props)}
        tabIndex={props.tabStop ? 0 : -1}
        aria-label={props.name}
        aria-expanded={props.open}
        onClick={() => props.onActivate(props.nodeKey, false)}
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
        onClick={() => props.onActivate(props.nodeKey, false)}
        onKeyDown={props.onKeyDown}
        className={cn(
          BASE,
          'border-l-4 border-dashed border-border-strong bg-surface hover:bg-surface-hover',
          tierEdge(props.tier),
          props.highlighted && HIGHLIGHT,
        )}
      >
        <span className="truncate type-table text-foreground">{props.path}</span>
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate type-label text-foreground-secondary">{props.line}</span>
          <span className="shrink-0 type-meta text-foreground-tertiary">{props.note}</span>
        </span>
      </button>
    );
  }
  const { back, tools, info, focusFacts } = props;
  return (
    <div
      className={cn('group relative', props.focus ? 'w-72' : 'w-60')}
      style={props.offset === null ? undefined : { transform: `translate(${props.offset.dx}px, ${props.offset.dy}px)` }}
    >
      <button
        type="button"
        {...dataOf(props)}
        tabIndex={props.tabStop ? 0 : -1}
        aria-label={props.name}
        aria-describedby={describedBy}
        aria-expanded={props.open === null ? undefined : props.open}
        onClick={(event) => props.onActivate(props.nodeKey, event.shiftKey || event.metaKey || event.ctrlKey)}
        onPointerDown={(event) => props.onDragStart(props.nodeKey, event)}
        onKeyDown={props.onKeyDown}
        className={cn(
          BASE,
          'border-l-4',
          tierEdge(props.tier),
          props.focus ? 'border-2 border-primary ring-4 ring-primary/15' : 'border-border-strong',
          props.open === true ? 'bg-primary-subtle' : 'bg-surface hover:bg-surface-hover',
          props.selected && 'ring-2 ring-primary',
          props.highlighted && HIGHLIGHT,
        )}
      >
        <span className="flex min-w-0 items-center gap-1">
          {props.open === null ? null : (
            <Icon icon={props.open ? ChevronDown : ChevronRight} size="xs" className="text-foreground-tertiary" />
          )}
          <span className={cn('truncate text-foreground', props.focus ? 'type-body-strong' : 'type-table')}>
            {props.path}
          </span>
        </span>
        <span className={cn('flex min-w-0 items-center gap-2', back !== null && 'pr-10')}>
          <span className="min-w-0 flex-1 truncate type-label text-foreground-secondary">{props.line}</span>
          <span className="flex shrink-0 items-center gap-1.5 type-meta text-foreground-tertiary">
            <span className="text-foreground-secondary">{props.tierText}</span>
            <span className="num">{props.linkingText}</span>
            {props.status === null ? null : <Badge tone={props.status.tone}>{props.status.text}</Badge>}
            {props.bothWaysText === null ? null : (
              <span data-both-ways="" title={props.bothWaysText} className="inline-flex text-primary-text">
                <Icon icon={ArrowLeftRight} size="xs" />
              </span>
            )}
          </span>
        </span>
        {focusFacts === null ? null : (
          <span className="mt-0.5 flex items-center gap-3 type-meta text-foreground-tertiary">
            <span className="num">{focusFacts.out}</span>
            <span>{focusFacts.depth}</span>
          </span>
        )}
      </button>
      <span id={describedBy} className="sr-only">
        {props.description}
      </span>
      {/* Hidden tools take no pointer, so a tap on the corner of a card cannot hit one it does not show; a touch screen has no hover, so there they always show */}
      <div className="pointer-events-none absolute top-1 right-1 flex gap-0.5 rounded-sm bg-surface opacity-0 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100">
        <IconButton
          icon={Info}
          size="icon-xs"
          variant="secondary"
          label={info.buttonLabel}
          tabIndex={props.tabStop ? 0 : -1}
          aria-expanded={info.open}
          {...{ [INFO_TOGGLE_ATTRIBUTE]: '' }}
          onClick={() => info.onToggle(props.nodeKey)}
        />
        {tools.focusLabel === null ? null : (
          <IconButton
            icon={Crosshair}
            size="icon-xs"
            variant="secondary"
            label={tools.focusLabel}
            tabIndex={props.tabStop ? 0 : -1}
            onClick={() => tools.onFocusPage(props.urlId ?? '')}
          />
        )}
        <IconButton
          icon={PanelRightOpen}
          size="icon-xs"
          variant="secondary"
          label={tools.detailsLabel}
          tabIndex={props.tabStop ? 0 : -1}
          onClick={() => tools.onDetails(props.urlId ?? '')}
        />
      </div>
      {back === null ? null : (
        <Tooltip content={back.tip.content} detail={back.tip.detail}>
          <button
            type="button"
            tabIndex={props.tabStop ? 0 : -1}
            aria-label={back.label}
            aria-pressed={back.pressed}
            onClick={() => back.onToggle(props.nodeKey)}
            onMouseEnter={() => back.onShow(props.nodeKey, true)}
            onMouseLeave={() => back.onShow(props.nodeKey, false)}
            onFocus={() => back.onShow(props.nodeKey, true)}
            onBlur={() => back.onShow(props.nodeKey, false)}
            className="absolute right-3 bottom-2 flex items-center gap-1 rounded-sm px-1 type-label whitespace-nowrap text-primary-text hover:underline focus-visible:focus-ring aria-pressed:bg-primary-subtle"
          >
            <Icon icon={CornerUpLeft} size="xs" />
            <span className="num">{back.count}</span>
          </button>
        </Tooltip>
      )}
      {info.open ? (
        <InfoPanel
          label={info.label}
          facts={info.facts}
          onClose={(restoreFocus) => info.onClose(props.nodeKey, restoreFocus)}
        />
      ) : null}
    </div>
  );
}
