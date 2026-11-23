"""The recount of crawls finished before pages that refuse the crawler were told apart (plan 08).

Migration 0031 runs these two statements once. A page that answered 401, 403 or 429 is unknown,
not broken: its links-in no longer count it as a broken outlink, and its crawl records how many
such pages it had. Only crawls that have such pages are touched, and only their own counters."""

from __future__ import annotations

from typing import Final

# The statuses are written out: a migration states what it did then. A test holds them equal to
# `crawl.status.BLOCKED_STATUSES` for as long as that is meant to be true.
RUN_COUNT: Final = """
UPDATE seo.crawl_runs r SET pages_blocked = c.blocked
FROM (SELECT run_id, count(*) AS blocked FROM seo.crawl_pages
      WHERE status_code IN (401, 403, 429) GROUP BY run_id) c
WHERE r.id = c.run_id AND r.pages_blocked IS NULL
"""
# `pages_blocked` is null for a crawl that has none (or was finished since), so the second
# statement reads the pages themselves: every page of a crawl that has a blocked page.
BROKEN_OUTLINKS: Final = """
UPDATE seo.crawl_pages p SET broken_outlinks = c.broken
FROM (SELECT l.run_id, l.source_url_id AS url_id,
             count(DISTINCT l.target_url_id) FILTER (
                 WHERE t.status_code >= 400 AND t.status_code NOT IN (401, 403, 429)) AS broken
      FROM seo.crawl_links l
      JOIN seo.crawl_pages t ON t.run_id = l.run_id AND t.url_id = l.target_url_id
      WHERE l.run_id IN (SELECT DISTINCT run_id FROM seo.crawl_pages
                         WHERE status_code IN (401, 403, 429))
      GROUP BY l.run_id, l.source_url_id) c
WHERE p.run_id = c.run_id AND p.url_id = c.url_id AND p.broken_outlinks <> c.broken
"""
