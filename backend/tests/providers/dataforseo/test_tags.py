"""The tag a task is sent with (docs/06-dataforseo-seo-integration.md section 3.1)."""

import uuid

import pytest
from hypothesis import given
from hypothesis import strategies as st

from sightline.providers.contract import Echo
from sightline.providers.dataforseo.tags import make_tag, read_tag

RUN = uuid.UUID("0192f0a1-3c44-7e10-8a51-2b7d9c0e4f11")


def test_a_tag_names_the_task_and_the_start_of_its_run() -> None:
    assert make_tag(35, RUN) == "t:z:r:0192f0a1"
    assert make_tag(0, RUN) == "t:0:r:0192f0a1"
    assert make_tag(36, RUN) == "t:10:r:0192f0a1"


@given(task_id=st.integers(0, 2**63 - 1), run=st.uuids())
def test_a_tag_reads_back_as_the_task_and_run_it_was_made_for(task_id: int, run: uuid.UUID) -> None:
    tag = make_tag(task_id, run)
    echo = read_tag(tag)

    assert echo.task_id == str(task_id)
    assert echo.names(task_id, run)
    # Well inside the 255 characters DataForSEO keeps.
    assert len(tag) <= 30


def test_a_tag_is_checked_against_its_task_and_its_run() -> None:
    echo = read_tag(make_tag(7, RUN))

    assert not echo.names(7, uuid.uuid4())
    assert not echo.names(8, RUN)


@pytest.mark.parametrize(
    "tag",
    [
        None,
        17,
        "",
        "t:z",
        "t:Z:r:0192f0a1",
        "t:z:r:0192F0A1",
        "t:z:r:0192f0a",
        "t:z:r:0192f0a1:extra",
        "x:z:r:0192f0a1",
        "t:-1:r:0192f0a1",
        # Longer than any bigint in base 36.
        "t:1234567890abcd:r:0192f0a1",
    ],
)
def test_a_tag_that_is_not_ours_says_nothing(tag: object) -> None:
    echo = read_tag(tag)

    assert echo == Echo()
    assert not echo.names(35, RUN)


def test_a_negative_task_id_has_no_tag() -> None:
    with pytest.raises(ValueError, match="not negative"):
        make_tag(-1, RUN)
