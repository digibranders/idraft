"""The normalized SERP, parser version 1 (docs/06-dataforseo-seo-integration.md section 5;
docs/12-normalized-observation-schemas.md section 3).

`parse_serp` reads the answer of `task_get/advanced` (or the live endpoint, which is assumed to
answer alike) and returns what the rest of the system needs, whatever the provider's field names:
the organic list in rank order, the SERP features, the AI Overview slot and a few facts about the
query. It is pure: no I/O, no database. Resolving ranks for entities, state and events are other
modules' work (`sightline.ranks`).

What a rank depends on is read strictly: the shape of the answer, and the type, rank, position,
URL and text of an organic item. A field there that is missing or of another type raises
`SerpSchemaMismatchError`, and the task fails with its raw payload kept. Everything else is read
as far as it can be and left out when it cannot (a feature of a type the parser does not know, a
count, a link list): a new kind of block must not stop ingest. Data that is merely odd (a
duplicate URL, a rank gap, an unreadable URL) is repaired and reported in `warnings`.

Text the database cannot keep (NUL, a lone surrogate) is cleaned from the whole answer first.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import datetime
from typing import Any, Final, Literal

from sightline.extraction.urls import CanonicalUrl, UrlRejectedError, canonicalize

PARSER_VERSION: Final = 1
# A feature's payload is kept small: it is a row of a table read for every SERP of a keyword.
# The limit is bytes of the text PostgreSQL gives the jsonb value, which is what the table's check
# measures: `json.dumps` with its default separators writes the same text.
PAYLOAD_MAX_BYTES: Final = 4096
NO_RESULTS_STATUS: Final = 40102

AiOverviewState = Literal["absent", "present", "present_async_loaded", "present_not_loaded"]
CitationKind = Literal["reference_card", "inline"]

# DataForSEO `type` to our `feature_type` (doc 06 section 5.4). Several provider types share one.
FEATURE_TYPES: Final[Mapping[str, str]] = {
    "ai_overview": "ai_overview",
    "featured_snippet": "featured_snippet",
    "people_also_ask": "people_also_ask",
    "local_pack": "local_pack",
    "knowledge_graph": "knowledge_graph",
    "top_stories": "top_stories",
    "video": "video",
    "short_videos": "video",
    "images": "images",
    "discussions_and_forums": "discussions_and_forums",
    "perspectives": "perspectives",
    "shopping": "shopping",
    "popular_products": "shopping",
    "commercial_units": "shopping",
    "related_searches": "related_searches",
    "people_also_search": "related_searches",
    "twitter": "social_posts",
    "answer_box": "answer_box",
    "paid": "ads",
}
# The paths of the answer the parser depends on (docs/26-testing-quality.md section 3.3). A test
# checks that every one exists in the fixtures of the endpoint.
READS_PATHS: Final = (
    "tasks[].status_code",
    "tasks[].result[].items[].type",
    "tasks[].result[].items[].rank_group",
    "tasks[].result[].items[].rank_absolute",
    "tasks[].result[].items[].position",
    "tasks[].result[].items[].url",
    "tasks[].result[].items[].title",
    "tasks[].result[].items[].description",
    "tasks[].result[].items[].related_result[].url",
    "tasks[].result[].items[].links[].url",
    "tasks[].result[].items[].references[].url",
    "tasks[].result[].items[].asynchronous_ai_overview",
    "tasks[].data.depth",
    "tasks[].data.device",
    "tasks[].data.language_code",
    "tasks[].result[].keyword",
    "tasks[].result[].se_results_count",
    "tasks[].result[].item_types",
    "tasks[].result[].datetime",
)


class SerpSchemaMismatchError(ValueError):
    """The answer is not shaped as the parser reads it: `path` says where."""

    def __init__(self, path: str, expected: str) -> None:
        super().__init__(f"{path}: expected {expected}")
        self.path = path


@dataclass(frozen=True, slots=True)
class Rating:
    value: float
    votes: int | None
    max: float


@dataclass(frozen=True, slots=True)
class OrganicResult:
    organic_rank: int  # canonical: 1 for the first organic result, in order, without gaps
    absolute_rank: int | None  # None for a right-column item
    url: CanonicalUrl
    title: str | None
    snippet: str | None
    breadcrumb: str | None
    grouped_urls: tuple[CanonicalUrl, ...]  # `related_result` children, at the same rank
    has_sitelinks: bool
    checks: tuple[str, ...]  # 'is_image', 'is_video', 'amp', 'is_featured_snippet'
    rating: Rating | None


@dataclass(frozen=True, slots=True)
class SerpFeature:
    feature_type: str  # a registry code, or `other:<provider type>`
    ordinal: int  # nth occurrence of the type on the page, from 1
    absolute_rank: int | None
    source_urls: tuple[CanonicalUrl, ...]  # display order, no URL twice
    payload: dict[str, Any] | None  # at most `PAYLOAD_MAX_BYTES` as the database writes it


@dataclass(frozen=True, slots=True)
class Citation:
    url: CanonicalUrl
    # A reference card (a source the block lists) or an inline link inside its text that is not
    # also listed as a reference.
    kind: CitationKind


@dataclass(frozen=True, slots=True)
class AiOverview:
    state: AiOverviewState
    # What it cites, in order of first appearance: the references of the block, then the links
    # inside its elements. Empty unless a present state.
    citations: tuple[Citation, ...]


@dataclass(frozen=True, slots=True)
class Spell:
    type: str  # 'showing_results_for' (Google replaced the query) or 'did_you_mean'
    keyword: str


@dataclass(frozen=True, slots=True)
class RequestEcho:
    """The task as the provider says it ran it (`tasks[].data`): what a check asked for, which
    the ledger does not keep."""

    depth: int
    device: str
    language_code: str
    os: str | None
    se_domain: str | None
    location_code: int | None


@dataclass(frozen=True, slots=True)
class NormalizedSerp:
    keyword: str | None
    se_domain: str | None
    check_url: str | None
    observed_at: datetime | None  # the provider's crawl time, as an aware datetime
    se_results_count: int | None
    spell: Spell | None
    item_types: tuple[str, ...]  # canonical names, once each, in order of first appearance
    organic: tuple[OrganicResult, ...]
    features: tuple[SerpFeature, ...]
    ai_overview: AiOverview
    warnings: tuple[str, ...]  # repairs and oddities, one entry for each occurrence
    # None when the answer does not echo the task (reported as `request_echo_missing`).
    request: RequestEcho | None = None

    @property
    def depth_returned(self) -> int:
        return len(self.organic)


def parse_serp(body: bytes | Mapping[str, Any]) -> NormalizedSerp:
    """The normalized SERP of a `task_get/advanced` answer, given as the bytes the provider sent
    or as its parsed JSON."""
    try:
        document = _document(body)
    except RecursionError:
        raise SerpSchemaMismatchError("$", "a document that is not nested without end") from None
    task = _first(document.get("tasks"), "tasks[]")
    status = task.get("status_code")
    results = task.get("result")
    request = _request_echo(task.get("data"))
    if status == NO_RESULTS_STATUS and not results:
        return replace(_empty(), request=request)
    result = _first(results, "tasks[].result[]")
    items = result.get("items")
    if items is not None and not isinstance(items, list):
        raise SerpSchemaMismatchError("tasks[].result[].items", "a list or null")
    builder = _Builder()
    for position, item in enumerate(items or []):
        if not isinstance(item, Mapping):
            raise SerpSchemaMismatchError(f"tasks[].result[].items[{position}]", "an object")
        builder.add(item)
    # The organic list first: it adds the sitelinks and the ads to the features, and its
    # repairs to the warnings.
    organic = builder.finish_organic()
    if request is None:
        builder.warnings.append("request_echo_missing")
    return NormalizedSerp(
        request=request,
        keyword=_text(result.get("keyword")),
        se_domain=_text(result.get("se_domain")),
        check_url=_text(result.get("check_url")),
        observed_at=_observed_at(result.get("datetime"), builder.warnings),
        se_results_count=_whole(result.get("se_results_count")),
        spell=_spell(result.get("spell"), builder.warnings),
        item_types=_item_types(result.get("item_types"), builder.seen_types),
        organic=organic,
        features=tuple(builder.features),
        ai_overview=builder.ai_overview(),
        warnings=tuple(builder.warnings),
    )


def _request_echo(data: object) -> RequestEcho | None:
    """What the task asked for, when the answer says; None when the depth, device or language
    is missing, which the ingest writer cannot do without."""
    if not isinstance(data, Mapping):
        return None
    depth = _whole(data.get("depth"))
    device, language = _text(data.get("device")), _text(data.get("language_code"))
    if depth is None or depth < 1 or device is None or language is None:
        return None
    return RequestEcho(
        depth=depth,
        device=device,
        language_code=language,
        os=_text(data.get("os")),
        se_domain=_text(data.get("se_domain")),
        location_code=_whole(data.get("location_code")),
    )


def _empty() -> NormalizedSerp:
    return NormalizedSerp(
        keyword=None,
        se_domain=None,
        check_url=None,
        observed_at=None,
        se_results_count=None,
        spell=None,
        item_types=(),
        organic=(),
        features=(),
        ai_overview=AiOverview("absent", ()),
        warnings=("no_results",),
    )


def _scrub(value: Any) -> Any:
    """The document with the text the database cannot keep cleaned out: NUL is dropped and a lone
    surrogate becomes `?`, as a replacing UTF-8 encoder writes it."""
    if isinstance(value, str):
        if value.isascii() and "\x00" not in value:
            return value
        return value.replace("\x00", "").encode("utf-8", "replace").decode("utf-8")
    if isinstance(value, list):
        return [_scrub(element) for element in value]
    if isinstance(value, Mapping):
        return {_scrub(name): _scrub(element) for name, element in value.items()}
    return value


def _document(body: bytes | Mapping[str, Any]) -> Mapping[str, Any]:
    if isinstance(body, bytes):
        try:
            body = json.loads(body)
        except ValueError:
            raise SerpSchemaMismatchError("$", "JSON") from None
    if not isinstance(body, Mapping):
        raise SerpSchemaMismatchError("$", "an object")
    cleaned: Mapping[str, Any] = _scrub(body)
    return cleaned


def _first(value: object, path: str) -> Mapping[str, Any]:
    if not isinstance(value, list) or not value or not isinstance(value[0], Mapping):
        raise SerpSchemaMismatchError(path, "a non-empty list of objects")
    first: Mapping[str, Any] = value[0]
    return first


def _strict_str(value: object, path: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise SerpSchemaMismatchError(path, "a string or null")
    return value


def _strict_int(value: object, path: str) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int):
        raise SerpSchemaMismatchError(path, "an integer or null")
    return value


def _text(value: object) -> str | None:
    """A string, or None: what a rank does not depend on is left out when it cannot be read."""
    return value if isinstance(value, str) else None


def _whole(value: object) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _mappings(value: object) -> list[Mapping[str, Any]]:
    """The objects of a list; anything else (a missing list, another type) is no objects."""
    if not isinstance(value, list):
        return []
    return [element for element in value if isinstance(element, Mapping)]


def _observed_at(value: object, warnings: list[str]) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, str):
        try:
            return datetime.strptime(value, "%Y-%m-%d %H:%M:%S %z")
        except ValueError:
            pass
    warnings.append("datetime_unreadable")
    return None


def _spell(value: object, warnings: list[str]) -> Spell | None:
    if not isinstance(value, Mapping):
        return None
    kind, keyword = value.get("type"), value.get("keyword")
    if not isinstance(kind, str) or not isinstance(keyword, str):
        return None
    if kind == "showing_results_for":
        warnings.append("query_autocorrected")
    return Spell(kind, keyword)


def _canonical_name(provider_type: str) -> str:
    if provider_type == "organic":
        return "organic"
    return FEATURE_TYPES.get(provider_type) or f"other:{provider_type}"


def _item_types(value: object, seen: Sequence[str]) -> tuple[str, ...]:
    """The types the provider lists, else the ones the items had, as our names."""
    names = value if isinstance(value, list) else list(seen)
    found: dict[str, None] = {}
    for name in names:
        if isinstance(name, str) and name:
            found.setdefault(_canonical_name(name), None)
    return tuple(found)


def _url(raw: object, warnings: list[str]) -> CanonicalUrl | None:
    """The canonical URL, or None when there is none to read (reported)."""
    if not isinstance(raw, str) or not raw.strip():
        return None
    try:
        found = canonicalize(raw)
    except UrlRejectedError:
        warnings.append("url_rejected")
        return None
    if "unresolved_redirect" in found.flags:
        warnings.append("unresolved_redirect")
    return found


def _distinct(urls: Sequence[CanonicalUrl | None]) -> tuple[CanonicalUrl, ...]:
    found: dict[bytes, CanonicalUrl] = {}
    for url in urls:
        if url is not None:
            found.setdefault(url.url_hash, url)
    return tuple(found.values())


def _fits(payload: dict[str, Any]) -> bool:
    return len(json.dumps(payload, ensure_ascii=False).encode()) <= PAYLOAD_MAX_BYTES


def _bounded(payload: dict[str, Any] | None) -> dict[str, Any] | None:
    """The payload with its longest list cut until it fits; `{"truncated": true}` when that is
    not enough."""
    if payload is None or _fits(payload):
        return payload
    kept = {
        name: list(value) if isinstance(value, list) else value for name, value in payload.items()
    }
    lists = [name for name, value in kept.items() if isinstance(value, list)]
    while lists and not _fits(kept):
        longest = max(lists, key=lambda name: len(kept[name]))
        if not kept[longest]:
            break
        del kept[longest][len(kept[longest]) // 2 :]
    if _fits(kept):
        kept["truncated"] = True
        return kept if _fits(kept) else {"truncated": True}
    return {"truncated": True}


class _Builder:
    """Reads the items of a SERP in response order."""

    def __init__(self) -> None:
        self.warnings: list[str] = []
        self.features: list[SerpFeature] = []
        self.seen_types: list[str] = []
        self._organic: list[Mapping[str, Any]] = []
        self._ordinals: dict[str, int] = {}
        self._ads: list[Mapping[str, Any]] = []
        self._ads_at: int | None = None
        self._ai: Mapping[str, Any] | None = None
        self._ai_citations: tuple[Citation, ...] = ()
        self._pack: list[Mapping[str, Any]] = []
        self._pack_at: int | None = None

    def add(self, item: Mapping[str, Any]) -> None:
        kind = item.get("type")
        if not isinstance(kind, str):
            raise SerpSchemaMismatchError("tasks[].result[].items[].type", "a string")
        if kind not in self.seen_types:
            self.seen_types.append(kind)
        if kind == "organic":
            self._organic.append(item)
            self._pack_at = None
            return
        if kind == "paid":
            # One feature for all the ads of the page, placed where the first one is.
            self._pack_at = None
            if not self._ads:
                self._ads_at = len(self.features)
                self.features.append(_placeholder())
            self._ads.append(item)
            return
        if kind == "local_pack" and not _mappings(item.get("items")):
            self._add_business(item)
            return
        self._pack_at = None
        if kind == "ai_overview" and self._ai is None:
            self._ai = item
            self._ai_citations = self._citations(item)
        sources = (
            [citation.url for citation in self._ai_citations]
            if item is self._ai
            else self._sources(kind, item)
        )
        self._append(_canonical_name(kind), item, sources, self._payload(kind, item))

    def _add_business(self, item: Mapping[str, Any]) -> None:
        """A local pack the provider lists one business at a time is one block, as long as the
        businesses follow each other."""
        if self._pack_at is None or self._pack_at != len(self.features) - 1:
            self._pack = []
            self._pack_at = len(self.features)
            self.features.append(_placeholder())
            ordinal = self._ordinals.get("local_pack", 0) + 1
            self._ordinals["local_pack"] = ordinal
        else:
            ordinal = self.features[self._pack_at].ordinal
        self._pack.append(item)
        absolutes = [rank for entry in self._pack if (rank := _absolute(entry)) is not None]
        self.features[self._pack_at] = SerpFeature(
            feature_type="local_pack",
            ordinal=ordinal,
            absolute_rank=min(absolutes) if absolutes else None,
            source_urls=_distinct(self._urls(*(entry.get("url") for entry in self._pack))),
            payload=_bounded({"titles": [_text(entry.get("title")) for entry in self._pack]}),
        )

    def _append(
        self,
        feature_type: str,
        item: Mapping[str, Any],
        sources: Sequence[CanonicalUrl | None],
        payload: dict[str, Any] | None,
    ) -> None:
        ordinal = self._ordinals.get(feature_type, 0) + 1
        self._ordinals[feature_type] = ordinal
        self.features.append(
            SerpFeature(
                feature_type=feature_type,
                ordinal=ordinal,
                absolute_rank=_absolute(item),
                source_urls=_distinct(sources),
                payload=_bounded(payload),
            )
        )

    def _urls(self, *raw: object) -> list[CanonicalUrl | None]:
        return [_url(value, self.warnings) for value in raw]

    def _citations(self, item: Mapping[str, Any]) -> tuple[Citation, ...]:
        """What an AI Overview cites, in order of first appearance: its references, then for each
        element its links and its references. A URL listed as a reference anywhere in the block
        is a reference card; the others are inline links."""
        references = [ref.get("url") for ref in _mappings(item.get("references"))]
        ordered: list[object] = list(references)
        for element in _mappings(item.get("items")):
            ordered.extend(link.get("url") for link in _mappings(element.get("links")))
            element_references = [ref.get("url") for ref in _mappings(element.get("references"))]
            ordered.extend(element_references)
            references.extend(element_references)
        reference_hashes = {found.url_hash for found in self._urls(*references) if found}
        citations: dict[bytes, Citation] = {}
        for found in self._urls(*ordered):
            if found is None or found.url_hash in citations:
                continue
            kind: CitationKind = (
                "reference_card" if found.url_hash in reference_hashes else "inline"
            )
            citations[found.url_hash] = Citation(found, kind)
        return tuple(citations.values())

    def _sources(self, kind: str, item: Mapping[str, Any]) -> list[CanonicalUrl | None]:
        if kind == "ai_overview":
            return [citation.url for citation in self._citations(item)]
        if kind == "people_also_ask":
            raw: list[object] = []
            for element in _mappings(item.get("items")):
                for expanded in _mappings(element.get("expanded_element")):
                    raw.append(expanded.get("url"))
                    # An answer that is an AI Overview lists its sources as references.
                    raw.extend(ref.get("url") for ref in _mappings(expanded.get("references")))
            return self._urls(*raw)
        if kind in ("related_searches", "people_also_search"):
            return []
        elements = _mappings(item.get("items"))
        return self._urls(item.get("url"), *(element.get("url") for element in elements))

    @staticmethod
    def _question(element: Mapping[str, Any]) -> dict[str, Any]:
        """A People also ask question, the domain its answer comes from and whether that answer
        is an AI Overview."""
        expanded = _mappings(element.get("expanded_element"))
        first = expanded[0] if expanded else {}
        domain = _text(first.get("domain")) or _host_of(first.get("url"))
        return {
            "title": _text(element.get("title")),
            "domain": domain,
            "ai": "ai_overview" in str(first.get("type", "")),
        }

    def _payload(self, kind: str, item: Mapping[str, Any]) -> dict[str, Any] | None:
        elements = _mappings(item.get("items"))
        if kind == "ai_overview":
            kinds = " ".join(str(element.get("type", "")) for element in elements)
            return {
                "asynchronous": item.get("asynchronous_ai_overview") is True,
                "elements": len(elements),
                "has_table": "table" in kinds,
                "has_video": "video" in kinds,
            }
        if kind == "featured_snippet":
            return {
                "title": _text(item.get("featured_title")),
                "kind": "table" if item.get("table") else "paragraph",
            }
        if kind == "people_also_ask":
            return {"questions": [self._question(element) for element in elements]}
        if kind == "local_pack":
            return {"titles": [_text(element.get("title")) for element in elements]}
        if kind == "knowledge_graph":
            return {"title": _text(item.get("title")), "subtitle": _text(item.get("sub_title"))}
        if kind in ("related_searches", "people_also_search"):
            return {
                "queries": [
                    _text(element.get("title")) or _text(element.get("keyword"))
                    for element in elements
                ]
            }
        if kind in ("video", "short_videos", "discussions_and_forums"):
            domains = {
                domain for element in elements if isinstance(domain := element.get("domain"), str)
            }
            return {"domains": sorted(domains)}
        if elements:
            return {"count": len(elements)}
        return None

    def finish_organic(self) -> tuple[OrganicResult, ...]:
        """The organic list (doc 06 section 5.2): ranks checked, URLs canonical, duplicates
        dropped, ranks dense from 1. Dense ranks are the invariant of doc 12; when a gap in the
        provider's ranks, or a result dropped before a later one, moves a result off the rank the
        provider gave it, that is reported as `rank_recomputed`."""
        given = [
            _strict_int(item.get("rank_group"), "items[].rank_group") for item in self._organic
        ]
        recomputed = given != list(range(1, len(given) + 1))
        results: list[OrganicResult] = []
        seen: set[bytes] = set()
        for item, provider_rank in zip(self._organic, given, strict=True):
            url = _url(_strict_str(item.get("url"), "items[].url"), self.warnings)
            if url is None:
                self.warnings.append("organic_without_url")
                continue
            if url.url_hash in seen:
                self.warnings.append("duplicate_url")
                continue
            seen.add(url.url_hash)
            grouped = _distinct(
                [
                    _url(child.get("url"), self.warnings)
                    for child in _mappings(item.get("related_result"))
                ]
            )
            links = _mappings(item.get("links"))
            organic_rank = len(results) + 1
            if provider_rank != organic_rank:
                recomputed = True
            if links:
                self._sitelinks(item, url, len(links), organic_rank)
            results.append(
                OrganicResult(
                    organic_rank=organic_rank,
                    absolute_rank=_organic_absolute(item),
                    url=url,
                    title=_strict_str(item.get("title"), "items[].title"),
                    snippet=_strict_str(item.get("description"), "items[].description"),
                    breadcrumb=_text(item.get("breadcrumb")),
                    grouped_urls=tuple(
                        child for child in grouped if child.url_hash != url.url_hash
                    ),
                    has_sitelinks=bool(links),
                    checks=_checks(item),
                    rating=_rating(item.get("rating")),
                )
            )
        if recomputed:
            self.warnings.append("rank_recomputed")
        self._finish_ads(results)
        return tuple(results)

    def _sitelinks(
        self, item: Mapping[str, Any], parent: CanonicalUrl, count: int, organic_rank: int
    ) -> None:
        self._append("sitelinks", item, [parent], {"count": count, "organic_rank": organic_rank})

    def _finish_ads(self, organic: Sequence[OrganicResult]) -> None:
        """The ads of the page as one feature: how many are above the first organic result and
        how many below it. An ad is on top when it is numbered before the first organic result."""
        if self._ads_at is None:
            return
        first_organic = min(
            (
                rank
                for item in self._organic
                if isinstance(rank := item.get("rank_absolute"), int) and not isinstance(rank, bool)
            ),
            default=None,
        )
        top = sum(
            1
            for ad in self._ads
            if first_organic is None
            or (isinstance(rank := ad.get("rank_absolute"), int) and rank < first_organic)
        )
        ordinal = self._ordinals.get("ads", 0) + 1
        self._ordinals["ads"] = ordinal
        absolutes = [rank for ad in self._ads if (rank := _absolute(ad)) is not None]
        self.features[self._ads_at] = SerpFeature(
            feature_type="ads",
            ordinal=ordinal,
            absolute_rank=min(absolutes) if absolutes else None,
            source_urls=_distinct(self._urls(*(ad.get("url") for ad in self._ads))),
            payload={"top": top, "bottom": len(self._ads) - top},
        )

    def ai_overview(self) -> AiOverview:
        """The AI Overview slot (doc 06 section 5.5)."""
        item = self._ai
        if item is None:
            return AiOverview("absent", ())
        citations = self._ai_citations
        elements = _mappings(item.get("items"))
        asynchronous = item.get("asynchronous_ai_overview") is True
        state: AiOverviewState
        if asynchronous and not elements and not citations:
            state = "present_not_loaded"
        else:
            state = "present_async_loaded" if asynchronous else "present"
        return AiOverview(state, citations)


def _placeholder() -> SerpFeature:
    return SerpFeature("ads", 1, None, (), None)


def _organic_absolute(item: Mapping[str, Any]) -> int | None:
    """The position of an organic item among all items of the page, read strictly; None for the
    right column, which the provider numbers apart and which is not compared with the left."""
    if item.get("position") == "right":
        return None
    return _strict_int(item.get("rank_absolute"), "items[].rank_absolute")


def _absolute(item: Mapping[str, Any]) -> int | None:
    """The same for a feature, read leniently: a block of a type not known yet must not stop
    ingest."""
    if item.get("position") == "right":
        return None
    return _whole(item.get("rank_absolute"))


def _host_of(url: object) -> str | None:
    if not isinstance(url, str):
        return None
    try:
        return canonicalize(url).host.name
    except UrlRejectedError:
        return None


def _checks(item: Mapping[str, Any]) -> tuple[str, ...]:
    flags = (
        ("is_image", "is_image"),
        ("is_video", "is_video"),
        ("amp_version", "amp"),
        ("is_featured_snippet", "is_featured_snippet"),
    )
    return tuple(name for field, name in flags if item.get(field) is True)


def _rating(value: object) -> Rating | None:
    if not isinstance(value, Mapping):
        return None
    number, top = value.get("value"), value.get("rating_max")
    votes = value.get("votes_count")
    if isinstance(number, bool) or not isinstance(number, int | float):
        return None
    maximum = float(top) if isinstance(top, int | float) and not isinstance(top, bool) else 5.0
    return Rating(
        float(number),
        votes if isinstance(votes, int) and not isinstance(votes, bool) else None,
        maximum,
    )
