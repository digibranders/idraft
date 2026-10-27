"""Groups and terms as the API and imports both create them: paths made level by level, names
matched without case, the same limits. As each role that writes them."""

from __future__ import annotations

import uuid
from collections.abc import Sequence

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.db.engine import workspace_transaction
from idraft.keywords.groups import ensure_group_path, lock_groups, path_fits
from idraft.keywords.links import add_members, add_terms, groups_of, terms_of
from idraft.keywords.terms import (
    ensure_term_path,
    fold,
    free_slug,
    lock_vocabulary,
    slugify,
    vocabulary_ref,
)
from tests.api.auth.support import Workspace, execute, fetch, fetchrow, make_workspace
from tests.api.workspaces.support import make_project
from tests.conftest import PostgresServer

type Sessions = async_sessionmaker[AsyncSession]


async def _tracked(pg: PostgresServer, workspace: Workspace, project_id: uuid.UUID) -> uuid.UUID:
    """A tracked keyword, written directly."""
    await execute(
        pg,
        "INSERT INTO core.locations (id, name, country_iso, location_type) "
        "VALUES (2840, 'United States', 'US', 'Country') ON CONFLICT (id) DO NOTHING",
    )
    keyword = await fetchrow(
        pg,
        "INSERT INTO seo.keywords (workspace_id, text, normalized_text, language_code) "
        "VALUES ($1, 'crm', 'crm', 'en') RETURNING id",
        workspace.id,
    )
    tracked = await fetchrow(
        pg,
        "INSERT INTO seo.tracked_keywords (workspace_id, project_id, keyword_id, location_id, "
        "language_code, device) VALUES ($1, $2, $3, 2840, 'en', 'desktop') RETURNING id",
        workspace.id,
        project_id,
        keyword["id"],
    )
    tracked_id: uuid.UUID = tracked["id"]
    return tracked_id


async def test_a_group_path_is_found_or_made_level_by_level(
    sessions: Sessions, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    project = await make_project(migrated, workspace.id)

    async def ensure(names: Sequence[str]) -> uuid.UUID:
        async with workspace_transaction(sessions, workspace.id) as db:
            await lock_groups(db, project)
            return await ensure_group_path(
                db, workspace_id=workspace.id, project_id=project, names=names
            )

    first = await ensure(["Product", "Pricing"])
    # The same path written another way finds the same groups.
    again = await ensure(["product", "PRICING"])
    deeper = await ensure(["Product", "Pricing", "Plans"])

    assert first == again != deeper
    rows = await fetch(
        migrated,
        "SELECT name, path FROM seo.keyword_groups WHERE project_id = $1 ORDER BY path",
        project,
    )
    assert [(row["name"], row["path"]) for row in rows] == [
        ("Product", "Product"),
        ("Pricing", "Product/Pricing"),
        ("Plans", "Product/Pricing/Plans"),
    ]


async def test_a_group_is_matched_by_the_databases_own_lower_case(
    sessions: Sessions, migrated: PostgresServer
) -> None:
    """Python lower-cases a final capital sigma to a final sigma, the database to a plain one:
    a name matched in Python would miss the group the sibling index knows and fail on insert."""
    workspace = await make_workspace(migrated)
    project = await make_project(migrated, workspace.id)
    made = await fetchrow(
        migrated,
        "INSERT INTO seo.keyword_groups (workspace_id, project_id, name, path) "
        "VALUES ($1, $2, 'ΟΔΟΣ', 'ΟΔΟΣ') RETURNING id",
        workspace.id,
        project,
    )

    async with workspace_transaction(sessions, workspace.id) as db:
        found = await ensure_group_path(
            db, workspace_id=workspace.id, project_id=project, names=["ΟΔΟΣ"]
        )

    assert found == made["id"]


async def test_groups_of_two_projects_do_not_meet(
    sessions: Sessions, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    one = await make_project(migrated, workspace.id)
    two = await make_project(migrated, workspace.id)

    async with workspace_transaction(sessions, workspace.id) as db:
        a = await ensure_group_path(db, workspace_id=workspace.id, project_id=one, names=["A"])
        b = await ensure_group_path(db, workspace_id=workspace.id, project_id=two, names=["A"])

    assert a != b


async def test_an_empty_path_is_refused(sessions: Sessions, migrated: PostgresServer) -> None:
    workspace = await make_workspace(migrated)
    project = await make_project(migrated, workspace.id)

    async with workspace_transaction(sessions, workspace.id) as db:
        with pytest.raises(ValueError, match="at least one"):
            await ensure_group_path(db, workspace_id=workspace.id, project_id=project, names=[])


@pytest.mark.parametrize(
    ("names", "fits"),
    [
        (["a"], True),
        ([], False),
        (["a/b"], False),
        ([""], False),
        (["x" * 100], True),
        (["x" * 101], False),
        (["a"] * 10, True),
        (["a"] * 11, False),
        # 10 names of 100 two-byte letters: 2,009 bytes with the slashes; 11 names are too deep.
        (["é" * 100] * 10, True),
        (["é" * 100] * 11, False),
    ],
)
def test_a_group_path_fits_the_limits(names: list[str], fits: bool) -> None:
    assert path_fits(names) is fits


def test_a_path_over_the_byte_limit_does_not_fit_though_its_names_do() -> None:
    # Ten names of 100 three-byte characters: each is within its limit, the path is 3,009 bytes.
    assert path_fits(["€" * 100] * 10) is False


def test_term_names_compare_without_case_and_in_either_form_of_an_accent() -> None:
    # Composed (U+00E9) and decomposed (e and U+0301) forms of the same name are one name.
    assert fold("Café") == fold("café") == fold("CAFÉ")
    assert fold("CRM") == fold("crm")


def test_slugs_lose_accents_and_number_their_siblings() -> None:
    assert slugify("Café Crème!") == "cafe-creme"
    assert slugify("日本語") == "term"
    assert free_slug("crm", {"crm"}) == "crm-2"
    assert free_slug("crm", {"crm", "crm-2"}) == "crm-3"


async def test_a_term_path_is_found_or_made_with_free_slugs(
    sessions: Sessions, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    vocabulary = await fetchrow(
        migrated,
        "INSERT INTO core.taxonomy_vocabularies (workspace_id, kind, name, is_hierarchical) "
        "VALUES ($1, 'topic', 'Topics', true) RETURNING id",
        workspace.id,
    )
    await execute(
        migrated,
        "INSERT INTO core.taxonomy_terms (workspace_id, vocabulary_id, name, slug, path) "
        "VALUES ($1, $2, 'CRM', 'crm', 'crm')",
        workspace.id,
        vocabulary["id"],
    )

    async with workspace_transaction(sessions, workspace.id) as db:
        ref = await vocabulary_ref(db, workspace.id, vocabulary["id"])
        assert ref is not None
        await lock_vocabulary(db, ref.id)
        first = await ensure_term_path(
            db, workspace_id=workspace.id, vocabulary=ref, names=["crm", "CRM for Startups"]
        )
        # The same path written another way finds the same terms (names match without case).
        again = await ensure_term_path(
            db, workspace_id=workspace.id, vocabulary=ref, names=["CRM", "crm for startups"]
        )

    assert first == again
    rows = await fetch(
        migrated,
        "SELECT name, path, source FROM core.taxonomy_terms WHERE vocabulary_id = $1 ORDER BY path",
        vocabulary["id"],
    )
    assert [(row["name"], row["path"]) for row in rows] == [
        ("CRM", "crm"),
        ("CRM for Startups", "crm/crm-for-startups"),
    ]
    # The term made by the import says so.
    assert rows[1]["source"] == "import"


async def test_a_vocabulary_that_is_gone_has_no_reference(
    sessions: Sessions, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)

    async with workspace_transaction(sessions, workspace.id) as db:
        assert await vocabulary_ref(db, workspace.id, uuid.uuid4()) is None


async def test_links_are_added_once_and_read_back(
    sessions: Sessions, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    project = await make_project(migrated, workspace.id)
    tracked = await _tracked(migrated, workspace, project)
    vocabulary = await fetchrow(
        migrated,
        "INSERT INTO core.taxonomy_vocabularies (workspace_id, kind, name) "
        "VALUES ($1, 'tag', 'Tags') RETURNING id",
        workspace.id,
    )
    term = await fetchrow(
        migrated,
        "INSERT INTO core.taxonomy_terms (workspace_id, vocabulary_id, name, slug, path) "
        "VALUES ($1, $2, 'b2b', 'b2b', 'b2b') RETURNING id",
        workspace.id,
        vocabulary["id"],
    )

    async with workspace_transaction(sessions, workspace.id) as db:
        group = await ensure_group_path(
            db, workspace_id=workspace.id, project_id=project, names=["Product"]
        )
        first_group = await add_members(
            db, workspace_id=workspace.id, project_id=project, pairs=[(group, tracked)]
        )
        again_group = await add_members(
            db, workspace_id=workspace.id, project_id=project, pairs=[(group, tracked)]
        )
        first_term = await add_terms(
            db, workspace_id=workspace.id, pairs=[(tracked, term["id"])], assigned_by="import"
        )
        again_term = await add_terms(
            db, workspace_id=workspace.id, pairs=[(tracked, term["id"])], assigned_by="import"
        )
        groups = await groups_of(db, workspace.id, [tracked])
        terms = await terms_of(db, workspace.id, [tracked])

    assert (first_group, again_group, first_term, again_term) == (1, 0, 1, 0)
    assert [g.path for g in groups[tracked]] == ["Product"]
    assert [t.path for t in terms[tracked]] == ["b2b"]
