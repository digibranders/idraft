import { findGroup, missingNames, splitPath, type GroupLike } from './group-paths';

/** Creates one group under `parentId` (or at the root) and answers it. */
export type CreateGroup = (name: string, parentId: string | null) => Promise<GroupLike>;

/**
 * The group id of each path, creating the levels that do not exist yet, parents before children. Paths
 * are taken in order and a level created for one path serves the next, so "Blog/Guides" and "blog/guides"
 * create Guides once. A refusal of `create` rejects with that refusal; the levels made before it stay.
 */
export async function ensureGroups(
  paths: readonly string[],
  existing: readonly GroupLike[],
  create: CreateGroup,
): Promise<string[]> {
  const known: GroupLike[] = [...existing];
  const ids: string[] = [];
  for (const path of paths) {
    const names = splitPath(path);
    const found = findGroup(known, names);
    if (found !== null) {
      ids.push(found.group_id);
      continue;
    }
    const missing = missingNames(known, names);
    let parentId = missing.parentId;
    for (const name of missing.names) {
      const made = await create(name, parentId);
      known.push(made);
      parentId = made.group_id;
    }
    if (parentId === null) throw new Error(`No group was made for the path "${path}"`);
    ids.push(parentId);
  }
  return ids;
}
