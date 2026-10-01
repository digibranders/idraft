"""The URL canonicalizer, version 1 (docs/14-citation-intelligence.md section 3).

Two links canonicalize to the same string when they point at the same page. No network: redirect
wrappers are unwrapped from their parameters, and the Public Suffix List is the snapshot bundled
with the pinned `publicsuffixlist` package (private domains on), so upgrading that package is a
canonicalizer version change.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import ipaddress
import re
import string
from dataclasses import dataclass
from typing import Final, Literal
from urllib.parse import unquote, urlsplit

import idna
from publicsuffixlist import PublicSuffixList

CANONICALIZER_VERSION: Final = 1

RejectReason = Literal[
    "unsupported_scheme", "missing_host", "invalid_host", "invalid_port", "too_long"
]
UrlFlag = Literal["text_fragment_removed", "redirect_unwrapped", "unresolved_redirect"]
Scheme = Literal["http", "https"]

_PSL: Final = PublicSuffixList()
# Who runs a site is decided on ICANN suffixes only: `google.github.io` is not Google.
_ICANN_PSL: Final = PublicSuffixList(only_icann=True)
_SCHEMES: Final[dict[str, Scheme]] = {"http": "http", "https": "https"}
_DEFAULT_PORTS: Final[dict[Scheme, int]] = {"http": 80, "https": 443}
# Wrappers are unwrapped until none is left, which is what makes the output a fixed point. Each
# destination is shorter than its wrapper, so this ends; the length limit bounds the work.
_MAX_LENGTH: Final = 32 * 1024

# RFC 3986: what may stand unencoded in a path or a query; everything else is percent-encoded.
_UNRESERVED: Final = frozenset(string.ascii_letters + string.digits + "-._~")
_PATH_SAFE: Final = _UNRESERVED | frozenset("!$&'()*+,;=:@/")
_QUERY_SAFE: Final = _PATH_SAFE | frozenset("?")
# A path segment moved into a query value (youtu.be) must not split the query.
_QUERY_VALUE_SAFE: Final = _QUERY_SAFE - frozenset("&")
_DROPPED_CONTROLS: Final = str.maketrans("", "", "\t\r\n")
_HEX: Final = frozenset(string.hexdigits)

_ASCII_LABEL: Final = re.compile(r"[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?")
_NUMERIC_LABEL: Final = re.compile(r"[0-9]+|0x[0-9a-f]*")
_HTTP_PREFIX: Final = re.compile(r"https?://", re.IGNORECASE)

# Step 6, list v1.
_TRACKING_PREFIXES: Final = ("utm_",)
_TRACKING_NAMES: Final = frozenset(
    {
        "gclid",
        "gbraid",
        "wbraid",
        "dclid",
        "fbclid",
        "msclkid",
        "mc_cid",
        "mc_eid",
        "_hsenc",
        "_hsmi",
        "hsctatracking",
        "igshid",
        "srsltid",
        "yclid",
        "spm",
        "_ga",
        "_gl",
        "oly_enc_id",
        "oly_anon_id",
        "vero_id",
        "mkt_tok",
    }
)
_SI_DOMAINS: Final = frozenset({"youtube.com", "youtu.be", "spotify.com"})
_REFERRER_NAMES: Final = frozenset({"ref", "ref_src"})
_KNOWN_REFERRERS: Final = frozenset(
    {
        "producthunt",
        "hackernews",
        "hn",
        "reddit",
        "twitter",
        "facebook",
        "linkedin",
        "newsletter",
        "rss",
        "chatgpt.com",
        "perplexity",
        "perplexity.ai",
    }
)
_KNOWN_REFERRER_PREFIXES: Final = ("twsrc",)  # Twitter embeds: ref_src=twsrc^tfw

# Step 8, list v1: publishers whose AMP pages are copies of the article.
_AMP_PUBLISHERS: Final = frozenset(
    {
        "theguardian.com",
        "cnn.com",
        "bbc.com",
        "bbc.co.uk",
        "nytimes.com",
        "washingtonpost.com",
        "forbes.com",
        "businessinsider.com",
        "independent.co.uk",
        "reuters.com",
        "techcrunch.com",
        "theverge.com",
    }
)
_AMP_ON: Final = frozenset({"1", "true"})
_MOBILE_WIKIPEDIA_LABELS: Final = frozenset({"m", "mobile"})


class UrlRejectedError(ValueError):
    """The input is not an http(s) URL we can name a page by."""

    def __init__(self, reason: RejectReason, raw: str) -> None:
        super().__init__(f"{reason}: {raw[:200]!r}")
        self.reason: RejectReason = reason
        self.raw = raw


@dataclass(frozen=True, slots=True)
class Host:
    """A host as `core.domains` stores it."""

    name: str  # lowercase, punycode, no trailing dot, `www.` kept; IPv6 in brackets
    registrable_domain: str  # eTLD+1; the host itself for an IP or a bare public suffix
    public_suffix: str  # empty for an IP address
    is_ip: bool


@dataclass(frozen=True, slots=True)
class CanonicalUrl:
    url: str
    scheme: Scheme  # as observed; the hash leaves it out
    host: Host
    port: int | None  # None when it is the scheme's default
    path: str  # canonical path without the query
    query: str  # canonical query without the `?`
    url_hash: bytes  # sha256 of the URL without its scheme
    referral_tag: str | None  # the `utm_source` value, removed from the URL
    flags: frozenset[UrlFlag]


@dataclass(frozen=True, slots=True)
class _Parts:
    scheme: Scheme
    host: Host
    port: int | None
    path: str
    query: str
    fragment: str


@dataclass(frozen=True, slots=True)
class _Wrapper:
    target: str | None  # None when the wrapper is known but its destination cannot be read


def canonicalize(raw: str) -> CanonicalUrl:
    """The canonical form of an http(s) URL. Raises `UrlRejectedError` for anything else."""
    flags: set[UrlFlag] = set()
    parts = _parse(raw, raw)
    while True:
        # A wrapper can carry the text fragment its destination was linked with (href.li).
        if ":~:" in parts.fragment:
            flags.add("text_fragment_removed")
        wrapper = _wrapper(parts)
        if wrapper is None:
            break
        if wrapper.target is None:
            flags.add("unresolved_redirect")
            break
        try:
            parts = _parse(wrapper.target, raw)
        except UrlRejectedError:
            flags.add("unresolved_redirect")
            break
        flags.add("redirect_unwrapped")

    host = _desktop_wikipedia(parts.host)
    path = _remove_dot_segments(_encode(parts.path or "/", _PATH_SAFE))
    pairs = _query_pairs(parts.query)
    if host.name == "youtu.be" and (video := _single_segment(path)) is not None:
        host = _host("youtube.com")
        path = "/watch"
        video = _encode(video, _QUERY_VALUE_SAFE)
        pairs = [(name, value) for name, value in pairs if name != "v"] + [("v", video)]
    if host.registrable_domain in _AMP_PUBLISHERS:
        path = _strip_amp(path)
    path = path.rstrip("/") or "/"

    referral_tag = next(
        (unquote(value) for name, value in pairs if name.lower() == "utm_source" and value), None
    )
    kept = [
        (name, value)
        for name, value in pairs
        if name and value and not _is_noise(name, value, host.registrable_domain)
    ]
    kept.sort(key=lambda pair: pair[0])
    query = "&".join(f"{name}={value}" for name, value in kept)

    authority = host.name if parts.port is None else f"{host.name}:{parts.port}"
    rest = f"{authority}{path}?{query}" if query else f"{authority}{path}"
    return CanonicalUrl(
        url=f"{parts.scheme}://{rest}",
        scheme=parts.scheme,
        host=host,
        port=parts.port,
        path=path,
        query=query,
        url_hash=hashlib.sha256(rest.encode("ascii")).digest(),
        referral_tag=referral_tag,
        flags=frozenset(flags),
    )


def normalize_host(value: str) -> Host:
    """The host of something a person typed: a bare name (`Acme.COM.`) or a URL.

    Hosts `canonicalize` never produces are mapped as it maps them (`en.m.wikipedia.org` is
    `en.wikipedia.org`, `youtu.be` is `youtube.com`), so a rule entered with one still matches.
    """
    text = value.strip()
    if "://" not in text:
        text = f"http://{text}"
    host = _desktop_wikipedia(_parse(text, value).host)
    return _host("youtube.com") if host.name == "youtu.be" else host


def normalize_path_prefix(value: str) -> str:
    """A path prefix normalized the way canonical paths are, so the two compare directly."""
    # Tabs and newlines are dropped from URLs before they are split, so from prefixes too.
    text = value.strip().translate(_DROPPED_CONTROLS).replace("\\", "/")
    if not text or "?" in text or "#" in text:
        raise ValueError(f"a path prefix is a non-empty path with no query or fragment: {value!r}")
    if not text.startswith("/"):
        text = f"/{text}"
    return _remove_dot_segments(_encode(text, _PATH_SAFE)).rstrip("/") or "/"


def _parse(text: str, raw: str) -> _Parts:
    """Step 1: split, check the scheme, normalize host and port (step 4)."""
    text = text.strip()
    if _HTTP_PREFIX.match(text):
        # Browsers read backslashes before the query as slashes in http(s) URLs.
        cut = min((i for i in (text.find("?"), text.find("#")) if i >= 0), default=len(text))
        text = text[:cut].replace("\\", "/") + text[cut:]
    if len(text) > _MAX_LENGTH:
        raise UrlRejectedError("too_long", raw)
    try:
        split = urlsplit(text)
    except ValueError as error:  # an unbalanced or invalid bracketed IPv6 host
        raise UrlRejectedError("invalid_host", raw) from error
    scheme = _SCHEMES.get(split.scheme)
    if scheme is None:
        raise UrlRejectedError("unsupported_scheme", raw)
    host_text, port = _authority(split.netloc, scheme, raw)
    if not host_text:
        raise UrlRejectedError("missing_host", raw)
    try:
        host = _host(host_text)
    except ValueError as error:
        raise UrlRejectedError("invalid_host", raw) from error
    return _Parts(scheme, host, port, split.path, split.query, split.fragment)


def _authority(netloc: str, scheme: Scheme, raw: str) -> tuple[str, int | None]:
    """The host text and the port, without credentials; a default port is None."""
    hostport = netloc.rpartition("@")[2]
    if hostport.startswith("["):  # urlsplit has checked the brackets and what follows them
        end = hostport.find("]")
        host_text, port_text = hostport[: end + 1], hostport[end + 2 :]
    else:
        host_text, _, port_text = hostport.partition(":")
    if not port_text:
        return host_text, None
    # Leading zeros are allowed (`:000080`); the length check keeps int() off huge inputs.
    digits = port_text.lstrip("0") or "0"
    if not port_text.isascii() or not port_text.isdigit() or len(digits) > 5:
        raise UrlRejectedError("invalid_port", raw)
    port = int(digits)
    if port > 65535:
        raise UrlRejectedError("invalid_port", raw)
    return host_text, None if port == _DEFAULT_PORTS[scheme] else port


def _host(text: str) -> Host:
    """Lowercase, IDNA to punycode, no trailing dot; IP addresses in their standard form."""
    if text.startswith("["):  # urlsplit has checked the closing bracket
        ipv6 = ipaddress.IPv6Address(text[1:-1])
        if ipv6.scope_id is not None:  # a zone id names an interface on one machine
            raise ValueError("an IPv6 host has no zone id in a URL")
        name = f"[{ipv6.compressed}]"
        return Host(name=name, registrable_domain=name, public_suffix="", is_ip=True)

    text = unquote(text)
    if not text.isascii():
        try:
            text = idna.uts46_remap(text, std3_rules=False, transitional=False)
        except idna.IDNAError as error:
            raise ValueError(f"not a host name: {text!r}") from error
    text = text.lower().removesuffix(".")
    labels = [_label(label) for label in text.split(".")]
    name = ".".join(labels)
    if len(name) > 253:
        raise ValueError("a host name is at most 253 characters")
    if _NUMERIC_LABEL.fullmatch(labels[-1]):
        address = str(ipaddress.IPv4Address(name))  # raises ValueError for 1.2.3.999 and the like
        return Host(name=address, registrable_domain=address, public_suffix="", is_ip=True)
    return Host(
        name=name,
        registrable_domain=_PSL.privatesuffix(name) or name,
        public_suffix=_PSL.publicsuffix(name) or name,
        is_ip=False,
    )


def _label(label: str) -> str:
    if label.isascii():
        if not _ASCII_LABEL.fullmatch(label):
            raise ValueError(f"not a host label: {label!r}")
        return label
    try:
        return idna.alabel(label).decode("ascii")
    except (idna.IDNAError, UnicodeError) as error:
        raise ValueError(f"not a host label: {label!r}") from error


def _wrapper(parts: _Parts) -> _Wrapper | None:
    """Step 2: a known redirect wrapper and its destination, read from its parameters."""
    host = parts.host
    path = parts.path
    if (_ICANN_PSL.privatesuffix(host.name) or "").split(".", 1)[0] == "google":
        if host.name == "vertexaisearch.cloud.google.com":
            # Grounding redirects carry an opaque token, never the destination.
            if path.startswith("/grounding-api-redirect/"):
                return _Wrapper(None)
            return None
        if path in ("/url", "/goto"):
            return _Wrapper(_first_url(parts.query, ("q", "url")))
        return None
    if host.registrable_domain == "bing.com" and path == "/ck/a":
        return _Wrapper(_bing_target(parts.query))
    if host.registrable_domain == "facebook.com" and path == "/l.php":
        return _Wrapper(_first_url(parts.query, ("u",)))
    if host.name == "out.reddit.com":
        return _Wrapper(_first_url(parts.query, ("url",)))
    if host.name == "href.li":
        target = parts.query if _HTTP_PREFIX.match(parts.query) else unquote(parts.query)
        return _Wrapper(target if _HTTP_PREFIX.match(target) else None)
    return None


def _first_url(query: str, names: tuple[str, ...]) -> str | None:
    """The first http(s) value of the first name that has one, in the order names are given."""
    pairs = _raw_pairs(query)
    for wanted in names:
        for name, value in pairs:
            if name == wanted and _HTTP_PREFIX.match(target := unquote(value)):
                return target
    return None


def _bing_target(query: str) -> str | None:
    """Bing's `u` is `a1` and the destination in unpadded URL-safe base64."""
    for name, value in _raw_pairs(query):
        encoded = unquote(value)
        if name != "u" or not encoded.startswith("a1"):
            continue
        body = encoded[2:]
        try:
            # A destination that is not http(s) is refused when it is parsed.
            return base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)).decode("utf-8")
        except (binascii.Error, ValueError):
            return None
    return None


def _raw_pairs(query: str) -> list[tuple[str, str]]:
    """Name and value as they appear, split on `&` and the first `=`, nothing decoded."""
    pairs = []
    for item in query.split("&"):
        name, _, value = item.partition("=")
        pairs.append((name, value))
    return pairs


def _query_pairs(query: str) -> list[tuple[str, str]]:
    """Step 6 input: each name and value with its percent-encoding normalized."""
    return [
        (_encode(name, _QUERY_SAFE), _encode(value, _QUERY_SAFE))
        for name, value in _raw_pairs(query)
    ]


def _is_noise(name: str, value: str, registrable_domain: str) -> bool:
    """A tracking parameter (step 6) or an AMP switch on a known publisher (step 8)."""
    key = unquote(name).lower()
    if key.startswith(_TRACKING_PREFIXES) or key in _TRACKING_NAMES:
        return True
    if key == "si":
        return registrable_domain in _SI_DOMAINS
    if key in _REFERRER_NAMES:
        tag = unquote(value).lower()
        return tag in _KNOWN_REFERRERS or tag.startswith(_KNOWN_REFERRER_PREFIXES)
    if key == "amp":
        return registrable_domain in _AMP_PUBLISHERS and unquote(value).lower() in _AMP_ON
    return False


def _encode(text: str, safe: frozenset[str]) -> str:
    """RFC 3986 section 6.2.2: decode unreserved escapes, uppercase the others, encode the rest."""
    out: list[str] = []
    index = 0
    while index < len(text):
        char = text[index]
        escape = text[index + 1 : index + 3]
        if char == "%" and len(escape) == 2 and set(escape) <= _HEX:
            decoded = chr(int(escape, 16))
            out.append(decoded if decoded in _UNRESERVED else f"%{escape.upper()}")
            index += 3
            continue
        if char in safe:
            out.append(char)
        else:
            out.extend(f"%{byte:02X}" for byte in char.encode("utf-8", "surrogatepass"))
        index += 1
    return "".join(out)


def _remove_dot_segments(path: str) -> str:
    """RFC 3986 section 5.2.4 on an absolute path; `..` never climbs above the root."""
    segments = path.split("/")
    output: list[str] = []
    last = len(segments) - 1
    for index, segment in enumerate(segments):
        if segment in (".", ".."):
            if segment == ".." and len(output) > 1:
                output.pop()
            if index == last:
                output.append("")
            continue
        output.append(segment)
    return "/".join(output)


def _desktop_wikipedia(host: Host) -> Host:
    """`en.m.wikipedia.org` and `en.mobile.wikipedia.org` are `en.wikipedia.org`."""
    if host.registrable_domain != "wikipedia.org":
        return host
    labels = host.name.split(".")
    if len(labels) < 3 or labels[-3] not in _MOBILE_WIKIPEDIA_LABELS:
        return host
    while len(labels) > 2 and labels[-3] in _MOBILE_WIKIPEDIA_LABELS:
        del labels[-3]
    return _host(".".join(labels))


def _single_segment(path: str) -> str | None:
    segments = path.strip("/").split("/")
    return segments[0] if len(segments) == 1 and segments[0] else None


def _strip_amp(path: str) -> str:
    """`/story/amp` and `/story/amp/` are `/story`."""
    segments = path.split("/")
    while len(segments) > 1 and segments[-1] in ("amp", ""):
        segments.pop()
    return "/".join(segments) or "/"
