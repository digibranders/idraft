from idraft.crawl.hosts import site_hosts


def test_the_site_is_its_host_with_and_without_www_and_the_allowed_subdomains() -> None:
    assert site_hosts("www.Example.com", ["Blog.example.com"]) == {
        "example.com",
        "www.example.com",
        "blog.example.com",
    }
