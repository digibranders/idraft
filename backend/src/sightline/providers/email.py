"""Transactional email: the port and its senders.

The application depends on `EmailSender` only. `console` prints messages for local development;
`resend` posts them to Resend. Another provider is another class here and one more setting value.
"""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass
from typing import Literal, Protocol

import httpx

RESEND_URL = "https://api.resend.com/emails"
SEND_TIMEOUT_SECONDS = 10.0
_ADDRESS = re.compile(r"[^\s<>@,;]+@[^\s<>@,;]+")
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


@dataclass(frozen=True, slots=True)
class EmailMessage:
    """One plain-text message to one recipient."""

    to: str
    subject: str
    text: str

    def __post_init__(self) -> None:
        # Both become headers. A line break in either would let the value add a header of its own.
        if not _ADDRESS.fullmatch(self.to):
            raise ValueError("to must be one email address")
        if not self.subject or _CONTROL.search(self.subject):
            raise ValueError("subject must be one non-empty line")


class EmailSendError(Exception):
    """The provider did not accept the message. Never carries the key, the body or the recipient."""


class EmailSender(Protocol):
    async def send(self, message: EmailMessage) -> None: ...


class ConsoleEmailSender:
    """Writes the message to stderr. For local development, where there is no mailbox to open."""

    async def send(self, message: EmailMessage) -> None:
        sys.stderr.write(
            f"\n--- email ---\nTo: {message.to}\nSubject: {message.subject}\n\n{message.text}\n"
            "--- end ---\n"
        )


class ResendEmailSender:
    def __init__(self, client: httpx.AsyncClient, *, api_key: str, sender: str) -> None:
        self._client = client
        self._api_key = api_key
        self._sender = sender

    async def send(self, message: EmailMessage) -> None:
        try:
            response = await self._client.post(
                RESEND_URL,
                headers={"Authorization": f"Bearer {self._api_key}"},
                json={
                    "from": self._sender,
                    "to": [message.to],
                    "subject": message.subject,
                    "text": message.text,
                },
                timeout=SEND_TIMEOUT_SECONDS,
            )
        except httpx.HTTPError as error:
            # `from None`: the original may quote request details.
            raise EmailSendError(
                f"the email provider could not be reached: {type(error).__name__}"
            ) from None
        if not response.is_success:
            raise EmailSendError(f"the email provider answered {response.status_code}")


def build_email_sender(
    client: httpx.AsyncClient,
    *,
    provider: Literal["console", "resend"],
    api_key: str | None,
    sender: str,
) -> EmailSender:
    """The sender for a process. Takes plain values so this package stays free of settings."""
    if provider == "resend":
        if not api_key:
            raise ValueError("the resend email provider needs an API key")
        return ResendEmailSender(client, api_key=api_key, sender=sender)
    return ConsoleEmailSender()
