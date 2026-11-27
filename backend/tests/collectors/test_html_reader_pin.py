"""What the HTML reader returns for fixed pages is pinned, so that changing it needs a new version.

If this fails, the reader's output for the same HTML changed: raise `HTML_READER_VERSION` in
`idraft/crawl/integrity.py` (crawls read by the old reader are then found stale), then regenerate
the golden file with
`UPDATE_READER_GOLDEN=1 uv run pytest tests/collectors/test_html_reader_pin.py`. A Python upgrade
that changes `html.parser` can also trip it, and is a change of reader too. It only protects the
shapes below; add a shape whenever a page teaches one.
"""

from __future__ import annotations

import dataclasses
import json
import os
from pathlib import Path
from typing import Any

from idraft.collectors.crawl_ingest import page_links_from_html
from idraft.crawl.integrity import HTML_READER_VERSION

GOLDEN = Path(__file__).parent / "golden" / "html_reader.json"
HOSTS = frozenset({"example.com"})
PAGE = "https://example.com/blog/post/"

FIXTURES: dict[str, str] = {
    "plain": (
        '<html><head><link rel="canonical" href="https://example.com/blog/post/"></head><body>'
        '<header><nav><a href="/">Home</a><a href="/services">Services</a></nav></header>'
        '<main><h1>Post</h1><p>Read <a href="/services/soc">our SOC</a> and '
        '<a href="https://other.example.org/x" rel="nofollow">elsewhere</a>.</p></main>'
        '<footer><a href="/privacy">Privacy</a><a href="mailto:a@example.com">Mail</a></footer>'
        "</body></html>"
    ),
    "empty comment before the body": (
        '<html><body><header><a href="/">Home</a></header><div><!---></div>'
        '<main><p><a href="/author/x/">Author</a> <a href="/a">A</a></p></main>'
        '<footer><a href="/privacy">Privacy</a></footer></body></html>'
    ),
    "short empty comment": (
        '<html><body><p><a href="/one">One</a></p><!--><p><a href="/two">Two</a></p></body></html>'
    ),
    "hidden anchors": (
        '<html><body><!-- <a href="/commented">c</a> --><script>"<a href=\\"/js\\">"</script>'
        '<template><a href="/tpl">t</a></template><a href="/real">r</a></body></html>'
    ),
    "images and fragments": (
        '<html><body><a href="/img"><img src="/i.png" alt="logo"></a><a href="#top">Top</a>'
        '<a href="/a#frag">A</a><a href="/a?utm_source=x">A again</a></body></html>'
    ),
}


def _edges(read: Any) -> list[dict[str, Any]]:
    out = []
    for edge in read.edges:
        out.append(
            {
                "target": edge.target.url,
                "anchor": edge.anchor,
                "kind": edge.kind,
                "placement": edge.placement,
                "scope": edge.scope.value,
                "rel": sorted(edge.rel),
                "followed": edge.followed,
                "occurrences": edge.occurrences,
            }
        )
    return sorted(out, key=lambda item: json.dumps(item, sort_keys=True))


async def _current() -> dict[str, Any]:
    output: dict[str, Any] = {}
    for name, html in FIXTURES.items():
        read = await page_links_from_html(html, 1, PAGE, PAGE, HOSTS)
        output[name] = {
            "edges": _edges(read),
            "capped": read.capped,
            "canonical": None if read.canonical is None else read.canonical.url,
            "facts": None if read.facts is None else dataclasses.asdict(read.facts),
        }
    return output


async def test_the_reader_returns_what_the_golden_file_says_for_the_same_html() -> None:
    current = {"version": HTML_READER_VERSION, "output": await _current()}
    if os.environ.get("UPDATE_READER_GOLDEN") == "1":
        GOLDEN.write_text(json.dumps(current, indent=2, sort_keys=True) + "\n")
    golden = json.loads(GOLDEN.read_text())
    assert golden["version"] == HTML_READER_VERSION, (
        "the version was raised: regenerate the golden file (see this file's docstring)"
    )
    assert golden["output"] == json.loads(json.dumps(current["output"])), (
        "the HTML reader's output changed: raise HTML_READER_VERSION and regenerate the golden "
        "file (see this file's docstring)"
    )
