import base64
import hashlib
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest

from idraft.providers.google.client import (
    ACCOUNT_SUMMARIES_URL,
    ANALYTICS_SCOPE,
    CONNECT_SCOPES,
    REVOKE_URL,
    SEARCH_CONSOLE_SCOPE,
    SITES_URL,
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
