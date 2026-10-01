'use client';

import { ChevronRight } from 'lucide-react';
import { useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactElement } from 'react';

import { Icon } from './icon';
import { cn } from '@/lib/utils';

export interface TreeViewNode {
  id: string;
  label: string;
  /** A second, quieter text after the label: a slug, a count. */
  detail?: string | undefined;
  children: readonly TreeViewNode[];
}

export interface TreeViewProps {
  /** The name of the tree: "Topics". */
  label: string;
  nodes: readonly TreeViewNode[];
  /** The chosen node, which the actions beside the tree act on. Selection follows focus. */
  selected: string | null;
  onSelect: (id: string) => void;
  expanded: ReadonlySet<string>;
  onExpandedChange: (expanded: ReadonlySet<string>) => void;
  className?: string | undefined;
}

interface Row {
  node: TreeViewNode;
  level: number;
  parent: string | null;
  size: number;
  position: number;
}

/** The rows a person can see: every root, and the children of each expanded node, in order. */
function visibleRows(nodes: readonly TreeViewNode[], expanded: ReadonlySet<string>): Row[] {
  const rows: Row[] = [];
  const walk = (list: readonly TreeViewNode[], level: number, parent: string | null): void => {
    list.forEach((node, index) => {
      rows.push({ node, level, parent, size: list.length, position: index + 1 });
      if (node.children.length > 0 && expanded.has(node.id)) walk(node.children, level + 1, node.id);
    });
  };
  walk(nodes, 1, null);
  return rows;
}

/**
 * A tree of nested items, such as the terms of a vocabulary (WAI-ARIA tree pattern, single selection).
 * One item is a tab stop. Up and Down move, Right opens an item or moves into it, Left closes it or moves
 * to its parent, Home and End go to the ends, and typing a letter moves to the next item that starts with
 * it. Actions live outside the tree and act on the selected item, so no control sits inside an item.
 */
export function TreeView({
  label,
  nodes,
  selected,
  onSelect,
  expanded,
  onExpandedChange,
  className,
}: TreeViewProps): ReactElement {
  const rows = visibleRows(nodes, expanded);
  // An item is named by its own label, not by the labels of the items nested in it
  const labelPrefix = useId();
  const items = useRef(new Map<string, HTMLLIElement>());
  const [focused, setFocused] = useState<string | null>(null);
  // The tab stop: the focused item, else the selected one if it is visible, else the first
  const tabStop =
    rows.find((row) => row.node.id === focused)?.node.id ??
    rows.find((row) => row.node.id === selected)?.node.id ??
    rows[0]?.node.id;

  const moveTo = (id: string): void => {
    setFocused(id);
    onSelect(id);
    items.current.get(id)?.focus();
  };
  const toggle = (id: string, open: boolean): void => {
    const next = new Set(expanded);
    if (open) next.add(id);
    else next.delete(id);
    onExpandedChange(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLLIElement>, row: Row): void => {
    // Keys pressed inside a nested item reach the item itself first
    if (event.target !== event.currentTarget) return;
    const index = rows.indexOf(row);
    const hasChildren = row.node.children.length > 0;
    const open = hasChildren && expanded.has(row.node.id);
    let handled = true;
    switch (event.key) {
      case 'ArrowDown': {
        const next = rows[index + 1];
        if (next) moveTo(next.node.id);
        break;
      }
      case 'ArrowUp': {
        const previous = rows[index - 1];
        if (previous) moveTo(previous.node.id);
        break;
      }
      case 'ArrowRight':
        if (hasChildren && !open) toggle(row.node.id, true);
        else if (open) {
          const child = row.node.children[0];
          if (child) moveTo(child.id);
        }
        break;
      case 'ArrowLeft':
        if (open) toggle(row.node.id, false);
        else if (row.parent !== null) moveTo(row.parent);
        break;
      case 'Home': {
        const first = rows[0];
        if (first) moveTo(first.node.id);
        break;
      }
      case 'End': {
        const last = rows[rows.length - 1];
        if (last) moveTo(last.node.id);
        break;
      }
      case 'Enter':
      case ' ':
        onSelect(row.node.id);
        break;
      default: {
        if (event.key.length !== 1 || event.altKey || event.ctrlKey || event.metaKey) {
          handled = false;
          break;
        }
        const letter = event.key.toLocaleLowerCase();
        const after = [...rows.slice(index + 1), ...rows.slice(0, index + 1)];
        const match = after.find((candidate) => candidate.node.label.toLocaleLowerCase().startsWith(letter));
        if (match) moveTo(match.node.id);
      }
    }
    if (handled) event.preventDefault();
  };

  const render = (list: readonly TreeViewNode[], level: number, parent: string | null): ReactElement[] =>
    list.map((node, index) => {
      const row: Row = rows.find((candidate) => candidate.node.id === node.id) ?? {
        node,
        level,
        parent,
        size: list.length,
        position: index + 1,
      };
      const hasChildren = node.children.length > 0;
      const open = hasChildren && expanded.has(node.id);
      const isSelected = node.id === selected;
      return (
        <li
          key={node.id}
          ref={(element) => {
            if (element === null) items.current.delete(node.id);
            else items.current.set(node.id, element);
          }}
          role="treeitem"
          aria-labelledby={`${labelPrefix}-${node.id}`}
          aria-level={level}
          aria-setsize={list.length}
          aria-posinset={index + 1}
          aria-selected={isSelected}
          aria-expanded={hasChildren ? open : undefined}
          tabIndex={node.id === tabStop ? 0 : -1}
          onKeyDown={(event) => onKeyDown(event, row)}
          onClick={(event) => {
            // A click on a nested item is that item's own, not its parent's too
            event.stopPropagation();
            if (hasChildren && event.target instanceof Element && event.target.closest('[data-tree-toggle]')) {
              toggle(node.id, !open);
            }
            setFocused(node.id);
            onSelect(node.id);
          }}
          onFocus={(event) => {
            if (event.target === event.currentTarget) setFocused(node.id);
          }}
          className="group/item outline-none"
        >
          <div
            style={{ '--tree-level': level - 1 } as CSSProperties}
            className={cn(
              'flex h-8 cursor-default items-center gap-1.5 rounded-md pr-2 pl-[calc(var(--tree-level)*1.25rem+0.25rem)] type-body text-foreground select-none hover:bg-surface-hover',
              'group-focus-visible/item:focus-ring-inset',
              isSelected && 'bg-surface-selected hover:bg-surface-selected',
            )}
          >
            <span
              aria-hidden="true"
              data-tree-toggle
              className="flex size-5 shrink-0 items-center justify-center rounded-xs text-foreground-tertiary hover:text-foreground"
            >
              {hasChildren ? (
                <Icon icon={ChevronRight} size="sm" className={cn('transition-transform', open && 'rotate-90')} />
              ) : null}
            </span>
            <span id={`${labelPrefix}-${node.id}`} className="min-w-0 flex-1 truncate">
              {node.label}
            </span>
            {node.detail === undefined ? null : <span className="shrink-0 type-meta">{node.detail}</span>}
          </div>
          {open ? (
            <ul role="group" className="flex flex-col">
              {render(node.children, level + 1, node.id)}
            </ul>
          ) : null}
        </li>
      );
    });

  return (
    <ul role="tree" aria-label={label} className={cn('flex flex-col', className)}>
      {render(nodes, 1, null)}
    </ul>
  );
}
