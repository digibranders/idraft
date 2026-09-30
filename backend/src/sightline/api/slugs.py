"""Slugs are URL segments in the web app, so their shape is fixed and some words are taken.

The reserved words are the static segments of the web app's routes: a workspace slug is the first
segment of a path, a project slug the second. Both lists are in the OpenAPI document, so the web
forms refuse the same words before asking the API.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Annotated

from pydantic import AfterValidator, StringConstraints

SLUG_MIN = 3
SLUG_MAX = 40
# Lower-case letters, digits and hyphens, starting and ending with a letter or digit.
SLUG_PATTERN = r"^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$"


class ReservedWorkspaceSlug(StrEnum):
    ACCOUNT = "account"
    ADMIN = "admin"
    API = "api"
    DESIGN_SYSTEM = "design-system"
    INVITE = "invite"
    LOGIN = "login"
    NEW = "new"
    ONBOARDING = "onboarding"
    RESET_PASSWORD = "reset-password"
    SETTINGS = "settings"
    SIGNUP = "signup"
    TWO_FACTOR = "two-factor"
    VERIFY_EMAIL = "verify-email"


class ReservedProjectSlug(StrEnum):
    BILLING = "billing"
    COSTS = "costs"
    MEMBERS = "members"
    NEW = "new"
    ONBOARDING = "onboarding"
    OPS = "ops"
    PROJECTS = "projects"
    SETTINGS = "settings"


def _not_a_workspace_route(value: str) -> str:
    if value in ReservedWorkspaceSlug:
        raise ValueError("is a reserved word")
    return value


def _not_a_project_route(value: str) -> str:
    if value in ReservedProjectSlug:
        raise ValueError("is a reserved word")
    return value


_Slug = Annotated[str, StringConstraints(pattern=SLUG_PATTERN)]
WorkspaceSlug = Annotated[_Slug, AfterValidator(_not_a_workspace_route)]
ProjectSlug = Annotated[_Slug, AfterValidator(_not_a_project_route)]
