"""Offset pages and unknown query parameters (docs/19 section 2.4)."""

import httpx
import pytest

PAGE = "/api/v1/_probe/page"


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


async def test_an_unknown_query_parameter_is_an_error_on_every_route(
    api: httpx.AsyncClient,
) -> None:
    for url in (PAGE, "/api/healthz", "/api/v1/me"):
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
