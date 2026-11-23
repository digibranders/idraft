"""Outbound fetching of a site's pages and icons, safe against a hostile or misconfigured name.

The domain comes from a customer's project or from an answer's citations, so it is not trusted.
Every hop of a request (the first and each redirect) is resolved here, refused unless every
address it resolves to is public, and then sent to one of those addresses: the connection cannot
resolve the name again, so a name that answers differently the second time (DNS rebinding) gets
no second chance. TLS still verifies the certificate against the host name.
"""

from __future__ import annotations

import asyncio
import ipaddress
import socket
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Final
from urllib.parse import urljoin, urlsplit, urlunsplit

import httpx

MAX_REDIRECTS: Final = 3
_PORTS: Final = {None, 80, 443}
_USER_AGENT: Final = "idraft-favicon/1.0"

Resolver = Callable[[str], Awaitable[list[str]]]


class FetchRefusedError(Exception):
    """The request was not made, or was dropped, because it could reach an internal host, left
    the limits (redirects, size), or named something that is not a public site."""


@dataclass(frozen=True, slots=True)
class Fetched:
    url: str
    content_type: str
    body: bytes


async def resolve(host: str) -> list[str]:
    infos = await asyncio.get_running_loop().getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    return sorted({str(info[4][0]) for info in infos})


def is_public(address: str) -> bool:
    """A global unicast address. Loopback, private, link-local (the cloud metadata address),
    shared (carrier-grade NAT), multicast and reserved ranges are not, and neither is an IPv6
    address that wraps one of them."""
    try:
        ip = ipaddress.ip_address(address.split("%", 1)[0])
    except ValueError:
        return False
    if isinstance(ip, ipaddress.IPv6Address):
        wrapped = ip.ipv4_mapped or ip.sixtofour
        if wrapped is not None:
            return is_public(str(wrapped))
        if ip in ipaddress.ip_network("64:ff9b::/96"):  # NAT64 carries an IPv4 address
            return is_public(str(ipaddress.IPv4Address(int(ip) & 0xFFFFFFFF)))
    return ip.is_global and not ip.is_multicast


def _is_address(host: str) -> bool:
    try:
        ipaddress.ip_address(host.split("%", 1)[0])
    except ValueError:
        return False
    return True


class SafeFetcher:
    def __init__(self, client: httpx.AsyncClient, resolver: Resolver = resolve) -> None:
        self._client = client
        self._resolver = resolver

    async def get(
        self, url: str, *, max_bytes: int, content_types: tuple[str, ...]
    ) -> Fetched | None:
        """The body of `url` after at most `MAX_REDIRECTS` redirects, or None when the site
        answers anything but 200 or a type other than `content_types` (a prefix each).

        Raises FetchRefusedError for an address that is not public, too many redirects or a
        body past `max_bytes`; httpx errors (connection, timeout) pass through.
        """
        for _ in range(MAX_REDIRECTS + 1):
            host, target = await self._pin(url)
            headers = {"Host": host, "User-Agent": _USER_AGENT, "Accept": ",".join(content_types)}
            async with self._client.stream(
                "GET", target, headers=headers, extensions={"sni_hostname": host}
            ) as response:
                if response.is_redirect:
                    location = response.headers.get("location")
                    if not location:
                        return None
                    url = urljoin(url, location)
                    continue
                if response.status_code != 200:
                    return None
                kind = response.headers.get("content-type", "")
                content_type = kind.split(";")[0].strip().lower()
                if not content_type.startswith(content_types):
                    return None
                declared = response.headers.get("content-length", "")
                if declared.isdigit() and int(declared) > max_bytes:
                    raise FetchRefusedError("the body is larger than allowed")
                body = bytearray()
                async for chunk in response.aiter_bytes():
                    body += chunk
                    if len(body) > max_bytes:
                        raise FetchRefusedError("the body is larger than allowed")
                return Fetched(url=url, content_type=content_type, body=bytes(body))
        raise FetchRefusedError("too many redirects")

    async def _pin(self, url: str) -> tuple[str, str]:
        """The host of `url` and the same URL with the host replaced by one address it resolves
        to, once every address it resolves to has been checked."""
        parts = urlsplit(url)
        host = (parts.hostname or "").lower()
        try:
            port = parts.port
        except ValueError:
            raise FetchRefusedError("not a valid port") from None
        web = parts.scheme in {"http", "https"} and port in _PORTS
        if not web or not host or parts.username:
            raise FetchRefusedError("not a public web address")
        if _is_address(host):  # an address literal names no site
            raise FetchRefusedError("an address is not a site name")
        try:
            addresses = await self._resolver(host)
        except OSError:
            raise FetchRefusedError("the name does not resolve") from None
        if not addresses or not all(is_public(address) for address in addresses):
            raise FetchRefusedError("the name resolves to a non-public address")
        pinned = f"[{addresses[0]}]" if ":" in addresses[0] else addresses[0]
        netloc = pinned if port is None else f"{pinned}:{port}"
        return host, urlunsplit((parts.scheme, netloc, parts.path or "/", parts.query, ""))
