"""Variants of a page: the same page under another address (plan 09).

A crawled page that names another crawled page as its canonical is a variant: `/blogs?page=2`
whose canonical is `/blogs`, or a tracking link to `/book-a-demo`. It is not a page of the
site. Variants stay stored; for every count and for the link graph they fold into the canonical
page: a link to a variant is a link to the page it names, and the links a variant carries are
ignored. Which pages are variants is decided in SQL when the crawl's metrics are computed
(`crawl_ingest.SET_VARIANTS`); this module folds a graph that was read with that answer.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import replace

from idraft.crawl.graph import Link, Node


def fold_variants(
    nodes: Mapping[int, Node], links: Iterable[Link], variant_of: Mapping[int, int]
) -> tuple[dict[int, Node], list[Link]]:
    """The graph without its variants: their nodes are gone, the links from them are dropped,
    and a link or redirect to one points at its canonical page. A link that folds into a link
    from a page to itself is dropped too. `variant_of` maps a variant to its canonical page."""
    kept: dict[int, Node] = {}
    for url_id, node in nodes.items():
        if url_id in variant_of:
            continue
        redirect = node.redirect_to
        if redirect is not None and redirect in variant_of:
            node = replace(node, redirect_to=variant_of[redirect])
        kept[url_id] = node
    folded: list[Link] = []
    for link in links:
        if link.source in variant_of:
            continue
        target = variant_of.get(link.target, link.target)
        if target == link.target:
            folded.append(link)
        elif target != link.source:
            folded.append(replace(link, target=target))
    return kept, folded
