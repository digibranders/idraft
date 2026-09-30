import sightline


def test_package_exposes_version() -> None:
    assert sightline.__version__ == "0.1.0"
