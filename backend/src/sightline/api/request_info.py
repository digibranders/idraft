"""Where a request came from, for throttling and the audit log."""

from __future__ import annotations

import ipaddress
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Request

# What the audit log keeps of a user agent; ops.record_auth_event cuts at the same length.
USER_AGENT_MAX = 512


@dataclass(frozen=True, slots=True)
class RequestInfo:
    ip: str | None
    user_agent: str | None
    request_id: str | None

    @property
    def throttle_ip(self) -> str:
        return self.ip or "unknown"


def request_info(
    *, client_host: str | None, user_agent: str | None, request_id: str | None
) -> RequestInfo:
    """Build RequestInfo from what the server reports. An address that is not an IP is dropped,
    and a long user agent is cut."""
    ip: str | None = None
    if client_host is not None:
        try:
            ip = str(ipaddress.ip_address(client_host))
        except ValueError:
            ip = None
    if user_agent is not None:
        user_agent = user_agent[:USER_AGENT_MAX]
    return RequestInfo(ip=ip, user_agent=user_agent, request_id=request_id)


def get_request_info(request: Request) -> RequestInfo:
    return request_info(
        client_host=None if request.client is None else request.client.host,
        user_agent=request.headers.get("user-agent"),
        request_id=getattr(request.state, "request_id", None),
    )


Info = Annotated[RequestInfo, Depends(get_request_info)]
