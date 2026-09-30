"""The container healthcheck: is the worker's heartbeat file fresh?

    python -m sightline.worker.healthcheck /tmp/heartbeat 60

Exits 0 when the file was touched within the given number of seconds, 1 otherwise, which are
the two codes a container healthcheck may give. Wrong arguments are 1 as well, with the reason
on standard error. The worker touches the file only while it can reach PostgreSQL and Redis, so
a worker cut off from either reports unhealthy (docs/22-infrastructure-devops.md section 4.1).
"""

from __future__ import annotations

import sys
import time
from pathlib import Path


def is_fresh(heartbeat: Path, *, max_age_seconds: float, now: float | None = None) -> bool:
    try:
        touched = heartbeat.stat().st_mtime
    except OSError:
        return False
    return (time.time() if now is None else now) - touched <= max_age_seconds


def main(arguments: list[str]) -> int:
    if len(arguments) != 2:
        sys.stderr.write("usage: python -m sightline.worker.healthcheck <file> <max age seconds>\n")
        return 1
    try:
        max_age = float(arguments[1])
    except ValueError:
        sys.stderr.write("the maximum age must be a number of seconds\n")
        return 1
    return 0 if is_fresh(Path(arguments[0]), max_age_seconds=max_age) else 1


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main(sys.argv[1:]))
