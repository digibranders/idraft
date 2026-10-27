"""The tag each task is sent with (docs/06-dataforseo-seo-integration.md section 3.1).

DataForSEO echoes a request's `tag` in its readiness list, its task list and its results, so a
provider task is matched to ours without a lookup table:

    i:<installation>:t:<task id in base36>:a:<attempt>:r:<run id, 32 hex digits>

Every part is a check. The installation keeps two installations that share the account (say
production and a restore rehearsal, whose ids and runs are copies) from taking each other's
answers. The whole run id is carried: its first digits are a timestamp, shared by every run
made in the same minute. The attempt keeps the answer to an earlier submission of a task from
being taken for a later one's.
"""

from __future__ import annotations

import re
from typing import Final
from uuid import UUID

from idraft.providers.contract import Echo

_DIGITS: Final = "0123456789abcdefghijklmnopqrstuvwxyz"
INSTALLATION: Final = re.compile(r"[a-z0-9]{1,16}")
_PATTERN: Final = re.compile(
    rf"i:({INSTALLATION.pattern}):t:([0-9a-z]{{1,13}}):a:([0-9]{{1,5}}):r:([0-9a-f]{{32}})"
)


def _base36(number: int) -> str:
    if number < 0:
        raise ValueError("a task id is not negative")
    digits = ""
    while True:
        number, remainder = divmod(number, 36)
        digits = _DIGITS[remainder] + digits
        if number == 0:
            return digits


def make_tag(installation: str, task_id: int, attempt: int, run_id: UUID) -> str:
    """The tag for that attempt at that task. Refuses what `read_tag` could not read back: a
    task sent with such a tag would be paid for and never matched."""
    if not INSTALLATION.fullmatch(installation):
        raise ValueError("an installation is 1 to 16 lowercase letters and digits")
    if not 0 <= attempt <= 99_999:
        raise ValueError("an attempt is 0 to 99999")
    return f"i:{installation}:t:{_base36(task_id)}:a:{attempt}:r:{run_id.hex}"


def read_tag(tag: object, installation: str) -> Echo:
    """What a tag says of our task. Empty for one that is not ours, or not this installation's."""
    if not isinstance(tag, str):
        return Echo()
    found = _PATTERN.fullmatch(tag)
    if found is None or found.group(1) != installation:
        return Echo()
    _, task, attempt, run = found.groups()
    return Echo(task_id=str(int(task, 36)), attempt=int(attempt), run_id=UUID(hex=run))
