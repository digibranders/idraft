import { MAX_GROUP_DEPTH } from './group-paths';
import type { TreeViewNode } from '@/components/ui/tree-view';

/** A group as the tree format lists it. */
export interface GroupNode {
  group_id: string;
  parent_id: string | null;
  name: string;
  path: string;
  keyword_count: number;
  created_at: string;
  children: readonly GroupNode[];
}

/** Every group, depth first, as the tree lists them. */
export const flattenGroups = (nodes: readonly GroupNode[]): GroupNode[] =>
  nodes.flatMap((node) => [node, ...flattenGroups(node.children)]);

/** The group and every group under it. */
export const subtreeIds = (node: GroupNode): Set<string> =>
  new Set(flattenGroups([node]).map((group) => group.group_id));

/** The levels a group's path has: a group at the top is level 1. */
const levelOf = (node: GroupNode): number => node.path.split('/').length;

/** The levels of a group and its subgroups: 1 for a group with none, 3 with subgroups two levels down. */
export const subtreeHeight = (node: GroupNode): number =>
  Math.max(...flattenGroups([node]).map((group) => levelOf(group))) - levelOf(node) + 1;

/**
 * The groups `group` can be moved under: not itself or a group under it, and not one so deep that the
 * moved subtree would pass 10 levels (the API refuses that with `too_deep`).
 */
export const moveTargets = (all: readonly GroupNode[], group: GroupNode): GroupNode[] => {
  const blocked = subtreeIds(group);
  const height = subtreeHeight(group);
  return all.filter((target) => !blocked.has(target.group_id) && levelOf(target) + height <= MAX_GROUP_DEPTH);
};

/** The ids of the groups above `id`, root first; empty for a root or an unknown id. */
export function ancestorsOf(nodes: readonly GroupNode[], id: string): string[] {
  for (const node of nodes) {
    if (node.group_id === id) return [];
    const below = ancestorsOf(node.children, id);
    if (below.length > 0 || node.children.some((child) => child.group_id === id)) return [node.group_id, ...below];
  }
  return [];
}

/** The tree view's nodes, each with its keyword count as the quiet detail. */
export const toTreeNodes = (nodes: readonly GroupNode[], countText: (count: number) => string): TreeViewNode[] =>
  nodes.map((node) => ({
    id: node.group_id,
    label: node.name,
    detail: countText(node.keyword_count),
    children: toTreeNodes(node.children, countText),
  }));
