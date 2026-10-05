import type { KeywordImport } from '@/lib/api/types';

/** The id of the import `importFixture` makes unless told another. */
export const IMPORT_FIXTURE_ID = '0192d1a8-e007-7a10-8e07-0000000009aa';

/**
 * An import as the API answers it, being written: 12 rows of 40 done, which is what a reload finds. Tests
 * change what they care about (`importFixture({ status: 'completed' })`) and leave the rest.
 */
export function importFixture(over: Partial<KeywordImport> = {}): KeywordImport {
  return {
    import_id: IMPORT_FIXTURE_ID,
    source: 'upload',
    original_filename: 'keywords.csv',
    status: 'writing',
    column_mapping: { keyword: 'keyword' },
    defaults: {},
    counts: {
      rows_total: 40,
      new: 40,
      duplicate: 0,
      variant: 0,
      conflict: 0,
      invalid: 0,
      created: 0,
      skipped: 0,
      merged: 0,
    },
    quota: null,
    error_code: null,
    created_by: { user_id: '0192d1a8-0000-7000-8000-000000000001', name: 'Mira Okafor', email: 'mira@fynix.io' },
    created_at: '2026-10-05T09:00:00Z',
    expires_at: '2026-10-12T09:00:00Z',
    finished_at: null,
    operation: {
      kind: 'keyword_import',
      status: 'running',
      progress: { done: 12, total: 40, unit: 'rows' },
      started_at: '2026-10-05T09:00:00Z',
      finished_at: null,
      error: null,
      links: { self: '/api/v1/import' },
    },
    ...over,
  };
}
