"""Problem codes of the collection reads (WP-30; contract C3), kept here beside the routes that
raise them."""

from __future__ import annotations

from idraft.api.problems import ProblemError


class NotAnAiRunError(ProblemError):
    """The run exists in the project but its workload is not `ai_prompt`, so it has no AI
    answers to cover."""

    status, code, title = 422, "not_an_ai_run", "The run is not an AI run"
