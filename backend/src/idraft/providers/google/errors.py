"""What a call to Google can end in. None of these carries a response body, a token or a code:
Google's answers echo what was sent, and these are logged and shown."""

from __future__ import annotations


class GoogleError(Exception):
    """Base of every failure of a call to Google."""

    reason: str = "google_error"

    def __init__(self, message: str | None = None) -> None:
        super().__init__(message or self.reason)


class GoogleInvalidGrantError(GoogleError):
    """The token endpoint refused a refresh token or an authorization code (`invalid_grant`):
    revoked by the person, expired (a Testing-status app's tokens last seven days), or a code
    that was used or timed out. For a stored refresh token, the connection needs re-auth."""

    reason = "invalid_grant"


class GoogleClientRejectedError(GoogleError):
    """Google does not accept our OAuth client: a wrong secret, a redirect address that is not
    registered, or a request it cannot read. Nothing the person can fix."""

    reason = "client_rejected"


class GoogleUnauthorizedError(GoogleError):
    """An API call with an access token Google no longer accepts (HTTP 401): refresh it once."""

    reason = "unauthorized"


class GoogleQuotaError(GoogleError):
    """Google's quota or rate limit (HTTP 429, or 403 with a quota reason)."""

    reason = "quota_exceeded"


class GooglePermissionError(GoogleError):
    """HTTP 403 that is not a quota: the account lost access to the property."""

    reason = "permission_revoked"


class GoogleUnavailableError(GoogleError):
    """A server error or no answer, after the retries."""

    reason = "unavailable"


class GoogleResponseError(GoogleError):
    """An answer that is not what the API documents (or a status this client has no meaning
    for). Nothing is written from it."""

    reason = "bad_response"
