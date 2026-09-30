import pytest

from sightline.db.ddl import column_grant, grants, statements, tenant_isolation


def test_grant_statements_per_role() -> None:
    assert grants("core.projects", api="SELECT, INSERT", worker="SELECT") == [
        "GRANT SELECT, INSERT ON core.projects TO app_api",
        "GRANT SELECT ON core.projects TO app_worker",
    ]


def test_a_role_without_privileges_gets_no_statement() -> None:
    assert grants("ops.collection_tasks", api="SELECT") == [
        "GRANT SELECT ON ops.collection_tasks TO app_api"
    ]
    assert grants("ops.collection_tasks") == []


def test_tenant_isolation_uses_the_workspace_helper_for_reads_and_writes() -> None:
    assert tenant_isolation("core.projects") == [
        "ALTER TABLE core.projects ENABLE ROW LEVEL SECURITY",
        "CREATE POLICY tenant_isolation ON core.projects "
        "USING (workspace_id = auth.current_workspace_id()) "
        "WITH CHECK (workspace_id = auth.current_workspace_id())",
    ]


def test_a_table_can_widen_what_is_visible_without_widening_what_is_writable() -> None:
    statements = tenant_isolation(
        "auth.memberships", also_visible_when="user_id = auth.current_user_id()"
    )
    assert (
        "USING (workspace_id = auth.current_workspace_id() OR user_id = auth.current_user_id())"
        in statements[1]
    )
    assert statements[1].endswith("WITH CHECK (workspace_id = auth.current_workspace_id())")


def test_the_tenant_column_can_be_named() -> None:
    policy = tenant_isolation("auth.workspaces", column="id")[1]
    assert "USING (id = auth.current_workspace_id())" in policy
    assert policy.endswith("WITH CHECK (id = auth.current_workspace_id())")


@pytest.mark.parametrize(
    "name", ["projects", "core.projects; DROP TABLE x", "core.projects x", "Core.Projects", ""]
)
def test_table_names_are_validated(name: str) -> None:
    with pytest.raises(ValueError, match=r"schema\.table"):
        tenant_isolation(name)
    with pytest.raises(ValueError, match=r"schema\.table"):
        grants(name, api="SELECT")


@pytest.mark.parametrize("column", ["workspace_id; --", "Workspace", ""])
def test_column_names_are_validated(column: str) -> None:
    with pytest.raises(ValueError, match="column"):
        tenant_isolation("core.projects", column=column)


@pytest.mark.parametrize("privileges", ["SELECT; DROP TABLE x", "ALL", "select", "SELECT,, INSERT"])
def test_privileges_are_validated(privileges: str) -> None:
    with pytest.raises(ValueError, match="privileges"):
        grants("core.projects", api=privileges)


def test_a_script_is_split_into_statements_at_blank_lines() -> None:
    script = """
    CREATE TABLE a (id int);

    CREATE INDEX ON a (id);


    -- a note that stands alone is not a statement

    CREATE FUNCTION f() RETURNS int
        LANGUAGE sql
        BEGIN ATOMIC
            SELECT 1;
        END;
    """
    assert statements(script) == [
        "CREATE TABLE a (id int);",
        "CREATE INDEX ON a (id);",
        "CREATE FUNCTION f() RETURNS int\n"
        "        LANGUAGE sql\n"
        "        BEGIN ATOMIC\n"
        "            SELECT 1;\n"
        "        END;",
    ]


def test_a_comment_above_a_statement_stays_with_it() -> None:
    assert statements("-- why\nSELECT 1;") == ["-- why\nSELECT 1;"]


def test_an_empty_script_has_no_statements() -> None:
    assert statements("   \n\n  ") == []


def test_a_column_grant_names_its_columns() -> None:
    statement = column_grant(
        "auth.users", role="app_api", privilege="UPDATE", columns=("name", "image")
    )
    assert statement == "GRANT UPDATE (name, image) ON auth.users TO app_api"


@pytest.mark.parametrize(
    ("role", "privilege", "columns", "message"),
    [
        ("postgres", "UPDATE", ("name",), "runtime role"),
        ("app_api", "DELETE", ("name",), "privileges"),
        ("app_api", "UPDATE", (), "column names"),
        ("app_api", "UPDATE", ("name); DROP TABLE x; --",), "column names"),
    ],
)
def test_a_column_grant_is_validated(
    role: str, privilege: str, columns: tuple[str, ...], message: str
) -> None:
    with pytest.raises(ValueError, match=message):
        column_grant("auth.users", role=role, privilege=privilege, columns=columns)
