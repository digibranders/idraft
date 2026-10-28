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
BREVO_URL = "https://api.brevo.com/v3/smtp/email"
# "Name <address>" as the settings write it; a bare address is accepted too.
SENDER_PATTERN = re.compile(
    r"\s*(?:(?P<name>[^<>]*?)\s*<(?P<bracketed>[^<>]+)>|(?P<bare>[^<>\s]+))\s*"
)
SEND_TIMEOUT_SECONDS = 10.0
ADDRESS_MAX = 254
ADDRESS_PATTERN = re.compile(r"[^\s<>@,;\x00-\x1f\x7f]+@[^\s<>@,;\x00-\x1f\x7f]+")
_CONTROL = re.compile(r"[\x00-\x1f\x7f-\x9f]")


@dataclass(frozen=True, slots=True)
class EmailMessage:
    """One plain-text message to one recipient."""

    to: str
    subject: str
    text: str

    def __post_init__(self) -> None:
        # Both become headers. A line break in either would let the value add a header of its own.
        if len(self.to) > ADDRESS_MAX or not ADDRESS_PATTERN.fullmatch(self.to):
            raise ValueError("to must be one email address")
        # splitlines knows every line break Unicode has, including U+2028 and U+0085.
        one_line = len(self.subject.splitlines()) == 1 and not _CONTROL.search(self.subject)
        if not self.subject.strip() or not one_line:
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
                # Whatever the client's default: a redirect would replay the recipient and the
                # token link to another host.
                follow_redirects=False,
            )
        except httpx.HTTPError as error:
            # `from None`: the original may quote request details.
            raise EmailSendError(
                f"the email provider could not be reached: {type(error).__name__}"
            ) from None
        if not response.is_success:
            raise EmailSendError(f"the email provider answered {response.status_code}")


class BrevoEmailSender:
    """Sends through Brevo's transactional API. The key travels in the `api-key` header only."""

    def __init__(self, client: httpx.AsyncClient, *, api_key: str, sender: str) -> None:
        match = SENDER_PATTERN.fullmatch(sender)
        if match is None:
            raise ValueError(
                "the sender must be an address, or a name and an address in angle brackets"
            )
        self._client = client
        self._api_key = api_key
        self._sender: dict[str, str] = {"email": match["bracketed"] or match["bare"]}
        if match["name"]:
            self._sender["name"] = match["name"]

    async def send(self, message: EmailMessage) -> None:
        try:
            response = await self._client.post(
                BREVO_URL,
                headers={"api-key": self._api_key, "accept": "application/json"},
                json={
                    "sender": self._sender,
                    "to": [{"email": message.to}],
                    "subject": message.subject,
                    "textContent": message.text,
                },
                timeout=SEND_TIMEOUT_SECONDS,
                follow_redirects=False,
            )
        except httpx.HTTPError as error:
            raise EmailSendError(
                f"the email provider could not be reached: {type(error).__name__}"
            ) from None
        if not response.is_success:
            raise EmailSendError(f"the email provider answered {response.status_code}")


def build_email_sender(
    client: httpx.AsyncClient,
    *,
    provider: Literal["console", "resend", "brevo"],
    api_key: str | None,
    sender: str,
) -> EmailSender:
    """The sender for a process. Takes plain values so this package stays free of settings."""
    if provider == "console":
        return ConsoleEmailSender()
    if provider in ("resend", "brevo"):
        key = (api_key or "").strip()
        if not key:
            raise ValueError(f"the {provider} email provider needs an API key")
        if provider == "brevo":
            return BrevoEmailSender(client, api_key=key, sender=sender)
        return ResendEmailSender(client, api_key=key, sender=sender)
    # Reached only if a provider is added to the settings and not here.
    raise ValueError("unknown email provider")
