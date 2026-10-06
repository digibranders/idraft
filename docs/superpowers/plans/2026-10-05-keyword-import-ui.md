# Keyword Import (Frontend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an editor import keywords from a CSV file or a paste: upload with a progress bar, map the file's columns, review what will happen to every row (new, duplicate, variant, conflict, invalid, over quota), confirm, follow the write in the Rankings header, and download the report.

**Architecture:** This is Task 9 of `docs/superpowers/plans/2026-10-01-keywords-ui.md`, written out step by step. Pure modules hold the import's rules (which step comes next, how outcomes add up, whether a mapping is valid, what Confirm will do), so the dialog only renders state and sends requests. The dialog is the existing `StepperDialog` (720 px) over Rankings. A route `seo/rankings/import` keeps Rankings mounted through a `layout.tsx` and opens the dialog from the URL. The upload goes through `XMLHttpRequest`, the only browser API with upload progress. After Confirm the dialog closes and Rankings' header shows `CollectionProgress` until the write ends, then a toast offers the report.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict (`exactOptionalPropertyTypes`), TanStack Query 5, react-hook-form, zod 4, next-intl, Base UI, MSW, Vitest with Testing Library, Playwright.

---

## Read first

| What | Where |
|---|---|
| The parent plan and its executor notes (gates, house rules, Opus review, no dashes) | `docs/superpowers/plans/2026-10-01-keywords-ui.md`, "Notes for the executor" and Task 9 |
| The backend's import rules (sent 2026-10-05) | "Facts" below; the backend's own sub-plan is `docs/superpowers/plans/2026-10-05-keyword-imports.md` on `backend/keywords` (rule I4) |
| Outcomes, actions, columns | backend plan `docs/superpowers/plans/2026-10-01-keywords.md` D11 to D13 (lines 106 to 129) |
| Routes | `docs/19-api-specification.md` section 3.6.3 (lines 934 to 967) and `apps/web/openapi/step-5-draft.json` |
| Stepper dialog | `docs/design-system/16-drawers-dialogs-popovers.md` section 4.6; `apps/web/src/components/ui/stepper-dialog.tsx` |
| Dropzone and mapping copy | `docs/design-system/10-forms.md` section 15 (lines 372 to 399); `docs/design-system/25-component-inventory.md` `FileDropzoneProps` (around line 1827) |
| Progress and toasts | `docs/design-system/17-empty-loading-error-states.md` section 4 (lines 181 to 219); `apps/web/src/components/app/status/collection-progress.tsx` |
| The import mocks | `apps/web/src/mocks/handlers/keyword-imports.ts`, `keyword-import-rows.ts` and their tests |

All commands run in `apps/web`. Before any markup, invoke `design-taste-frontend` (house rule); the project's design system outranks its generic advice.

## Facts

**Routes** (all `imports:write`; `{P}` is `/api/v1/workspaces/{workspace_id}/projects/{project_id}`):

| Route | Use |
|---|---|
| `POST {P}/keyword-imports/upload` | multipart: `file` (CSV, UTF-8, a BOM is fine, 50 MB at most) and `options` (the JSON of `{ column_mapping?, defaults? }`); `202 { data: KeywordImport }` |
| `POST {P}/keyword-imports` | JSON `{ source: 'paste', paste, defaults? }` (one keyword per line; a TAB then tags); `202` |
| `GET {P}/keyword-imports/{id}` | the import; `Retry-After` while it is not settled |
| `GET {P}/keyword-imports?filter[status]=writing&limit=1` | a write in progress, to resume its header progress after a reload |
| `PATCH {P}/keyword-imports/{id}` | `{ column_mapping?, defaults? }` re-reads the source; or `{ row_actions: [{ row_no, part?, action }] }` alone |
| `GET {P}/keyword-imports/{id}/rows?filter[outcome_in]=...&filter[action]=...&limit=&cursor=` | rows of the preview, only from `preview_ready` on |
| `POST {P}/keyword-imports/{id}/confirm` | `{ duplicate_action?: 'skip' | 'merge_terms' }`; `202`, status becomes `writing` |
| `POST {P}/keyword-imports/{id}/cancel` | before writing starts |
| `GET {P}/keyword-imports/{id}/report` | `text/csv`, streamed, one line per row with outcome and reason |

**`KeywordImport`** fields used here: `import_id`, `source`, `original_filename`, `status`, `column_mapping` (`{ header: field }`, only the headers that map), `defaults`, `counts { rows_total, new, duplicate, variant, conflict, invalid, created, skipped, merged }`, `quota { limit, used, would_use } | null` (only while the preview is `preview_ready`, as the API gives it), `error_code`, `expires_at`, `operation { status, progress { done, total, unit } }`.

**Statuses:** `uploaded`, `parsing`, `needs_mapping`, `preview_ready`, `writing`, `completed`, `completed_with_errors`, `failed`, `cancelled`, `expired`.

**Rules the backend confirmed on 2026-10-05:**
1. A PATCH of `column_mapping` or `defaults` sets status `uploaded`; `parsing` is never seen. Treat `uploaded` and `parsing` alike as "reading the file". The next state is `preview_ready`, `needs_mapping` or `failed`.
2. `needs_mapping` carries `error_code`:
   - `keyword_column_missing`: nothing maps to `keyword`;
   - `tags_vocabulary_missing`: a column maps to `tags` (or a paste line has a TAB) and `defaults.tags_vocabulary_id` is not set;
   - `topic_vocabulary_missing`: the same for `topic`.
   Fix with PATCH `column_mapping` or `defaults`.
3. A header maps to the field of the same name, without case, after trimming. `column_mapping` keys are matched to the file's headers without case; send the header text exactly as the file has it.
4. Two headers mapped to one field: `422 validation_failed`, `field_mapped_twice` at `column_mapping`. With a paste, `column_mapping` is `422` with `not_applicable`.
5. `row_actions` together with a mapping or defaults: `422` with `not_with_mapping` at `row_actions`. `row_actions` only in `preview_ready`.
6. Actions per outcome: `new` and `variant` take `create` or `skip`; tracked `duplicate` and `conflict` take `skip` or `merge`; in-file repeats (`reason_code: 'repeated_in_file'`) and `invalid` take `skip` only. `force_separate` is `422 force_separate_not_available` (never offered).
7. Counts count parts: a `device: both` row is two parts (`part` 1 desktop, 2 mobile) and counts twice; `rows_total` is the number of parts.
8. Confirm: `422 quota_exceeded` (`limit`, `used`, `requested`) writes nothing; `409 invalid_state_transition` in any state but `preview_ready`.
9. `GET {W}/runs` is not in part 1 (irrelevant here; noted for Task 12).

**Invalid reason codes** (D12, as the backend sends them, in the order it checks a row): `cell_too_long`, `keyword_missing`, `keyword_invalid`, `keyword_too_long`, `search_operator_not_allowed`, `cell_invalid`, `location_unknown`, `language_invalid`, `device_invalid`, `priority_invalid`, `depth_profile_invalid`, `intent_invalid`, `funnel_stage_invalid`, `target_url_invalid`, `group_path_invalid`, `tags_invalid`, `topic_invalid`. Other rows carry `repeated_in_file` and `tracked` (duplicates), `casing_differs` (variants) and `archived` (conflicts). An earlier draft of this plan, and the first mocks, named them `repeated_row`, `already_tracked`, `variant` and `conflict`; the backend never sent those.

**Fields** (`ImportField`): `keyword`, `country`, `location`, `language`, `device`, `tags`, `topic`, `group`, `intent`, `funnel_stage`, `priority`, `target_url`, `depth_profile`. `competitors` does not exist in part 1.

## Decisions

1. **CSV only.** The design system mentions TSV; the backend reads CSV (`415` otherwise). The dropzone accepts `.csv` and `text/csv`.
2. **The browser reads the header line itself.** `column_mapping` names only mapped headers, so the Map step reads the file's first 64 KiB in the browser for every header and three sample rows. A file that is not UTF-8 is refused there, before the upload.
3. **Map is a step for files only.** A paste has no columns: its steps are Upload, Review, Confirm. A paste whose lines hold a TAB shows the Tags vocabulary choice in the Upload step.
4. **Vocabularies are chosen where they are needed.** In the Map step, a row mapped to `tags` or `topic` shows its vocabulary `Select` under it; `needs_mapping` with a vocabulary code puts the error there.
5. **Outcome-level choices, not row-level.** Review offers one choice per outcome: duplicates skip or merge groups and tags (`duplicate_action` on confirm); conflicts skip or unarchive (sent as `row_actions` `merge` for every conflict row just before confirm, read page by page from `rows?filter[outcome_in]=conflict`). New rows are created; variants are created with a warning; invalid rows are skipped.
6. **Over quota blocks Confirm.** When `quota.would_use > quota.limit`, Review shows how many are over and the Confirm step's button stays disabled with that reason (the API would refuse it anyway).
7. **A route keeps Rankings mounted.** `seo/rankings/layout.tsx` renders the screen; `page.tsx` and `import/page.tsx` render nothing. A client wrapper reads the segment and tells the screen whether the dialog is open, so the table, its scroll and the header progress survive opening and closing.
8. **Closing past step 1 asks first**, then cancels a cancellable import in the background (`POST cancel`, errors ignored; the API expires previews after 7 days anyway).
9. **"Download report"** is the toast's action (the parent plan's wording; the design system says "View report", but the report is a file).

## File structure

| File | Responsibility |
|---|---|
| Move `src/mocks/csv.ts` to `src/lib/csv/csv.ts` | `parseCsv` and `toCsv`, shared by the mocks and the browser |
| Create `src/lib/csv/csv-head.ts` (+ test) | Read a file's first bytes: UTF-8 check, headers, three sample rows |
| Create `src/lib/api/upload.ts` (+ test) | `uploadForm`: a multipart POST through `XMLHttpRequest` with progress, request id and problem errors |
| Create `src/lib/dom/download.ts` (+ test) | `downloadUrl(url, filename)` |
| Create `src/features/rankings/import/import-model.ts` (+ test) | Pure rules: steps, reading states, outcome summary, mapping check, confirm plan, reason keys |
| Create `src/features/rankings/import/import-queries.ts` | Paths, `useImport(scope, id)` with polling, `readRows`, `conflictRowActions` |
| Create `src/features/rankings/import/upload-step.tsx` | Source tabs (File, Paste), dropzone, options, progress |
| Create `src/features/rankings/import/file-dropzone.tsx` | The dropzone of 10-forms section 15.1 |
| Create `src/features/rankings/import/mapping-step.tsx` | Header, Maps to, Sample; vocabulary choices |
| Create `src/features/rankings/import/review-step.tsx` | Counts per outcome, choices, first 20 rows per outcome |
| Create `src/features/rankings/import/confirm-step.tsx` | What Confirm will do; quota reason |
| Create `src/features/rankings/import/import-dialog.tsx` | The `StepperDialog` and the flow between steps |
| Create `src/features/rankings/import/import-progress.tsx` | Header `CollectionProgress`, completion toast with the report |
| Create `src/features/rankings/import/import.test.tsx` | Component tests of the whole flow |
| Create `src/features/rankings/rankings-route.tsx` | Client wrapper: segment to `importOpen`, close by `router.replace` |
| Create `src/app/[workspace]/[project]/seo/rankings/layout.tsx` | Renders `RankingsRoute` (moves the page's data loading here) |
| Modify `src/app/[workspace]/[project]/seo/rankings/page.tsx` | Keeps `generateMetadata`; renders `null` |
| Create `src/app/[workspace]/[project]/seo/rankings/import/page.tsx` | Its own title; renders `null` |
| Modify `src/features/rankings/rankings-screen.tsx` | Props `importOpen`, `onImportOpenChange`; Import button; header progress |
| Modify `src/features/rankings/index.ts` | Export `RankingsRoute` |
| Modify `src/mocks/handlers/keyword-imports.ts`, `keyword-import-rows.ts` (+ tests) | Align with the backend's rules 1, 2, 4, 5, 6 |
| Modify `messages/en.json` | `rankings.import.*` |
| Modify `e2e/flows/rankings.spec.ts` | Import a CSV through review and confirm |
| Modify `docs/superpowers/plans/2026-10-01-keywords-ui.md` | Task 9 as-built note |

---

### Task 1: Align the import mocks with the backend's rules

**Files:**
- Modify: `apps/web/src/mocks/handlers/keyword-imports.ts`
- Modify: `apps/web/src/mocks/handlers/keyword-import-rows.ts`
- Test: `apps/web/src/mocks/handlers/keyword-imports.test.ts`

- [ ] **Step 1: Write failing tests** in `keyword-imports.test.ts`, using the file's existing `upload` and request helpers:
  1. Right after an upload, and right after a PATCH of `column_mapping`, the import reads `status: 'uploaded'` (never `parsing`); after the parse delay it reads `preview_ready`.
  2. An upload whose headers include no keyword column reads `needs_mapping` with `error_code: 'keyword_column_missing'`.
  3. A CSV with a `tags` column and no `defaults.tags_vocabulary_id` reads `needs_mapping` with `error_code: 'tags_vocabulary_missing'`; a PATCH of `defaults` with a vocabulary id the project sees reads `uploaded`, then `preview_ready`. Same for `topic` with `topic_vocabulary_missing`.
  4. A paste whose line holds a TAB, with no tags vocabulary, reads `needs_mapping` with `tags_vocabulary_missing`.
  5. A paste import PATCHed with `column_mapping` is `422` with `not_applicable` at `column_mapping`.
  6. A PATCH with both `row_actions` and `defaults` is `422` with `not_with_mapping` at `row_actions`.
  7. A `merge` row action on a `repeated_in_file` duplicate is `422` with `action_not_allowed`; `skip` is fine.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run src/mocks/handlers/keyword-imports.test.ts`
Expected: tests 1 to 7 FAIL; the existing tests pass.

- [ ] **Step 3: Change the mocks**
  - `statusOf`: return `'uploaded'` where it returns `'parsing'` now. Keep `'parsing'` in the status list (the contract has it) but never produce it. In `importView`, `parsing` becomes `status === 'uploaded'`.
  - Separate a failure from a mapping problem: keep `entry.error_code` for `failed` only, and add `function mappingProblem(entry): 'keyword_column_missing' | 'tags_vocabulary_missing' | 'topic_vocabulary_missing' | null` (keyword first, then tags, then topic; tags and topic count when a mapped column names them or, for a paste, when a line holds a TAB). `statusOf` returns `needs_mapping` when it is not `null`; the view's `error_code` is `entry.error_code ?? (status === 'needs_mapping' ? mappingProblem(entry) : null)`.
  - PATCH: refuse `column_mapping` on a paste (`bodyError('column_mapping', 'not_applicable', 'A paste has no columns.')`); refuse `row_actions` sent with `column_mapping` or `defaults` (`bodyError('row_actions', 'not_with_mapping', 'Row actions apply to a preview; send them on their own.')`).
  - Row actions: add `allowed_actions: readonly RowAction[]` to `AnalyzedRow` in `keyword-import-rows.ts`, set from `ACTIONS_OF[outcome]` except `['skip']` for `repeated_in_file`; the PATCH checks `row.allowed_actions` instead of `ACTIONS_OF[row.outcome]`.
  - Update the handler's doc comment where it describes statuses.

- [ ] **Step 4: Run the mock tests**

Run: `pnpm vitest run src/mocks`
Expected: PASS. Fix any older test that expected `parsing`; its intent is "still reading".

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/mocks
git commit -m "Mocks: import statuses and mapping rules as the backend builds them"
```

### Task 2: CSV in `lib`, and the file head reader

**Files:**
- Move: `apps/web/src/mocks/csv.ts` to `apps/web/src/lib/csv/csv.ts` (and its test, if one exists, to `src/lib/csv/csv.test.ts`)
- Modify: every importer of `../csv` or `@/mocks/csv` (find them with `grep -rn "csv'" src/mocks src/test`)
- Create: `apps/web/src/lib/csv/csv-head.ts`
- Test: `apps/web/src/lib/csv/csv-head.test.ts`

- [ ] **Step 1: Move the file** with `git mv`, then point every import at `@/lib/csv/csv`. The boundaries lint rule lets mocks import `lib`; features may not import mocks, which is why it moves.

Run: `pnpm lint && pnpm vitest run src/mocks`
Expected: clean, PASS.

- [ ] **Step 2: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

import { readCsvHead } from './csv-head';

const file = (parts: BlobPart[], name = 'k.csv'): File => new File(parts, name, { type: 'text/csv' });

describe('readCsvHead', () => {
  it('reads the headers and up to three sample rows', async () => {
    const head = await readCsvHead(file(['﻿Keyword,Tags\ncrm,"a|b"\nseo,x\nppc,y\nlast,z\n']));
    expect(head).toEqual({
      kind: 'ok',
      headers: ['Keyword', 'Tags'],
      samples: [
        ['crm', 'a|b'],
        ['seo', 'x'],
        ['ppc', 'y'],
      ],
    });
  });

  it('stops at the last whole line of the bytes it reads', async () => {
    const long = `Keyword\n${'a'.repeat(70_000)}\nshort\n`;
    const head = await readCsvHead(file([long]), 65_536);
    expect(head).toEqual({ kind: 'ok', headers: ['Keyword'], samples: [] });
  });

  it('refuses a file that is not UTF-8', async () => {
    expect(await readCsvHead(file([new Uint8Array([0x4b, 0x65, 0x79, 0x0a, 0xff, 0xfe, 0x0a])]))).toEqual({
      kind: 'not_utf8',
    });
  });

  it('refuses a file with no header line', async () => {
    expect(await readCsvHead(file(['']))).toEqual({ kind: 'empty' });
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `pnpm vitest run src/lib/csv/csv-head.test.ts`
Expected: FAIL, the module does not exist.

- [ ] **Step 4: Write the module**

```ts
import { parseCsv } from './csv';

export type CsvHead =
  | { kind: 'ok'; headers: string[]; samples: string[][] }
  | { kind: 'not_utf8' }
  | { kind: 'empty' };

const SAMPLE_ROWS = 3;
const NEWLINE = 0x0a;

/**
 * The header line and the first rows of a CSV file, read from its first `maxBytes` only, so a 50 MB file
 * costs no more than a small one. The bytes are cut at the last line break they hold, so neither a row nor
 * a UTF-8 character is cut in half; the whole file is read when it is smaller.
 */
export async function readCsvHead(file: Blob, maxBytes = 65_536): Promise<CsvHead> {
  const bytes = new Uint8Array(await file.slice(0, maxBytes).arrayBuffer());
  const whole = file.size <= maxBytes;
  const end = whole ? bytes.length : bytes.lastIndexOf(NEWLINE) + 1;
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, end));
  } catch {
    return { kind: 'not_utf8' };
  }
  const [header, ...rows] = parseCsv(text);
  if (header === undefined || header.every((cell) => cell.trim() === '')) return { kind: 'empty' };
  return { kind: 'ok', headers: header.map((cell) => cell.trim()), samples: rows.slice(0, SAMPLE_ROWS) };
}
```

`parseCsv` already drops a leading BOM. If jsdom's `Blob` lacks `arrayBuffer`, the test setup (`vitest.setup.ts`) may need Node's `Blob`; check first, and prefer `new Response(file.slice(...)).arrayBuffer()` if `arrayBuffer` is missing.

- [ ] **Step 5: Run the tests to see them pass**

Run: `pnpm vitest run src/lib/csv`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/csv apps/web/src/mocks apps/web/src/test
git commit -m "CSV in lib, and reading a file's head in the browser"
```

### Task 3: Upload with progress, and downloads

**Files:**
- Create: `apps/web/src/lib/api/upload.ts`
- Test: `apps/web/src/lib/api/upload.test.ts`
- Create: `apps/web/src/lib/dom/download.ts`
- Test: `apps/web/src/lib/dom/download.test.ts`

- [ ] **Step 1: Write the failing upload test** with a fake `XMLHttpRequest` (`vi.stubGlobal`), so progress events can be driven:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

import { isApiProblem } from './problem';
import { uploadForm } from './upload';

class FakeXhr {
  static last: FakeXhr | null = null;
  upload = { onprogress: null as ((event: { loaded: number; total: number; lengthComputable: boolean }) => void) | null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 0;
  responseText = '';
  headers = new Map<string, string>();
  sent: unknown = null;
  method = '';
  url = '';
  responseHeaders = 'content-type: application/json';
  constructor() {
    FakeXhr.last = this;
  }
  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string): void {
    this.headers.set(name.toLowerCase(), value);
  }
  getAllResponseHeaders(): string {
    return this.responseHeaders;
  }
  send(body: unknown): void {
    this.sent = body;
  }
  abort(): void {
    this.onabort?.();
  }
}

afterEach(() => vi.unstubAllGlobals());

describe('uploadForm', () => {
  it('posts the form with a request id, reports progress and answers the JSON body', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const progress: number[] = [];
    const form = new FormData();
    const answer = uploadForm('/api/v1/x', form, { onProgress: ({ loaded }) => progress.push(loaded) });
    const xhr = FakeXhr.last!;
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe(`${window.location.origin}/api/v1/x`);
    expect(xhr.headers.get('x-request-id')).toMatch(/.+/);
    expect(xhr.sent).toBe(form);
    xhr.upload.onprogress?.({ loaded: 50, total: 100, lengthComputable: true });
    xhr.status = 202;
    xhr.responseText = '{"data":{"import_id":"i1"}}';
    xhr.onload?.();
    await expect(answer).resolves.toEqual({ data: { import_id: 'i1' } });
    expect(progress).toEqual([50]);
  });

  it('turns an error answer into the API problem', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const answer = uploadForm('/api/v1/x', new FormData());
    const xhr = FakeXhr.last!;
    xhr.status = 413;
    xhr.responseHeaders = 'content-type: application/problem+json';
    xhr.responseText = JSON.stringify({ type: 'about:blank', title: 'Too large', status: 413, code: 'payload_too_large' });
    xhr.onload?.();
    await expect(answer).rejects.toSatisfy((error: unknown) => isApiProblem(error, 'payload_too_large'));
  });

  it('rejects with a TypeError when the connection fails, and with an AbortError when aborted', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const failed = uploadForm('/api/v1/x', new FormData());
    FakeXhr.last!.onerror?.();
    await expect(failed).rejects.toBeInstanceOf(TypeError);
    const controller = new AbortController();
    const aborted = uploadForm('/api/v1/x', new FormData(), { signal: controller.signal });
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' });
  });
});
```

Read the problem JSON shape the API sends from `src/lib/api/problem.ts` (`problemFrom`) and from a mock `problem(...)` answer; adjust the test body to match it exactly. If the lint rules forbid `!`, replace `FakeXhr.last!` with a small `lastXhr()` helper that throws when it is `null`.

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run src/lib/api/upload.test.ts`
Expected: FAIL, the module does not exist.

- [ ] **Step 3: Write `upload.ts`**

```ts
import { problemFrom } from './problem';
import { REQUEST_ID_HEADER, newRequestId } from '@/lib/request-id';

export interface UploadProgress {
  loaded: number;
  /** `null` when the browser cannot tell the size. */
  total: number | null;
}

export interface UploadOptions {
  onProgress?: ((progress: UploadProgress) => void) | undefined;
  signal?: AbortSignal | undefined;
}

/** Response headers as `XMLHttpRequest` lists them, for `problemFrom`. */
function headersOf(raw: string): Headers {
  const headers = new Headers();
  for (const line of raw.trim().split(/[\r\n]+/)) {
    const at = line.indexOf(':');
    if (at > 0) headers.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
  }
  return headers;
}

/**
 * A multipart POST to this app's API with upload progress, which `fetch` cannot report. Same origin, so the
 * session cookie goes along as with the typed client, and with an `X-Request-Id` as every request has. The
 * answer is the parsed JSON body, `unknown` until the caller checks it; an error answer rejects with the
 * `ApiProblem`, a lost connection with a `TypeError` (retryable, as `fetch`'s), an abort with an `AbortError`.
 */
export function uploadForm(path: `/api/v1/${string}`, form: FormData, options: UploadOptions = {}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${window.location.origin}${path}`);
    xhr.setRequestHeader(REQUEST_ID_HEADER, newRequestId());
    xhr.upload.onprogress = (event) => {
      options.onProgress?.({ loaded: event.loaded, total: event.lengthComputable ? event.total : null });
    };
    xhr.onload = () => {
      const response = new Response(xhr.responseText === '' ? null : xhr.responseText, {
        status: xhr.status,
        headers: headersOf(xhr.getAllResponseHeaders()),
      });
      let body: unknown = null;
      try {
        body = xhr.responseText === '' ? null : JSON.parse(xhr.responseText);
      } catch {
        body = xhr.responseText;
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(problemFrom(response, body));
    };
    xhr.onerror = () => reject(new TypeError('The upload lost its connection'));
    xhr.onabort = () => reject(new DOMException('The upload was stopped', 'AbortError'));
    options.signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(form);
  });
}
```

`new Response(body, { status })` throws for a status outside 200 to 599 (a 0 from a blocked request reaches `onerror`, not `onload`, so this holds). If `problemFrom` takes the raw text rather than the parsed body for non-JSON answers, pass what it expects (read its signature).

- [ ] **Step 4: Write the failing download test, then `download.ts`**

```ts
import { describe, expect, it, vi } from 'vitest';

import { downloadUrl } from './download';

describe('downloadUrl', () => {
  it('clicks a temporary link with the file name, then removes it', () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    downloadUrl('/api/v1/report', 'keywords-report.csv');
    expect(click).toHaveBeenCalledOnce();
    const link = click.mock.contexts[0] as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/api/v1/report');
    expect(link.download).toBe('keywords-report.csv');
    expect(document.body.contains(link)).toBe(false);
    click.mockRestore();
  });
});
```

```ts
/** Downloads a same-origin URL as `filename`: the session cookie goes along, nothing is held in memory. */
export function downloadUrl(url: string, filename: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
}
```

If the `as HTMLAnchorElement` in the test trips the lint config, check `instanceof HTMLAnchorElement` and fail the test otherwise.

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run src/lib/api/upload.test.ts src/lib/dom/download.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/api/upload.ts apps/web/src/lib/api/upload.test.ts apps/web/src/lib/dom/download.ts apps/web/src/lib/dom/download.test.ts
git commit -m "Uploads with progress, and downloads"
```

### Task 4: The import's rules (pure)

**Files:**
- Create: `apps/web/src/features/rankings/import/import-model.ts`
- Test: `apps/web/src/features/rankings/import/import-model.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

import {
  autoMapping,
  confirmPlan,
  importPhase,
  mappingProblems,
  outcomeSummary,
  stepsOf,
  type Counts,
} from './import-model';

const counts = (over: Partial<Counts> = {}): Counts => ({
  rows_total: 0, new: 0, duplicate: 0, variant: 0, conflict: 0, invalid: 0, created: 0, skipped: 0, merged: 0, ...over,
});

describe('import model', () => {
  it('has a Map step for files only', () => {
    expect(stepsOf('upload')).toEqual(['upload', 'map', 'review', 'confirm']);
    expect(stepsOf('paste')).toEqual(['upload', 'review', 'confirm']);
  });

  it('names the phase of each status', () => {
    expect(importPhase('uploaded')).toBe('reading');
    expect(importPhase('parsing')).toBe('reading');
    expect(importPhase('needs_mapping')).toBe('needs_mapping');
    expect(importPhase('preview_ready')).toBe('ready');
    expect(importPhase('writing')).toBe('writing');
    expect(importPhase('completed_with_errors')).toBe('done');
    expect(importPhase('expired')).toBe('expired');
    expect(importPhase('cancelled')).toBe('gone');
    expect(importPhase('failed')).toBe('failed');
  });

  it('maps headers to fields by name without case, as the API does', () => {
    expect(autoMapping([' Keyword ', 'TAGS', 'Volume'])).toEqual({ ' Keyword ': 'keyword', TAGS: 'tags' });
  });

  it('finds a missing keyword column and fields mapped twice', () => {
    expect(mappingProblems({ A: 'tags' }, { tagsVocabulary: 'v1', topicVocabulary: null })).toEqual({
      form: 'keyword_missing',
      rows: {},
    });
    expect(
      mappingProblems({ A: 'keyword', B: 'tags', C: 'tags' }, { tagsVocabulary: 'v1', topicVocabulary: null }),
    ).toEqual({ form: null, rows: { B: 'mapped_twice', C: 'mapped_twice' } });
    expect(mappingProblems({ A: 'keyword', B: 'topic' }, { tagsVocabulary: null, topicVocabulary: null })).toEqual({
      form: null,
      rows: { B: 'vocabulary_missing' },
    });
  });

  it('adds up the outcomes and what goes over the quota', () => {
    const summary = outcomeSummary(counts({ rows_total: 10, new: 6, duplicate: 2, invalid: 2 }), {
      limit: 100,
      used: 97,
      would_use: 103,
    });
    expect(summary).toEqual({ new: 6, duplicate: 2, variant: 0, conflict: 0, invalid: 2, overQuota: 3 });
  });

  it('says what Confirm will do with the choices made', () => {
    expect(
      confirmPlan(counts({ new: 5, variant: 1, duplicate: 2, conflict: 3, invalid: 1 }), {
        duplicates: 'merge',
        conflicts: 'unarchive',
      }),
    ).toEqual({ create: 6, merge: 2, unarchive: 3, skip: 1, duplicateAction: 'merge_terms', conflictAction: 'merge' });
    expect(
      confirmPlan(counts({ new: 1, duplicate: 1, conflict: 1 }), { duplicates: 'skip', conflicts: 'skip' }),
    ).toEqual({ create: 1, merge: 0, unarchive: 0, skip: 2, duplicateAction: 'skip', conflictAction: 'skip' });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run src/features/rankings/import/import-model.test.ts`
Expected: FAIL, the module does not exist.

- [ ] **Step 3: Write the module**

```ts
import type { components } from '@/lib/api/schema';

export type KeywordImport = components['schemas']['KeywordImport'];
export type ImportStatus = KeywordImport['status'];
export type ImportSource = 'upload' | 'paste';
export type Counts = components['schemas']['ImportCounts'];
export type Quota = components['schemas']['ImportQuota'];
export type ImportField = components['schemas']['ImportField'];
export type Outcome = components['schemas']['ImportRow']['outcome'];
export type StepId = 'upload' | 'map' | 'review' | 'confirm';

/** Every field a column can map to, in the order the Map step lists them. */
export const IMPORT_FIELDS: readonly ImportField[] = [
  'keyword', 'location', 'country', 'language', 'device', 'tags', 'topic', 'group',
  'intent', 'funnel_stage', 'priority', 'target_url', 'depth_profile',
];

export const OUTCOMES: readonly Outcome[] = ['new', 'duplicate', 'variant', 'conflict', 'invalid'];

/** The steps of a source: a paste has no columns to map. */
export const stepsOf = (source: ImportSource): StepId[] =>
  source === 'upload' ? ['upload', 'map', 'review', 'confirm'] : ['upload', 'review', 'confirm'];

export type ImportPhase = 'reading' | 'needs_mapping' | 'ready' | 'writing' | 'done' | 'expired' | 'failed' | 'gone';

/** What a status means to the dialog. `parsing` is never seen (the API commits `uploaded`), but reads the same. */
export function importPhase(status: ImportStatus): ImportPhase {
  switch (status) {
    case 'uploaded':
    case 'parsing':
      return 'reading';
    case 'needs_mapping':
      return 'needs_mapping';
    case 'preview_ready':
      return 'ready';
    case 'writing':
      return 'writing';
    case 'completed':
    case 'completed_with_errors':
      return 'done';
    case 'expired':
      return 'expired';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'gone';
  }
}

/** The API's automatic mapping: a header that names a field, without case and spaces around it. */
export function autoMapping(headers: readonly string[]): Record<string, ImportField> {
  const mapping: Record<string, ImportField> = {};
  for (const header of headers) {
    const field = IMPORT_FIELDS.find((candidate) => candidate === header.trim().toLowerCase());
    if (field !== undefined) mapping[header] = field;
  }
  return mapping;
}

export type MappingRowProblem = 'mapped_twice' | 'vocabulary_missing';

/** What stops a mapping: no keyword column (the form), a field mapped twice or a vocabulary missing (a row). */
export function mappingProblems(
  mapping: Readonly<Record<string, ImportField>>,
  vocabularies: { tagsVocabulary: string | null; topicVocabulary: string | null },
): { form: 'keyword_missing' | null; rows: Record<string, MappingRowProblem> } {
  const entries = Object.entries(mapping);
  const rows: Record<string, MappingRowProblem> = {};
  for (const [header, field] of entries) {
    if (entries.filter(([, other]) => other === field).length > 1) rows[header] = 'mapped_twice';
    else if (field === 'tags' && vocabularies.tagsVocabulary === null) rows[header] = 'vocabulary_missing';
    else if (field === 'topic' && vocabularies.topicVocabulary === null) rows[header] = 'vocabulary_missing';
  }
  return { form: entries.some(([, field]) => field === 'keyword') ? null : 'keyword_missing', rows };
}

export interface OutcomeSummary {
  new: number;
  duplicate: number;
  variant: number;
  conflict: number;
  invalid: number;
  /** Keywords past the plan's limit if the import went ahead as previewed; 0 when it fits. */
  overQuota: number;
}

export function outcomeSummary(counts: Counts, quota: Quota | null): OutcomeSummary {
  return {
    new: counts.new,
    duplicate: counts.duplicate,
    variant: counts.variant,
    conflict: counts.conflict,
    invalid: counts.invalid,
    overQuota: quota === null ? 0 : Math.max(0, quota.would_use - quota.limit),
  };
}

export interface ReviewChoices {
  duplicates: 'skip' | 'merge';
  conflicts: 'skip' | 'unarchive';
}

export const DEFAULT_CHOICES: ReviewChoices = { duplicates: 'skip', conflicts: 'skip' };

export interface ConfirmPlan {
  create: number;
  merge: number;
  unarchive: number;
  skip: number;
  duplicateAction: 'skip' | 'merge_terms';
  /** The row action sent for every conflict row before confirming; `skip` sends none (it is the default). */
  conflictAction: 'skip' | 'merge';
}

/**
 * What Confirm will do, by parts. Duplicates that repeat a row of the file are skipped whatever the choice
 * (the API allows them nothing else), so `merge` counts tracked duplicates at most: the Review step says so.
 */
export function confirmPlan(counts: Counts, choices: ReviewChoices): ConfirmPlan {
  const merge = choices.duplicates === 'merge' ? counts.duplicate : 0;
  const unarchive = choices.conflicts === 'unarchive' ? counts.conflict : 0;
  return {
    create: counts.new + counts.variant,
    merge,
    unarchive,
    skip: counts.invalid + (counts.duplicate - merge) + (counts.conflict - unarchive),
    duplicateAction: choices.duplicates === 'merge' ? 'merge_terms' : 'skip',
    conflictAction: choices.conflicts === 'unarchive' ? 'merge' : 'skip',
  };
}

/** The message key of a row's reason; the API's own `reason` text is the fallback for a code not listed. */
export const REASON_CODES = [
  'keyword_missing', 'keyword_invalid', 'keyword_too_long', 'search_operator_not_allowed', 'location_unknown',
  'language_invalid', 'device_invalid', 'priority_invalid', 'depth_profile_invalid', 'target_url_invalid',
  'group_path_invalid', 'repeated_in_file', 'tracked', 'casing_differs', 'archived',
  // as built: also cell_too_long, cell_invalid, intent_invalid, funnel_stage_invalid, tags_invalid, topic_invalid
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];
export const isReasonCode = (code: string | null): code is ReasonCode =>
  code !== null && (REASON_CODES as readonly string[]).includes(code);
```

Check the field order against `importFieldValues` in `src/lib/api/schema.ts`: `IMPORT_FIELDS` must hold every value exactly once (add a test line `expect(new Set(IMPORT_FIELDS)).toEqual(new Set(importFieldValues))`).

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm vitest run src/features/rankings/import/import-model.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/rankings/import
git commit -m "Rankings: the import's rules"
```

### Task 5: Queries and polling

**Files:**
- Create: `apps/web/src/features/rankings/import/import-queries.ts`

- [ ] **Step 1: Write the module**

```ts
'use client';

import { useQuery, type QueryClient, type UseQueryResult } from '@tanstack/react-query';

import type { KeywordImport } from './import-model';
import type { ProjectScope } from '../rankings-queries';
import { projectKey } from '@/lib/api/keys';
import { api, unwrap } from '@/lib/api/client';
import { apiMutation } from '@/lib/api/query';

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
export const IMPORTS = `${P}/keyword-imports` as const;
export const IMPORT = `${P}/keyword-imports/{import_id}` as const;
export const IMPORT_ROWS = `${P}/keyword-imports/{import_id}/rows` as const;

export const CREATE_IMPORT = apiMutation('post', IMPORTS);
export const CHANGE_IMPORT = apiMutation('patch', IMPORT);
export const CONFIRM_IMPORT = apiMutation('post', `${P}/keyword-imports/{import_id}/confirm`);
export const CANCEL_IMPORT = apiMutation('post', `${P}/keyword-imports/{import_id}/cancel`);

/** Where the browser posts a file; not a typed client route, since `uploadForm` sends it. */
export const uploadPath = (scope: ProjectScope): `/api/v1/${string}` =>
  `/api/v1/workspaces/${scope.workspaceId}/projects/${scope.projectId}/keyword-imports/upload`;

/** Where the report of an import downloads from. */
export const reportPath = (scope: ProjectScope, importId: string): string =>
  `/api/v1/workspaces/${scope.workspaceId}/projects/${scope.projectId}/keyword-imports/${importId}/report`;

export const importKey = (scope: ProjectScope, importId: string): readonly unknown[] => [
  ...projectKey(scope.workspaceId, scope.projectId),
  'keyword-imports',
  importId,
];

/** How often an unsettled import is asked about: the API's `Retry-After` is 5 seconds for imports. */
export const IMPORT_POLL_MS = 5_000;
/** Reading and writing are asked about sooner in the dialog, where someone is waiting. */
export const DIALOG_POLL_MS = 1_000;

const unsettled = (status: KeywordImport['status']): boolean =>
  status === 'uploaded' || status === 'parsing' || status === 'writing';

/** One import, asked about every `pollMs` while it is reading or writing. */
export function useImport(
  scope: ProjectScope,
  importId: string | null,
  pollMs: number,
): UseQueryResult<KeywordImport> {
  return useQuery({
    queryKey: importKey(scope, importId ?? 'none'),
    enabled: importId !== null,
    queryFn: async ({ signal }) =>
      (
        await unwrap(
          api.GET(IMPORT, {
            params: {
              path: { workspace_id: scope.workspaceId, project_id: scope.projectId, import_id: importId ?? '' },
            },
            signal,
          }),
        )
      ).data,
    refetchInterval: (query) => (query.state.data !== undefined && unsettled(query.state.data.status) ? pollMs : false),
  });
}
```

Then add, in the same file:
- `readRows(scope, importId, outcome, limit)` that answers the first `limit` rows of an outcome (one `GET IMPORT_ROWS` with `filter[outcome_in]: [outcome]`, `limit`), for the Review lists.
- `conflictRowActions(scope, importId)` that reads every conflict row page by page (`limit: 200`, following `page.next_cursor` while `page.has_more`) and answers `{ row_no, part, action: 'merge' }[]`.
- `useWritingImport(scope)`: `GET IMPORTS` with `filter[status]: 'writing'`, `limit: 1`, answering the import or `null`; used once on mount to resume header progress.

Check the generated query parameter types (`filter[outcome_in]` is a list; the client serializes lists comma-separated). Use `apiQuery` for `useWritingImport` if that fits better than `useQuery` plus `unwrap`; follow `rankings-queries.ts`.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: clean. Template literal paths must match keys of `paths` in `schema.ts`; if `as const` template strings do not narrow to the path type, write the paths out in full as string literals.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/rankings/import/import-queries.ts
git commit -m "Rankings: import queries"
```

### Task 6: The route that keeps Rankings mounted

**Files:**
- Create: `apps/web/src/app/[workspace]/[project]/seo/rankings/layout.tsx`
- Modify: `apps/web/src/app/[workspace]/[project]/seo/rankings/page.tsx`
- Create: `apps/web/src/app/[workspace]/[project]/seo/rankings/import/page.tsx`
- Create: `apps/web/src/features/rankings/rankings-route.tsx`
- Modify: `apps/web/src/features/rankings/rankings-screen.tsx`, `apps/web/src/features/rankings/index.ts`

- [ ] **Step 1: The layout** takes the page's data loading (membership, current project, `notFound()`) as it is in `page.tsx` today, and renders `<RankingsRoute workspaceId=... projectId=... timeZone=... defaults=...>{children}</RankingsRoute>`. Children are rendered (they are `null`) so Next keeps the segments.

- [ ] **Step 2: The pages.** `page.tsx` keeps `generateMetadata` and returns `null`. `import/page.tsx` has `generateMetadata` with the title `t('import.pageTitle')` from `rankings` (add `"pageTitle": "Import keywords"`) and returns `null`.

- [ ] **Step 3: `rankings-route.tsx`**

```tsx
'use client';

import { usePathname, useRouter, useSearchParams, useSelectedLayoutSegment } from 'next/navigation';
import type { Route } from 'next';
import type { ReactElement, ReactNode } from 'react';

import { RankingsScreen, type RankingsScreenProps } from './rankings-screen';

/**
 * Rankings as its route renders it: `/seo/rankings/import` opens the import dialog over the same mounted
 * screen, so the table, its scroll and a write in progress stay as they are.
 */
export function RankingsRoute({
  children,
  ...props
}: Omit<RankingsScreenProps, 'importOpen' | 'onImportOpenChange'> & { children: ReactNode }): ReactElement {
  const segment = useSelectedLayoutSegment();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const base = segment === 'import' ? pathname.replace(/\/import$/, '') : pathname;
  const go = (path: string): void => router.replace(`${path}${search === '' ? '' : `?${search}`}` as Route, { scroll: false });
  return (
    <>
      <RankingsScreen
        {...props}
        importOpen={segment === 'import'}
        onImportOpenChange={(open) => go(open ? `${base}/import` : base)}
      />
      {children}
    </>
  );
}
```

Export `RankingsScreenProps` from `rankings-screen.tsx` if it is not exported. `useSearchParams` needs a `Suspense` boundary above it in the layout (Next warns at build otherwise); wrap `RankingsRoute` in `<Suspense fallback={<PageSkeleton />}>` the way the workspace pages do (`src/features/shell/page-skeleton.tsx`).

- [ ] **Step 4: Screen props.** `RankingsScreen` takes `importOpen?: boolean` (default `false`) and `onImportOpenChange?: (open: boolean) => void`. The header gains an "Import" button (`variant="secondary"`, icon `Upload`) before "Add keywords" when `useCan('imports:write')`, calling `onImportOpenChange?.(true)`. Do not render the dialog yet (Task 9 does).

- [ ] **Step 5: Run the existing tests and the build**

Run: `pnpm vitest run src/features/rankings && pnpm typecheck && NEXT_PUBLIC_API_MOCKING=off pnpm build`
Expected: PASS and a clean build (the routes list shows `/[workspace]/[project]/seo/rankings/import`).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app apps/web/src/features/rankings apps/web/messages/en.json
git commit -m "Rankings: an import route over the mounted screen"
```

### Task 7: Strings

**Files:**
- Modify: `apps/web/messages/en.json`

- [ ] **Step 1: Add `rankings.import`** (merge with `pageTitle` from Task 6). Every string is plain text without en or em dashes:

```json
"import": {
  "pageTitle": "Import keywords",
  "open": "Import",
  "title": "Import keywords",
  "steps": { "upload": "Upload", "map": "Map columns", "review": "Review", "confirm": "Confirm" },
  "source": "Source",
  "sourceFile": "CSV file",
  "sourcePaste": "Paste",
  "dropzone": "Drop a CSV file here, or choose one",
  "dropzoneActive": "Drop to upload",
  "chooseFile": "Choose file",
  "constraints": "CSV, UTF-8, up to 50 MB. One column must hold the keywords.",
  "fileRow": "{name}, {size}",
  "removeFile": "Remove file",
  "fileTooLarge": "This file is larger than 50 MB. Split it into smaller files.",
  "fileNotUtf8": "This file is not UTF-8. Export it again as CSV UTF-8.",
  "fileNotCsv": "Only CSV files can be imported.",
  "fileEmpty": "This file has no header line.",
  "fileRequired": "Choose a CSV file to import.",
  "pasteLabel": "Keywords",
  "pasteHint": "One keyword per line. To add tags, put a tab after the keyword and separate tags with |.",
  "pasteRequired": "Paste at least one keyword.",
  "options": "Defaults for rows that leave them out",
  "location": "Location",
  "language": "Language",
  "device": "Device",
  "deviceDesktop": "Desktop",
  "deviceMobile": "Mobile",
  "deviceBoth": "Both",
  "tagsVocabulary": "Vocabulary for tags",
  "topicVocabulary": "Vocabulary for topics",
  "vocabularyPlaceholder": "Choose a vocabulary",
  "uploading": "Uploading {name}",
  "uploadProgress": "{percent}% uploaded",
  "reading": "Reading the file",
  "readingRows": "{done} of {total} rows read",
  "mapIntro": "Choose what each column of the file holds. Columns left on Ignore are not imported.",
  "mapColumn": "Column",
  "mapTo": "Maps to",
  "mapSample": "Sample",
  "ignore": "Ignore",
  "fields": {
    "keyword": "Keyword", "country": "Country", "location": "Location", "language": "Language", "device": "Device",
    "tags": "Tags", "topic": "Topic", "group": "Group", "intent": "Intent", "funnel_stage": "Funnel stage",
    "priority": "Priority", "target_url": "Target URL", "depth_profile": "Depth profile"
  },
  "keywordMissing": "Map a column to Keyword.",
  "mappedTwice": "Map each field from one column only.",
  "vocabularyMissing": "Choose the vocabulary these terms belong to.",
  "outcomes": {
    "new": "New", "duplicate": "Duplicate", "variant": "Variant", "conflict": "Archived", "invalid": "Invalid", "overQuota": "Over quota"
  },
  "outcomeHelp": {
    "new": "Tracked as new keywords.",
    "duplicate": "Already tracked in this project.",
    "variant": "The same keyword typed differently. Tracked separately; the provider keeps the first spelling.",
    "conflict": "Archived in this project.",
    "invalid": "Skipped. Each row says why.",
    "overQuota": "{count, plural, one {# keyword is} other {# keywords are}} over your plan's limit of {limit}. Skip rows or archive keywords, then import again."
  },
  "duplicateSkip": "Skip them",
  "duplicateMerge": "Add their groups and tags to the tracked keywords",
  "duplicateRepeatNote": "Rows that repeat an earlier row of the file are always skipped.",
  "conflictSkip": "Leave them archived",
  "conflictUnarchive": "Unarchive them with the file's settings",
  "rowsShown": "First {shown} of {count}",
  "row": "Row {row}",
  "rowPart": "Row {row}, {device}",
  "noKeyword": "No keyword",
  "reasons": {
    "keyword_missing": "The row has no keyword.",
    "keyword_invalid": "The keyword holds a control character.",
    "keyword_too_long": "The keyword is longer than 700 characters.",
    "search_operator_not_allowed": "Search operators such as site: are not tracked.",
    "location_unknown": "No location has this name or id.",
    "language_invalid": "Not a two-letter language code.",
    "device_invalid": "Device is desktop, mobile or both.",
    "priority_invalid": "Priority is a whole number from 1 to 5.",
    "depth_profile_invalid": "Not a depth profile of this workspace.",
    "target_url_invalid": "Not an http or https URL.",
    "group_path_invalid": "A group path is names of 1 to 100 characters joined by /.",
    "repeatedInFile": "Repeats an earlier row of the file.",
    "tracked": "Already tracked.",
    "casingDiffers": "Typed differently from a tracked keyword.",
    "archived": "Archived in this project."
  },
  "confirmIntro": "When you confirm, Sightline writes the rows in the background. You can keep working; the header shows progress.",
  "confirmCreate": "{count, plural, one {# keyword is} other {# keywords are}} tracked",
  "confirmMerge": "{count, plural, one {# tracked keyword gets} other {# tracked keywords get}} the file's groups and tags",
  "confirmUnarchive": "{count, plural, one {# archived keyword is} other {# archived keywords are}} unarchived",
  "confirmSkip": "{count, plural, one {# row is} other {# rows are}} skipped and listed in the report",
  "confirmButton": "{count, plural, =0 {Import} one {Import # keyword} other {Import # keywords}}",
  "overQuotaReason": "The import is over your plan's keyword limit.",
  "expired": "This preview expired after 7 days. Start the import again.",
  "startAgain": "Start again",
  "failed": "The file could not be read. Check that it is a CSV with a header line, then try again.",
  "gone": "This import was cancelled.",
  "requestFailed": "The import could not continue. Try again.",
  "forbidden": "Importing keywords needs permission to import.",
  "quotaExceeded": "The import is over your plan's limit: {used} of {limit} keywords are tracked and this adds {requested}.",
  "uploadTooLarge": "The file is larger than the 50 MB the API takes.",
  "uploadType": "The API takes CSV files only.",
  "storageUnavailable": "Uploads are unavailable right now. Paste the keywords instead, or try again later.",
  "discardTitle": "Stop this import?",
  "discardDescription": "Nothing has been imported yet. The file and your choices are dropped.",
  "discardConfirm": "Stop import",
  "discardKeep": "Keep importing",
  "progressText": "Importing keywords",
  "progressCounts": "{done} of {total} rows",
  "finished": "Import finished: {created} added, {skipped} skipped",
  "finishedMerged": "Import finished: {created} added, {merged} updated, {skipped} skipped",
  "finishedFailed": "Import failed: {reason}",
  "downloadReport": "Download report",
  "reportName": "keyword-import-{date}.csv"
}
```

Check the stepper's `labels` and `discard` props in `stepper-dialog.tsx` (`StepperDialogLabels`, `DialogDiscardCopy`): reuse the existing generic labels (`steps`, `close`, `back`, `cancel`, `continue`, `completed`) from wherever Task 2's design-system section took them, and fit the discard copy above to `DialogDiscardCopy`'s fields.

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: clean (the JSON is valid; unused keys are fine until the components land).

- [ ] **Step 3: Commit**

```bash
git add apps/web/messages/en.json
git commit -m "Rankings: import strings"
```

### Task 8: The steps

**Files:**
- Create: `apps/web/src/features/rankings/import/file-dropzone.tsx`
- Create: `apps/web/src/features/rankings/import/upload-step.tsx`
- Create: `apps/web/src/features/rankings/import/mapping-step.tsx`
- Create: `apps/web/src/features/rankings/import/review-step.tsx`
- Create: `apps/web/src/features/rankings/import/confirm-step.tsx`

- [ ] **Step 1: Invoke `design-taste-frontend`** before writing markup. Then read `docs/design-system/10-forms.md` section 15 and `16-drawers-dialogs-popovers.md` section 4.6 once more; they fix the sizes and copy.

Each step is a controlled component: it renders from props and reports changes up; only the dialog (Task 9) sends requests. Shared types, in `import-dialog.tsx` or a small `import-state.ts` if the dialog grows past about 300 lines:

```ts
export interface UploadValues {
  source: ImportSource;
  file: File | null;
  head: Extract<CsvHead, { kind: 'ok' }> | null;
  paste: string;
  locationId: number | null;
  languageCode: string | null;
  device: 'desktop' | 'mobile' | 'both' | null;
  tagsVocabulary: string | null;
  topicVocabulary: string | null;
}
```

- [ ] **Step 2: `FileDropzone`** with the inventory's props:

```ts
export interface FileDropzoneProps {
  accept: string;
  constraints: string;
  file: { name: string; sizeText: string } | null;
  onFile: (file: File) => void;
  onRemove: () => void;
  error: string | null;
  /** 0 to 100 while uploading; `null` otherwise. */
  progress: number | null;
  progressText: string | null;
  disabled: boolean;
}
```

  - Box `h-24`, dashed `border-border-strong`, `bg-surface-subtle`, `rounded-lg`, the instruction text and a real "Choose file" `Button` that clicks a visually hidden `<input type="file" accept=".csv,text/csv">`. Drag over switches the text to "Drop to upload" and the border to the focus color token the design system names. Drop takes the first file.
  - With a file: one row with the name and size (`formatBytes` from `src/lib/format` if it exists; else add it there with a test), and a "Remove file" `IconButton`.
  - With `progress`: a 4 px bar with `role="progressbar"`, `aria-valuenow`, `aria-valuemin={0}`, `aria-valuemax={100}`, `aria-valuetext={progressText}`; reuse the bar of `CollectionProgress` if it is exported, otherwise style it with the same tokens.
  - `error` shows as the field error under the box (`FieldError`), and the box gets `aria-invalid`.

- [ ] **Step 3: `UploadStep`** props `{ values, onChange, errors: { file?: string; paste?: string }, progress, uploading, vocabularies, locationDefault }`.
  - A `SegmentedControl` for the source (CSV file, Paste).
  - File: `FileDropzone`. On a file: reject by extension or type (`fileNotCsv`), by size over 50 MB (`fileTooLarge`), then `readCsvHead(file)`: `not_utf8` gives `fileNotUtf8`, `empty` gives `fileEmpty`, `ok` stores `head`.
  - Paste: `Textarea` with `pasteHint`; when the text holds a TAB, the Tags vocabulary `Select` shows under it.
  - Options group (`fieldset` with the `options` legend): Location (`LocationCombobox`, as Add keywords uses it, defaulting to the project's location), Language (as Add keywords), Device (`Select` Desktop, Mobile, Both, empty meaning the project default). Copy the controls from `add-keywords-dialog.tsx`; do not invent new ones.

- [ ] **Step 4: `MappingStep`** props `{ headers, samples, mapping, onMappingChange, tagsVocabulary, topicVocabulary, onVocabularyChange, vocabularies, problems, alert }`.
  - The intro sentence, then one row per header in a `div` grid (not a data table; the dialog rules forbid record tables): the header text (`type-label`), a `Select` "Maps to" with Ignore plus `IMPORT_FIELDS` labelled from `fields.*`, and the sample (`type-meta`, the header's values from `samples` joined with ", ", truncated to one line with a title attribute).
  - Under a row mapped to `tags` or `topic`, the vocabulary `Select` for it (tags: every vocabulary the project sees; topic: hierarchical ones only; read `useVocabularies(scope)` from `taxonomy-queries.ts`).
  - `problems.rows[header]` shows that row's error (`mappedTwice` or `vocabularyMissing`); `problems.form` shows `keywordMissing` as a `FormAlert` at the top. `alert` (from the dialog, e.g. a `needs_mapping` answer) shows there too.

- [ ] **Step 5: `ReviewStep`** props `{ summary: OutcomeSummary, quota, choices, onChoicesChange, rows: Partial<Record<Outcome, RowsState>>, limit }` where `RowsState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; rows: ImportRow[]; total: number }`.
  - A count strip at the top: one item per outcome with a count above 0, plus Over quota when above 0 (`MetricStrip` `size="sm"` if it fits the 720 px dialog; otherwise a row of label and number pairs with the same type tokens).
  - Then one section per outcome with a count above 0, in `OUTCOMES` order: heading with the label and count, the `outcomeHelp` sentence, the choice where there is one (`RadioGroup`: duplicates `duplicateSkip` or `duplicateMerge` plus the `duplicateRepeatNote`; conflicts `conflictSkip` or `conflictUnarchive`), and a simple list (`ul`) of the first 20 rows: "Row 12" (or "Row 12, Mobile" for a part of a `both` row; part 1 is desktop, 2 is mobile), the keyword or `noKeyword`, and for invalid rows the reason in words (`reasons.{code}` when `isReasonCode`, else the row's `reason`, else nothing). Under the list, `rowsShown` when the count is above 20.
  - Over quota: a negative `Banner` (or `FormAlert`) with `outcomeHelp.overQuota`.

- [ ] **Step 6: `ConfirmStep`** props `{ plan: ConfirmPlan, overQuota: number }`: the intro sentence and a list of the plan's lines with a count above 0 (`confirmCreate`, `confirmMerge`, `confirmUnarchive`, `confirmSkip`). Over quota repeats the banner.

- [ ] **Step 7: Lint and typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/features/rankings/import apps/web/src/lib/format
git commit -m "Rankings: import steps"
```

### Task 9: The dialog and the flow

**Files:**
- Create: `apps/web/src/features/rankings/import/import-dialog.tsx`
- Modify: `apps/web/src/features/rankings/rankings-screen.tsx`
- Test: `apps/web/src/features/rankings/import/import.test.tsx`

- [ ] **Step 1: Write the failing tests** in `import.test.tsx`. Render `RankingsScreen` through a variant of `rankingsAs` that passes `importOpen` and a spy `onImportOpenChange` (add an optional third parameter `props?: Partial<RankingsScreenProps>` to `rankingsAs` in `src/test/rankings-harness.tsx`). Use `userEvent.upload(input, file)` on the dropzone's file input (find it by its accessible name or `container.querySelector('input[type=file]')`).

First, a probe test: upload through the dialog and assert the mock received it. MSW's node server intercepts `XMLHttpRequest` in jsdom; if it does not, change `ImportDialog` to take an optional `upload?: typeof uploadForm` prop and have the tests pass an uploader built on `fetch` (`(path, form) => fetch(new URL(path, window.location.origin), { method: 'POST', body: form }).then(...)`), keeping the real `uploadForm` for the app.

Cases:
1. **File through to confirm.** Upload a CSV with `keyword,tags` headers and four rows (one new, one tracked fixture keyword, one invalid `site:example.com`, one more new). Upload step shows the file row. Continue. The Map step lists `keyword` mapped to Keyword and `tags` to Tags with the tags vocabulary error. Choose the Topics vocabulary for Tags, Continue: a PATCH with `defaults.tags_vocabulary_id` is sent. Review shows New 2, Duplicate 1, Invalid 1 and the invalid row's reason "Search operators such as site: are not tracked." Continue. Confirm shows "2 keywords are tracked" and the button "Import 2 keywords". Press it: `POST .../confirm` with `{ duplicate_action: 'skip' }`; `onImportOpenChange(false)` is called.
2. **Choices go out.** On Review choose `duplicateMerge` and, with a CSV holding an archived fixture keyword, `conflictUnarchive`; Confirm sends a `PATCH` with `row_actions` of `merge` for the conflict rows, then confirm with `duplicate_action: 'merge_terms'`.
3. **Mapping checks.** Map two columns to Keyword: both rows show "Map each field from one column only." and Continue sends nothing. Map none to Keyword: "Map a column to Keyword."
4. **Paste skips Map.** Choose Paste, type two keywords, Continue: the steps list shows Upload, Review, Confirm; Review shows New 2.
5. **Local file checks.** A `.txt` file: "Only CSV files can be imported."; a file of 50 MB plus one byte (build it with a `Blob` of that size; jsdom does not allocate it): "This file is larger than 50 MB..."; bytes `0xff 0xfe`: "This file is not UTF-8...".
6. **Expired.** Answer the import's GET with `status: 'expired'` (override with `server.use`); the dialog shows the expired message and "Start again", which returns to an empty Upload step.
7. **Over quota.** Override the import's GET with `quota: { limit: 10, used: 9, would_use: 12 }`: Review shows "2 keywords are over your plan's limit of 10..." and the Confirm button is disabled with the reason.
8. **Closing asks first and cancels.** After the upload, press Close: the discard question shows; "Stop import" sends `POST .../cancel` and calls `onImportOpenChange(false)`.
9. **Permission.** A viewer sees no Import button; an editor does.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run src/features/rankings/import/import.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Write `ImportDialog`.** Props: `{ scope, open, onOpenChange, onConfirmed: (importId: string) => void, projectLocation }`. State, in one `useReducer` so steps stay consistent:

```ts
interface ImportState {
  values: UploadValues;
  importId: string | null;
  step: StepId;
  completed: ReadonlySet<StepId>;
  mapping: Record<string, ImportField>;
  choices: ReviewChoices;
  uploadProgress: number | null;
  alert: string | null;
}
```

Flow, driven by `onContinue` of `StepperDialog` (it answers `'ok'` to move on, `'invalid'` to stay):
- **Upload, Continue:**
  - Check locally (file chosen and readable, or paste not empty; a paste with a TAB needs the tags vocabulary). On a problem set the field error and answer `'invalid'`.
  - File: build `FormData` (`file`, and `options` as `JSON.stringify({ defaults })` with only the defaults set: `location_id`, `language_code`, `device`, `tags_vocabulary_id`, `topic_vocabulary_id`). Send `uploadForm(uploadPath(scope), form, { onProgress })`. Parse the answer with `z.object({ data: z.object({ import_id: z.string() }) })`. Paste: `CREATE_IMPORT` with `{ source: 'paste', paste, defaults }`.
  - Store `importId`, then wait for the import to leave `reading` (poll with `useImport(scope, importId, DIALOG_POLL_MS)`; `onContinue` awaits a promise that resolves when the query's data reaches another phase; write a small `waitForPhase(queryClient, key, isDone)` helper with `queryClient.fetchQuery` in a loop with a 1 second delay and an `AbortSignal` from the dialog's lifetime, simpler than subscribing).
  - Then: `ready` goes to Map for a file (the Map step starts from the import's `column_mapping`, falling back to `autoMapping(head.headers)`) or to Review for a paste; `needs_mapping` goes to Map (a paste with `tags_vocabulary_missing` stays on Upload with the vocabulary error); `failed` shows `failed`; `expired` shows the expired state.
- **Map, Continue:**
  - `mappingProblems(mapping, vocabularies)`; any problem shows and answers `'invalid'`.
  - If the mapping or vocabularies differ from the import's (`column_mapping` compared without key order; `defaults.tags_vocabulary_id`, `defaults.topic_vocabulary_id`), send `CHANGE_IMPORT` with `{ column_mapping: mapping, defaults: { ...current defaults, tags_vocabulary_id, topic_vocabulary_id } }` and wait for the phase as above. `needs_mapping` again shows the matching error (`keyword_column_missing` as `keywordMissing`, the vocabulary codes on the tags or topic row) and answers `'invalid'`. A `422` with `field_mapped_twice` marks every row that maps to the field it names.
  - `ready` goes to Review.
- **Review:** loads the first 20 rows per outcome with a count above 0 (`readRows`, through `useQueries` keyed by import id and outcome). Continue goes to Confirm without a request.
- **Confirm (final):**
  - Disabled with `overQuotaReason` when `summary.overQuota > 0` (pass the reason through `StepperDialog` if it has a slot for it; otherwise show the banner and answer `'invalid'`).
  - If `plan.conflictAction === 'merge'`, read `conflictRowActions` and send them in `CHANGE_IMPORT` requests of at most 1,000 actions.
  - Then `CONFIRM_IMPORT` with `{ duplicate_action }`. Success: `onConfirmed(importId)`, reset the state, `onOpenChange(false)`.
  - `quota_exceeded` shows `quotaExceeded` with its numbers (read `limit`, `used` and `requested` from the problem's extension members, as the bulk actions do in `bulk-actions.tsx` `problemText`). `invalid_state_transition` refetches the import and shows `expired`, `gone` or `requestFailed` by its phase.
- **Errors anywhere:**
  - `payload_too_large` gives `uploadTooLarge`;
  - `unsupported_media_type` gives `uploadType`;
  - `storage_unavailable` gives `storageUnavailable`;
  - `forbidden` gives `forbidden`;
  - else `requestFailed`.
  Show them as the dialog's `FormAlert`, and keep the step.
- **Back** keeps every earlier choice (WCAG 3.3.7). Going back from Review to Map and continuing without changes sends nothing.
- **Close:** when `importId !== null` or a file or paste is set, `StepperDialog`'s `discard` question asks first; on discard, if the import's phase is `reading`, `needs_mapping` or `ready`, fire `CANCEL_IMPORT` and ignore its result. Reset the state.
- **Expired view:** the body shows the `expired` message and a "Start again" button that resets to the Upload step (keeping the options, dropping the file).

- [ ] **Step 4: Render it from the screen.** In `rankings-screen.tsx`, when `useCan('imports:write')`: `<ImportDialog scope={scope} open={importOpen} onOpenChange={(open) => onImportOpenChange?.(open)} onConfirmed={setActiveImport} projectLocation={defaults.location} />`. `activeImport` is used in Task 10.

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run src/features/rankings`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/rankings apps/web/src/test
git commit -m "Rankings: import dialog"
```

### Task 10: Header progress and the report

**Files:**
- Create: `apps/web/src/features/rankings/import/import-progress.tsx`
- Modify: `apps/web/src/features/rankings/rankings-screen.tsx`
- Test: `apps/web/src/features/rankings/import/import.test.tsx`

- [ ] **Step 1: Write the failing tests**
  1. After Confirm (case 1 of Task 9), the header shows `CollectionProgress` "Importing keywords" with "N of M rows"; when the mock's write ends, a success toast "Import finished: 2 added, 2 skipped" with "Download report" shows, the progress goes away, and the keyword table shows the new keywords (the list was refreshed).
  2. "Download report" calls `downloadUrl` with the report path and `keyword-import-YYYY-MM-DD.csv` (spy on `HTMLAnchorElement.prototype.click` as in Task 3).
  3. On mount with an import in `writing` (override `GET .../keyword-imports?filter[status]=writing` to answer one), the header shows its progress.
  4. A write that ends `failed` shows the error toast "Import failed: ..." with the operation's error detail.

Use fake timers only if the mock's write delay makes the test slow; the mock writes 1,000 rows a second, so small files finish within one poll.

- [ ] **Step 2: Write `ImportProgress`.** Props `{ scope, importId, onSettled: () => void }`. It polls `useImport(scope, importId, IMPORT_POLL_MS)`.
  - While `writing` (or `reading`): `CollectionProgress` `density="standard"`, `status="running"`, `text={progressText}`, `counts={{ done, failed: 0, total }}` from `operation.progress`, `countsText={progressCounts}`.
  - On `done` (once, guarded by a ref):
    - invalidate the keyword list (`keywordsKey(scope)`), the groups (`refreshGroups`) and the vocabularies' terms (new tags and topics may exist; invalidate the workspace key prefix the vocabularies use in `taxonomy-queries.ts`);
    - show a success toast: `finishedMerged` when `counts.merged > 0`, else `finished`. Its action is `downloadReport`, calling `downloadUrl(reportPath(scope, importId), t('reportName', { date }))` with the date as `YYYY-MM-DD` in the project's time zone (use the date formatter in `src/lib/format`);
    - call `onSettled()`.
  - On `failed`: an error toast `finishedFailed` with `operation.error?.detail` or the `failed` sentence, then `onSettled()`.
  - On `gone` or `expired`: `onSettled()` quietly.
  - Use the toast `id` of the import, so a second render never shows two toasts.

- [ ] **Step 3: Wire it.** In `rankings-screen.tsx`: `const [activeImport, setActiveImport] = useState<string | null>(null)`. On mount, `useWritingImport(scope)` fills it when it is `null` and an import is writing. Render `<ImportProgress ... onSettled={() => setActiveImport(null)} />` in the header area the design system places `CollectionProgress` (doc 23 lines 803 to 806; the page header's meta row).

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run src/features/rankings`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/rankings
git commit -m "Rankings: import progress and report"
```

### Task 11: End to end, as-built note, gates, review

**Files:**
- Modify: `apps/web/e2e/flows/rankings.spec.ts`
- Modify: `docs/superpowers/plans/2026-10-01-keywords-ui.md`

- [ ] **Step 1: E2E flow:** an editor opens Rankings, presses Import (the URL ends in `/seo/rankings/import`), uploads a small CSV written by the test to a temporary file (`keyword,tags` with three new keywords and one fixture duplicate), chooses the tags vocabulary on Map, sees New 3 and Duplicate 1 on Review, imports, sees the header progress and then the "Import finished" toast, and finds the three keywords in the table. The URL is back to `/seo/rankings`.

- [ ] **Step 2: As-built note** under Task 9 in the parent plan:

```markdown
- **As built.** Step by step in `2026-10-05-keyword-import-ui.md`.
  - CSV only (the backend reads CSV). The browser reads the file's first 64 KiB for every header and three sample rows, and refuses a file that is not UTF-8 before uploading; `column_mapping` names only mapped headers.
  - Map is a step for files only. Vocabularies for tags and topics are chosen on the Map row that needs them (and on Upload for a paste with tabs); `needs_mapping` with `keyword_column_missing`, `tags_vocabulary_missing` or `topic_vocabulary_missing` shows on that row.
  - Review offers one choice per outcome: duplicates skip or merge (`duplicate_action`), archived keywords stay or are unarchived (row actions `merge` for every conflict row, sent before confirm). Over quota blocks Confirm.
  - `seo/rankings/layout.tsx` keeps Rankings mounted; `/seo/rankings/import` opens the dialog. The upload goes through `XMLHttpRequest` (`src/lib/api/upload.ts`) for its progress.
  - After Confirm the header shows the write's progress, resumed after a reload from `filter[status]=writing`, and the finished toast offers "Download report".
  - The mocks follow the backend's rules of 2026-10-05: `uploaded` instead of `parsing`, the `needs_mapping` codes, `not_applicable`, `not_with_mapping`, and skip only for repeated rows.
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

- [ ] **Step 4: Opus review.** Dispatch an independent reviewer on the Opus model (superpowers:code-reviewer) with this plan, the parent plan's Task 9, the backend's rules in "Facts", and the range from the commit before Task 1 to HEAD. Fix every Critical and Important finding, re-run the gates.

- [ ] **Step 5: Commit**

```bash
git add apps/web docs/superpowers/plans/2026-10-01-keywords-ui.md
git commit -m "Rankings: import keywords"
```

The client is generated from `backend/openapi/v1.json` (there is no draft folder in `apps/web`). When the backend changes that document after its imports Part A, run `pnpm gen:api` in `apps/web` and fix any difference before the review. Never add `.claude/launch.json` or `research/`. No attribution lines. Push only on the user's word.

## After the whole-branch review (2026-10-06)

What the review found and the code now does, where the steps above say otherwise:

- **Reason codes** are the backend's (see "Invalid reason codes" above). Messages exist for every one; a code without words shows the API's own `reason`.
- **A write that fails** (`status: 'failed'`, `error_code: 'write_failed'`) keeps what its earlier 1,000-row batches wrote, and its report stays available. The header reads the keywords, groups and vocabularies again and offers "Download report" with the failure. `completed_with_errors` means rows could not be written (not that the preview skipped invalid rows, which ends `completed`); it says so and offers the report. The mock can stop a write after N batches (`writeTrouble` in `keyword-imports.ts`).
- **Statuses and links as the API gives them:** `uploaded` is `queued`, `expired` is `failed` with `error.code: 'expired'` (the import's `status` stays `expired`, which the dialog reads), `links.result` is the report whenever there are rows (a ready preview too), `cancel` only while the import is open (not in `parsing`, which is never committed), the quota only while the preview is ready, and a file with a header and no rows is a preview of no rows, not a failure (`no_rows` stays in the failure words, and no API sends it).
- **Waiting for the read:** the dialog polls with the tab hidden, and asks the API once more before it ends the wait as slow, so an import that was ready is not cancelled for a file that went up. Closing the dialog stops reading the conflict rows.
- **A paste** is checked before it is sent against the API's limits (a million characters, and a request body of 1 MiB, which line breaks and accents can exceed under a million characters), and a 413 on a paste has words of its own.
- **The route** opens the dialog on a history entry of its own: the browser's Back closes it (the dialog stops what it had going, as when it is closed) and stays on Rankings. The code of the dialog loads on its first opening, and not for a member who cannot import. An upload times out after ten minutes.
