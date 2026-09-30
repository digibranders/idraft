"""The container healthcheck (docs/22-infrastructure-devops.md section 4.1)."""

import os
import time
from pathlib import Path

import pytest

from sightline.worker.healthcheck import is_fresh, main


def test_a_file_touched_just_now_is_fresh(tmp_path: Path) -> None:
    heartbeat = tmp_path / "heartbeat"
    heartbeat.touch()
    assert is_fresh(heartbeat, max_age_seconds=60)
    assert main([str(heartbeat), "60"]) == 0


def test_a_file_older_than_the_limit_is_not(tmp_path: Path) -> None:
    heartbeat = tmp_path / "heartbeat"
    heartbeat.touch()
    two_minutes_ago = time.time() - 120
    os.utime(heartbeat, (two_minutes_ago, two_minutes_ago))

    assert not is_fresh(heartbeat, max_age_seconds=60)
    assert is_fresh(heartbeat, max_age_seconds=180)
    assert main([str(heartbeat), "60"]) == 1


def test_a_worker_that_never_wrote_the_file_is_unhealthy(tmp_path: Path) -> None:
    assert not is_fresh(tmp_path / "missing", max_age_seconds=60)
    assert main([str(tmp_path / "missing"), "60"]) == 1


@pytest.mark.parametrize("arguments", [[], ["/tmp/heartbeat"], ["/tmp/heartbeat", "soon"]])
def test_wrong_arguments_are_a_usage_error_not_a_verdict(
    arguments: list[str], capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(arguments) == 2
    assert capsys.readouterr().err != ""
