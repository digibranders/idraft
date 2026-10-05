"""The normalized SERP, parser version 1 (docs/06-dataforseo-seo-integration.md section 5;
docs/12-normalized-observation-schemas.md section 3).

`parse_serp` reads the answer of `task_get/advanced` (or the live endpoint, which is assumed to
answer alike) and returns what the rest of the system needs, whatever the provider's field names:
the organic list in rank order, the SERP features, the AI Overview slot and a few facts about the
query. It is pure: no I/O, no database. Resolving ranks for entities, state and events are other
modules' work (`sightline.ranks`).

A field the parser depends on that is missing or of another type raises
`SerpSchemaMismatchError`; the task then fails with its raw payload kept. Data that is merely odd
(a duplicate URL, a rank gap, an unreadable URL) is repaired and reported in `warnings`.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Final, Literal

from sightline.extraction.urls import CanonicalUrl, UrlRejectedError, canonicalize

PARSER_VERSION: Final = 1
# A feature's payload is kept small: it is a row of a table read for every SERP of a keyword.
PAYLOAD_MAX_BYTES: Final = 4096
NO_RESULTS_STATUS: Final = 40102

AiOverviewState = Literal["absent", "present", "present_async_loaded", "present_not_loaded"]

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
    "tasks[].result[].items[].url",
    "tasks[].result[].items[].title",
    "tasks[].result[].items[].description",
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
    checks: tuple[str, ...]  # 'is_image', 'is_video', 'amp', 'highlighted'
    rating: Rating | None


@dataclass(frozen=True, slots=True)
class SerpFeature:
    feature_type: str  # a registry code, or `other:<provider type>`
    ordinal: int  # nth occurrence of the type on the page, from 1
    absolute_rank: int | None
    source_urls: tuple[CanonicalUrl, ...]  # display order, no URL twice
    payload: dict[str, Any] | None  # at most `PAYLOAD_MAX_BYTES` serialized


@dataclass(frozen=True, slots=True)
class AiOverview:
    state: AiOverviewState
    # The URLs it cites, in order of first appearance: the references of the block, then the
    # links inside its elements. Empty unless a present state.
    citations: tuple[CanonicalUrl, ...]


@dataclass(frozen=True, slots=True)
class Spell:
    type: str  # 'showing_results_for' (Google replaced the query) or 'did_you_mean'
    keyword: str


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

    @property
    def depth_returned(self) -> int:
        return len(self.organic)


def parse_serp(body: bytes | Mapping[str, Any]) -> NormalizedSerp:
    """The normalized SERP of a `task_get/advanced` answer, given as the bytes the provider sent
    or as its parsed JSON."""
    document = _document(body)
    task = _first(document.get("tasks"), "tasks[]")
    status = task.get("status_code")
    results = task.get("result")
    if status == NO_RESULTS_STATUS and not results:
        return _empty()
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
    return NormalizedSerp(
        keyword=_optional_str(result.get("keyword"), "tasks[].result[].keyword"),
        se_domain=_optional_str(result.get("se_domain"), "tasks[].result[].se_domain"),
        check_url=_optional_str(result.get("check_url"), "tasks[].result[].check_url"),
        observed_at=_observed_at(result.get("datetime"), builder.warnings),
        se_results_count=_optional_int(
            result.get("se_results_count"), "tasks[].result[].se_results_count"
        ),
        spell=_spell(result.get("spell"), builder.warnings),
        item_types=_item_types(result.get("item_types"), builder.seen_types),
        organic=organic,
        features=tuple(builder.features),
        ai_overview=builder.ai_overview(),
        warnings=tuple(builder.warnings),
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


def _document(body: bytes | Mapping[str, Any]) -> Mapping[str, Any]:
    if isinstance(body, bytes):
        try:
            body = json.loads(body)
        except ValueError:
            raise SerpSchemaMismatchError("$", "JSON") from None
    if not isinstance(body, Mapping):
        raise SerpSchemaMismatchError("$", "an object")
    return body


def _first(value: object, path: str) -> Mapping[str, Any]:
    if not isinstance(value, list) or not value or not isinstance(value[0], Mapping):
        raise SerpSchemaMismatchError(path, "a non-empty list of objects")
    first: Mapping[str, Any] = value[0]
    return first


def _optional_str(value: object, path: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise SerpSchemaMismatchError(path, "a string or null")
    return value


def _optional_int(value: object, path: str) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int):
        raise SerpSchemaMismatchError(path, "an integer or null")
    return value


def _list_of_mappings(value: object, path: str) -> list[Mapping[str, Any]]:
    """A list the provider may leave null; its elements that are not objects are not read."""
    if value is None:
        return []
    if not isinstance(value, list):
        raise SerpSchemaMismatchError(path, "a list or null")
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
    return len(json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode()) <= (
        PAYLOAD_MAX_BYTES
    )


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
        self._ai_citations: tuple[CanonicalUrl, ...] = ()

    def add(self, item: Mapping[str, Any]) -> None:
        kind = item.get("type")
        if not isinstance(kind, str):
            raise SerpSchemaMismatchError("tasks[].result[].items[].type", "a string")
        if kind not in self.seen_types:
            self.seen_types.append(kind)
        if kind == "organic":
            self._organic.append(item)
            return
        if kind == "paid":
            # One feature for all the ads of the page, placed where the first one is.
            if not self._ads:
                self._ads_at = len(self.features)
                self.features.append(_placeholder())
            self._ads.append(item)
            return
        sources = self._sources(kind, item)
        if kind == "ai_overview" and self._ai is None:
            self._ai, self._ai_citations = item, _distinct(sources)
        self._append(_canonical_name(kind), item, sources, self._payload(kind, item))

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

    def _sources(self, kind: str, item: Mapping[str, Any]) -> list[CanonicalUrl | None]:
        if kind == "ai_overview":
            return self._urls(*_ai_urls(item))
        if kind == "people_also_ask":
            return self._urls(
                *(
                    expanded.get("url")
                    for element in _list_of_mappings(item.get("items"), "items")
                    for expanded in _list_of_mappings(element.get("expanded_element"), "expanded")
                )
            )
        if kind in ("related_searches", "people_also_search"):
            return []
        elements = _list_of_mappings(item.get("items"), "items")
        return self._urls(item.get("url"), *(element.get("url") for element in elements))

    def _payload(self, kind: str, item: Mapping[str, Any]) -> dict[str, Any] | None:
        elements = _list_of_mappings(item.get("items"), "items")
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
                "title": item.get("featured_title"),
                "kind": "table" if item.get("table") else "paragraph",
            }
        if kind == "people_also_ask":
            return {"questions": [element.get("title") for element in elements]}
        if kind == "local_pack":
            return {"titles": [element.get("title") for element in elements]}
        if kind == "knowledge_graph":
            return {"title": item.get("title"), "subtitle": item.get("sub_title")}
        if kind in ("related_searches", "people_also_search"):
            return {
                "queries": [element.get("title") or element.get("keyword") for element in elements]
            }
        if kind in ("video", "short_videos", "discussions_and_forums"):
            domains = {element.get("domain") for element in elements if element.get("domain")}
            return {"domains": sorted(str(domain) for domain in domains)}
        if elements:
            return {"count": len(elements)}
        return None

    def finish_organic(self) -> tuple[OrganicResult, ...]:
        """The organic list (doc 06 section 5.2): ranks checked, URLs canonical, duplicates
        dropped, ranks dense from 1."""
        given = [_rank_group(item) for item in self._organic]
        if given != list(range(1, len(given) + 1)):
            self.warnings.append("rank_recomputed")
        results: list[OrganicResult] = []
        seen: set[bytes] = set()
        for item in self._organic:
            url = _url(item.get("url"), self.warnings)
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
                    for child in _list_of_mappings(item.get("related_result"), "related_result")
                ]
            )
            links = _list_of_mappings(item.get("links"), "links")
            organic_rank = len(results) + 1
            if links:
                self._sitelinks(item, url, len(links), organic_rank)
            results.append(
                OrganicResult(
                    organic_rank=organic_rank,
                    absolute_rank=_absolute(item),
                    url=url,
                    title=_optional_str(item.get("title"), "items[].title"),
                    snippet=_optional_str(item.get("description"), "items[].description"),
                    breadcrumb=_optional_str(item.get("breadcrumb"), "items[].breadcrumb"),
                    grouped_urls=tuple(
                        child for child in grouped if child.url_hash != url.url_hash
                    ),
                    has_sitelinks=bool(links),
                    checks=_checks(item),
                    rating=_rating(item.get("rating")),
                )
            )
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
        elements = _list_of_mappings(item.get("items"), "items")
        asynchronous = item.get("asynchronous_ai_overview") is True
        state: AiOverviewState
        if asynchronous and not elements and not citations:
            state = "present_not_loaded"
        else:
            state = "present_async_loaded" if asynchronous else "present"
        return AiOverview(state, citations)


def _placeholder() -> SerpFeature:
    return SerpFeature("ads", 1, None, (), None)


def _absolute(item: Mapping[str, Any]) -> int | None:
    """The position among all items of the page; None for the right column, which the provider
    numbers apart and which is not compared with the left."""
    if item.get("position") == "right":
        return None
    return _optional_int(item.get("rank_absolute"), "items[].rank_absolute")


def _rank_group(item: Mapping[str, Any]) -> int | None:
    return _optional_int(item.get("rank_group"), "items[].rank_group")


def _ai_urls(item: Mapping[str, Any]) -> list[object]:
    """The URLs an AI Overview cites, in order: its references, then for each element its links
    and its references."""
    urls: list[object] = [ref.get("url") for ref in _list_of_mappings(item.get("references"), "r")]
    for element in _list_of_mappings(item.get("items"), "items"):
        urls.extend(link.get("url") for link in _list_of_mappings(element.get("links"), "l"))
        urls.extend(ref.get("url") for ref in _list_of_mappings(element.get("references"), "r"))
    return urls


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
