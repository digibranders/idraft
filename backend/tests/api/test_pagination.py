"""Offset pages and unknown query parameters (docs/19 section 2.4)."""

import uuid
from typing import Annotated

import httpx
import pytest
from fastapi import Depends, FastAPI, Query
from pydantic import BaseModel, Field

from idraft.api.access import public
from idraft.api.problems import register_problem_handlers
from idraft.api.resources import Resources
from tests.api.auth.support import cookie, make_user, open_session
from tests.conftest import PostgresServer

PAGE = "/api/v1/_probe/page"
ORIGIN = "https://app.example.com"


async def test_a_page_defaults_to_the_first_fifty(api: httpx.AsyncClient) -> None:
    assert (await api.get(PAGE)).json() == {"offset": 0, "limit": 50}
    assert (await api.get(PAGE, params={"offset": 100, "limit": 200})).json() == {
        "offset": 100,
        "limit": 200,
    }


@pytest.mark.parametrize(
    "params", [{"limit": 0}, {"limit": 201}, {"offset": -1}, {"offset": 100_001}, {"limit": "x"}]
)
async def test_a_page_outside_the_bounds_is_refused(
    api: httpx.AsyncClient, params: dict[str, str]
) -> None:
    response = await api.get(PAGE, params=params)
    assert (response.status_code, response.json()["code"]) == (422, "validation_failed")


async def test_an_unknown_query_parameter_is_an_error(api: httpx.AsyncClient) -> None:
    for url in (PAGE, "/api/healthz"):
        response = await api.get(url, params={"filter[stauts]": "active", "limit": 5})
        assert (response.status_code, response.json()["code"]) == (422, "validation_failed"), url
        errors = response.json()["errors"]
        assert {
            "location": "query",
            "path": "filter[stauts]",
            "code": "extra_forbidden",
            "message": "Unknown parameter.",
        } in errors
    # `limit` is unknown to the health route and known to the page route.
    assert len((await api.get("/api/healthz", params={"limit": 5})).json()["errors"]) == 1
    assert (await api.get(PAGE, params={"limit": 5})).status_code == 200


async def test_a_protected_route_says_nothing_about_its_parameters_to_an_anonymous_caller(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    token, _ = await open_session(resources, await make_user(migrated))
    pending, _ = await open_session(resources, await make_user(migrated), state="pending_totp")
    workspace = f"/api/v1/_probe/workspaces/{uuid.uuid4()}/member"

    for url in ("/api/v1/me", workspace):
        anonymous = await api.get(url, params={"x": 1})
        half_signed_in = await api.get(url, params={"x": 1}, headers=cookie(pending))
        assert anonymous.json()["code"] == half_signed_in.json()["code"] == "unauthenticated", url
    signed_in = await api.get("/api/v1/me", params={"x": 1}, headers=cookie(token))
    assert (signed_in.status_code, signed_in.json()["code"]) == (422, "validation_failed")
    # Sign-out takes an optional session, so it answers anyone.
    signed_out = await api.post("/api/v1/auth/sign-out", params={"x": 1})
    assert signed_out.json()["code"] == "validation_failed"


async def test_a_parameter_is_known_by_the_name_a_client_writes() -> None:
    class Filters(BaseModel):
        status: str | None = None
        text: str | None = Field(default=None, alias="q")

    app = FastAPI(openapi_url=None, docs_url=None, redoc_url=None)
    register_problem_handlers(app, app_origin=ORIGIN)

    @app.get("/modelled", dependencies=[Depends(public)])
    async def modelled(filters: Annotated[Filters, Query()]) -> dict[str, object]:
        return {"status": filters.status, "q": filters.text}

    @app.get("/aliased", dependencies=[Depends(public)])
    async def aliased(
        sort: Annotated[str | None, Query(validation_alias="sort-by")] = None,
        statuses: Annotated[list[str] | None, Query(alias="filter[status_in]")] = None,
    ) -> dict[str, object]:
        return {"sort": sort, "statuses": statuses}

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=ORIGIN) as client:
        model = await client.get("/modelled", params={"status": "active", "q": "crm"})
        by_field_name = await client.get("/modelled", params={"text": "crm", "filters": "x"})
        alias = await client.get(
            "/aliased",
            params=[("sort-by", "name"), ("filter[status_in]", "a"), ("filter[status_in]", "b")],
        )
        by_python_name = await client.get("/aliased", params={"sort": "name", "statuses": "a"})

    assert model.json() == {"status": "active", "q": "crm"}
    assert alias.json() == {"sort": "name", "statuses": ["a", "b"]}
    assert [error["path"] for error in by_field_name.json()["errors"]] == ["filters", "text"]
    assert [error["path"] for error in by_python_name.json()["errors"]] == ["sort", "statuses"]
