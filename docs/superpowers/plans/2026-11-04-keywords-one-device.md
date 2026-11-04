# Keywords: one device at a time Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The real Keywords page shows Desktop or Mobile, never both. One Rank column, and every per-device figure on the page is the shown device's own.

**Architecture:** The list already loads the tracked keywords of both devices and `pairRows` joins them into one `PairedRow` per keyword (so a bulk action still reaches both devices of a keyword). With a device chosen, `pairRows` already makes the chosen device's row the row the table shows, so every column that reads `row.state` (features, AI Overview, trend, ranking URL, updated) is already that device's. This plan removes the combined option and the second rank column, and makes everything else (strip, export, ranking pages popup) follow the one device. Volume, KD, CPC and Intent stay device independent (provider values per keyword and country).

**Tech Stack:** Next.js (apps/web), TypeScript strict, nuqs URL state, next-intl messages, vitest (`pnpm test`), Playwright (`pnpm e2e`).

**Source of truth for behaviour:** the design preview `apps/web/design-preview/kw-grouped-model.js` (commit 8b321b4) and `docs/design-system/24-page-templates.md` ("Device switch" row).

**Out of scope (separate plans):** the By group view, multi-country add, Clicks and Impressions columns, top bar country and search. The Add keywords dialog keeps its own "Desktop / Mobile / Desktop and mobile" choice: that chooses which devices to track, not which to look at.

Work in the worktree `/Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/keywords-grouped` (branch `frontend/keywords-grouped`). All commands run from `apps/web`. Do not touch `src/lib/api/schema.ts` or `backend/` (another session has uncommitted edits there in the main checkout).

---

### Task 1: One device at a time

The types change breaks every consumer at once, so this is one task; do the steps in order and keep `pnpm typecheck` as the guide to what is left.

**Files:**
- Modify: `src/features/rankings/keyword-pairs.ts`, `src/features/rankings/keyword-pairs.test.ts`
- Modify: `src/features/rankings/keyword-scope.tsx`
- Modify: `src/features/rankings/rank-columns.tsx`, `src/features/rankings/rank-columns.test.tsx`
- Modify: `src/features/rankings/keyword-columns.tsx`
- Modify: `src/features/rankings/ranking-pages.tsx`, `src/features/rankings/ranking-pages.test.tsx`
- Modify: `src/features/rankings/export/export-model.ts`, `src/features/rankings/export/export-model.test.ts`
- Modify: `src/features/rankings/rankings-screen.tsx`, `src/features/rankings/rankings.test.tsx`
- Modify: `messages/en.json`

- [ ] **Step 1: Pairing takes one device (test first)**

In `keyword-pairs.test.ts` every `pairRows(x, 'both')` becomes `pairRows(x, 'desktop')` and the expectations follow:
- a keyword with rows on both devices: one pair, `devices.desktop` and `devices.mobile` both set (unchanged);
- a keyword tracked on mobile only is now **left out** of the desktop pairing (it was kept with `both`); change the test at line 53 (`expect(pairRows(LIST, 'both')[1]).toMatchObject({ tracked_keyword_id: 'b-m', device: 'mobile' })`) to assert that `pairRows(LIST, 'desktop')` has no pair with `tracked_keyword_id` `b-m`, and add:

```ts
it('shows a keyword on the device chosen, with that device’s row as the row it shows', () => {
  const mobile = pairRows(LIST, 'mobile');
  expect(mobile.every((pair) => pair.device === 'mobile')).toBe(true);
  expect(mobile.every((pair) => pair.devices.mobile !== null)).toBe(true);
});
```

Run: `pnpm vitest run src/features/rankings/keyword-pairs.test.ts` and expect the type error (`'both'` is gone) or failures until Step 2 is done.

- [ ] **Step 2: Pairing implementation**

In `keyword-pairs.ts` delete `DeviceScope` and its mention in the file comment, and replace the second half of `pairRows`:

```ts
/**
 * The rows paired, in the order each keyword first appears, for the device the table shows. The row a pair
 * shows is that device's row, so everything the table reads from it (rank, features, AI Overview, trend, the
 * ranking URL, the check time) is that device's own; a keyword not tracked on the device is left out.
 */
export function pairRows(rows: readonly TrackedKeywordRow[], device: Device): PairedRow[] {
  // ... the grouping loop above is unchanged ...
  const paired: PairedRow[] = [];
  for (const devices of order) {
    const primary = devices[device];
    if (primary === null) continue;
    paired.push({ ...primary, devices });
  }
  return paired;
}
```

Run the test again; expect PASS.

- [ ] **Step 3: The scope control has two options (test first)**

In `rankings.test.tsx` replace the test "shows a rank column for each device, and hides the other device’s column when one is chosen" (line 88) with:

```tsx
it('shows one rank column for the device chosen, and the other device’s figures when it is switched', async () => {
  const { user } = renderWithProviders(as('viewer'));
  const grid = await loadedGrid();
  // Desktop is the default: one Rank column, no Desktop or Mobile column
  expect(within(grid).getByRole('columnheader', { name: /^Rank$/ })).toBeInTheDocument();
  expect(within(grid).queryByRole('columnheader', { name: /^Desktop$/ })).toBeNull();
  expect(within(grid).queryByRole('columnheader', { name: /^Mobile$/ })).toBeNull();
  // The device and location are not columns: they are the controls beside the filters
  expect(within(grid).queryByRole('columnheader', { name: /^Device$/ })).toBeNull();
  expect(within(grid).queryByRole('columnheader', { name: /^Location$/ })).toBeNull();
  // Two options only
  expect(screen.queryByRole('radio', { name: 'Desktop and mobile' })).toBeNull();
  expect(screen.getByRole('radio', { name: 'Desktop' })).toBeChecked();
  await user.click(screen.getByRole('radio', { name: 'Mobile' }));
  await waitFor(() => expect(screen.getByRole('radio', { name: 'Mobile' })).toBeChecked());
  expect(within(grid).getByRole('columnheader', { name: /^Rank$/ })).toBeInTheDocument();
});
```

Also fix the other tests that name the removed columns:
- line 108 test "puts one row for a keyword tracked on both devices, with a rank in each column": rename to "puts one row for a keyword tracked on both devices" and drop the `Not tracked` assertion (the text no longer exists).
- line 140: `columnheader { name: /Desktop/ }` becomes `/^Rank$/`.
- lines 447 to 448 and 482: the expected header lists `'Desktop', 'Mobile'` become `'Rank'`, and `t?.includes('Desktop')` becomes `t?.includes('Rank')`.
- lines 769, 781, 803 click `within(grid).getByRole('button', { name: 'Desktop' })` (the sort button on the Desktop header): read what each test sorts, and make it click the `Rank` header button.
- line 1186 test with `?dev=mobile` stays; add one more `it` that renders with `?dev=mobile` and asserts the API list request carries no `filter[device]` but the strip's six count requests do (copy the request-capture pattern of the test at line 114).

Run: `pnpm vitest run src/features/rankings/rankings.test.tsx` and expect FAIL.

- [ ] **Step 4: Scope control implementation**

In `keyword-scope.tsx`:
- import `Device` instead of `DeviceScope` from `./keyword-pairs`; drop `MonitorSmartphone` from the lucide import;
- update the doc comment: "Desktop shows unless mobile is chosen";
- `KeywordScope.device: Device`, `setDevice: (device: Device) => void`;
- in `useKeywordScope`:

```ts
return {
  device: state.dev ?? 'desktop',
  countryId: state.loc ?? fallback,
  // Desktop is the default and is kept out of the URL
  setDevice: (device) => void setState({ dev: device === 'desktop' ? null : device }),
  setCountry: (countryId) => void setState({ loc: countryId === fallback ? null : countryId }),
};
```

- the control:

```tsx
<SegmentedControl<Device>
  semantics="view"
  label={t('device')}
  value={scope.device}
  onValueChange={scope.setDevice}
  size="sm"
  iconOnly
  items={[
    { value: 'desktop', label: columns('desktop'), icon: Monitor },
    { value: 'mobile', label: columns('mobile'), icon: Smartphone },
  ]}
/>
```

In `messages/en.json` delete `rankings.scope.both` (line 2196). Run `pnpm typecheck` and read the errors: they are the list of what Steps 5 to 8 fix.

- [ ] **Step 5: One Rank column (test first)**

In `rank-columns.test.tsx` the test at line 203 becomes:

```tsx
it('gives the rank column no tooltip of its own: the cell and its markers say what there is to say', () => {
  const { result } = renderHook(() => useRankColumns('UTC'), { wrapper });
  const rank = makeRow({});
  expect(result.current.rank.headerTooltip).toBeUndefined();
  expect(result.current.rank.cellTip).toBeUndefined();
  expect(result.current.best.headerTooltip).toBeUndefined();
  expect(result.current.trend.headerTooltip).toBeUndefined();
  expect(result.current.best.cellTip?.(rank)).toBeUndefined();
});
```

Search the same file for other uses of `rankDesktop` or `rankMobile` and move them to `rank` (the file has one at line 206 in the grep; check for others with `grep -n "rankDesktop\|rankMobile" src/features/rankings/rank-columns.test.tsx`). Add:

```tsx
it('reads the rank of the row it is given, whatever device that row is', () => {
  const { result } = renderHook(() => useRankColumns('UTC'), { wrapper });
  const mobile = makeRow({ device: 'mobile' });
  expect(result.current.rank.header).toBe('Rank');
  expect(result.current.rank.sortValue?.(mobile)).toBe(
    mobile.state.current.state === 'ranked' ? mobile.state.current.rank : null,
  );
});
```

- [ ] **Step 6: Rank column implementation**

In `rank-columns.tsx`:
- `RANK_COLUMN_IDS`: delete `rankMobile`; the comment on `rank` becomes "The rank column keeps the API's sort field, so a link with `sort=current_rank` still sorts.";
- `RankColumns`: replace `rankDesktop` and `rankMobile` with `rank: DataTableColumn<TrackedKeywordRow>`;
- replace the `rankColumn` helper and the two entries with:

```tsx
rank: col.rank<TrackedKeywordRow>(
  RANK_COLUMN_IDS.rank,
  (row) => {
    const shown = display(row);
    return shown.kind === 'ranked' ? shown.rank : null;
  },
  {
    header: t('rank'),
    priority: 1,
    // The rank and its change slot beside it
    width: 128,
    minWidth: 128,
    cell: (row) => (
      <RankCellView
        display={display(row)}
        change={rowChangeDisplay(row.state.current, row.state.change)}
        timeZone={timeZone}
      />
    ),
  },
),
```

In `keyword-columns.tsx`: replace `ranks.rankDesktop, ranks.rankMobile,` with `ranks.rank,`; change the `device` parameter to `device: Device = 'desktop'` and its import to `import type { Device, PairedRow } from './keyword-pairs';`.

Delete the message `rankings.rank.notTracked` only if `grep -rn "notTracked" src` shows no other use.

Run `pnpm vitest run src/features/rankings/rank-columns.test.tsx`; expect PASS.

- [ ] **Step 7: Ranking pages popup shows the one device (test first)**

In `ranking-pages.test.tsx` every `rankingPages(x, 'both')` becomes `rankingPages(x, 'desktop')` (lines 53, 80, 89, 95, 111). Re-read each test: where it asserted a rank on both devices for one page (`page.ranks`, line 89), change the expectation to the desktop rank only, and add:

```ts
it('lists a page with the rank of the device shown only', () => {
  const row = paired(tracked('desktop', [page('p1', 3)]), tracked('mobile', [page('p1', 9)]));
  expect(rankingPages(row, 'mobile').map((entry) => entry.ranks)).toEqual([{ mobile: 9 }]);
});
```

(Use the file's own `paired`, `tracked` and `page` builders; if their names differ, use the ones the file defines.)

- [ ] **Step 8: Ranking pages implementation**

In `ranking-pages.tsx`: import `Device` and `PairedRow` only (drop `DeviceScope`); delete `devicesOf`; `rankingPages(row, device: Device)` uses `const tracked = ((): [Device, TrackedKeywordRow][] => { const own = devices[device]; return own === null ? [] : [[device, own]]; })();`; `RankingPagesCardProps.scope: DeviceScope` becomes `device: Device`; in `RankingPagesCard` drop `devices` and `deviceLabel` and render a single header cell `{rank('rank')}` and a single value cell `{page.ranks[device] ?? t('beyond')}`. In `keyword-columns.tsx` pass `device={device}` to `RankingPagesCard` instead of `scope={device}`.

- [ ] **Step 9: Export follows the one device (test first)**

In `export-model.test.ts`:
- `LABELS` gains `rank: 'Rank'`;
- the test "counts the tracked keywords of both devices, as the strip does" becomes "counts the tracked keywords of the device chosen" with `buildExport(rows, 'desktop', LABELS)` and expected values `[3, ...]` (the file's desktop counts: `desktop.kpis[0].value` is 3 in the existing test at line 98; compute the three top counts from the fixture and assert them);
- "counts only the device chosen, and drops the other device’s column" asserts `mobile.header` contains `'Rank (Mobile)'` and not `'Desktop'` or `'Mobile'` alone, and `desktop.header` contains `'Rank (Desktop)'`;
- "writes a row for each keyword with a rank for each device..." becomes one rank: `header.slice(0, 2)` equals `['Keyword', 'Rank (Desktop)']`, `body[0]` is the same row without the `'>100'` mobile cell, `body[2]?.slice(0, 2)` is `['lonely', '>100']` (for the fixture's desktop value; read the fixture);
- the kinds test expects exactly one `'rank'` kind for both devices;
- every remaining `'both'` argument becomes `'desktop'`.

- [ ] **Step 10: Export implementation**

In `export-model.ts`: import `Device`; `ExportLabels` gains `rank: string;` (keep `desktop` and `mobile`); replace `trackedIn` with:

```ts
/** The tracked keyword of a row on the device shown, or none when it is not tracked there. */
function trackedIn(row: PairedRow, device: Device): TrackedKeywordRow[] {
  const found = row.devices[device];
  return found === null ? [] : [found];
}
```

`buildExport(rows, device: Device, labels)`: `tracked = rows.flatMap((row) => trackedIn(row, device))`; the columns become

```ts
const columns: [ExportColumnKind, string][] = [
  ['keyword', labels.keyword],
  ['rank', `${labels.rank} (${labels[device]})`],
  ['url', labels.url],
  // ... volume to checked unchanged ...
];
```

and in the body: `const current = row.devices[device]?.state.current;` the row is `[safeText(row.keyword.text), rankCell(current), current?.state === 'ranked' ? (current.url?.canonical_url ?? null) : null, number(row.metrics?.search_volume.value), ...unchanged..., latestCheck(trackedIn(row, device))]`. Update the doc comment above `buildExport` ("one row for each keyword with its rank on the device shown").

- [ ] **Step 11: The screen**

In `rankings-screen.tsx`:
- delete the `columns` memo (lines 203 to 210) and use `allColumns` where `columns` was used (or rename `allColumns` to `columns` at its declaration); delete the `RANK_COLUMN_IDS` import if it is unused;
- `stripFilters`: `const stripFilters = useMemo(() => ({ ...filters, 'filter[device]': keywordScope.device }), [filters, keywordScope.device]);` and update its comment ("The summary counts the keywords of the device shown");
- export (`exportKeywords`): `rank: rankT('rank')` added to the labels (add `const rankT = useTranslations('rankings.rank');` beside the other translators), and `const deviceText = columnsT(device);`.

Run `pnpm typecheck`; expect no errors. Run `pnpm vitest run src/features/rankings`; expect PASS. Fix any remaining test that names the removed column or option (`grep -rn "Desktop and mobile\|rankDesktop\|rankMobile\|'both'" src/features/rankings` should show only the Add dialog and its tests, the project settings, and the mock handlers).

- [ ] **Step 12: Lint, format, commit**

Run: `pnpm lint && pnpm format:check && pnpm typecheck && pnpm vitest run src/features/rankings src/test`
Expected: all clean. If `format:check` fails, run `pnpm prettier --write` on the changed files.

```bash
git add apps/web/src apps/web/messages
git commit -m "Keywords: show one device at a time, with one Rank column"
```

---

### Task 2: End to end and documentation

**Files:**
- Modify: `e2e/flows/rankings.spec.ts` (and `e2e/visual/pages.spec.ts` only if a screenshot name or step uses the removed option)
- Modify: `docs/design-system/24-page-templates.md`, `docs/20-frontend-specification.md`

- [ ] **Step 1: Find the e2e steps that use the removed option or columns**

Run: `grep -n "Desktop and mobile\|Mobile\|Desktop\|dev=" e2e/flows/rankings.spec.ts e2e/visual/pages.spec.ts e2e/flows/table-style.spec.ts`
Expected: a short list. For each hit that looks for the combined option or a Desktop or Mobile column header, change it to the Rank header or the two-option control.

- [ ] **Step 2: Run the e2e flows for the page**

Run: `pnpm e2e e2e/flows/rankings.spec.ts`
Expected: PASS. If a visual baseline changed because the table lost a column, regenerate only that baseline with the project's documented command and look at the image before committing.

- [ ] **Step 3: Documentation**

In `docs/design-system/24-page-templates.md`, section "As built" (the paragraphs beginning "As built (2026-10-06" and "As built (rank features, 2026-10-29"), add one paragraph after them:

```md
As built (one device at a time, 2026-11-04, plan `2026-11-04-keywords-one-device.md`): the Device scope control has two options, Desktop and Mobile (the URL key `dev` holds `mobile`; Desktop is the default and is kept out of the URL). The table has one Rank column (id `current_rank`, headed "Rank") and every figure beside it is that device's own: rank and change, ranking URL, SERP features, AI Overview, trend and Updated. A keyword not tracked on the device is not listed. The strip counts the tracked keywords of the device shown. The ranking pages popup lists the rank on the device shown. The export has one column "Rank (Desktop)" or "Rank (Mobile)". An action on a keyword still reaches both of its devices.
```

In `docs/20-frontend-specification.md` section 5.3, find the sentence that says the table shows a rank column for each device and rewrite it to the one-Rank-column behaviour in the same words. Use `grep -n "Desktop\|both devices\|each device" docs/20-frontend-specification.md` to find it.

- [ ] **Step 4: Final checks and commit**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
Expected: all pass (the full suite is long; run it in the background and read the summary).

```bash
git add apps/web/e2e docs
git commit -m "Keywords: one device at a time, end to end and in the docs"
```

---

## Self-review

- **Spec coverage:** two options only (Task 1 steps 3, 4); one Rank column (steps 5, 6); everything shown is the device's own (the pairing already makes the device's row the shown row, step 2 makes it unconditional); strip per device (step 11); popup, export (steps 7 to 10); docs (task 2). Volume, KD, CPC and Intent are left device independent on purpose.
- **Placeholders:** none. Steps 3, 7 and 9 tell the implementer to read the named fixtures because their exact values live in the existing test files.
- **Type consistency:** `Device` is the single type (`keyword-pairs.ts`); `DeviceScope` is deleted everywhere (`pairRows`, `KeywordScope`, `rankingPages`, `RankingPagesCardProps.device`, `buildExport`, `useKeywordColumns`); `RankColumns.rank` replaces `rankDesktop` and `rankMobile`.
- **Known limit:** in server mode (more than 10,000 matching rows) pairing happens per page, as it did before when one device was chosen; this plan does not change that.
