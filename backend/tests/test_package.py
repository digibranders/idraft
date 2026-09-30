from importlib import metadata

import sightline


def test_the_package_version_matches_its_metadata() -> None:
    assert sightline.__version__ == metadata.version("sightline")
