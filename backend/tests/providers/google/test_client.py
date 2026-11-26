import base64
import hashlib
from datetime import UTC, date, datetime, timedelta
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest

from idraft.providers.google.client import (
    ACCOUNT_SUMMARIES_URL,
    ANALYTICS_DATA_URL,
    ANALYTICS_SCOPE,
    CONNECT_SCOPES,
    REVOKE_URL,
    SEARCH_CONSOLE_SCOPE,
    SITES_URL,
    URL_INSPECTION_URL,
    Ga4Report,
    Ga4Row,
    GoogleClient,
    authorization_url,
    new_pkce,
)
from idraft.providers.google.errors import (
    GoogleClientRejectedError,
    GoogleInvalidGrantError,
    GooglePermissionError,
    GoogleQuotaError,
    GoogleResponseError,
    GoogleUnauthorizedError,
    GoogleUnavailableError,
)
from tests.providers.google.fake_google import CLIENT_ID, CLIENT_SECRET, FakeGoogle

REDIRECT = "https://app.example.com/api/v1/oauth/google/callback"


class Pause:
    """Records the waits instead of making them."""

    def __init__(self) -> None:
        self.waits: list[float] = []

    async def __call__(self, seconds: float) -> None:
        self.waits.append(seconds)


def _client(
    transport: httpx.AsyncBaseTransport,
    *,
    pause: Pause | None = None,
    client_secret: str = CLIENT_SECRET,
) -> GoogleClient:
    return GoogleClient(
        httpx.AsyncClient(transport=transport),
        client_id=CLIENT_ID,
        client_secret=client_secret,
        sleep=pause or Pause(),
        jitter=lambda: 1.0,
    )


def test_a_pkce_pair_is_an_s256_challenge_of_a_fresh_verifier() -> None:
    first, second = new_pkce(), new_pkce()
    digest = hashlib.sha256(first.verifier.encode()).digest()
    assert first.challenge == base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
    assert first.verifier != second.verifier
    assert len(first.verifier) >= 43
    assert first.verifier not in repr(first)


def test_the_authorization_address_asks_for_both_products_in_one_consent_and_this_grant_only() -> (
    None
):
    pkce = new_pkce()
    address = authorization_url(
        client_id=CLIENT_ID, redirect_uri=REDIRECT, state="s-1", challenge=pkce.challenge
    )
    parts = urlsplit(address)
    query = {name: values[0] for name, values in parse_qs(parts.query).items()}
    assert f"{parts.scheme}://{parts.netloc}{parts.path}" == (
        "https://accounts.google.com/o/oauth2/v2/auth"
    )
    assert query == {
        "client_id": CLIENT_ID,
        "redirect_uri": REDIRECT,
        "response_type": "code",
        "scope": (
            "openid email https://www.googleapis.com/auth/webmasters.readonly "
            "https://www.googleapis.com/auth/analytics.readonly"
        ),
        "state": "s-1",
        "code_challenge": pkce.challenge,
        "code_challenge_method": "S256",
        "access_type": "offline",
        "prompt": "consent",
        "include_granted_scopes": "false",
    }
    assert {SEARCH_CONSOLE_SCOPE, ANALYTICS_SCOPE} <= set(CONNECT_SCOPES)


async def test_a_code_is_exchanged_with_its_verifier_and_the_account_is_read() -> None:
    fake = FakeGoogle(REDIRECT)
    account = fake.account("person@example.com", [("sc-domain:example.com", "siteOwner")])
    pkce = new_pkce()
    google = _client(fake.transport)

    grant = await google.exchange_code(
        code=fake.issue_code(account, challenge=pkce.challenge),
        verifier=pkce.verifier,
        redirect_uri=REDIRECT,
    )
    identity = await google.identity(grant.access_token)
    sites = await google.list_sites(grant.access_token)

    assert grant.refresh_token == account.refresh_token
    assert grant.scopes == set(CONNECT_SCOPES)
    assert (identity.sub, identity.email) == (account.sub, "person@example.com")
    assert [(s.site_url, s.permission_level) for s in sites] == [
        ("sc-domain:example.com", "siteOwner")
    ]
    assert grant.access_token not in repr(grant)
    assert account.refresh_token not in repr(grant)


async def test_a_code_works_once_and_only_with_its_own_verifier() -> None:
    fake = FakeGoogle(REDIRECT)
    account = fake.account("person@example.com")
    pkce = new_pkce()
    google = _client(fake.transport)
    code = fake.issue_code(account, challenge=pkce.challenge)

    with pytest.raises(GoogleInvalidGrantError):
        await google.exchange_code(code=code, verifier=new_pkce().verifier, redirect_uri=REDIRECT)
    await google.exchange_code(code=code, verifier=pkce.verifier, redirect_uri=REDIRECT)
    with pytest.raises(GoogleInvalidGrantError):
        await google.exchange_code(code=code, verifier=pkce.verifier, redirect_uri=REDIRECT)


async def test_a_wrong_client_secret_is_a_rejected_client_not_a_dead_grant() -> None:
    fake = FakeGoogle(REDIRECT)
    google = _client(fake.transport, client_secret="wrong-secret")
    with pytest.raises(GoogleClientRejectedError) as error:
        await google.refresh("1//whatever")
    assert "wrong-secret" not in str(error.value)


async def test_a_refresh_token_gives_an_access_token_until_it_is_revoked() -> None:
    fake = FakeGoogle(REDIRECT)
    account = fake.account("person@example.com")
    google = _client(fake.transport)

    token = await google.refresh(account.refresh_token)
    assert token.expires_in == 3599
    assert "ya29" not in repr(token)

    fake.kill_refresh_token(account)
    with pytest.raises(GoogleInvalidGrantError):
        await google.refresh(account.refresh_token)


async def test_the_secret_is_sent_in_the_body_of_the_token_call_and_in_no_address() -> None:
    fake = FakeGoogle(REDIRECT)
    account = fake.account("person@example.com")
    await _client(fake.transport).refresh(account.refresh_token)
    for call in fake.calls:
        assert CLIENT_SECRET not in call.url
        assert account.refresh_token not in call.url


async def test_a_server_error_is_tried_again_with_backoff_and_then_succeeds() -> None:
    fake = FakeGoogle(REDIRECT)
    account = fake.account("person@example.com")
    fake.token_outage = 2
    pause = Pause()

    token = await _client(fake.transport, pause=pause).refresh(account.refresh_token)

    assert token.expires_in == 3599
    assert pause.waits == [0.5, 1.0]


async def test_an_outage_that_does_not_end_is_unavailable() -> None:
    fake = FakeGoogle(REDIRECT)
    account = fake.account("person@example.com")
    fake.token_outage = 99
    pause = Pause()

    with pytest.raises(GoogleUnavailableError):
        await _client(fake.transport, pause=pause).refresh(account.refresh_token)

    assert len(fake.calls) == 3
    assert len(pause.waits) == 2


async def test_a_network_error_is_retried_like_a_server_error() -> None:
    attempts = 0

    def drop(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        raise httpx.ConnectTimeout("no route", request=request)

    with pytest.raises(GoogleUnavailableError):
        await _client(httpx.MockTransport(drop)).list_sites("ya29.x")
    assert attempts == 3


@pytest.mark.parametrize(
    ("status", "body", "error"),
    [
        (401, {"error": {"code": 401}}, GoogleUnauthorizedError),
        (429, {"error": {"message": "slow down"}}, GoogleQuotaError),
        (403, {"error": {"message": "Quota exceeded for quota metric"}}, GoogleQuotaError),
        (
            403,
            {"error": {"errors": [{"reason": "rateLimitExceeded"}], "message": "x"}},
            GoogleQuotaError,
        ),
        (
            403,
            {"error": {"message": "User does not have sufficient permission"}},
            GooglePermissionError,
        ),
        (403, "<html>", GooglePermissionError),
        (404, {}, GoogleResponseError),
    ],
)
async def test_api_errors_are_mapped_and_never_retried(
    status: int, body: object, error: type[Exception]
) -> None:
    seen = 0

    def answer(request: httpx.Request) -> httpx.Response:
        nonlocal seen
        seen += 1
        if isinstance(body, str):
            return httpx.Response(status, text=body)
        return httpx.Response(status, json=body)

    with pytest.raises(error):
        await _client(httpx.MockTransport(answer)).list_sites("ya29.x")
    assert seen == 1


@pytest.mark.parametrize(
    "body", [{"siteEntry": [{"siteUrl": "x"}]}, {"siteEntry": "nope"}, [], "text"]
)
async def test_an_answer_that_is_not_documented_writes_nothing(body: object) -> None:
    def answer(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=body)

    with pytest.raises(GoogleResponseError) as error:
        await _client(httpx.MockTransport(answer)).list_sites("ya29.x")
    assert "ya29" not in str(error.value)


async def test_an_account_with_no_property_has_an_empty_list() -> None:
    fake = FakeGoogle(REDIRECT)
    account = fake.account("person@example.com")
    google = _client(fake.transport)
    token = await google.refresh(account.refresh_token)
    assert await google.list_sites(token.access_token) == []
    assert [call.url for call in fake.calls][-1] == SITES_URL


async def test_a_token_is_revoked_and_a_failure_to_revoke_is_reported_not_raised() -> None:
    fake = FakeGoogle(REDIRECT)
    account = fake.account("person@example.com")
    google = _client(fake.transport)

    assert await google.revoke(account.refresh_token) is True
    assert not fake.alive(account)
    assert fake.called(REVOKE_URL)[0].form == {"token": account.refresh_token}

    fake.revoke_status = 400
    assert await google.revoke("1//other") is False
    fake.revoke_status = 503
    assert await google.revoke("1//other") is False


async def test_attempts_must_be_positive() -> None:
    with pytest.raises(ValueError, match="attempts"):
        GoogleClient(httpx.AsyncClient(), client_id="a", client_secret="b", attempts=0)


async def _analytics_token(fake: FakeGoogle, google: GoogleClient, refresh_token: str) -> str:
    return (await google.refresh(refresh_token)).access_token


async def test_ga4_properties_are_listed_by_account_and_an_empty_account_adds_none() -> None:
    fake = FakeGoogle(REDIRECT)
    account = fake.account(
        "person@example.com",
        analytics=[
            ("100", "Acme", [("111", "Acme site", "PROPERTY_TYPE_ORDINARY")]),
            ("200", "Empty account", []),
            (
                "300",
                "Agency",
                [
                    ("333", "Roll-up", "PROPERTY_TYPE_ROLLUP"),
                    ("444", "Sub", "PROPERTY_TYPE_SUBPROPERTY"),
                ],
            ),
        ],
    )
    google = _client(fake.transport)

    found = await google.list_analytics_properties(
        await _analytics_token(fake, google, account.refresh_token)
    )

    assert [
        (p.name, p.display_name, p.property_type, p.account, p.account_name) for p in found
    ] == [
        ("properties/111", "Acme site", "PROPERTY_TYPE_ORDINARY", "accounts/100", "Acme"),
        ("properties/333", "Roll-up", "PROPERTY_TYPE_ROLLUP", "accounts/300", "Agency"),
        ("properties/444", "Sub", "PROPERTY_TYPE_SUBPROPERTY", "accounts/300", "Agency"),
    ]
    assert fake.called(ACCOUNT_SUMMARIES_URL)[0].authorization is not None


async def test_ga4_properties_follow_the_next_page_token() -> None:
    fake = FakeGoogle(REDIRECT)
    fake.summaries_page_size = 2
    accounts = [
        (str(100 + n), f"Account {n}", [(str(500 + n), f"Property {n}", "PROPERTY_TYPE_ORDINARY")])
        for n in range(5)
    ]
    account = fake.account("person@example.com", analytics=accounts)
    google = _client(fake.transport)

    found = await google.list_analytics_properties(
        await _analytics_token(fake, google, account.refresh_token)
    )

    assert [p.name for p in found] == [f"properties/{500 + n}" for n in range(5)]
    assert len(fake.called(ACCOUNT_SUMMARIES_URL)) == 3


async def test_an_account_with_no_ga4_property_has_an_empty_list() -> None:
    fake = FakeGoogle(REDIRECT)
    account = fake.account("person@example.com")
    google = _client(fake.transport)
    token = await _analytics_token(fake, google, account.refresh_token)
    assert await google.list_analytics_properties(token) == []


@pytest.mark.parametrize(
    "body",
    [
        {"accountSummaries": [{"account": "accounts/1", "propertySummaries": [{"property": "x"}]}]},
        {"accountSummaries": [{"account": "nope"}]},
        {"accountSummaries": "nope"},
        [],
    ],
)
async def test_an_account_summary_that_is_not_documented_writes_nothing(body: object) -> None:
    def answer(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=body)

    with pytest.raises(GoogleResponseError) as error:
        await _client(httpx.MockTransport(answer)).list_analytics_properties("ya29.x")
    assert "ya29" not in str(error.value)


async def test_the_account_summary_paging_is_bounded() -> None:
    def forever(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"nextPageToken": "again"})

    with pytest.raises(GoogleResponseError):
        await _client(httpx.MockTransport(forever)).list_analytics_properties("ya29.x")


async def test_the_analytics_admin_api_maps_a_disabled_api_to_a_permission_error() -> None:
    def answer(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            403, json={"error": {"status": "PERMISSION_DENIED", "message": "API has not been used"}}
        )

    with pytest.raises(GooglePermissionError):
        await _client(httpx.MockTransport(answer)).list_analytics_properties("ya29.x")


PROPERTY = "properties/111"
GA4_DIMENSIONS = ["date", "sessionSource"]
GA4_METRICS = ["sessions", "engagedSessions"]
GA4_ROWS: list[tuple[tuple[str, ...], tuple[str, ...]]] = [
    (("20261120", "chatgpt.com"), ("12", "9")),
    (("20261120", "perplexity.ai"), ("3", "2")),
    (("20261121", "chatgpt.com"), ("7", "5")),
    (("20261121", "gemini.google.com"), ("1", "0")),
    (("20261122", "chatgpt.com"), ("4", "4")),
]


async def _ga4_report(
    transport: httpx.AsyncBaseTransport, token: str = "ya29.x", *, offset: int = 0, limit: int = 100
) -> Ga4Report:
    return await _client(transport).run_report(
        token,
        PROPERTY,
        start_date=date(2026, 11, 20),
        end_date=date(2026, 11, 22),
        dimensions=GA4_DIMENSIONS,
        metrics=GA4_METRICS,
        offset=offset,
        limit=limit,
    )


async def _ga4_fake() -> tuple[FakeGoogle, str]:
    fake = FakeGoogle(REDIRECT)
    account = fake.account("person@example.com")
    token = await _analytics_token(fake, _client(fake.transport), account.refresh_token)
    return fake, token


async def test_a_ga4_report_page_is_parsed_with_its_total_and_the_quota_left() -> None:
    fake, token = await _ga4_fake()
    fake.ga4_rows[PROPERTY] = GA4_ROWS[:2]
    fake.ga4_tokens_remaining = 38_000

    report = await _ga4_report(fake.transport, token)

    assert report == Ga4Report(
        rows=(
            Ga4Row(("20261120", "chatgpt.com"), ("12", "9")),
            Ga4Row(("20261120", "perplexity.ai"), ("3", "2")),
        ),
        row_count=2,
        quota_remaining=38_000,
    )


async def test_a_ga4_report_with_no_row_is_empty() -> None:
    fake, token = await _ga4_fake()

    report = await _ga4_report(fake.transport, token)

    assert report == Ga4Report(rows=(), row_count=0, quota_remaining=39_995)


async def test_a_ga4_report_is_paged_with_a_string_offset_and_the_total_row_count() -> None:
    fake, token = await _ga4_fake()
    fake.ga4_rows[PROPERTY] = GA4_ROWS

    pages = [await _ga4_report(fake.transport, token, offset=n, limit=2) for n in (0, 2, 4, 6)]

    assert [len(page.rows) for page in pages] == [2, 2, 1, 0]
    assert {page.row_count for page in pages} == {5}
    assert [row for page in pages for row in page.rows] == [Ga4Row(*row) for row in GA4_ROWS]
    sent = [call.json_body for call in fake.calls if call.json_body]
    assert [(body["offset"], body["limit"]) for body in sent] == [
        ("0", "2"),
        ("2", "2"),
        ("4", "2"),
        ("6", "2"),
    ]


async def test_a_ga4_report_request_has_the_documented_body_address_and_bearer_header() -> None:
    fake, token = await _ga4_fake()

    await _ga4_report(fake.transport, token)

    (call,) = [c for c in fake.calls if c.url.startswith(ANALYTICS_DATA_URL)]
    assert call.method == "POST"
    assert call.url == f"{ANALYTICS_DATA_URL}/{PROPERTY}:runReport"
    assert call.authorization == f"Bearer {token}"
    assert call.json_body == {
        "dateRanges": [{"startDate": "2026-11-20", "endDate": "2026-11-22"}],
        "dimensions": [{"name": "date"}, {"name": "sessionSource"}],
        "metrics": [{"name": "sessions"}, {"name": "engagedSessions"}],
        "offset": "0",
        "limit": "100",
        "returnPropertyQuota": True,
    }


async def test_a_ga4_report_without_a_quota_member_has_no_quota_figure() -> None:
    def answer(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"rows": [], "rowCount": 0, "propertyQuota": {}})

    report = await _ga4_report(httpx.MockTransport(answer))
    assert report.quota_remaining is None


async def test_a_ga4_report_without_a_row_count_counts_its_rows() -> None:
    def answer(request: httpx.Request) -> httpx.Response:
        row = {
            "dimensionValues": [{"value": "a"}, {"value": "b"}],
            "metricValues": [{"value": "1"}] * 2,
        }
        return httpx.Response(200, json={"rows": [row]})

    assert (await _ga4_report(httpx.MockTransport(answer))).row_count == 1


async def test_a_ga4_token_google_does_not_know_is_unauthorized() -> None:
    fake, _ = await _ga4_fake()
    with pytest.raises(GoogleUnauthorizedError):
        await _ga4_report(fake.transport, "ya29.stale")


@pytest.mark.parametrize(
    ("status", "body", "error"),
    [
        (401, {"error": {"status": "UNAUTHENTICATED"}}, GoogleUnauthorizedError),
        (
            429,
            {"error": {"status": "RESOURCE_EXHAUSTED", "message": "slow down"}},
            GoogleQuotaError,
        ),
        (
            403,
            {"error": {"status": "RESOURCE_EXHAUSTED", "message": "Exhausted property tokens"}},
            GoogleQuotaError,
        ),
        (403, {"error": {"message": "Exhausted: quota for this property"}}, GoogleQuotaError),
        (
            403,
            {"error": {"status": "PERMISSION_DENIED", "message": "User cannot access property"}},
            GooglePermissionError,
        ),
        (403, "<html>", GooglePermissionError),
    ],
)
async def test_ga4_report_errors_are_mapped_and_never_retried(
    status: int, body: object, error: type[Exception]
) -> None:
    seen = 0

    def answer(request: httpx.Request) -> httpx.Response:
        nonlocal seen
        seen += 1
        if isinstance(body, str):
            return httpx.Response(status, text=body)
        return httpx.Response(status, json=body)

    with pytest.raises(error):
        await _ga4_report(httpx.MockTransport(answer))
    assert seen == 1


@pytest.mark.parametrize(
    "row",
    [
        {"dimensionValues": [{"value": "a"}], "metricValues": [{"value": "1"}, {"value": "2"}]},
        {"dimensionValues": [{"value": "a"}, {"value": "b"}], "metricValues": [{"value": "1"}]},
        {"dimensionValues": [{"value": "a"}, {"value": "b"}], "metricValues": "nope"},
        {"dimensionValues": [{"value": "a"}, {"value": "b"}]},
    ],
)
async def test_a_ga4_row_that_does_not_match_the_request_writes_nothing(row: object) -> None:
    def answer(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"rows": [row], "rowCount": 1})

    with pytest.raises(GoogleResponseError) as error:
        await _ga4_report(httpx.MockTransport(answer), "ya29.secret")
    assert "ya29" not in str(error.value)


@pytest.mark.parametrize("text", ["<html>not json</html>", "", "[]", '{"rows": "nope"}'])
async def test_a_ga4_answer_that_is_not_documented_is_a_response_error(text: str) -> None:
    def answer(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text=text)

    with pytest.raises(GoogleResponseError) as error:
        await _ga4_report(httpx.MockTransport(answer), "ya29.secret")
    assert "ya29" not in str(error.value)


async def test_a_ga4_server_error_is_retried_and_then_unavailable() -> None:
    seen = 0
    pause = Pause()

    def answer(request: httpx.Request) -> httpx.Response:
        nonlocal seen
        seen += 1
        return httpx.Response(503, text="unavailable")

    with pytest.raises(GoogleUnavailableError):
        await _client(httpx.MockTransport(answer), pause=pause).run_report(
            "ya29.x",
            PROPERTY,
            start_date=date(2026, 11, 20),
            end_date=date(2026, 11, 22),
            dimensions=GA4_DIMENSIONS,
            metrics=GA4_METRICS,
        )
    assert seen == 3
    assert pause.waits == [0.5, 1.0]


@pytest.mark.parametrize("name", ["properties/1/../x", "properties/1?x=1", "properties/abc", "x"])
async def test_a_malformed_ga4_property_is_refused_before_any_request(name: str) -> None:
    seen = 0

    def answer(request: httpx.Request) -> httpx.Response:
        nonlocal seen
        seen += 1
        return httpx.Response(200, json={})

    with pytest.raises(ValueError, match="properties/"):
        await _client(httpx.MockTransport(answer)).run_report(
            "ya29.x",
            name,
            start_date=date(2026, 11, 20),
            end_date=date(2026, 11, 22),
            dimensions=GA4_DIMENSIONS,
            metrics=GA4_METRICS,
        )
    assert seen == 0


INSPECT_SITE = "sc-domain:acme.example"
INSPECT_PAGE = "https://acme.example/pricing"


async def _inspect_fake() -> tuple[FakeGoogle, GoogleClient, str]:
    fake = FakeGoogle(REDIRECT)
    account = fake.account("person@example.com", sites=[(INSPECT_SITE, "siteOwner")])
    google = _client(fake.transport)
    return fake, google, (await google.refresh(account.refresh_token)).access_token


async def test_an_inspection_gives_the_last_crawl_in_utc_and_the_coverage_state() -> None:
    fake, google, token = await _inspect_fake()
    fake.inspections[INSPECT_PAGE] = ("2026-11-20T08:15:30.123456Z", "Submitted and indexed")

    found = await google.inspect_url(token, site_url=INSPECT_SITE, page_url=INSPECT_PAGE)

    assert found.last_crawl_time == datetime(2026, 11, 20, 8, 15, 30, 123456, tzinfo=UTC)
    assert found.last_crawl_time is not None
    assert found.last_crawl_time.utcoffset() == timedelta(0)
    assert found.coverage_state == "Submitted and indexed"
    call = fake.called(URL_INSPECTION_URL)[0]
    assert call.json_body == {"inspectionUrl": INSPECT_PAGE, "siteUrl": INSPECT_SITE}
    assert call.authorization == f"Bearer {token}"


async def test_an_inspection_with_an_offset_is_converted_to_utc() -> None:
    fake, google, token = await _inspect_fake()
    fake.inspections[INSPECT_PAGE] = ("2026-11-20T10:00:00+02:00", "Crawled")

    found = await google.inspect_url(token, site_url=INSPECT_SITE, page_url=INSPECT_PAGE)

    assert found.last_crawl_time == datetime(2026, 11, 20, 8, 0, tzinfo=UTC)
    assert found.last_crawl_time is not None
    assert found.last_crawl_time.utcoffset() == timedelta(0)


async def test_a_page_google_never_crawled_has_no_crawl_time_and_is_not_an_error() -> None:
    _, google, token = await _inspect_fake()

    found = await google.inspect_url(token, site_url=INSPECT_SITE, page_url=INSPECT_PAGE)

    assert found.last_crawl_time is None
    assert found.coverage_state == "URL is unknown to Google"


async def test_an_inspection_with_no_status_member_has_nothing_to_say() -> None:
    def answer(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"inspectionResult": {}})

    found = await _client(httpx.MockTransport(answer)).inspect_url(
        "ya29.x", site_url=INSPECT_SITE, page_url=INSPECT_PAGE
    )

    assert (found.last_crawl_time, found.coverage_state) == (None, None)


@pytest.mark.parametrize(
    "body",
    [
        {},
        [],
        "text",
        {"inspectionResult": "nope"},
        {"inspectionResult": {"indexStatusResult": {"lastCrawlTime": "yesterday"}}},
        {"inspectionResult": {"indexStatusResult": {"lastCrawlTime": "2026-11-20T08:00:00"}}},
        {"inspectionResult": {"indexStatusResult": {"coverageState": 7}}},
    ],
)
async def test_an_inspection_that_is_not_documented_writes_nothing(body: object) -> None:
    def answer(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=body)

    with pytest.raises(GoogleResponseError) as error:
        await _client(httpx.MockTransport(answer)).inspect_url(
            "ya29.secret", site_url=INSPECT_SITE, page_url=INSPECT_PAGE
        )
    assert "ya29" not in str(error.value)


@pytest.mark.parametrize(
    ("status", "body", "error"),
    [
        (401, {"error": {"status": "UNAUTHENTICATED"}}, GoogleUnauthorizedError),
        (
            429,
            {"error": {"status": "RESOURCE_EXHAUSTED", "message": "slow down"}},
            GoogleQuotaError,
        ),
        (403, {"error": {"message": "Quota exceeded for quota metric"}}, GoogleQuotaError),
        (
            403,
            {"error": {"message": "User does not have sufficient permission"}},
            GooglePermissionError,
        ),
        (403, "<html>", GooglePermissionError),
        (404, {"error": {"message": "not found"}}, GoogleResponseError),
    ],
)
async def test_inspection_errors_are_mapped_and_never_retried(
    status: int, body: object, error: type[Exception]
) -> None:
    seen = 0

    def answer(request: httpx.Request) -> httpx.Response:
        nonlocal seen
        seen += 1
        if isinstance(body, str):
            return httpx.Response(status, text=body)
        return httpx.Response(status, json=body)

    with pytest.raises(error):
        await _client(httpx.MockTransport(answer)).inspect_url(
            "ya29.x", site_url=INSPECT_SITE, page_url=INSPECT_PAGE
        )
    assert seen == 1


async def test_an_inspection_of_a_property_the_account_does_not_have_is_a_permission_error() -> (
    None
):
    _, google, token = await _inspect_fake()
    with pytest.raises(GooglePermissionError):
        await google.inspect_url(token, site_url="sc-domain:other.example", page_url=INSPECT_PAGE)


async def test_an_inspection_server_error_is_retried_and_then_unavailable() -> None:
    attempts = 0

    def answer(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        return httpx.Response(503)

    with pytest.raises(GoogleUnavailableError):
        await _client(httpx.MockTransport(answer)).inspect_url(
            "ya29.x", site_url=INSPECT_SITE, page_url=INSPECT_PAGE
        )
    assert attempts == 3
