# Keyword Groups (Frontend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an editor file keywords in nested groups: pick or create a group wherever keywords get one (Add keywords, the inspector, bulk "Move to group"), and add, rename, move and delete groups in a "Manage groups" dialog with each group's keyword count.

**Architecture:** This is Task 8 of `docs/superpowers/plans/2026-10-01-keywords-ui.md`, written out step by step. A pure module turns typed paths ("Blog/Guides") into names and finds the groups that exist; a small async helper creates the missing ones level by level when a form is saved, never when a choice is picked, so a cancelled form leaves no stray groups. Two pickers share one choice list: `GroupPicker` (several groups, on `MultiSelect` with `creatable`) and `GroupSelect` (one group or none, on `Combobox` in caller-filtered mode). "Manage groups" is a 560 px dialog over Rankings with a `TreeView`, a toolbar, and inline compact forms for add, rename and move (a dialog never opens another dialog; only the delete confirmation stacks).

**Tech Stack:** Next.js 16, React 19, TypeScript strict (`exactOptionalPropertyTypes`), TanStack Query 5, react-hook-form, next-intl, Base UI, MSW, Vitest with Testing Library, Playwright.

---

## Read first

| What | Where |
|---|---|
| The parent plan and its executor notes (gates, house rules, Opus review, no dashes) | `docs/superpowers/plans/2026-10-01-keywords-ui.md`, "Notes for the executor" and Task 8 |
| Group routes and rules as built | `docs/19-api-specification.md` section 3.6.2 (lines 919 to 930) |
| The pattern to copy for the tree screen | `apps/web/src/features/taxonomy/taxonomy-screen.tsx` (`TermTree`) and `term-dialogs.tsx` (`NameForm`, `MoveForm`) |
| Dialog rules | `docs/design-system/16-drawers-dialogs-popovers.md` sections 4.1 to 4.5 |
| Inline compact forms ("renaming a group") | `docs/design-system/10-forms.md` section 16 |
| Creatable multi-select | `docs/design-system/10-forms.md` section 6.4; `apps/web/src/components/ui/multi-select.tsx` |

All commands run in `apps/web`. Before any markup, invoke `design-taste-frontend` (house rule); the project's design system outranks its generic advice.

## Facts this plan relies on

- Routes (`keywords:write` for every write; reading needs `data:read`):
  - `GET {P}/keyword-groups?format=tree|flat` answers `{ data: KeywordGroupNode[] }`. Each node has `group_id`, `parent_id`, `name`, `path` (names from the root joined by `/`, no spaces), `keyword_count` (active keywords in the group or under it, each once), `created_at`, `children` (empty in the flat format). Lists are in path order, a subtree right after its group.
  - `POST {P}/keyword-groups` with `{ name, parent_id? }` answers `201 { data: KeywordGroup }`.
  - `PATCH {P}/keyword-groups/{group_id}` with `{ name?, parent_id? }` (`parent_id: null` moves to the root).
  - `DELETE {P}/keyword-groups/{group_id}` answers `204`. Subgroups go too; members are unlinked, keywords stay tracked.
- Rules and refusals:
  - name 1 to 100 characters after trimming, no `/` (`422 validation_failed`, `slash_not_allowed` at `name`);
  - unique among siblings in any case (`409 duplicate`);
  - at most 10 levels (`too_deep` at `parent_id`, for a create and for a move that pushes the subtree deeper);
  - path at most 2,048 bytes (`path_too_long` at `name`);
  - unknown parent (`group_unknown` at `parent_id`);
  - a parent that is the group or under it is `422 cycle_detected` with no field errors.
- The mocks (`src/mocks/handlers/keyword-groups.ts`) already answer all of the above; this plan only adds tests that lean on them.
- `src/features/rankings/taxonomy-queries.ts` has `useKeywordGroups(scope)` (flat format) and `refreshGroups(queryClient, scope)`, which invalidates every query under `[...projectKey, 'keyword-groups']`, so it refreshes the tree format too.

## Decisions

1. **The filter keeps its own editor.** The filter bar's group field (`keyword-filters.ts`) already lists group paths with counts. A filter never creates a group, so it does not use the pickers. Record this in the as-built note.
2. **Creating happens on save.** A typed path that names no group becomes a `new` choice. Saving the form creates the missing groups first (parents before children), then sends the keyword change with the new ids. Cancel creates nothing.
3. **Paths are typed with `/`.** "Blog/Guides" means Guides under Blog. Each name is trimmed. A name that is empty or longer than 100 characters, or a path deeper than 10 levels, is a field error before anything is sent.
4. **Manage groups is for `keywords:write` only.** Without it the More menu does not offer it (the screen renders no dead controls).
5. **No drag to move.** "Move to" is an inline form with a `Select` of every group outside the moved group's subtree, plus "Top level" (as `MoveForm` in taxonomy does).

## File structure

| File | Responsibility |
|---|---|
| Create `src/features/rankings/groups/group-paths.ts` | Pure: split and check a typed path; find a group by path (any case); list the names still missing |
| Create `src/features/rankings/groups/group-paths.test.ts` | Unit tests of the above |
| Create `src/features/rankings/groups/ensure-groups.ts` | Async: create the missing groups of several paths, level by level, through an injected `create` |
| Create `src/features/rankings/groups/ensure-groups.test.ts` | Unit tests with a fake `create` |
| Create `src/features/rankings/groups/group-choices.ts` | `GroupChoice` type, `useGroupChoices(scope)`, `useEnsureGroups(scope)` (wires `ensureGroups` to the API) |
| Create `src/features/rankings/groups/group-picker.tsx` | `GroupPicker` (several) and `GroupSelect` (one or none) |
| Create `src/features/rankings/groups/group-tree.ts` | Pure: tree helpers (flatten, subtree ids, ancestors, to `TreeViewNode`) |
| Create `src/features/rankings/groups/group-tree.test.ts` | Unit tests |
| Create `src/features/rankings/groups/manage-groups-dialog.tsx` | The dialog: tree, toolbar, inline forms, delete confirmation |
| Create `src/features/rankings/groups/group-refusals.ts` | One function from an API problem to the sentence the dialog shows |
| Create `src/features/rankings/groups/groups.test.tsx` | Component tests of the pickers in their forms and of the dialog |
| Modify `src/features/rankings/taxonomy-queries.ts` | Add `useKeywordGroupTree(scope)` (tree format) |
| Modify `src/features/rankings/add-keywords/add-keywords-dialog.tsx` | Groups field becomes `GroupPicker`; save ensures groups first |
| Modify `src/features/rankings/keyword-inspector/links-section.tsx` | Groups field becomes `GroupPicker`; save ensures groups first |
| Modify `src/features/rankings/bulk/move-to-group-dialog.tsx` | `Select` becomes `GroupSelect`; save ensures the group first |
| Modify `src/features/rankings/rankings-screen.tsx` | A "More actions" menu in the header with "Manage groups" |
| Modify `messages/en.json` | `rankings.groups.*` strings |
| Modify `e2e/flows/rankings.spec.ts` | One flow: create a group while moving keywords, then rename it in Manage groups |
| Modify `docs/superpowers/plans/2026-10-01-keywords-ui.md` | Task 8 as-built note |

---

### Task 1: Group paths (pure)

**Files:**
- Create: `apps/web/src/features/rankings/groups/group-paths.ts`
- Test: `apps/web/src/features/rankings/groups/group-paths.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

import { findGroup, missingNames, pathProblem, splitPath } from './group-paths';

const groups = [
  { group_id: 'g-blog', parent_id: null, name: 'Blog', path: 'Blog' },
  { group_id: 'g-guides', parent_id: 'g-blog', name: 'Guides', path: 'Blog/Guides' },
  { group_id: 'g-services', parent_id: null, name: 'Services', path: 'Services' },
];

describe('group paths', () => {
  it('splits a typed path into trimmed names', () => {
    expect(splitPath(' Blog / How to ')).toEqual(['Blog', 'How to']);
    expect(splitPath('Blog')).toEqual(['Blog']);
  });

  it('names what is wrong with a typed path', () => {
    expect(pathProblem('')).toBe('empty');
    expect(pathProblem('Blog//Guides')).toBe('empty');
    expect(pathProblem(`Blog/${'a'.repeat(101)}`)).toBe('too_long');
    expect(pathProblem(Array.from({ length: 11 }, (_, index) => `L${String(index)}`).join('/'))).toBe('too_deep');
    expect(pathProblem('Blog/Guides')).toBeNull();
  });

  it('finds a group by its path in any case', () => {
    expect(findGroup(groups, ['blog', 'GUIDES'])?.group_id).toBe('g-guides');
    expect(findGroup(groups, ['Blog', 'News'])).toBeNull();
  });

  it('lists the names still missing below the deepest group that exists', () => {
    expect(missingNames(groups, ['Blog', 'Guides', 'SEO', 'Local'])).toEqual({
      parentId: 'g-guides',
      names: ['SEO', 'Local'],
    });
    expect(missingNames(groups, ['News'])).toEqual({ parentId: null, names: ['News'] });
    expect(missingNames(groups, ['services'])).toEqual({ parentId: 'g-services', names: [] });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run src/features/rankings/groups/group-paths.test.ts`
Expected: FAIL, the module does not exist.

- [ ] **Step 3: Write the module**

```ts
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
  for (const name of names) {
    found = childNamed(groups, found?.group_id ?? null, name);
    if (found === null) return null;
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
    const child = childNamed(groups, parentId, name);
    if (child === null) return { parentId, names: names.slice(index) };
    parentId = child.group_id;
  }
  return { parentId, names: [] };
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `pnpm vitest run src/features/rankings/groups/group-paths.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/rankings/groups/group-paths.ts apps/web/src/features/rankings/groups/group-paths.test.ts
git commit -m "Rankings: group paths"
```

### Task 2: Ensure groups (create the missing ones)

**Files:**
- Create: `apps/web/src/features/rankings/groups/ensure-groups.ts`
- Test: `apps/web/src/features/rankings/groups/ensure-groups.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from 'vitest';

import { ensureGroups, type CreateGroup } from './ensure-groups';

const groups = [{ group_id: 'g-blog', parent_id: null, name: 'Blog', path: 'Blog' }];

describe('ensureGroups', () => {
  it('creates missing levels parent first, once per path, and answers an id per path', async () => {
    let next = 0;
    const create = vi.fn<CreateGroup>(async (name, parentId) => {
      next += 1;
      return { group_id: `new-${String(next)}`, parent_id: parentId, name, path: name };
    });
    const ids = await ensureGroups(['Blog/Guides/SEO', 'blog/guides', 'Blog'], groups, create);
    expect(create.mock.calls).toEqual([
      ['Guides', 'g-blog'],
      ['SEO', 'new-1'],
    ]);
    expect(ids).toEqual(['new-2', 'new-1', 'g-blog']);
  });

  it('creates nothing when every path exists', async () => {
    const create = vi.fn<CreateGroup>();
    expect(await ensureGroups(['blog'], groups, create)).toEqual(['g-blog']);
    expect(create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run src/features/rankings/groups/ensure-groups.test.ts`
Expected: FAIL, the module does not exist.

- [ ] **Step 3: Write the module**

```ts
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
```

- [ ] **Step 4: Run the test to see it pass**

Run: `pnpm vitest run src/features/rankings/groups/ensure-groups.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/rankings/groups/ensure-groups.ts apps/web/src/features/rankings/groups/ensure-groups.test.ts
git commit -m "Rankings: create missing groups on save"
```

### Task 3: Choices, the tree query and the hooks

**Files:**
- Modify: `apps/web/src/features/rankings/taxonomy-queries.ts`
- Create: `apps/web/src/features/rankings/groups/group-choices.ts`

- [ ] **Step 1: Add the tree query** to `taxonomy-queries.ts`, below `useKeywordGroups`:

```ts
type GroupTree = ApiResponse<'get', typeof GROUPS>;

/** The project's groups as a tree, for Manage groups. Shares `refreshGroups` with the flat list. */
export function useKeywordGroupTree(scope: ProjectScope): UseQueryResult<GroupTree> {
  return useQuery(
    apiQuery(GROUPS, {
      params: {
        path: { workspace_id: scope.workspaceId, project_id: scope.projectId },
        query: { format: 'tree' },
      },
    }),
  );
}
```

`GroupTree` and `GroupList` are the same response type; keep both names for reading clarity, or reuse `GroupList` (either is fine, do not add a cast).

- [ ] **Step 2: Write `group-choices.ts`**

```ts
'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import { ensureGroups } from './ensure-groups';
import { pathProblem, splitPath } from './group-paths';
import type { ProjectScope } from '../rankings-queries';
import { refreshGroups, useKeywordGroups } from '../taxonomy-queries';
import { apiMutation } from '@/lib/api/query';

const CREATE = apiMutation('post', '/api/v1/workspaces/{workspace_id}/projects/{project_id}/keyword-groups');

/**
 * A group a picker offers or holds: one that exists, one typed to be created on save, or (for "Move to
 * group" only) none at all.
 */
export type GroupChoice =
  | { kind: 'existing'; key: string; groupId: string; path: string; count: number }
  | { kind: 'new'; key: string; path: string }
  | { kind: 'none'; key: 'none' };

export const NO_GROUP_CHOICE: GroupChoice = { kind: 'none', key: 'none' };

/** A typed path as a choice; the key ignores case, as group names do. */
export function newGroupChoice(text: string): GroupChoice {
  const path = splitPath(text).join('/');
  return { kind: 'new', key: `new:${path.toLocaleLowerCase()}`, path };
}

/** Whether a typed path can become a group. */
export const canCreatePath = (text: string): boolean => pathProblem(text) === null;

export interface GroupChoices {
  choices: readonly Extract<GroupChoice, { kind: 'existing' }>[];
  byId: ReadonlyMap<string, Extract<GroupChoice, { kind: 'existing' }>>;
  ready: boolean;
  failed: boolean;
}

/** The project's groups as choices, in the API's path order. */
export function useGroupChoices(scope: ProjectScope): GroupChoices {
  const groups = useKeywordGroups(scope);
  return useMemo(() => {
    const choices = (groups.data?.data ?? []).map((group) => ({
      kind: 'existing' as const,
      key: group.group_id,
      groupId: group.group_id,
      path: group.path,
      count: group.keyword_count,
    }));
    return {
      choices,
      byId: new Map(choices.map((choice) => [choice.groupId, choice])),
      ready: groups.isSuccess,
      failed: groups.isError,
    };
  }, [groups.data, groups.isSuccess, groups.isError]);
}

/**
 * The ids of the chosen groups, creating the new ones first. Rejects with the API's refusal of a create;
 * the groups list is refreshed either way, so groups made before a refusal show.
 */
export function useEnsureGroups(scope: ProjectScope): (chosen: readonly GroupChoice[]) => Promise<string[]> {
  const queryClient = useQueryClient();
  const groups = useKeywordGroups(scope);
  const create = useMutation(CREATE);
  const { mutateAsync } = create;
  return useCallback(
    async (chosen) => {
      const existing = chosen.flatMap((choice) => (choice.kind === 'existing' ? [choice.groupId] : []));
      const typed = chosen.flatMap((choice) => (choice.kind === 'new' ? [choice.path] : []));
      if (typed.length === 0) return existing;
      try {
        const made = await ensureGroups(typed, groups.data?.data ?? [], async (name, parentId) => {
          const answer = await mutateAsync({
            params: { path: { workspace_id: scope.workspaceId, project_id: scope.projectId } },
            body: { name, parent_id: parentId },
          });
          return answer.data;
        });
        return [...new Set([...existing, ...made])];
      } finally {
        await refreshGroups(queryClient, scope);
      }
    },
    [groups.data, mutateAsync, queryClient, scope],
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: no errors. If `apiMutation`'s answer type is not `{ data: KeywordGroup }`, read it from `src/lib/api/schema.ts` (`KeywordGroupResponse`) and fix the access, never with a cast.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/rankings/taxonomy-queries.ts apps/web/src/features/rankings/groups/group-choices.ts
git commit -m "Rankings: group choices and tree query"
```

### Task 4: The pickers

**Files:**
- Create: `apps/web/src/features/rankings/groups/group-picker.tsx`
- Modify: `apps/web/messages/en.json`

- [ ] **Step 1: Invoke `design-taste-frontend`** before writing markup.

- [ ] **Step 2: Add the strings** under `rankings.groups` in `messages/en.json` (keep the file's key order style; no en or em dashes):

```json
"groups": {
  "pickerPlaceholder": "Choose or type a group",
  "selectPlaceholder": "Choose a group",
  "create": "Create group \"{path}\"",
  "empty": "No groups match \"{query}\". Type a path such as Blog/Guides to create one.",
  "noneYet": "No groups yet. Type a name to create one.",
  "chips": "Chosen groups",
  "remove": "Remove {value}",
  "chipsHint": "{count, plural, one {# group chosen.} other {# groups chosen.}} Press Left Arrow to reach them.",
  "chipHint": "Press Backspace or Delete to remove",
  "clear": "Clear",
  "open": "Show groups",
  "none": "No group",
  "newBadge": "New",
  "count": "{count, plural, one {# keyword} other {# keywords}}",
  "pathEmpty": "Each level of a group path needs a name.",
  "pathTooLong": "A group name has 100 characters at most.",
  "pathTooDeep": "Groups go 10 levels deep at most."
}
```

If `rankings.add` already has `chips`, `remove`, `chipsHint` and `chipHint` with the same wording, reuse those keys instead of copying them (check `add-keywords-dialog.tsx`).

- [ ] **Step 3: Write `group-picker.tsx`**

```tsx
'use client';

import { useTranslations } from 'next-intl';
import { useMemo, useState, type ReactElement, type Ref } from 'react';

import {
  canCreatePath,
  newGroupChoice,
  NO_GROUP_CHOICE,
  useGroupChoices,
  type GroupChoice,
} from './group-choices';
import type { ProjectScope } from '../rankings-queries';
import { Combobox } from '@/components/ui/combobox';
import { MultiSelect } from '@/components/ui/multi-select';

interface FieldProps {
  scope: ProjectScope;
  inputRef?: Ref<HTMLInputElement> | undefined;
  onBlur?: (() => void) | undefined;
  id?: string | undefined;
  'aria-required'?: boolean | undefined;
}

const labelOf = (choice: GroupChoice, none: string): string => (choice.kind === 'none' ? none : choice.path);

/** Several groups, from the project's or typed as a path to create on save. */
export function GroupPicker({
  scope,
  value,
  onValueChange,
  ...field
}: FieldProps & {
  value: readonly GroupChoice[];
  onValueChange: (value: readonly GroupChoice[]) => void;
}): ReactElement {
  const t = useTranslations('rankings.groups');
  const groups = useGroupChoices(scope);
  return (
    <MultiSelect<GroupChoice>
      {...field}
      value={value}
      onValueChange={onValueChange}
      items={groups.choices}
      itemToString={(choice) => labelOf(choice, t('none'))}
      itemKey={(choice) => choice.key}
      creatable={{
        label: (query) => t('create', { path: query.trim() }),
        onCreate: (query) => newGroupChoice(query),
      }}
      placeholder={t('pickerPlaceholder')}
      emptyText={(query) => (query.trim() === '' ? t('noneYet') : t('empty', { query }))}
      chipsLabel={t('chips')}
      removeLabel={(label) => t('remove', { value: label })}
      chipsHint={(count) => t('chipsHint', { count })}
      chipHint={t('chipHint')}
    />
  );
}

/**
 * One group or none, for "Move to group". The list is filtered here, so a typed path that names no group
 * can be offered first as "Create group".
 */
export function GroupSelect({
  scope,
  value,
  onValueChange,
  ...field
}: FieldProps & {
  value: GroupChoice | null;
  onValueChange: (value: GroupChoice | null) => void;
}): ReactElement {
  const t = useTranslations('rankings.groups');
  const groups = useGroupChoices(scope);
  const [query, setQuery] = useState('');
  const items = useMemo((): GroupChoice[] => {
    const typed = query.trim();
    const lowered = typed.toLocaleLowerCase();
    const listed: GroupChoice[] = [NO_GROUP_CHOICE, ...groups.choices].filter(
      (choice) => typed === '' || labelOf(choice, t('none')).toLocaleLowerCase().includes(lowered),
    );
    const exact = groups.choices.some((choice) => choice.path.toLocaleLowerCase() === lowered);
    return typed !== '' && !exact && canCreatePath(typed) ? [newGroupChoice(typed), ...listed] : listed;
  }, [groups.choices, query, t]);
  return (
    <Combobox<GroupChoice>
      {...field}
      value={value}
      onValueChange={onValueChange}
      items={items}
      onQueryChange={setQuery}
      itemToString={(choice) => labelOf(choice, t('none'))}
      itemKey={(choice) => choice.key}
      renderItem={(choice) => (choice.kind === 'new' ? t('create', { path: choice.path }) : labelOf(choice, t('none')))}
      placeholder={t('selectPlaceholder')}
      emptyText={(typed) => t('empty', { query: typed })}
      clearLabel={t('clear')}
      openLabel={t('open')}
    />
  );
}
```

Notes for this step:
- `Combobox` with `onQueryChange` treats `items` as already filtered (server mode). Its doc comment says the caller debounces from 2 characters; that applies to API searches. Here filtering is in memory, so it runs on every change, which is correct.
- A `new` choice that fails `pathProblem` is never offered in `GroupSelect`. `MultiSelect` always offers its create row, so `GroupPicker`'s callers check paths on submit (Task 5 shows how).

- [ ] **Step 4: Lint and typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: clean. The `i18next/no-literal-string` rule must pass: every visible string comes from `t`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/rankings/groups/group-picker.tsx apps/web/messages/en.json
git commit -m "Rankings: group pickers"
```

### Task 5: Use the pickers in the three forms

**Files:**
- Modify: `apps/web/src/features/rankings/bulk/move-to-group-dialog.tsx`
- Modify: `apps/web/src/features/rankings/add-keywords/add-keywords-dialog.tsx`
- Modify: `apps/web/src/features/rankings/keyword-inspector/links-section.tsx`
- Test: `apps/web/src/features/rankings/groups/groups.test.tsx`

- [ ] **Step 1: Write the failing tests** in `groups.test.tsx`. Use the harness (`rankingsAs`, `loadedGrid`, `stubWideScreen`, `restoreWideScreen` from `@/test/rankings-harness`, `renderWithProviders` from `@/test/render`, `server` from `@/test/msw`) as `bulk/bulk.test.tsx` does, and record writes the way that file's `writes()` helper does (copy the helper; it listens on `server.events` `request:start` and keeps method, route and JSON body).

Cases, each its own `it`:
1. **Bulk move creates a typed group.** Select "seo agency", open "Move to group", type `Blog/Guides`, choose the `Create group "Blog/Guides"` row, submit. Expect two `POST .../keyword-groups` writes in order, bodies `{ name: 'Blog', parent_id: null }` and `{ name: 'Guides', parent_id: <the id the first answered> }`, then the members write for the new group; the success toast names `Blog/Guides`.
2. **Bulk move to an existing group offers no create row.** Type the exact path of a fixture group (read it from `MOCK_*` fixtures or from the rendered list); expect no `Create group` option.
3. **Add keywords creates new groups on save, not on pick.** Open Add keywords, type a keyword, in Groups type `Pillar` and press Enter (chip `Pillar` shows). Cancel and confirm discard: no `POST .../keyword-groups` was sent. Open again, do the same and submit: one group create, then `bulk-create` with that id in `group_ids`.
4. **A bad typed path is a field error.** In Add keywords type `Blog//x` in Groups, press Enter, submit: the Groups field shows "Each level of a group path needs a name." and nothing is sent.
5. **The inspector creates a typed group.** Open a keyword in the inspector, edit Groups and tags, add `Pillar`, save: one group create, then the members add for that keyword.
6. **A refused create shows in the form.** Answer `POST .../keyword-groups` with `problem(request, 'duplicate')` via `server.use`; in bulk move, type and create `Fresh`, submit: the dialog's alert says "A group next to it already has this name." and the dialog stays open.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run src/features/rankings/groups/groups.test.tsx`
Expected: FAIL (no create row, no group creates).

- [ ] **Step 3: Move to group.** In `move-to-group-dialog.tsx`:
  - Form value becomes `{ group: GroupChoice | null }`.
  - Replace the `Select` with `<GroupSelect scope={scope} value={field.value} onValueChange={field.onChange} inputRef={field.ref} onBlur={field.onBlur} />` (use the `FormField` render props the file already uses; `field.controlProps` has `id` and `aria-*`).
  - On submit: if `group` is `null`, the existing required error. If `group.kind === 'new'`, call `ensure([group])` from `useEnsureGroups(scope)` inside the `try`, and use its single id as `target` and `group.path` as the name. If `kind === 'none'`, `target = null`. `others` are the loaded groups' ids minus `target` (a new group has no members yet).
  - A refusal of the create goes through `groupRefusal(error, t)` (Task 6 writes `group-refusals.ts`; until then put the function in this task and move it in Task 6, or write Task 6's file first: it has no dependencies).
  - Drop the local `NO_GROUP` constant; `NO_GROUP_CHOICE` replaces it.

- [ ] **Step 4: Add keywords.** In `add-keywords-dialog.tsx`:
  - `group_ids: string[]` in the form values becomes `groups: GroupChoice[]` (zod: `z.array(z.custom<GroupChoice>())`).
  - Replace the groups `MultiSelect` with `GroupPicker` (keep the `FormField` wrapper, label and description).
  - On submit, first check every `new` choice with `pathProblem`; on a problem set the field error on `groups` with the matching `rankings.groups.path*` string and stop. Then `const groupIds = await ensure(values.groups)` before the `bulk-create` call, and send `group_ids: groupIds`.
  - Remove `groupChoices` and `useKeywordGroups` from this file if nothing else uses them.

- [ ] **Step 5: Inspector.** In `links-section.tsx`:
  - The form's `groups: string[]` becomes `groups: GroupChoice[]`. `valuesOf(detail, ...)` maps `detail.groups` to `existing` choices (path from the detail, count from `useGroupChoices` when known, else 0).
  - Replace the groups field with `GroupPicker`.
  - On submit: path check as in Step 4, then `const after = await ensure(values.groups)`; diff `after` against the initial ids as the code does now.
  - `listsReady` waits for `useGroupChoices(scope).ready` instead of `groups.isSuccess`.

- [ ] **Step 6: Run the tests**

Run: `pnpm vitest run src/features/rankings`
Expected: PASS, including the existing bulk, add and inspector tests. Update an existing assertion only where it named the old `Select` option text; keep its intent.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/rankings apps/web/messages/en.json
git commit -m "Rankings: pick or create groups in add, inspector and bulk move"
```

### Task 6: Refusals and tree helpers

**Files:**
- Create: `apps/web/src/features/rankings/groups/group-refusals.ts`
- Create: `apps/web/src/features/rankings/groups/group-tree.ts`
- Test: `apps/web/src/features/rankings/groups/group-tree.test.ts`
- Modify: `apps/web/messages/en.json`

- [ ] **Step 1: Strings** under `rankings.groups.refusals`:

```json
"refusals": {
  "duplicate": "A group next to it already has this name.",
  "slash": "A group name can't contain \"/\".",
  "tooDeep": "Groups go 10 levels deep at most.",
  "pathTooLong": "This name makes the group's path too long.",
  "gone": "This group was deleted meanwhile. The list now shows the groups as they are.",
  "cycle": "A group can't move into itself or a group under it.",
  "forbidden": "Changing groups needs permission to edit keywords.",
  "failed": "The groups could not be changed. Try again."
}
```

- [ ] **Step 2: Write `group-refusals.ts`**

```ts
import type { useTranslations } from 'next-intl';

import { isApiProblem } from '@/lib/api/problem';

type Translate = ReturnType<typeof useTranslations<'rankings.groups.refusals'>>;

/** What to say for a refused group write; `field` is where it belongs, `null` for the form as a whole. */
export function groupRefusal(error: unknown, t: Translate): { field: 'name' | null; message: string } {
  if (isApiProblem(error, 'duplicate')) return { field: 'name', message: t('duplicate') };
  if (isApiProblem(error, 'cycle_detected')) return { field: null, message: t('cycle') };
  if (isApiProblem(error, 'not_found')) return { field: null, message: t('gone') };
  if (isApiProblem(error, 'forbidden')) return { field: null, message: t('forbidden') };
  if (isApiProblem(error, 'validation_failed')) {
    const codes = new Set(error.errors.map((item) => item.code));
    if (codes.has('slash_not_allowed')) return { field: 'name', message: t('slash') };
    if (codes.has('path_too_long')) return { field: 'name', message: t('pathTooLong') };
    if (codes.has('too_deep')) return { field: null, message: t('tooDeep') };
    if (codes.has('group_unknown')) return { field: null, message: t('gone') };
  }
  return { field: null, message: t('failed') };
}
```

Check `ApiProblem.errors` exists with `code` (see `term-dialogs.tsx` `refusalOf`, which reads it the same way).

- [ ] **Step 3: Write the failing tree test**

```ts
import { describe, expect, it } from 'vitest';

import { ancestorsOf, flattenGroups, subtreeIds, toTreeNodes } from './group-tree';

const tree = [
  {
    group_id: 'a', parent_id: null, name: 'Blog', path: 'Blog', keyword_count: 3, created_at: '', children: [
      { group_id: 'b', parent_id: 'a', name: 'Guides', path: 'Blog/Guides', keyword_count: 2, created_at: '', children: [] },
    ],
  },
  { group_id: 'c', parent_id: null, name: 'Services', path: 'Services', keyword_count: 0, created_at: '', children: [] },
];

describe('group tree', () => {
  it('flattens depth first', () => {
    expect(flattenGroups(tree).map((group) => group.group_id)).toEqual(['a', 'b', 'c']);
  });
  it('lists a group and everything under it', () => {
    expect([...subtreeIds(tree[0]!)]).toEqual(['a', 'b']);
  });
  it('lists the groups above one, root first', () => {
    expect(ancestorsOf(tree, 'b')).toEqual(['a']);
    expect(ancestorsOf(tree, 'c')).toEqual([]);
  });
  it('makes tree view nodes with the count as detail', () => {
    const nodes = toTreeNodes(tree, (count) => `${String(count)} kw`);
    expect(nodes[0]).toMatchObject({ id: 'a', label: 'Blog', detail: '3 kw' });
    expect(nodes[0]?.children[0]).toMatchObject({ id: 'b', label: 'Guides', detail: '2 kw' });
  });
});
```

Prettier will reflow the fixture; that is fine. If the lint config forbids the non-null assertion `tree[0]!`, write `const [blog] = tree; if (blog === undefined) throw new Error('fixture');`.

- [ ] **Step 4: Run it to see it fail**

Run: `pnpm vitest run src/features/rankings/groups/group-tree.test.ts`
Expected: FAIL, the module does not exist.

- [ ] **Step 5: Write `group-tree.ts`**

```ts
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
```

Check that `KeywordGroupNode` from the generated schema is assignable to `GroupNode` (it should be: same fields). Pass the API's nodes straight in; do not cast.

- [ ] **Step 6: Run the tests to see them pass**

Run: `pnpm vitest run src/features/rankings/groups`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/rankings/groups apps/web/messages/en.json
git commit -m "Rankings: group refusals and tree helpers"
```

### Task 7: Manage groups dialog

**Files:**
- Create: `apps/web/src/features/rankings/groups/manage-groups-dialog.tsx`
- Modify: `apps/web/src/features/rankings/rankings-screen.tsx`
- Modify: `apps/web/messages/en.json`
- Test: `apps/web/src/features/rankings/groups/groups.test.tsx`

- [ ] **Step 1: Invoke `design-taste-frontend`** before writing markup.

- [ ] **Step 2: Strings** under `rankings.groups.manage` and `rankings.moreActions`:

```json
"manage": {
  "open": "Manage groups",
  "title": "Manage groups",
  "description": "Groups file keywords by theme. A keyword can be in several groups.",
  "treeLabel": "Keyword groups",
  "toolbar": "Group actions",
  "addGroup": "Add group",
  "addSubgroup": "Add subgroup",
  "addSubgroupOf": "Add subgroup to {name}",
  "rename": "Rename",
  "moveTo": "Move to",
  "delete": "Delete",
  "name": "Name",
  "newParent": "Move under",
  "topLevel": "Top level",
  "apply": "Apply",
  "cancel": "Cancel",
  "nameRequired": "Enter a name.",
  "empty": "No groups yet. Add one to file keywords by theme.",
  "loadFailed": "The groups could not be loaded.",
  "count": "{count, plural, =0 {No keywords} one {# keyword} other {# keywords}}",
  "added": "Group {name} added",
  "renamed": "Group renamed to {name}",
  "moved": "{name} moved",
  "deleted": "{name} deleted",
  "selectedAfterChange": "The changed group is selected.",
  "deleteTitle": "Delete {name}?",
  "deleteDescription": "Keywords in it stay tracked and leave the group.",
  "deleteDescriptionWithSubgroups": "{count, plural, one {Its subgroup is} other {Its # subgroups are}} deleted too. Keywords in them stay tracked and leave these groups.",
  "deleteConfirm": "Delete group",
  "deleteConfirmWithSubgroups": "Delete group and subgroups",
  "close": "Close"
},
```

and `"moreActions": "More actions"` directly under `rankings`.

- [ ] **Step 3: Write the dialog.** Props:

```ts
export interface ManageGroupsDialogProps {
  scope: ProjectScope;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where focus goes when the dialog closes: the More actions button. */
  finalFocus: RefObject<HTMLElement | null>;
}
```

Structure, following `TermTree` in `src/features/taxonomy/taxonomy-screen.tsx` line by line where it fits:
- `Dialog` `size="md"`, `DialogHeader` with title and description, `DialogBody`, a footer with one "Close" button (secondary). There is no primary action: each change is applied by its own inline form.
- State: `selected: string | null`, `expanded: ReadonlySet<string>`, `reveal: string | null` (open the ancestors of a new or moved group once the refreshed tree has it, exactly like `TermTree`), `form: GroupForm | null` and `deleting: GroupNode | null`, where:

```ts
type GroupForm =
  | { kind: 'add'; parent: GroupNode | null }
  | { kind: 'rename'; group: GroupNode }
  | { kind: 'move'; group: GroupNode };
```

- Data: `useKeywordGroupTree(scope)`; `const all = flattenGroups(tree)`; `const group = all.find((g) => g.group_id === selected) ?? null`.
- Toolbar (`role="group"`, `aria-label` toolbar string), `size="sm"` buttons: Add group (opens `{ kind: 'add', parent: null }`), Add subgroup (disabled without a selection; label `addSubgroupOf` with the name when one is selected; disabled when the selected group is at level 10, computed with `ancestorsOf(tree, id).length + 1 >= MAX_GROUP_DEPTH`), Rename, Move to, Delete (each disabled without a selection).
- The inline form renders between the toolbar and the tree when `form !== null`, as a `<form>` with `sm` controls, Apply (primary, `size="sm"`) and Cancel (ghost). Enter applies (native submit), Escape cancels (handle `onKeyDown` on the form and `event.stopPropagation()` so Escape does not close the dialog). Focus moves into the field when it opens and back to the toolbar button that opened it when it closes.
  - add and rename: `Input` with the name, required, 100 characters at most (`textLength`), no `/`, checked before sending with `rankings.groups.manage.nameRequired`, `rankings.groups.pathTooLong` and `rankings.groups.refusals.slash`. Create: `POST` with `{ name, parent_id: parent?.group_id ?? null }`. Rename: `PATCH` with `{ name }`; an unchanged name closes the form without a request.
  - move: `Select<string>` with `{ value: '', label: topLevel }` and every group outside `subtreeIds(group)`, labelled by `path`. Unchanged parent closes without a request. `PATCH` with `{ parent_id: value === '' ? null : value }`.
  - Refusals: `groupRefusal(error, t)`; `field: 'name'` shows as the field's error, otherwise a `FormAlert` inside the inline form.
  - Success: `await refreshGroups(queryClient, scope)`, a success toast (`added`, `renamed`, `moved`), select the changed group, set `reveal`, `announce(t('selectedAfterChange'))`, close the form.
- Tree area: `rounded-lg border border-border bg-surface p-1`, a skeleton while pending (copy `TermTree`'s), `InlineError` with Retry on error, the `empty` text when there are no groups, else `TreeView` with `toTreeNodes(tree, (count) => t('count', { count }))`.
- Delete: `ConfirmDialog` (`@/components/ui/alert-dialog`), `finalFocus` on the toolbar's first button, title `deleteTitle`, description `deleteDescriptionWithSubgroups` with `count = subtreeIds(group).size - 1` when that is above 0, else `deleteDescription`; confirm label to match. `onConfirm` sends `DELETE`; a `not_found` counts as done. Then refresh, select the deleted group's parent, success toast `deleted`. Another refusal sets the dialog's `error` and rethrows (as `TermTree.confirmDelete` does).
- Keyword counts change after a delete or a move, and the keyword list's group cells may too: after any change also call `queryClient.invalidateQueries({ queryKey: keywordsKey(scope) })` (import `keywordsKey` from `../rankings-queries`; check its name there).

- [ ] **Step 4: The More actions menu.** In `rankings-screen.tsx`:
  - `const moreButton = useRef<HTMLButtonElement>(null)` and `const [managing, setManaging] = useState(false)`.
  - The header `actions` become, when `canWrite`, a fragment with `Menu` (`align="end"`, trigger `<IconButton ref={moreButton} icon={MoreHorizontal} variant="secondary" label={t('moreActions')} />`, items `[{ id: 'manage-groups', label: t('groups.manage.open'), icon: FolderTree, onSelect: () => setManaging(true) }]`) followed by the existing Add button. Without `canWrite`, no menu.
  - Render `<ManageGroupsDialog scope={scope} open={managing} onOpenChange={setManaging} finalFocus={moreButton} />` when `canWrite`.
  - Check `IconButton` forwards `ref` (it is a function component; look for `ref` in its props). If it does not, use a wrapping element's ref the way other screens do, without changing `IconButton`.

- [ ] **Step 5: Write the failing dialog tests** (add to `groups.test.tsx`):
  1. An editor opens More actions, then Manage groups: the dialog shows the fixture groups in a tree with their counts ("N keywords").
  2. Add group "Pillar": `POST` with `{ name: 'Pillar', parent_id: null }`; the tree shows Pillar selected; toast "Group Pillar added".
  3. Add a subgroup under a fixture group: `parent_id` is that group's id; the parent opens to show it.
  4. Rename to a sibling's name in another case: the field shows "A group next to it already has this name." and the form stays.
  5. Move to: the options exclude the group itself and its subgroups and include "Top level".
  6. Delete a group with a subgroup: the confirmation says "Its subgroup is deleted too..." and "Delete group and subgroups"; confirming sends `DELETE` and the tree no longer shows either.
  7. Escape in an open inline form closes the form, not the dialog.
  8. A viewer (`rankingsAs('viewer')`) sees no More actions button.

- [ ] **Step 6: Run the tests**

Run: `pnpm vitest run src/features/rankings/groups`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/rankings apps/web/messages/en.json
git commit -m "Rankings: manage groups"
```

### Task 8: End to end, as-built note, gates, review

**Files:**
- Modify: `apps/web/e2e/flows/rankings.spec.ts`
- Modify: `docs/superpowers/plans/2026-10-01-keywords-ui.md`

- [ ] **Step 1: Add one e2e flow** to `rankings.spec.ts`, in the style of its bulk priority test (checkbox names with `exact: true`): select two keywords, Move to group, type `E2E/Group`, choose the create row, submit, see the toast; open More actions, Manage groups, select `Group`, Rename to `Renamed`, Apply, see "Group renamed to Renamed"; close.

- [ ] **Step 2: As-built note** under Task 8 in the parent plan:

```markdown
- **As built.** Step by step in `2026-10-05-keyword-groups-ui.md`.
  - The filter keeps the filter bar's own group editor (paths with counts); a filter never creates a group.
  - `GroupPicker` (several, on `MultiSelect` with `creatable`) serves Add keywords and the inspector; `GroupSelect` (one or "No group", on `Combobox` filtered by the caller) serves bulk Move to group. A typed path such as `Blog/Guides` creates its missing levels when the form is saved, parents first; Cancel creates nothing.
  - Manage groups is a 560 px dialog from Rankings' More actions menu (`keywords:write` only) with inline forms for add, rename and move, and a confirmation for delete that counts the subgroups.
```

- [ ] **Step 3: Run every gate**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm format:check
NEXT_PUBLIC_API_MOCKING=off pnpm build
pnpm run preview
pnpm e2e
```

Expected: all pass. Fix and re-run until they do.

- [ ] **Step 4: Opus review.** Dispatch an independent reviewer on the Opus model (superpowers:code-reviewer) with this plan, the parent plan's Task 8, and the range from the commit before Task 1 to HEAD. Fix every Critical and Important finding, re-run the gates.

- [ ] **Step 5: Commit**

```bash
git add apps/web docs/superpowers/plans/2026-10-01-keywords-ui.md
git commit -m "Rankings: keyword groups"
```

Never add `.claude/launch.json` or `research/`. No attribution lines. Push only on the user's word.
