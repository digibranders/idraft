"""The emails the auth module sends. Plain text: nothing to sanitise, nothing to render.

Links put the token in the URL fragment. A fragment is never sent to a server, so the token stays
out of proxy and application access logs; the web page reads it and posts it to the API.
"""

from __future__ import annotations

import unicodedata
from typing import Literal

from sightline.providers.email import EmailMessage

_NAME_MAX = 80
_NAME_PUNCTUATION = frozenset("'-")


def plain_name(name: str) -> str:
    """The name with nothing a mail client would turn into a link. May be empty.

    A name is whatever someone typed, and these messages go to addresses that did not ask for
    them. Only letters, marks, decimal digits, apostrophes and hyphens are kept, in any script;
    everything else, dots and slashes and colons included, becomes a space.
    """
    kept = "".join(
        character if _is_name_character(character) else " "
        for character in unicodedata.normalize("NFC", name)
    )
    return " ".join(kept.split())[:_NAME_MAX].rstrip()


def _is_name_character(character: str) -> bool:
    category = unicodedata.category(character)
    # Decimal digits only: other number characters include digits with a full stop attached.
    return category[0] in "LM" or category == "Nd" or character in _NAME_PUNCTUATION


def _greeting(name: str) -> str:
    cleaned = plain_name(name)
    return f"Hello {cleaned}," if cleaned else "Hello,"


def verification_email(*, origin: str, to: str, name: str, token: str) -> EmailMessage:
    return EmailMessage(
        to=to,
        subject="Confirm your email address",
        text=(
            f"{_greeting(name)}\n\n"
            "Confirm this email address to finish setting up your idraft.ai account:\n\n"
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


def password_changed_email(
    *, origin: str, to: str, name: str, signed_out: Literal["others", "all"]
) -> EmailMessage:
    """`signed_out`: a change keeps the session that made it, a reset keeps none."""
    sessions = "every other session" if signed_out == "others" else "every session"
    return EmailMessage(
        to=to,
        subject="Your password was changed",
        text=(
            f"{_greeting(name)}\n\n"
            f"The password of your idraft.ai account was just changed, and {sessions} was "
            "signed out.\n\n"
            "If this was not you, reset your password now and tell your workspace owner:\n\n"
            f"{origin}/reset-password\n"
        ),
    )


_TWO_FACTOR_CHANGES = {
    "enabled": ("Two-factor sign-in was turned on", "Two-factor sign-in was just turned on"),
    "disabled": ("Two-factor sign-in was turned off", "Two-factor sign-in was just turned off"),
    "recovery_codes": (
        "Your recovery codes were replaced",
        "The recovery codes for two-factor sign-in were just replaced",
    ),
}


def two_factor_changed_email(
    *, origin: str, to: str, name: str, change: Literal["enabled", "disabled", "recovery_codes"]
) -> EmailMessage:
    subject, sentence = _TWO_FACTOR_CHANGES[change]
    return EmailMessage(
        to=to,
        subject=subject,
        text=(
            f"{_greeting(name)}\n\n"
            f"{sentence} for your idraft.ai account.\n\n"
            "If this was not you, reset your password now and tell your workspace owner:\n\n"
            f"{origin}/reset-password\n"
        ),
    )
