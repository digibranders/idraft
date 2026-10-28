-- SQL checks executed inside a consistent snapshot during backup and restore verification.
-- Returns a single JSON object with row counts, freshness metrics, checksums, and schema version.

SELECT json_build_object(
  'win_start', :'win_start',
  'win_end',   :'win_end',
  'counts', json_build_object(
    'auth.workspaces',                 (SELECT count(*) FROM auth.workspaces),
    'core.projects',                   (SELECT count(*) FROM core.projects),
    'core.entities',                   (SELECT count(*) FROM core.entities),
    'core.urls',                       (SELECT count(*) FROM core.urls),
    'seo.tracked_keywords',            (SELECT count(*) FROM seo.tracked_keywords),
    'ops.schedules',                   (SELECT count(*) FROM ops.schedules),
    'ops.collection_tasks_open',       (SELECT count(*) FROM ops.collection_tasks
                                        WHERE status IN ('pending', 'submit_unknown', 'submitted', 'ready', 'fetched')),
    'seo.serp_snapshots_win',          (SELECT count(*) FROM seo.serp_snapshots
                                        WHERE observed_at >= :'win_start'::date AND observed_at < :'win_end'::date),
    'seo.domain_rank_observations_win',(SELECT count(*) FROM seo.domain_rank_observations
                                        WHERE observed_at >= :'win_start'::date AND observed_at < :'win_end'::date),
    'ops.raw_payloads_win',            (SELECT count(*) FROM ops.raw_payloads
                                        WHERE fetched_at >= :'win_start'::date AND fetched_at < :'win_end'::date)
  ),
  'freshness', json_build_object(
    'seo_max_observed_at', (SELECT max(observed_at) FROM seo.serp_snapshots
                            WHERE observed_at >= :'win_start'::date - 7),
    'active_schedules',    (SELECT count(*) FROM ops.schedules WHERE is_active)
  ),
  'checksums', json_build_object(
    'core.projects', (SELECT md5(coalesce(string_agg(
        id::text || '|' || workspace_id::text || '|' || slug::text || '|' || status, ',' ORDER BY id), ''))
      FROM core.projects),
    'seo.tracked_keywords', (SELECT md5(coalesce(string_agg(
        id::text || '|' || keyword_id::text || '|' || location_id || '|' || device || '|' || config_version,
        ',' ORDER BY id), ''))
      FROM seo.tracked_keywords),
    'seo.serp_snapshots_win', (SELECT md5(coalesce(string_agg(
        id::text || '|' || tracked_keyword_id::text || '|' || raw_payload_id::text, ',' ORDER BY id), ''))
      FROM seo.serp_snapshots
      WHERE observed_at >= :'win_start'::date AND observed_at < :'win_end'::date)
  ),
  'schema_version', (SELECT version_num FROM ops.alembic_version),
  'server_version', current_setting('server_version'),
  'db_size_bytes',  pg_database_size(current_database())
)::text;
