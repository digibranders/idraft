"""The normalized AI answer, normalizer version 1 (docs/07-dataforseo-ai-integration.md section 5;
docs/12-normalized-observation-schemas.md section 4).

`parse_ai_answer` reads the `task_get/advanced` answer of the ChatGPT scraper, the Gemini scraper
or Google AI Mode and returns what ingest stores: the answer text, the cited sources in the
provider's order, the status, the model and a few small extras. It is pure: no I/O, no database.
Mentions and citation roles are `idraft.extraction.ai_facts`'s work.

Read strictly: the shape of the answer (`tasks[]`, `result[]`, `items[]`). Anything else is read
as far as it can be and left out when it cannot. Answer text is the markdown of the answer's
items, ad items left out (doc 07 section 5.4); for ChatGPT that is the top-level `markdown`
exactly when no ad is present (S-04: the top-level markdown is the items' markdown joined). The
text is kept as markdown: slice 1 has no markdown renderer, so `answer_text` equals
`answer_markdown` and a plain-text renderer later is an extractor version change.

Text the database cannot keep (NUL, a lone surrogate) is cleaned from the whole answer first.
The whole body is held in memory while it is read: the client caps the size of a body, so this
does not bound it again.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Final, Literal

from idraft.extraction.urls import CanonicalUrl, UrlRejectedError, canonicalize
from idraft.providers.dataforseo.serp_parse import scrub_text

PARSER_VERSION: Final = 1
# The task status code of an answer that can be read.
TASK_OK: Final = 20000
# provider_extras is a small column (doc 04 section 8.3): at most this many bytes of JSON.
EXTRAS_MAX_BYTES: Final = 16 * 1024
# An answer this short is not an answer (doc 07 section 5.5).
REFUSAL_MAX_CHARS: Final = 40
# A text opening with a refusal phrase is a refusal only when shorter than this.
REFUSAL_LONG_CHARS: Final = 300
# What a refusal opens with, without case.
REFUSALS: Final = (
    "i can't help with",
    "i cannot help with",
    "i can't assist with",
    "i cannot assist with",
    "i'm sorry, but i can't",
    "i'm unable to help",
)
# Item types that are advertising, never answer text or citations (doc 07 section 5.4).
AD_TYPES: Final = frozenset({"chat_gpt_ad", "ai_overview_paid", "paid"})
AnswerStatus = Literal["complete", "partial", "empty", "refused", "error"]
CitationKind = Literal["source_list", "inline", "reference_card"]
# The paths of the answer the parser depends on (docs/26-testing-quality.md section 3.3). A test
# checks that every one exists in the registered fixtures.
READS_PATHS: Final = (
    "tasks[].status_code",
    "tasks[].data.device",
    "tasks[].data.language_code",
    "tasks[].result[].model",
    "tasks[].result[].check_url",
    "tasks[].result[].datetime",
    "tasks[].result[].markdown",
    "tasks[].result[].sources[].url",
    "tasks[].result[].sources[].title",
    "tasks[].result[].sources[].source_name",
    "tasks[].result[].fan_out_queries[]",
    "tasks[].result[].brand_entities[].title",
    "tasks[].result[].items[].type",
    "tasks[].result[].items[].markdown",
    "tasks[].result[].items[].sources[].url",
    "tasks[].result[].items[].references[].url",
    "tasks[].result[].items[].references[].source",
    "tasks[].result[].items[].items[].type",
    "tasks[].result[].items[].items[].links[].url",
)


class AiSchemaMismatchError(ValueError):
    """The answer is not shaped as the parser reads it: `path` says where."""

    def __init__(self, path: str, expected: str) -> None:
        super().__init__(f"{path}: expected {expected}")
        self.path = path


@dataclass(frozen=True, slots=True)
class CitedSource:
    raw_url: str
    # None when the address cannot be read as a web page: kept for the count, never stored.
    url: CanonicalUrl | None
    title: str | None
    source_name: str | None
    kind: CitationKind
    # Cite entries across the answer's blocks (doc 14 section 9); at least 1.
    occurrences: int
    # The first block (item position, from 0) that cites it; None when no block does.
    answer_block_index: int | None


@dataclass(frozen=True, slots=True)
class NormalizedAnswer:
    status: AnswerStatus
    error_code: str | None
    answer_text: str | None
    model_reported: str | None
    check_url: str | None
    observed_at: datetime | None
    device: str | None
    language_code: str | None
    sources: tuple[CitedSource, ...]
    fan_out_count: int
    provider_extras: Mapping[str, Any] | None

    @property
    def is_valid(self) -> bool:
        """Whether the answer counts in rates (doc 07 section 5.5)."""
        return self.status in ("complete", "partial")


def unreadable(code: str, *, observed_at: datetime | None = None) -> NormalizedAnswer:
    """What is stored for an answer that cannot be read: an `error` with its code."""
    return NormalizedAnswer(
        status="error",
        error_code=code,
        answer_text=None,
        model_reported=None,
        check_url=None,
        observed_at=observed_at,
        device=None,
        language_code=None,
        sources=(),
        fan_out_count=0,
        provider_extras=None,
    )


def parse_ai_answer(engine_code: str, body: bytes | Mapping[str, Any]) -> NormalizedAnswer:
    """The normalized answer of a `task_get/advanced` answer of one engine, given as the bytes
    the provider sent or as its parsed JSON."""
    try:
        document = _document(body)
    except RecursionError:
        raise AiSchemaMismatchError("$", "a document that is not nested without end") from None
    task = _first(document.get("tasks"), "tasks[]")
    status_code = task.get("status_code")
    echoed = task.get("data")
    data: Mapping[str, Any] = echoed if isinstance(echoed, Mapping) else {}
    device, language = _text(data.get("device")), _text(data.get("language_code"))
    # Only a task that is exactly "Ok." (20000) is read; any other code, or none, is an error.
    if type(status_code) is not int or status_code != TASK_OK:
        code = "missing" if status_code is None else str(status_code)
        return _with(unreadable(code), device=device, language_code=language)
    results = task.get("result")
    if not results:
        return _empty(device, language)
    result = _first(results, "tasks[].result[]")
    items = result.get("items")
    if items is not None and not isinstance(items, list):
        raise AiSchemaMismatchError("tasks[].result[].items", "a list or null")
    for position, item in enumerate(items or []):
        if not isinstance(item, Mapping):
            raise AiSchemaMismatchError(f"tasks[].result[].items[{position}]", "an object")
    blocks: list[Mapping[str, Any]] = list(items or [])
    if engine_code == "google_ai_mode":
        text, sources, ads = _ai_mode(blocks)
    else:
        text, sources, ads = _scraper(result, blocks)
    fan_out = [query for query in result.get("fan_out_queries") or [] if isinstance(query, str)]
    extras = _bounded(
        {
            "check_url": _text(result.get("check_url")),
            "brand_entities": [
                {"title": _text(e.get("title")), "category": _text(e.get("category"))}
                for e in _mappings(result.get("brand_entities"))
            ],
            "fan_out_queries": fan_out,
            "search_results": len(_mappings(result.get("search_results"))),
            "ads": ads,
            "unreadable_sources": sum(source.url is None for source in sources),
        }
    )
    return NormalizedAnswer(
        status=_status(text, result, blocks),
        error_code=None,
        answer_text=text or None,
        model_reported=_model(result.get("model")),
        check_url=_text(result.get("check_url")),
        observed_at=_observed_at(result.get("datetime")),
        device=device,
        language_code=language or _text(result.get("language_code")),
        sources=tuple(sources),
        fan_out_count=len(fan_out),
        provider_extras=extras,
    )


def _status(
    text: str, result: Mapping[str, Any], blocks: Sequence[Mapping[str, Any]]
) -> AnswerStatus:
    if not text:
        return "empty"
    stripped = text.strip()
    # A curly apostrophe reads as a straight one, so one list of phrases serves both.
    opening = stripped.casefold().replace("\N{RIGHT SINGLE QUOTATION MARK}", "'")
    # A hedged answer opens with a refusal phrase and goes on to answer: a real refusal is short,
    # whether or not the engine had sources.
    declines = opening.startswith(REFUSALS) and len(stripped) < REFUSAL_LONG_CHARS
    if len(stripped) < REFUSAL_MAX_CHARS or declines:
        return "refused"
    if not blocks and _text(result.get("markdown")):
        # Markdown with no blocks behind it: whether an ad is in it cannot be told.
        return "partial"
    return "complete"


def _scraper(
    result: Mapping[str, Any], blocks: Sequence[Mapping[str, Any]]
) -> tuple[str, list[CitedSource], list[dict[str, Any]]]:
    """ChatGPT and Gemini: the text of the blocks that are not ads, the source list then the
    sources the blocks cite."""
    ads = [_ad(block) for block in blocks if block.get("type") in AD_TYPES]
    answer = [block for block in blocks if block.get("type") not in AD_TYPES]
    if blocks:
        text = "".join(_text(block.get("markdown")) or "" for block in answer)
    else:
        text = _text(result.get("markdown")) or ""
    sources = _Sources(_ad_keys(ads))
    for source in _mappings(result.get("sources")):
        sources.add(source, "source_list", None, cited=False)
    for position, block in enumerate(blocks):
        if block.get("type") in AD_TYPES:
            continue
        for source in _mappings(block.get("sources")):
            sources.add(source, "inline", position, cited=True)
    return text, sources.found(), ads


def _ai_mode(
    blocks: Sequence[Mapping[str, Any]],
) -> tuple[str, list[CitedSource], list[dict[str, Any]]]:
    """AI Mode: the `ai_overview` items (their text joined in order), their references as cards
    and their elements' links inline when not a reference already (doc 07 section 5.3)."""
    ads = [_ad(block) for block in blocks if block.get("type") in AD_TYPES]
    overviews = [block for block in blocks if block.get("type") == "ai_overview"]
    if not overviews:
        return "", [], ads
    parts: list[str] = []
    references: list[Mapping[str, Any]] = []
    cited: list[tuple[int, Mapping[str, Any]]] = []
    position = 0
    for overview in overviews:
        elements = _mappings(overview.get("items"))
        paid = [element for element in elements if element.get("type") in AD_TYPES]
        ads.extend(_ad(element) for element in paid)
        if paid:
            parts.append(
                "\n\n".join(
                    _text(element.get("markdown")) or ""
                    for element in elements
                    if element.get("type") not in AD_TYPES
                )
            )
        else:
            parts.append(_text(overview.get("markdown")) or "")
        references.extend(_mappings(overview.get("references")))
        for element in elements:
            if element.get("type") not in AD_TYPES:
                cited.append((position, element))
            position += 1
    sources = _Sources(_ad_keys(ads))
    for reference in references:
        sources.add(reference, "reference_card", None, cited=False, name_field="source")
    for position, element in cited:
        for link in _mappings(element.get("links")):
            sources.add(link, "inline", position, cited=True)
    return "\n\n".join(part for part in parts if part), sources.found(), ads


class _Sources:
    """Sources in first-appearance order, one per canonical URL (doc 14 section 9)."""

    def __init__(self, advertised: frozenset[str] = frozenset()) -> None:
        # Keys of the addresses the answer's ads point at: an ad is never a citation (doc 07
        # section 5.4), whichever list also carries the address.
        self._advertised = advertised
        self._order: list[str] = []
        self._first: dict[str, CitedSource] = {}
        self._cited: dict[str, int] = {}
        self._block: dict[str, int] = {}

    def add(
        self,
        source: Mapping[str, Any],
        kind: CitationKind,
        block: int | None,
        *,
        cited: bool,
        name_field: str = "source_name",
    ) -> None:
        raw = _text(source.get("url"))
        if not raw:
            return
        url, key = _identify(raw)
        if key in self._advertised:
            return
        if key not in self._first:
            self._order.append(key)
            self._first[key] = CitedSource(
                raw_url=raw,
                url=url,
                title=_text(source.get("title")),
                source_name=_text(source.get(name_field)),
                kind=kind,
                occurrences=1,
                answer_block_index=block,
            )
        if cited:
            self._cited[key] = self._cited.get(key, 0) + 1
            self._block.setdefault(key, block if block is not None else 0)

    def found(self) -> list[CitedSource]:
        found = []
        for key in self._order:
            first = self._first[key]
            block = first.answer_block_index
            if block is None:
                block = self._block.get(key)
            found.append(
                CitedSource(
                    raw_url=first.raw_url,
                    url=first.url,
                    title=first.title,
                    source_name=first.source_name,
                    kind=first.kind,
                    occurrences=max(1, self._cited.get(key, 0)),
                    answer_block_index=block,
                )
            )
        return found


def _identify(raw: str) -> tuple[CanonicalUrl | None, str]:
    """The canonical URL of an address (None when it is not a web page) and the key that tells
    two addresses of one page apart from the rest."""
    try:
        url: CanonicalUrl | None = canonicalize(raw)
    except UrlRejectedError:
        url = None
    return url, url.url_hash.hex() if url is not None else f"raw:{raw}"


def _ad_keys(ads: Sequence[Mapping[str, Any]]) -> frozenset[str]:
    return frozenset(_identify(ad["url"])[1] for ad in ads if isinstance(ad.get("url"), str))


def _ad(block: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "type": _text(block.get("type")),
        "domain": _text(block.get("domain")),
        "url": _text(block.get("url")),
        "title": _text(block.get("title")),
        "is_rendered": block.get("is_rendered")
        if isinstance(block.get("is_rendered"), bool)
        else None,
    }


def _model(value: object) -> str | None:
    """The model as reported, whitespace collapsed: Gemini has sent `3.5\\xa0Flash-Lite` (S-04)."""
    text = _text(value)
    if text is None:
        return None
    return " ".join(text.split()) or None


def _empty(device: str | None, language: str | None) -> NormalizedAnswer:
    return NormalizedAnswer(
        status="empty",
        error_code=None,
        answer_text=None,
        model_reported=None,
        check_url=None,
        observed_at=None,
        device=device,
        language_code=language,
        sources=(),
        fan_out_count=0,
        provider_extras=None,
    )


def _with(
    answer: NormalizedAnswer, *, device: str | None, language_code: str | None
) -> NormalizedAnswer:
    return NormalizedAnswer(
        status=answer.status,
        error_code=answer.error_code,
        answer_text=answer.answer_text,
        model_reported=answer.model_reported,
        check_url=answer.check_url,
        observed_at=answer.observed_at,
        device=device,
        language_code=language_code,
        sources=answer.sources,
        fan_out_count=answer.fan_out_count,
        provider_extras=answer.provider_extras,
    )


def _document(body: bytes | Mapping[str, Any]) -> Mapping[str, Any]:
    if isinstance(body, bytes):
        try:
            body = json.loads(body)
        except ValueError:
            raise AiSchemaMismatchError("$", "JSON") from None
    if not isinstance(body, Mapping):
        raise AiSchemaMismatchError("$", "an object")
    cleaned: Mapping[str, Any] = scrub_text(body)
    return cleaned


def _first(value: object, path: str) -> Mapping[str, Any]:
    if not isinstance(value, list) or not value or not isinstance(value[0], Mapping):
        raise AiSchemaMismatchError(path, "a non-empty list of objects")
    first: Mapping[str, Any] = value[0]
    return first


def _text(value: object) -> str | None:
    return value if isinstance(value, str) else None


def _mappings(value: object) -> list[Mapping[str, Any]]:
    if not isinstance(value, list):
        return []
    return [element for element in value if isinstance(element, Mapping)]


def _observed_at(value: object) -> datetime | None:
    text = _text(value)
    if text is None:
        return None
    try:
        return datetime.strptime(text, "%Y-%m-%d %H:%M:%S %z")
    except ValueError:
        return None


def _fits(payload: Mapping[str, Any]) -> bool:
    return len(json.dumps(payload, ensure_ascii=False).encode()) <= EXTRAS_MAX_BYTES


def _bounded(payload: dict[str, Any]) -> dict[str, Any]:
    """The extras with their longest list halved until they fit; `{"truncated": true}` when
    that is not enough."""
    kept = {
        name: list(value) if isinstance(value, list) else value for name, value in payload.items()
    }
    lists = [name for name, value in kept.items() if isinstance(value, list)]
    while not _fits(kept):
        longest = max(lists, key=lambda name: len(kept[name]), default=None)
        if longest is None or not kept[longest]:
            return {"truncated": True}
        del kept[longest][len(kept[longest]) // 2 :]
        kept["truncated"] = True
    return kept
