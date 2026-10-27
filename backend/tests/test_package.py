from importlib import metadata

import idraft


def test_the_package_version_matches_its_metadata() -> None:
    assert idraft.__version__ == metadata.version("idraft")
