"""The icon of a site, found once on the server and kept in Redis (which the VPS writes to disk),
so no browser and no page of the app ever contacts the site or a third party for it."""

from __future__ import annotations

import asyncio
from typing import Final

import httpx
from redis.asyncio import Redis
from redis.exceptions import RedisError

from idraft.api import limits
from idraft.api.auth.throttle import LoginThrottle
from idraft.api.favicons.fetch import FetchRefusedError, SafeFetcher
from idraft.api.favicons.icons import icon_links, to_png
from idraft.api.problems import BadRequestError, ServiceUnavailableError
from idraft.extraction.urls import has_known_suffix, normalize_host

HIT_SECONDS: Final = 7 * 24 * 3600
MISS_SECONDS: Final = 6 * 3600
# A site that was down or slow is asked again sooner than one that has no icon.
FAILED_SECONDS: Final = 15 * 60
FETCHES_PER_MINUTE: Final = 60
PAGE_MAX_BYTES: Final = 256 * 1024
IMAGE_MAX_BYTES: Final = 512 * 1024
MAX_CANDIDATES: Final = 4
DEADLINE_SECONDS: Final = 15
_IMAGE_TYPES: Final = ("image/",)
_REDIS_ERRORS: Final = (RedisError, OSError, TimeoutError)


def registrable_domain(raw: str) -> str:
    """The registrable domain a path segment names, or BadRequestError for anything that is not a
    public site name (an address, a name with no public suffix, a name with a scheme or path)."""
    if any(char in raw for char in "/?#@:[] \\") or not raw:
        raise BadRequestError("Not a public domain.")
    try:
        host = normalize_host(raw)
    except ValueError:
        raise BadRequestError("Not a public domain.") from None
    if host.is_ip or not has_known_suffix(host.name):
        raise BadRequestError("Not a public domain.")
    return host.registrable_domain


class FaviconService:
    def __init__(self, *, redis: Redis, throttle: LoginThrottle, fetcher: SafeFetcher) -> None:
        self._redis = redis
        self._throttle = throttle
        self._fetcher = fetcher

    async def icon(self, raw_domain: str, *, workspace_id: object) -> bytes | None:
        """A PNG at least 32 px wide, or None when the site has none."""
        domain = registrable_domain(raw_domain)
        hit_key, miss_key = f"favicon:v1:{domain}", f"favicon:v1:miss:{domain}"
        try:
            cached = await self._redis.get(hit_key)
            if isinstance(cached, bytes):
                return cached
            if await self._redis.exists(miss_key):
                return None
        except _REDIS_ERRORS:
            raise ServiceUnavailableError("Try again in a moment.") from None
        await limits.enforce(
            self._throttle, "favicon", workspace_id, limit=FETCHES_PER_MINUTE, window_seconds=60
        )
        png, failed = await self._find(domain)
        try:
            if png is not None:
                await self._redis.set(hit_key, png, ex=HIT_SECONDS)
            else:
                await self._redis.set(miss_key, b"1", ex=FAILED_SECONDS if failed else MISS_SECONDS)
        except _REDIS_ERRORS:
            pass  # the answer is still good; the next request asks the site again
        return png

    async def _find(self, domain: str) -> tuple[bytes | None, bool]:
        """The icon and whether a site error (not an absence) was met on the way."""
        failed = False
        try:
            async with asyncio.timeout(DEADLINE_SECONDS):
                candidates: list[str] = []
                try:
                    page = await self._fetcher.get(
                        f"https://{domain}/", max_bytes=PAGE_MAX_BYTES, content_types=("text/html",)
                    )
                except httpx.HTTPError:
                    failed = True
                    page = None
                except FetchRefusedError:
                    page = None
                if page is not None:
                    candidates = icon_links(page.body, page.url)
                candidates = [*candidates[: MAX_CANDIDATES - 1], f"https://{domain}/favicon.ico"]
                for url in dict.fromkeys(candidates):
                    try:
                        image = await self._fetcher.get(
                            url, max_bytes=IMAGE_MAX_BYTES, content_types=_IMAGE_TYPES
                        )
                    except httpx.HTTPError:
                        failed = True
                        continue
                    except FetchRefusedError:
                        continue
                    png = None if image is None else await to_png(image.body)
                    if png is not None:
                        return png, False
        except TimeoutError:
            failed = True
        return None, failed
