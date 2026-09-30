import time

from sightline.db.migrate import migration_state
from sightline.db.probe import probe_database


async def test_reports_the_revision_of_a_migrated_database(migrated_url: str) -> None:
    probe = await probe_database(migrated_url, within_seconds=5)
    assert probe.reachable is True
    assert probe.revision == migration_state().head


async def test_a_refused_connection_is_unreachable() -> None:
    probe = await probe_database("postgresql://nobody:x@127.0.0.1:1/none", within_seconds=2)
    assert (probe.reachable, probe.revision) == (False, None)


async def test_wrong_credentials_are_unreachable(postgres_url: str) -> None:
    host = postgres_url.split("@", 1)[1]
    probe = await probe_database(f"postgresql://intruder:wrong@{host}", within_seconds=5)
    assert probe.reachable is False


async def test_a_server_that_stops_answering_cannot_hold_the_probe(black_hole: str) -> None:
    started = time.perf_counter()
    probe = await probe_database(f"postgresql://u:p@{black_hole}/db", within_seconds=0.5)
    elapsed = time.perf_counter() - started
    assert probe.reachable is False
    assert elapsed < 2.0
