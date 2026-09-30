"""The invitation email. Plain text, with the token in the URL fragment (see auth.mail)."""

from __future__ import annotations

from sightline.api.auth.mail import plain_name
from sightline.providers.email import EmailMessage


def invitation_email(
    *, origin: str, to: str, workspace_name: str, inviter_name: str, role: str, token: str
) -> EmailMessage:
    """Both names were typed by someone else and the message goes to a third party, so they are
    reduced to plain words: an invitation must not carry a link of the inviter's choosing."""
    inviter = plain_name(inviter_name) or "Someone"
    workspace = plain_name(workspace_name)
    where = f'the workspace "{workspace}"' if workspace else "a workspace"
    return EmailMessage(
        to=to,
        subject="You are invited to a Sightline workspace",
        text=(
            "Hello,\n\n"
            f"{inviter} invited you to {where} on Sightline, with the role {role}.\n\n"
            "Accept the invitation:\n\n"
            f"{origin}/invite#token={token}\n\n"
            "The link expires in 7 days. If you did not expect this, ignore this message.\n"
        ),
    )
