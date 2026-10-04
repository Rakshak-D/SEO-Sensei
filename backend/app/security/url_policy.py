"""Strict URL and destination policy for user-controlled crawl targets.

The policy intentionally rejects any hostname for which DNS returns even one
non-global address. A validated address is then pinned into the safe fetcher's
transport; the transport does not perform a second hostname lookup.
"""

from __future__ import annotations

import ipaddress
import asyncio
import socket
from dataclasses import dataclass
from urllib.parse import urlsplit, urlunsplit

from ..config import Settings
from .errors import FetchError, FetchErrorCode


ALLOWED_SCHEMES = frozenset({"http", "https"})


@dataclass(frozen=True)
class ValidatedURL:
    """Canonical URL data used by the transport and redirect loop."""

    url: str
    scheme: str
    hostname: str
    port: int


def _looks_like_numeric_ip(hostname: str) -> bool:
    """Detect alternate numeric IPv4 spellings before system resolver parsing."""

    if hostname.isdigit() or hostname.lower().startswith("0x"):
        return True
    return bool(hostname) and all(character in "0123456789.xXaAbBcCdDeEfF" for character in hostname)


def _canonical_hostname(hostname: str) -> str:
    host = hostname.rstrip(".").lower()
    if not host:
        raise FetchError(FetchErrorCode.INVALID_URL, "The URL hostname is missing.")

    try:
        parsed_ip = ipaddress.ip_address(host)
    except ValueError:
        parsed_ip = None

    if parsed_ip is not None:
        return parsed_ip.compressed
    if _looks_like_numeric_ip(host):
        raise FetchError(FetchErrorCode.BLOCKED_DESTINATION, "The URL destination is not allowed.")

    try:
        encoded = host.encode("idna").decode("ascii")
    except UnicodeError as exc:
        raise FetchError(FetchErrorCode.INVALID_URL, "The URL hostname is malformed.") from exc

    if len(encoded) > 253 or any(not label or len(label) > 63 for label in encoded.split(".")):
        raise FetchError(FetchErrorCode.INVALID_URL, "The URL hostname is malformed.")
    return encoded


def validate_url(raw_url: str, settings: Settings) -> ValidatedURL:
    """Validate and canonicalize an HTTP(S) URL without resolving DNS."""

    if not isinstance(raw_url, str) or not raw_url or len(raw_url) > settings.max_url_length:
        raise FetchError(FetchErrorCode.INVALID_URL, "The URL is invalid or too long.")
    if any(character.isspace() or ord(character) < 32 or ord(character) == 127 for character in raw_url):
        raise FetchError(FetchErrorCode.INVALID_URL, "The URL is malformed.")

    try:
        parts = urlsplit(raw_url)
        scheme = parts.scheme.lower()
        hostname = parts.hostname
        port = parts.port
    except (ValueError, UnicodeError) as exc:
        raise FetchError(FetchErrorCode.INVALID_URL, "The URL is malformed.") from exc

    if scheme not in ALLOWED_SCHEMES:
        raise FetchError(FetchErrorCode.UNSUPPORTED_SCHEME, "Only HTTP and HTTPS URLs are supported.")
    if not parts.netloc or hostname is None:
        raise FetchError(FetchErrorCode.INVALID_URL, "The URL hostname is missing.")
    if parts.username is not None or parts.password is not None:
        raise FetchError(FetchErrorCode.CREDENTIALS_NOT_ALLOWED, "URLs containing credentials are not allowed.")

    canonical_host = _canonical_hostname(hostname)
    if port is None:
        port = 443 if scheme == "https" else 80
    if not 1 <= port <= 65535:
        raise FetchError(FetchErrorCode.INVALID_URL, "The URL port is invalid.")

    # Fragments are client-side only and are stripped before the request.
    # They are never sent to the origin and do not affect SEO HTML fetching.
    netloc = f"[{canonical_host}]" if ":" in canonical_host else canonical_host
    if (scheme, port) not in (("http", 80), ("https", 443)):
        netloc = f"{netloc}:{port}"
    canonical_url = urlunsplit((scheme, netloc, parts.path or "/", parts.query, ""))
    return ValidatedURL(canonical_url, scheme, canonical_host, port)


def classify_ip(address: str) -> ipaddress.IPv4Address | ipaddress.IPv6Address:
    """Parse and reject every non-global destination address."""

    try:
        parsed = ipaddress.ip_address(address)
    except ValueError as exc:
        raise FetchError(FetchErrorCode.DNS_RESOLUTION_FAILED, "The hostname did not resolve safely.") from exc

    mapped = getattr(parsed, "ipv4_mapped", None)
    effective = mapped if mapped is not None else parsed
    if (
        not effective.is_global
        or effective.is_loopback
        or effective.is_private
        or effective.is_link_local
        or effective.is_multicast
        or effective.is_unspecified
        or effective.is_reserved
    ):
        raise FetchError(FetchErrorCode.BLOCKED_DESTINATION, "The URL destination is not allowed.")
    return parsed


async def resolve_safe_addresses(validated: ValidatedURL) -> tuple[str, ...]:
    """Resolve all addresses and reject a host if any answer is unsafe."""

    if _is_ip_literal(validated.hostname):
        return (str(classify_ip(validated.hostname)),)

    try:
        records = await asyncio.to_thread(
            socket.getaddrinfo,
            validated.hostname,
            validated.port,
            type=socket.SOCK_STREAM,
        )
    except socket.gaierror as exc:
        raise FetchError(FetchErrorCode.DNS_RESOLUTION_FAILED, "The hostname could not be resolved.") from exc
    except OSError as exc:
        raise FetchError(FetchErrorCode.DNS_RESOLUTION_FAILED, "The hostname could not be resolved.") from exc

    addresses: list[str] = []
    for record in records:
        address = record[4][0]
        parsed = classify_ip(address)
        normalized = str(parsed)
        if normalized not in addresses:
            addresses.append(normalized)
    if not addresses:
        raise FetchError(FetchErrorCode.DNS_RESOLUTION_FAILED, "The hostname did not resolve.")
    return tuple(addresses)


def _is_ip_literal(hostname: str) -> bool:
    try:
        ipaddress.ip_address(hostname)
        return True
    except ValueError:
        return False
