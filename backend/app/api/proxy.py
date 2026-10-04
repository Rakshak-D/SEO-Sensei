"""Trusted reverse-proxy header handling.

Forwarded headers are accepted only when the immediate socket peer belongs to
one of the explicitly configured trusted proxy networks. Direct clients cannot
spoof client IP, scheme, or host by sending these headers themselves.
"""

from __future__ import annotations

import ipaddress
from functools import lru_cache

from fastapi import Request


@lru_cache(maxsize=32)
def _networks(values: tuple[str, ...]) -> tuple[ipaddress.IPv4Network | ipaddress.IPv6Network, ...]:
    return tuple(ipaddress.ip_network(value, strict=False) for value in values)


def _peer_ip(request: Request) -> ipaddress.IPv4Address | ipaddress.IPv6Address | None:
    raw_peer = request.client.host if request.client else None
    if not raw_peer:
        return None
    try:
        return ipaddress.ip_address(raw_peer)
    except ValueError:
        return None


def is_trusted_proxy(request: Request, trusted_networks: tuple[str, ...]) -> bool:
    peer = _peer_ip(request)
    return peer is not None and any(peer in network for network in _networks(trusted_networks))


def client_ip(request: Request, trusted_networks: tuple[str, ...] = ()) -> str:
    """Return the verified client address for rate-limit identity."""

    direct_peer = request.client.host if request.client else "unknown"
    if not is_trusted_proxy(request, trusted_networks):
        return direct_peer

    forwarded = request.headers.get("x-forwarded-for", "")
    candidates = [part.strip() for part in forwarded.split(",") if part.strip()]
    # Walk from the proxy inward. The first valid address outside the trusted
    # proxy chain is the effective client. Invalid values are ignored.
    for candidate in reversed(candidates):
        try:
            parsed = ipaddress.ip_address(candidate)
        except ValueError:
            continue
        if not any(parsed in network for network in _networks(trusted_networks)):
            return str(parsed)
    return direct_peer


def forwarded_value(request: Request, header: str, trusted_networks: tuple[str, ...] = ()) -> str | None:
    """Read a forwarded scheme/host value only from a trusted proxy."""

    if not is_trusted_proxy(request, trusted_networks):
        return None
    value = request.headers.get(header, "").split(",", 1)[0].strip()
    return value or None


def request_scheme(request: Request, trusted_networks: tuple[str, ...] = ()) -> str:
    """Return HTTPS-aware scheme without trusting direct client headers."""

    forwarded = forwarded_value(request, "x-forwarded-proto", trusted_networks)
    return forwarded if forwarded in {"http", "https"} else request.url.scheme


def request_host(request: Request, trusted_networks: tuple[str, ...] = ()) -> str:
    """Return the request host, accepting X-Forwarded-Host only from Caddy."""

    return forwarded_value(request, "x-forwarded-host", trusted_networks) or request.headers.get("host", "")
