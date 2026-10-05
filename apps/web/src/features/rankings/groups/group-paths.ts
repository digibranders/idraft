import { textLength } from '@/lib/text/length';

/**
 * Group paths as people type them (19 section 3.6.2): names joined by "/", each 1 to 100 characters after
 * trimming, at most 10 levels. Names are unique among siblings in any case, so a path finds its group
 * without case.
 */

export const MAX_GROUP_NAME = 100;
export const MAX_GROUP_DEPTH = 10;

/** What a group list holds that the path helpers read. */
export interface GroupLike {
  group_id: string;
  parent_id: string | null;
  name: string;
  path: string;
}

export type PathProblem = 'empty' | 'too_long' | 'too_deep';

/** The names of a typed path, each trimmed. */
export const splitPath = (text: string): string[] => text.split('/').map((name) => name.trim());

/** What is wrong with a typed path, or `null`. */
export function pathProblem(text: string): PathProblem | null {
  const names = splitPath(text);
  if (names.some((name) => name === '')) return 'empty';
  if (names.some((name) => textLength(name) > MAX_GROUP_NAME)) return 'too_long';
  return names.length > MAX_GROUP_DEPTH ? 'too_deep' : null;
}

const same = (a: string, b: string): boolean => a.toLocaleLowerCase() === b.toLocaleLowerCase();

/** The child of `parentId` named `name`, in any case. */
const childNamed = <G extends GroupLike>(groups: readonly G[], parentId: string | null, name: string): G | null =>
  groups.find((group) => group.parent_id === parentId && same(group.name, name)) ?? null;

/** The group at the end of `names`, or `null` when some level does not exist. */
export function findGroup<G extends GroupLike>(groups: readonly G[], names: readonly string[]): G | null {
  let found: G | null = null;
  let parentId: string | null = null;
  for (const name of names) {
    found = childNamed(groups, parentId, name);
    if (found === null) return null;
    parentId = found.group_id;
  }
  return found;
}

/** The deepest group of `names` that exists, and the names still to create under it. */
export function missingNames(
  groups: readonly GroupLike[],
  names: readonly string[],
): { parentId: string | null; names: string[] } {
  let parentId: string | null = null;
  for (const [index, name] of names.entries()) {
    const child: GroupLike | null = childNamed(groups, parentId, name);
    if (child === null) return { parentId, names: names.slice(index) };
    parentId = child.group_id;
  }
  return { parentId, names: [] };
}
