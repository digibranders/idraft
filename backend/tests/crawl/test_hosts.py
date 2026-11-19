import pytest

from idraft.crawl.hosts import is_site_host, site_hosts


def test_the_site_is_its_host_with_and_without_www_and_the_allowed_subdomains() -> None:
    assert site_hosts("www.Example.com", ["Blog.example.com"]) == {
        "example.com",
        "www.example.com",
        "blog.example.com",
    }


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("example.com", True),
        ("www.example.com", True),
        ("blog.example.com", True),
        ("a.b.example.com", True),
        ("notexample.com", False),
        ("example.com.evil.net", False),
        ("blog.other.com", False),
    ],
)
def test_a_host_belongs_to_the_site_when_it_is_the_site_or_under_it(
    name: str, expected: bool
) -> None:
    assert is_site_host("www.example.com", name) is expected
    assert is_site_host("example.com", name) is expected
