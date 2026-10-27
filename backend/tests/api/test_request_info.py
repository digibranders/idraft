"""What a request reports about where it came from."""

from idraft.api.request_info import USER_AGENT_MAX, request_info


def test_an_address_that_is_not_an_ip_is_dropped() -> None:
    assert request_info(client_host="203.0.113.7", user_agent=None, request_id=None).ip == (
        "203.0.113.7"
    )
    assert request_info(client_host="testclient", user_agent=None, request_id=None).ip is None
    assert request_info(client_host=None, user_agent=None, request_id=None).throttle_ip == "unknown"


def test_a_long_user_agent_is_cut_to_what_the_audit_log_keeps() -> None:
    info = request_info(client_host=None, user_agent="a" * 60_000, request_id="req_1")
    assert info.user_agent == "a" * USER_AGENT_MAX
    assert request_info(client_host=None, user_agent="curl/8", request_id=None).user_agent == (
        "curl/8"
    )
