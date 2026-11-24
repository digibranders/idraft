"""Problem codes of alerts (docs/19 section 3.11.5). A code belongs to one class
(tests/api/test_problems.py)."""

from __future__ import annotations

from idraft.api.problems import ProblemError


class InvalidParamsError(ProblemError):
    """Carries `rule_type`: the parameters do not fit that rule type."""

    status, code, title = 422, "invalid_params", "The parameters do not fit the rule type"
