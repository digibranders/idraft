"""The emails the auth module sends. Plain text: nothing to sanitise, nothing to render.

Links put the token in the URL fragment. A fragment is never sent to a server, so the token stays
out of proxy and application access logs; the web page reads it and posts it to the API.
"""

from __future__ import annotations

import unicodedata

from sightline.providers.email import EmailMessage

_NAME_MAX = 80
_NAME_PUNCTUATION = frozenset("'-")


def _greeting(name: str) -> str:
    """A greeting that contains the name and nothing a mail client would turn into a link.

    The name is whatever someone typed at registration, and the message goes to an address nobody
    has verified yet. Only letters, marks, digits, apostrophes and hyphens are kept, in any
    script; everything else, dots and slashes and colons included, becomes a space.
    """
    kept = "".join(
        character
        if unicodedata.category(character)[0] in "LMN" or character in _NAME_PUNCTUATION
        else " "
        for character in unicodedata.normalize("NFC", name)
    )
    cleaned = " ".join(kept.split())[:_NAME_MAX].rstrip()
    return f"Hello {cleaned}," if cleaned else "Hello,"


def verification_email(*, origin: str, to: str, name: str, token: str) -> EmailMessage:
    return EmailMessage(
        to=to,
        subject="Confirm your email address",
        text=(
            f"{_greeting(name)}\n\n"
            "Confirm this email address to finish setting up your Sightline account:\n\n"
            f"{origin}/verify-email#token={token}\n\n"
            "The link works once and expires in 24 hours. "
            "If you did not create an account, ignore this message.\n"
        ),
    )


def password_reset_email(*, origin: str, to: str, name: str, token: str) -> EmailMessage:
    return EmailMessage(
        to=to,
        subject="Reset your password",
        text=(
            f"{_greeting(name)}\n\n"
            "Use this link to choose a new password:\n\n"
            f"{origin}/reset-password#token={token}\n\n"
            "The link works once and expires in 1 hour. "
            "If you did not ask for it, ignore this message: your password has not changed.\n"
        ),
    )


def password_changed_email(*, origin: str, to: str, name: str) -> EmailMessage:
    return EmailMessage(
        to=to,
        subject="Your password was changed",
        text=(
            f"{_greeting(name)}\n\n"
            "The password of your Sightline account was just changed, and every other session "
            "was signed out.\n\n"
            "If this was not you, reset your password now and tell your workspace owner:\n\n"
            f"{origin}/reset-password\n"
        ),
    )
