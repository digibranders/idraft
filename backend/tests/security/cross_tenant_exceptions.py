"""Routes the cross-tenant suite cannot drive by putting another workspace's ids in the path
(docs/26-testing-quality.md section 6.1).

Every route of the application is either scoped by a workspace in its path, and then
tests/security/test_cross_tenant.py covers it without being told, or it is listed here with where
its tenant isolation is tested or why it has none to test. A new route that is neither fails the
suite until someone decides which it is.
"""

from __future__ import annotations

NOT_PATH_SCOPED: dict[tuple[str, str], str] = {
    ("GET", "/api/healthz"): "no tenant data",
    ("GET", "/api/readyz"): "no tenant data",
    ("GET", "/api/v1/openapi.json"): "no tenant data",
    ("POST", "/api/v1/auth/register"): "no tenant data; the invitation token is tested in "
    "tests/api/auth/test_register.py",
    ("POST", "/api/v1/auth/verify-email/request"): "no tenant data",
    ("POST", "/api/v1/auth/verify-email"): "no tenant data",
    ("POST", "/api/v1/auth/sign-in"): "no tenant data",
    ("POST", "/api/v1/auth/sign-out"): "no tenant data",
    ("POST", "/api/v1/auth/password-reset/request"): "no tenant data",
    ("POST", "/api/v1/auth/password-reset/confirm"): "no tenant data",
    ("POST", "/api/v1/auth/password/change"): "the caller's own account",
    ("POST", "/api/v1/auth/totp/setup"): "the caller's own account",
    ("POST", "/api/v1/auth/totp/setup/confirm"): "the caller's own account",
    ("POST", "/api/v1/auth/totp/verify"): "the caller's own account",
    ("POST", "/api/v1/auth/totp/recovery-codes"): "the caller's own account",
    ("POST", "/api/v1/auth/totp/disable"): "the caller's own account",
    (
        "GET",
        "/api/v1/auth/sessions",
    ): "the caller's own sessions, tests/api/auth/test_session_routes.py",
    ("POST", "/api/v1/auth/sessions/revoke-others"): "the caller's own sessions",
    ("DELETE", "/api/v1/auth/sessions/{session_id}"): "the caller's own sessions, "
    "tests/api/auth/test_session_routes.py",
    ("GET", "/api/v1/me"): "lists the caller's memberships: XT-04 in test_cross_tenant.py",
    ("PATCH", "/api/v1/me"): "the caller's own account",
    ("POST", "/api/v1/me/reauthenticate"): "the caller's own account",
    ("GET", "/api/v1/workspaces"): "lists the caller's workspaces: XT-04 in test_cross_tenant.py",
    ("POST", "/api/v1/workspaces"): "creates a workspace, names no existing one; a taken slug "
    "reveals nothing else, tests/api/workspaces/test_workspaces.py",
    ("POST", "/api/v1/invitations/accept"): "scoped by the invitation token and the caller's "
    "address, tests/api/workspaces/test_invitations.py",
}
