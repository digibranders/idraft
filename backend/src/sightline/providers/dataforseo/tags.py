"""The tag each task is sent with (docs/06-dataforseo-seo-integration.md section 3.1).

DataForSEO echoes a request's `tag` in its readiness list, its task list and its results, so a
provider task is matched to ours without a lookup table: `t:<task id in base36>:r:<first 8 hex
digits of the run id>`. The run part is a check: a tag whose run does not match its task's run
names some other task, and is not trusted.
"""

from __future__ import annotations

import re
from typing import Final
from uuid import UUID

from sightline.providers.contract import Echo

_DIGITS: Final = "0123456789abcdefghijklmnopqrstuvwxyz"
_PATTERN: Final = re.compile(r"t:([0-9a-z]{1,13}):r:([0-9a-f]{8})")
RUN_PREFIX_LENGTH: Final = 8


def _base36(number: int) -> str:
    if number < 0:
        raise ValueError("a task id is not negative")
    digits = ""
    while True:
        number, remainder = divmod(number, 36)
        digits = _DIGITS[remainder] + digits
        if number == 0:
            return digits


def make_tag(task_id: int, run_id: UUID) -> str:
    return f"t:{_base36(task_id)}:r:{run_id.hex[:RUN_PREFIX_LENGTH]}"


def read_tag(tag: object) -> Echo:
    """What a tag says of our task. Empty for one that is not ours."""
    if not isinstance(tag, str):
        return Echo()
    found = _PATTERN.fullmatch(tag)
    if found is None:
        return Echo()
    task, run = found.groups()
    return Echo(task_id=str(int(task, 36)), run_prefix=run)
