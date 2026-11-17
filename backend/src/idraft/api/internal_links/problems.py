"""Problem codes of the internal link tracker (docs/19 section 2.6 shapes). The app loads every
module that defines problem classes, and a code belongs to one class
(tests/api/test_problems.py)."""

from __future__ import annotations

from idraft.api.problems import ProblemError


class TierLimitError(ProblemError):
    status, code, title = 422, "tier_limit", "A workspace has at most 8 tiers"


class TierInUseError(ProblemError):
    """Carries `page_count` and `rule_count`: pass `move_to` to say where they go."""

    status, code, title = 422, "tier_in_use", "Pages or rules use this tier"


class CrawlInProgressError(ProblemError):
    """Carries `run_id`: the crawl under way."""

    status, code, title = 409, "crawl_in_progress", "A crawl of this site is under way"


class CrawlsDisabledError(ProblemError):
    status, code, title = 503, "crawls_disabled", "Site crawls are not switched on yet"


class NoWebsiteError(ProblemError):
    status, code, title = 422, "no_website", "The project has no website to crawl"


class BudgetExceededError(ProblemError):
    """Carries `budget_id`: the budget the crawl would pass."""

    status, code, title = 422, "budget_exceeded", "A budget would be passed"


class NoCrawlError(ProblemError):
    status, code, title = 404, "no_crawl", "The site has no finished crawl yet"
