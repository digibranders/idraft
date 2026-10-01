"""The tag a task is sent with (docs/06-dataforseo-seo-integration.md section 3.1)."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from hypothesis import given
from hypothesis import strategies as st

from sightline.providers.contract import Echo
from sightline.providers.dataforseo.tags import make_tag, read_tag

RUN = uuid.UUID("0192f0a1-3c44-7e10-8a51-2b7d9c0e4f11")


def _uuid7(millis: int) -> uuid.UUID:
    """A version 7 id, as PostgreSQL's uuidv7() makes run ids: the time first, then random."""
    value = (millis << 80) | (0x7 << 76) | (uuid.uuid4().int & ((1 << 76) - 1))
    return uuid.UUID(int=value)


def test_a_tag_names_the_installation_the_task_its_attempt_and_its_run() -> None:
    assert make_tag("prod", 35, 2, RUN) == "i:prod:t:z:a:2:r:0192f0a13c447e108a512b7d9c0e4f11"


@given(
    task_id=st.integers(0, 2**63 - 1),
    attempt=st.integers(0, 99_999),
    run=st.uuids(),
    installation=st.from_regex(r"[a-z0-9]{1,16}", fullmatch=True),
)
def test_a_tag_reads_back_as_what_it_was_made_for(
    task_id: int, attempt: int, run: uuid.UUID, installation: str
) -> None:
    tag = make_tag(installation, task_id, attempt, run)
    echo = read_tag(tag, installation)

    assert echo.names(task_id, run, attempt)
    # Well inside the 255 characters DataForSEO keeps.
    assert len(tag) <= 90


def test_runs_made_in_the_same_minute_are_told_apart() -> None:
    """The first digits of a version 7 id are its time: a prefix of them is no check."""
    # Eight hex digits are the top 32 of 48 bits of milliseconds: the same for 65.5 seconds.
    block = int(datetime(2026, 10, 1, 2, 0, tzinfo=UTC).timestamp() * 1000) // 65_536 * 65_536
    first = _uuid7(block + 1_000)
    second = _uuid7(block + int(timedelta(seconds=59).total_seconds() * 1000) + 1_000)
    assert first.hex[:8] == second.hex[:8]

    echo = read_tag(make_tag("prod", 16, 1, first), "prod")

    assert echo.names(16, first, 1)
    assert not echo.names(16, second, 1)


def test_the_answer_to_one_attempt_is_not_taken_for_another() -> None:
    echo = read_tag(make_tag("prod", 7, 1, RUN), "prod")

    assert not echo.names(7, RUN, 2)
    assert not echo.names(8, RUN, 1)


def test_a_tag_of_another_installation_on_the_same_account_is_not_ours() -> None:
    """A restore rehearsal's ids and runs are copies of production's."""
    tag = make_tag("rehearsal", 7, 1, RUN)

    assert read_tag(tag, "prod") == Echo()
    assert read_tag(tag, "rehearsal").names(7, RUN, 1)


@pytest.mark.parametrize(
    "tag",
    [
        None,
        17,
        "",
        "t:z:r:0192f0a1",
        "i:prod:t:z:a:1:r:0192f0a1",
        "i:prod:t:Z:a:1:r:0192f0a13c447e108a512b7d9c0e4f11",
        "i:prod:t:z:a:1:r:0192F0A13C447E108A512B7D9C0E4F11",
        "i:prod:t:z:a:-1:r:0192f0a13c447e108a512b7d9c0e4f11",
        "i:prod:t:z:a:1:r:0192f0a13c447e108a512b7d9c0e4f11:extra",
        "i:PROD:t:z:a:1:r:0192f0a13c447e108a512b7d9c0e4f11",
        # Longer than any bigint in base 36.
        "i:prod:t:1234567890abcd:a:1:r:0192f0a13c447e108a512b7d9c0e4f11",
    ],
)
def test_a_tag_that_is_not_ours_says_nothing(tag: object) -> None:
    echo = read_tag(tag, "prod")

    assert echo == Echo()
    assert not echo.names(35, RUN, 1)


def test_a_tag_is_made_only_for_what_it_can_carry() -> None:
    with pytest.raises(ValueError, match="not negative"):
        make_tag("prod", -1, 1, RUN)
    with pytest.raises(ValueError, match="attempt"):
        make_tag("prod", 1, 100_000, RUN)
    for installation in ("", "Prod", "a:b", "x" * 17):
        with pytest.raises(ValueError, match="installation"):
            make_tag(installation, 1, 1, RUN)
