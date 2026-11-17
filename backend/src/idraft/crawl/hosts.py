"""Which hosts are the project's site (plan decision D7): the website's host with and without
`www.`, plus the allowed subdomains of the project settings."""

from __future__ import annotations

from collections.abc import Sequence


def site_hosts(host: str, allowed_subdomains: Sequence[str]) -> frozenset[str]:
    bare = host.lower().removeprefix("www.")
    return frozenset({bare, f"www.{bare}", *(name.lower() for name in allowed_subdomains)})
