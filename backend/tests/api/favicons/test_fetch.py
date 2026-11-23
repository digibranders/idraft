"""The guard around outbound fetches: nothing internal is reached, whatever the name says."""

from __future__ import annotations

from collections.abc import AsyncIterator

import httpx
import pytest

from idraft.api.favicons.fetch import FetchRefusedError, SafeFetcher, is_public
from tests.api.favicons.support import Internet, html, image, png

PUBLIC = ["93.184.216.34"]


@pytest.mark.parametrize(
    "address",
    [
        "127.0.0.1",
        "10.0.0.5",
        "172.16.3.4",
        "192.168.1.1",
        "169.254.169.254",
        "100.64.0.1",
        "0.0.0.0",
        "224.0.0.1",
        "::1",
        "fe80::1",
        "fc00::1",
        "::ffff:127.0.0.1",
        "::ffff:169.254.169.254",
        "2002:7f00:1::",  # 6to4 around 127.0.0.1
        "64:ff9b::a00:1",  # NAT64 around 10.0.0.1
        "not an address",
    ],
)
def test_internal_addresses_are_not_public(address: str) -> None:
    assert not is_public(address)


@pytest.mark.parametrize("address", ["93.184.216.34", "8.8.8.8", "2606:2800:220:1::1"])
def test_global_addresses_are_public(address: str) -> None:
    assert is_public(address)


async def _get(net: Internet, url: str, *, max_bytes: int = 1000) -> object:
    return await net.fetcher().get(url, max_bytes=max_bytes, content_types=("image/",))


async def test_the_request_goes_to_the_checked_address_with_the_name_as_host() -> None:
    net = Internet({"acme.com": PUBLIC}, lambda _: image(png(32)))
    result = await _get(net, "https://acme.com/a.png", max_bytes=10_000)
    assert result is not None
    assert net.requests == [("acme.com", "93.184.216.34", "/a.png")]


@pytest.mark.parametrize(
    "addresses",
    [["127.0.0.1"], ["169.254.169.254"], [*PUBLIC, "10.0.0.1"], []],
    ids=["loopback", "metadata", "one private among public", "nothing"],
)
async def test_a_name_that_resolves_inside_is_refused_before_any_request(
    addresses: list[str],
) -> None:
    net = Internet({"evil.com": addresses}, lambda _: image(png(32)))
    with pytest.raises(FetchRefusedError):
        await _get(net, "https://evil.com/")
    assert net.requests == []


@pytest.mark.parametrize(
    "url",
    [
        "https://127.0.0.1/",
        "https://[::1]/",
        "http://93.184.216.34/",
        "ftp://acme.com/",
        "https://acme.com:6379/",
        "https://user@acme.com/",
        "https://nowhere.invalid/",
    ],
)
async def test_literals_other_schemes_ports_and_unknown_names_are_refused(url: str) -> None:
    net = Internet({"acme.com": PUBLIC}, lambda _: image(png(32)))
    with pytest.raises(FetchRefusedError):
        await _get(net, url)
    assert net.requests == []


async def test_a_redirect_to_an_internal_host_is_refused_at_that_hop() -> None:
    net = Internet(
        {"acme.com": PUBLIC, "internal.acme.com": ["10.1.2.3"]},
        lambda _: httpx.Response(302, headers={"location": "https://internal.acme.com/x"}),
    )
    with pytest.raises(FetchRefusedError):
        await _get(net, "https://acme.com/")
    assert [host for host, _, _ in net.requests] == ["acme.com"]


async def test_a_redirect_to_an_address_literal_is_refused() -> None:
    net = Internet(
        {"acme.com": PUBLIC},
        lambda _: httpx.Response(302, headers={"location": "http://169.254.169.254/latest"}),
    )
    with pytest.raises(FetchRefusedError):
        await _get(net, "https://acme.com/")
    assert len(net.requests) == 1


async def test_a_public_redirect_is_followed_and_each_hop_is_resolved_again() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.headers["host"] == "acme.com":
            return httpx.Response(301, headers={"location": "https://www.acme.com/icon.png"})
        return image(png(32))

    net = Internet({"acme.com": PUBLIC, "www.acme.com": ["93.184.216.35"]}, handler)
    result = await net.fetcher().get(
        "https://acme.com/", max_bytes=10_000, content_types=("image/",)
    )
    assert result is not None
    assert result.url == "https://www.acme.com/icon.png"
    assert net.lookups == ["acme.com", "www.acme.com"]
    assert net.requests[1][1] == "93.184.216.35"


async def test_a_name_that_changes_its_answer_between_lookups_is_pinned_to_the_checked_one() -> (
    None
):
    """DNS rebinding: the first lookup is public, a later one would be internal. The request is
    made to the checked address and the name is never resolved a second time for it."""
    net = Internet({"acme.com": PUBLIC}, lambda _: image(png(32)))
    answers = iter([PUBLIC, ["127.0.0.1"]])

    async def rebinding(host: str) -> list[str]:
        return next(answers)

    fetcher = SafeFetcher(net.client, rebinding)
    await fetcher.get("https://acme.com/", max_bytes=10_000, content_types=("image/",))
    assert net.requests == [("acme.com", "93.184.216.34", "/")]


async def test_a_redirect_loop_stops() -> None:
    net = Internet(
        {"acme.com": PUBLIC},
        lambda _: httpx.Response(302, headers={"location": "https://acme.com/"}),
    )
    with pytest.raises(FetchRefusedError, match="redirects"):
        await _get(net, "https://acme.com/")
    assert len(net.requests) == 4


async def test_a_body_past_the_cap_is_refused_whether_or_not_it_declares_its_size() -> None:
    big = b"x" * 2000
    net = Internet({"acme.com": PUBLIC}, lambda _: image(big))
    with pytest.raises(FetchRefusedError, match="larger"):
        await _get(net, "https://acme.com/")

    def streamed(_: httpx.Request) -> httpx.Response:
        async def chunks() -> AsyncIterator[bytes]:
            for _ in range(5):
                yield b"x" * 600

        return httpx.Response(200, content=chunks(), headers={"content-type": "image/png"})

    net = Internet({"acme.com": PUBLIC}, streamed)
    with pytest.raises(FetchRefusedError, match="larger"):
        await _get(net, "https://acme.com/")


async def test_a_type_that_is_not_wanted_and_a_failing_status_answer_nothing() -> None:
    net = Internet({"acme.com": PUBLIC}, lambda _: html())
    assert await _get(net, "https://acme.com/") is None
    net = Internet({"acme.com": PUBLIC}, lambda _: httpx.Response(404))
    assert await _get(net, "https://acme.com/") is None
