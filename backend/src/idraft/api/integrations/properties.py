"""Which Search Console properties a project can use (docs/18 section 4.1 items 3 and 4).

A property is a Domain (`sc-domain:example.com`, every subdomain and scheme) or a URL prefix
(`https://www.example.com/`). Pure functions: no database and no Google call.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Literal
from urllib.parse import urlsplit
from uuid import UUID

DOMAIN_PREFIX = "sc-domain:"
UNVERIFIED = "siteUnverifiedUser"


@dataclass(frozen=True, slots=True)
class Property:
    external_property: str
    property_type: Literal["domain", "url_prefix"]
    host: str
    path: str
    secure: bool
    permission_level: str

    @property
    def label(self) -> str:
        return self.host if self.property_type == "domain" else self.external_property

    @property
    def is_selectable(self) -> bool:
        # searchanalytics.query needs read permission, which an unverified user does not have.
        return self.permission_level != UNVERIFIED


@dataclass(frozen=True, slots=True)
class ProjectDomain:
    project_id: UUID
    host: str
    registrable_domain: str


def _bare(host: str) -> str:
    """The host as compared: lower case, without a leading `www.`."""
    host = host.lower().rstrip(".")
    return host.removeprefix("www.")


def parse_property(external_property: str, permission_level: str) -> Property:
    if external_property.startswith(DOMAIN_PREFIX):
        host = _bare(external_property.removeprefix(DOMAIN_PREFIX))
        return Property(external_property, "domain", host, "/", True, permission_level)
    parts = urlsplit(external_property)
    return Property(
        external_property,
        "url_prefix",
        _bare(parts.hostname or ""),
        parts.path or "/",
        parts.scheme == "https",
        permission_level,
    )


def _covers(domain: str, host: str) -> bool:
    return host == domain or host.endswith("." + domain)


def _matches(prop: Property, project: ProjectDomain) -> bool:
    host = _bare(project.host)
    if prop.property_type == "domain":
        return prop.host in (host, _bare(project.registrable_domain))
    return prop.host == host


def _preference(prop: Property) -> tuple[bool, bool, bool, str]:
    # Domain first, then https, then the site root, then a stable order.
    return (
        prop.property_type != "domain",
        not prop.secure,
        prop.path != "/",
        prop.external_property,
    )


def suggestions(
    projects: Iterable[ProjectDomain], properties: Sequence[Property]
) -> dict[str, UUID]:
    """For each project, the one selectable property that matches its primary domain, Domain
    before URL prefix. Returns property to project; a property goes to one project only (the
    first in the order given)."""
    chosen: dict[str, UUID] = {}
    for project in projects:
        matching = sorted(
            (p for p in properties if p.is_selectable and _matches(p, project)), key=_preference
        )
        for prop in matching:
            if prop.external_property not in chosen:
                chosen[prop.external_property] = project.project_id
                break
    return chosen


def overlapping(prop: Property, linked: Mapping[str, UUID]) -> tuple[str, UUID] | None:
    """A property already linked to a project that covers the same site as `prop`, other than
    `prop` itself: counting both would count one visit twice."""
    for other_text, project_id in linked.items():
        if other_text == prop.external_property:
            continue
        other = parse_property(other_text, "siteOwner")
        if (
            prop.host == other.host
            or (prop.property_type == "domain" and _covers(prop.host, other.host))
            or (other.property_type == "domain" and _covers(other.host, prop.host))
        ):
            return other_text, project_id
    return None
