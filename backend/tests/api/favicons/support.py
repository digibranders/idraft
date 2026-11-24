"""A fake internet for the favicon tests: a name table, and a transport that answers by host."""

from __future__ import annotations

import io
from collections.abc import Callable

import httpx
from PIL import Image

from idraft.api.favicons.fetch import SafeFetcher

Handler = Callable[[httpx.Request], httpx.Response]


def png(width: int) -> bytes:
    out = io.BytesIO()
    Image.new("RGBA", (width, width), (200, 30, 30, 255)).save(out, "PNG")
    return out.getvalue()


def ico(*widths: int) -> bytes:
    out = io.BytesIO()
    Image.new("RGBA", (max(widths), max(widths)), (30, 30, 200, 255)).save(
        out, "ICO", sizes=[(width, width) for width in widths]
    )
    return out.getvalue()


def html(*links: str) -> httpx.Response:
    body = "<html><head>" + "".join(links) + "</head><body>hi</body></html>"
    return httpx.Response(200, content=body, headers={"content-type": "text/html; charset=utf-8"})


def image(body: bytes, kind: str = "image/png") -> httpx.Response:
    return httpx.Response(200, content=body, headers={"content-type": kind})


class Internet:
    """Records each request as (Host header, address it was sent to, path)."""

    def __init__(self, names: dict[str, list[str]], handler: Handler) -> None:
        self.names = names
        self.handler = handler
        self.requests: list[tuple[str, str, str]] = []
        self.lookups: list[str] = []
        self.client = httpx.AsyncClient(transport=httpx.MockTransport(self._serve))

    async def resolve(self, host: str) -> list[str]:
        self.lookups.append(host)
        if host not in self.names:
            raise OSError("no such name")
        return self.names[host]

    def _serve(self, request: httpx.Request) -> httpx.Response:
        self.requests.append((request.headers["host"], request.url.host, request.url.path))
        return self.handler(request)

    def fetcher(self) -> SafeFetcher:
        return SafeFetcher(self.client, self.resolve)
