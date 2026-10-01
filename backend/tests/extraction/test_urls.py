"""The URL canonicalizer v1 (docs/14-citation-intelligence.md section 3)."""

from __future__ import annotations

import base64
import hashlib
from urllib.parse import quote

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from sightline.extraction.urls import (
    CANONICALIZER_VERSION,
    UrlRejectedError,
    canonicalize,
    normalize_host,
    normalize_path_prefix,
)


def _url(raw: str) -> str:
    return canonicalize(raw).url


# Doc 14 section 3.2, row by row.


def test_vector_tracking_text_fragment_and_query_order() -> None:
    result = canonicalize(
        "https://www.Example.com/Guide/?utm_source=chatgpt.com&b=2&a=1#:~:text=crm"
    )
    assert result.url == "https://www.example.com/Guide?a=1&b=2"
    assert result.host.registrable_domain == "example.com"
    assert result.referral_tag == "chatgpt.com"
    assert result.flags == frozenset({"text_fragment_removed"})


def test_vector_google_redirect() -> None:
    result = canonicalize("https://www.google.com/url?q=https%3A%2F%2Facme.io%2Fpricing&sa=D")
    assert result.url == "https://acme.io/pricing"
    assert result.host.registrable_domain == "acme.io"
    assert result.referral_tag is None
    assert result.flags == frozenset({"redirect_unwrapped"})


def test_vector_mobile_wikipedia() -> None:
    result = canonicalize("https://en.m.wikipedia.org/wiki/Customer_relationship_management")
    assert result.url == "https://en.wikipedia.org/wiki/Customer_relationship_management"
    assert result.host.registrable_domain == "wikipedia.org"
    assert result.flags == frozenset()


def test_vector_private_suffix() -> None:
    result = canonicalize("https://alice.github.io/post/")
    assert result.url == "https://alice.github.io/post"
    assert result.host.registrable_domain == "alice.github.io"
    assert result.host.public_suffix == "github.io"


def test_vector_port_case_and_dot_segments() -> None:
    result = canonicalize("http://ACME.co.uk:80/a/./b/../c")
    assert result.url == "http://acme.co.uk/a/c"
    assert result.host.registrable_domain == "acme.co.uk"


def test_vector_youtu_be() -> None:
    result = canonicalize("https://youtu.be/dQw4w9WgXcQ?si=abc")
    assert result.url == "https://youtube.com/watch?v=dQw4w9WgXcQ"
    assert result.host.registrable_domain == "youtube.com"


# Step 1: parse, reject what is not a web page.


@pytest.mark.parametrize(
    ("raw", "reason"),
    [
        ("javascript:alert(1)", "unsupported_scheme"),
        ("mailto:sales@acme.com", "unsupported_scheme"),
        ("ftp://acme.com/file", "unsupported_scheme"),
        ("data:text/html,hi", "unsupported_scheme"),
        ("//acme.com/pricing", "unsupported_scheme"),
        ("acme.com/pricing", "unsupported_scheme"),
        ("", "unsupported_scheme"),
        ("https:///pricing", "missing_host"),
        ("https://", "missing_host"),
        ("https://acme.com:http/", "invalid_port"),
        ("https://acme.com:70000/", "invalid_port"),
        ("https://exa mple.com/", "invalid_host"),
        ("https://a..b.com/", "invalid_host"),
        ("https://-acme.com/", "invalid_host"),
        ("https://1.2.3.999/", "invalid_host"),
        ("https://[::zz]/", "invalid_host"),
        ("https://[::1]x/", "invalid_host"),
        ("http://[fe80::1%25eth0]/x", "invalid_host"),
        ("http://[fe80::1%25é]/x", "invalid_host"),
        ("https://acme.com:" + "9" * 5000 + "/", "invalid_port"),
        ("https://acme.com:٨٠/", "invalid_port"),
        ("https://1.2.3.0x4/", "invalid_host"),
        ("https://acme.com/" + "a" * 32 * 1024, "too_long"),
        ("https://�.com/", "invalid_host"),
        ("https://☃.net/", "invalid_host"),
        ("https://a‍b.de/", "invalid_host"),
        (f"https://{'a' * 60}.{'b' * 60}.{'c' * 60}.{'d' * 60}.{'e' * 10}.com/", "invalid_host"),
    ],
)
def test_what_is_not_an_http_url_is_rejected_with_a_reason(raw: str, reason: str) -> None:
    with pytest.raises(UrlRejectedError) as caught:
        canonicalize(raw)
    assert caught.value.reason == reason
    assert caught.value.raw == raw


def test_surrounding_whitespace_and_embedded_newlines_are_ignored() -> None:
    assert _url("  https://acme.com/pri\ncing\t ") == "https://acme.com/pricing"


def test_credentials_are_never_kept() -> None:
    assert _url("https://user:secret@acme.com/x") == "https://acme.com/x"
    assert _url("https://user:p%40ss@word@acme.com/x") == "https://acme.com/x"


def test_leading_zeros_in_a_port_are_allowed() -> None:
    assert _url("http://acme.com:000080/x") == "http://acme.com/x"


def test_idna_uses_the_non_transitional_mapping_and_allows_underscores() -> None:
    assert canonicalize("https://faß.de/").host.name == "xn--fa-hia.de"
    assert canonicalize("https://my_app.bücher.de/").host.name == "my_app.xn--bcher-kva.de"


# Step 2: redirectors, unwrapped without the network.


def _bing(target: str) -> str:
    encoded = base64.urlsafe_b64encode(target.encode()).decode().rstrip("=")
    return f"https://www.bing.com/ck/a?!&&p=abc&u=a1{encoded}&ntb=1"


@pytest.mark.parametrize(
    "raw",
    [
        "https://www.google.com/url?q=https%3A%2F%2Facme.io%2Fpricing&sa=D",
        "https://www.google.com/url?sa=t&url=https%3A%2F%2Facme.io%2Fpricing",
        "https://www.google.co.uk/url?q=https://acme.io/pricing",
        "https://www.google.com/goto?url=https%3A%2F%2Facme.io%2Fpricing",
        _bing("https://acme.io/pricing"),
        "https://l.facebook.com/l.php?u=https%3A%2F%2Facme.io%2Fpricing&h=AT0",
        "https://out.reddit.com/t3_abc?url=https%3A%2F%2Facme.io%2Fpricing&token=x",
        "https://href.li/?https://acme.io/pricing",
    ],
)
def test_each_redirector_is_unwrapped(raw: str) -> None:
    result = canonicalize(raw)
    assert result.url == "https://acme.io/pricing"
    assert "redirect_unwrapped" in result.flags


def test_nested_redirectors_are_unwrapped_to_the_end() -> None:
    inner = "https://l.facebook.com/l.php?u=" + quote("https://acme.io/pricing", safe="")
    assert _url("https://www.google.com/url?q=" + quote(inner, safe="")) == (
        "https://acme.io/pricing"
    )


def test_tracking_on_the_target_is_read_after_unwrapping() -> None:
    target = "https://acme.io/pricing?utm_source=perplexity&plan=pro"
    result = canonicalize("https://www.google.com/url?q=" + quote(target, safe=""))
    assert result.url == "https://acme.io/pricing?plan=pro"
    assert result.referral_tag == "perplexity"


@pytest.mark.parametrize(
    "raw",
    [
        "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AbF9wXE",
        "https://www.google.com/url?q=not-a-url",
        "https://www.google.com/url?q=javascript%3Aalert(1)",
        "https://www.bing.com/ck/a?u=a1%%%",
        "https://l.facebook.com/l.php?h=AT0",
        "https://www.google.com/url?q=https%3A%2F%2Fexa%20mple.com%2F",
        "https://www.bing.com/ck/a?u=" + _bing("javascript:alert(1)").rpartition("u=")[2],
        "https://www.bing.com/ck/a?u=b1aHR0cHM6Ly9hY21lLmlv",
        "https://www.bing.com/ck/a?u=a1A",
        "https://www.bing.com/ck/a?u=a1__4",
        "https://href.li/?not-a-url",
    ],
)
def test_an_undecodable_redirector_is_kept_and_flagged(raw: str) -> None:
    result = canonicalize(raw)
    assert result.flags == frozenset({"unresolved_redirect"})
    assert canonicalize(result.url).url == result.url


def test_wrappers_are_unwrapped_however_deep() -> None:
    """Stopping at any depth would leave output the next call unwraps further."""
    raw = "https://acme.io/pricing"
    for _ in range(8):
        raw = "https://www.google.com/url?q=" + quote(raw, safe="")
    result = canonicalize(raw)
    assert result.url == "https://acme.io/pricing"
    assert result.flags == frozenset({"redirect_unwrapped"})


def test_a_url_over_32_kib_is_refused() -> None:
    """The limit bounds unwrapping, which reparses each level."""
    with pytest.raises(UrlRejectedError) as caught:
        canonicalize("https://acme.com/" + "a" * 32 * 1024)
    assert caught.value.reason == "too_long"
    assert canonicalize("https://acme.com/" + "a" * 32_000).host.name == "acme.com"


def test_google_on_a_private_suffix_is_not_google() -> None:
    """Anyone can publish `google.github.io/url?q=...`; it must not name another page."""
    for host in ("google.github.io", "google.netlify.app", "google.blogspot.com"):
        raw = f"https://{host}/url?q=https%3A%2F%2Fevil.io%2F"
        assert canonicalize(raw).host.name == host


def test_google_reads_q_before_url() -> None:
    raw = "https://www.google.com/url?url=https%3A%2F%2Fa.io%2F&q=https%3A%2F%2Fb.io%2F"
    assert _url(raw) == "https://b.io/"


def test_bing_without_www_and_an_encoded_href_li_target_are_unwrapped() -> None:
    assert _url(_bing("https://acme.io/a").replace("www.bing.com", "bing.com")) == (
        "https://acme.io/a"
    )
    assert _url("https://href.li/?https%3A%2F%2Facme.io%2Fa") == "https://acme.io/a"


def test_a_text_fragment_on_the_wrapper_is_flagged() -> None:
    result = canonicalize("https://href.li/?https://acme.io/a#:~:text=crm")
    assert result.url == "https://acme.io/a"
    assert result.flags == frozenset({"redirect_unwrapped", "text_fragment_removed"})


def test_other_vertex_pages_are_not_wrappers() -> None:
    assert canonicalize("https://vertexaisearch.cloud.google.com/docs").flags == frozenset()


def test_a_google_page_that_is_not_a_redirector_is_left_alone() -> None:
    result = canonicalize("https://www.google.com/search?q=crm")
    assert result.url == "https://www.google.com/search?q=crm"
    assert result.flags == frozenset()


# Steps 3 and 4: scheme and host.


def test_the_scheme_is_kept_as_observed_but_the_hash_ignores_it() -> None:
    plain = canonicalize("HTTP://acme.com/a")
    secure = canonicalize("https://acme.com/a")
    assert plain.url == "http://acme.com/a"
    assert plain.scheme == "http"
    assert plain.url_hash == secure.url_hash
    assert plain.url_hash == hashlib.sha256(b"acme.com/a").digest()


def test_international_hosts_become_punycode() -> None:
    result = canonicalize("https://Bücher.DE/über")
    assert result.url == "https://xn--bcher-kva.de/%C3%BCber"
    assert result.host.registrable_domain == "xn--bcher-kva.de"


def test_a_trailing_dot_on_the_host_is_removed() -> None:
    assert _url("https://acme.com./x") == "https://acme.com/x"


def test_default_ports_are_dropped_and_others_kept() -> None:
    assert _url("https://acme.com:443/x") == "https://acme.com/x"
    assert _url("http://acme.com:80/x") == "http://acme.com/x"
    assert _url("https://acme.com:80/x") == "https://acme.com:80/x"
    assert canonicalize("https://acme.com:8443/x").port == 8443


def test_www_is_kept_in_the_host_and_grouped_by_registrable_domain() -> None:
    result = canonicalize("https://WWW.acme.com/x")
    assert result.host.name == "www.acme.com"
    assert result.host.registrable_domain == "acme.com"
    assert result.host.public_suffix == "com"


@pytest.mark.parametrize(
    ("raw", "host"),
    [
        ("http://192.168.0.1:8080/x", "192.168.0.1"),
        ("http://[2001:DB8::1]/x", "[2001:db8::1]"),
        ("http://[::FFFF:1.2.3.4]/x", "[::ffff:1.2.3.4]"),
    ],
)
def test_ip_hosts_are_their_own_registrable_domain(raw: str, host: str) -> None:
    result = canonicalize(raw)
    assert result.host.name == host
    assert result.host.registrable_domain == host
    assert result.host.public_suffix == ""
    assert result.host.is_ip


def test_a_host_that_is_itself_a_public_suffix_is_its_own_registrable_domain() -> None:
    result = canonicalize("https://github.io/")
    assert result.host.registrable_domain == "github.io"
    assert result.host.public_suffix == "github.io"


# Step 5: fragments.


def test_a_plain_fragment_is_removed_without_a_flag() -> None:
    result = canonicalize("https://acme.com/docs#install")
    assert result.url == "https://acme.com/docs"
    assert result.flags == frozenset()


# Step 6: tracking parameters.

TRACKING = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "utm_id",
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
    "hsCtaTracking",
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
]


@pytest.mark.parametrize("name", TRACKING)
def test_each_tracking_parameter_is_removed(name: str) -> None:
    assert _url(f"https://acme.com/a?{name}=x1&plan=pro") == "https://acme.com/a?plan=pro"


def test_tracking_names_match_whatever_their_case_or_encoding() -> None:
    assert _url("https://acme.com/a?UTM_Medium=x&utm%5Fcampaign=y") == "https://acme.com/a"


@pytest.mark.parametrize(
    "host", ["www.youtube.com", "music.youtube.com", "youtu.be", "open.spotify.com"]
)
def test_si_is_removed_on_youtube_and_spotify(host: str) -> None:
    assert "si=" not in _url(f"https://{host}/watch?v=abc&si=xyz")


def test_si_is_kept_elsewhere() -> None:
    assert _url("https://acme.com/a?si=xyz") == "https://acme.com/a?si=xyz"


@pytest.mark.parametrize("name", ["ref", "ref_src"])
def test_ref_is_removed_only_when_its_value_is_a_known_referrer(name: str) -> None:
    assert _url(f"https://acme.com/a?{name}=producthunt") == "https://acme.com/a"
    assert _url(f"https://acme.com/a?{name}=ProductHunt") == "https://acme.com/a"
    assert _url(f"https://acme.com/a?{name}=main") == f"https://acme.com/a?{name}=main"


def test_a_twitter_embed_ref_src_is_removed() -> None:
    assert _url("https://acme.com/a?ref_src=twsrc%5Etfw") == "https://acme.com/a"


def test_the_first_non_empty_utm_source_is_the_referral_tag() -> None:
    result = canonicalize("https://acme.com/a?utm_source=&utm_source=chatgpt.com&utm_source=b")
    assert result.referral_tag == "chatgpt.com"
    assert canonicalize("https://acme.com/a?utm_medium=cpc").referral_tag is None


def test_remaining_parameters_are_sorted_by_name_and_empty_ones_dropped() -> None:
    assert _url("https://acme.com/a?z=1&a=&b&m=2&a=3") == "https://acme.com/a?a=3&m=2&z=1"


def test_repeated_parameters_keep_their_order() -> None:
    assert _url("https://acme.com/a?tag=b&x=1&tag=a") == "https://acme.com/a?tag=b&tag=a&x=1"


def test_query_encoding_is_normalized_like_the_path() -> None:
    assert _url("https://acme.com/a?q=%7euser%2fx&w=a b") == (
        "https://acme.com/a?q=~user%2Fx&w=a%20b"
    )


# Step 7: path.


def test_unreserved_characters_are_decoded_and_hex_is_uppercased() -> None:
    assert _url("https://acme.com/%7Euser/%2fdocs/%e2%82%ac") == (
        "https://acme.com/~user/%2Fdocs/%E2%82%AC"
    )


def test_encoded_dot_segments_are_removed() -> None:
    assert _url("https://acme.com/a/%2E%2e/b") == "https://acme.com/b"


def test_dot_segments_cannot_climb_above_the_root() -> None:
    assert _url("https://acme.com/../../a") == "https://acme.com/a"


def test_characters_a_url_cannot_hold_are_percent_encoded() -> None:
    assert _url('https://acme.com/a b/"q"/{x}') == "https://acme.com/a%20b/%22q%22/%7Bx%7D"


def test_a_lone_percent_sign_is_encoded() -> None:
    assert _url("https://acme.com/100%/x") == "https://acme.com/100%25/x"


def test_backslashes_are_path_separators() -> None:
    assert _url("https://acme.com\\a\\b") == "https://acme.com/a/b"
    # Not in the query.
    assert _url("https://acme.com/a?q=x\\y") == "https://acme.com/a?q=x%5Cy"


def test_a_short_escape_at_the_end_is_a_percent_sign() -> None:
    assert _url("https://acme.com/a%a") == "https://acme.com/a%25a"


def test_a_lone_surrogate_is_encoded_as_its_code_unit() -> None:
    assert _url("https://acme.com/a\ud800") == "https://acme.com/a%ED%A0%80"


def test_an_empty_path_becomes_the_root() -> None:
    assert _url("https://acme.com") == "https://acme.com/"
    assert _url("https://acme.com?b=1") == "https://acme.com/?b=1"


def test_trailing_slashes_are_removed_except_on_the_root() -> None:
    assert _url("https://acme.com/") == "https://acme.com/"
    assert _url("https://acme.com/a/") == "https://acme.com/a"
    assert _url("https://acme.com/a//") == "https://acme.com/a"


def test_the_path_is_the_canonical_path_without_the_query() -> None:
    assert canonicalize("https://acme.com/a/?b=1").path == "/a"


# Step 8: known equivalents.


@pytest.mark.parametrize(
    ("raw", "url"),
    [
        ("https://en.m.wikipedia.org/wiki/CRM", "https://en.wikipedia.org/wiki/CRM"),
        ("https://de.mobile.wikipedia.org/wiki/CRM", "https://de.wikipedia.org/wiki/CRM"),
        ("https://m.wikipedia.org/", "https://wikipedia.org/"),
        ("https://en.m.mobile.wikipedia.org/wiki/CRM", "https://en.wikipedia.org/wiki/CRM"),
        ("https://en.m.wiktionary.org/wiki/crm", "https://en.m.wiktionary.org/wiki/crm"),
    ],
)
def test_mobile_wikipedia_maps_to_desktop(raw: str, url: str) -> None:
    assert _url(raw) == url


@pytest.mark.parametrize(
    ("raw", "url"),
    [
        ("https://www.theguardian.com/world/story/amp", "https://www.theguardian.com/world/story"),
        ("https://www.theguardian.com/world/story/amp/", "https://www.theguardian.com/world/story"),
        ("https://www.theguardian.com/story/amp//amp", "https://www.theguardian.com/story"),
        ("https://www.theguardian.com/amp", "https://www.theguardian.com/"),
        ("https://edition.cnn.com/story?amp=1&x=2", "https://edition.cnn.com/story?x=2"),
        ("https://edition.cnn.com/story?amp=TRUE", "https://edition.cnn.com/story"),
        ("https://edition.cnn.com/story?amp=0", "https://edition.cnn.com/story?amp=0"),
        ("https://acme.com/products/amp", "https://acme.com/products/amp"),
        ("https://acme.com/a?amp=1", "https://acme.com/a?amp=1"),
    ],
)
def test_amp_maps_to_the_article_on_known_publishers_only(raw: str, url: str) -> None:
    assert _url(raw) == url


def test_youtu_be_keeps_its_other_parameters() -> None:
    assert _url("http://youtu.be/abc123?t=42&si=x") == "http://youtube.com/watch?t=42&v=abc123"


def test_youtu_be_replaces_a_v_parameter_already_there() -> None:
    assert _url("https://youtu.be/abc?v=zzz") == "https://youtube.com/watch?v=abc"


def test_a_youtu_be_id_cannot_split_the_query() -> None:
    once = canonicalize("https://youtu.be/a&b=c")
    assert once.url == "https://youtube.com/watch?v=a%26b=c"
    assert canonicalize(once.url).url == once.url


def test_youtu_be_without_a_video_is_left_alone() -> None:
    assert _url("https://youtu.be/") == "https://youtu.be/"


# Properties.

hosts = st.sampled_from(
    [
        "acme.com",
        "WWW.Acme.co.uk",
        "en.m.wikipedia.org",
        "youtu.be",
        "www.youtube.com",
        "alice.github.io",
        "www.theguardian.com",
        "192.168.0.1",
        "Bücher.de",
        "www.google.com",
    ]
)
segments = st.lists(
    st.sampled_from(["a", "B", ".", "..", "", "amp", "%7e", "%2F", "%2e", "ü", "a b", "%", "x%41"]),
    max_size=5,
)
params = st.lists(
    st.tuples(
        st.sampled_from(["utm_source", "si", "ref", "a", "B", "amp", "q", "url", "v", ""]),
        st.sampled_from(["", "1", "x", "producthunt", "https://acme.io/a?b=1", "%7e", "a b"]),
    ),
    max_size=5,
)


@given(
    scheme=st.sampled_from(["http", "https", "HTTPS"]),
    host=hosts,
    path=segments,
    query=params,
    fragment=st.sampled_from(["", "#top", "#:~:text=crm"]),
)
def test_canonicalizing_a_canonical_url_changes_nothing(
    scheme: str,
    host: str,
    path: list[str],
    query: list[tuple[str, str]],
    fragment: str,
) -> None:
    raw = f"{scheme}://{host}/{'/'.join(path)}"
    if query:
        raw += "?" + "&".join(f"{name}={quote(value)}" for name, value in query)
    once = canonicalize(raw + fragment)
    twice = canonicalize(once.url)
    assert twice.url == once.url
    assert twice.url_hash == once.url_hash
    assert twice.host == once.host


@settings(max_examples=500)
@given(
    prefix=st.sampled_from(["https://", "http://", "https://www.google.com/url?q=", ""]),
    rest=st.text(max_size=80),
)
def test_any_text_is_refused_or_canonicalized_to_a_fixed_point(prefix: str, rest: str) -> None:
    try:
        once = canonicalize(prefix + rest)
    except UrlRejectedError:
        return
    twice = canonicalize(once.url)
    assert (twice.url, twice.url_hash, twice.host) == (once.url, once.url_hash, once.host)


def test_the_version_is_one() -> None:
    assert CANONICALIZER_VERSION == 1


# Hosts typed by a person (entity domains, a project's primary domain).


@pytest.mark.parametrize(
    ("value", "host", "registrable"),
    [
        ("Acme.COM.", "acme.com", "acme.com"),
        ("https://www.acme.com/x", "www.acme.com", "acme.com"),
        ("  docs.acme.co.uk ", "docs.acme.co.uk", "acme.co.uk"),
        ("acme.com/pricing", "acme.com", "acme.com"),
        ("acme.com:8080", "acme.com", "acme.com"),
        ("Bücher.de", "xn--bcher-kva.de", "xn--bcher-kva.de"),
        ("medium.com/@acme", "medium.com", "medium.com"),
        # Mapped as canonicalize maps them, so a rule entered this way still matches.
        ("en.m.wikipedia.org", "en.wikipedia.org", "wikipedia.org"),
        ("https://youtu.be/abc", "youtube.com", "youtube.com"),
    ],
)
def test_a_host_is_read_from_a_bare_name_or_a_url(value: str, host: str, registrable: str) -> None:
    result = normalize_host(value)
    assert result.name == host
    assert result.registrable_domain == registrable


@pytest.mark.parametrize("value", ["", "   ", "ftp://acme.com", "exa mple.com", "https://"])
def test_a_host_that_cannot_be_read_is_rejected(value: str) -> None:
    with pytest.raises(UrlRejectedError):
        normalize_host(value)


@pytest.mark.parametrize(
    ("value", "prefix"),
    [
        ("/@acme", "/@acme"),
        ("/@acme/", "/@acme"),
        ("@acme", "/@acme"),
        ("/Acme/./docs/../blog", "/Acme/blog"),
        ("/%7eacme", "/~acme"),
        ("/", "/"),
        ("/ac\nme", "/acme"),
    ],
)
def test_a_path_prefix_is_normalized_like_a_canonical_path(value: str, prefix: str) -> None:
    assert normalize_path_prefix(value) == prefix


@pytest.mark.parametrize("value", ["", "/a?b=1", "/a#b"])
def test_a_path_prefix_with_a_query_or_fragment_is_refused(value: str) -> None:
    with pytest.raises(ValueError, match="path prefix"):
        normalize_path_prefix(value)
