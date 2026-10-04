from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import Request

from backend.app.api.proxy import client_ip, request_host, request_scheme
from backend.app.config import ConfigurationError, Settings


def settings(networks: str = "172.30.0.2/32") -> Settings:
    return Settings.from_environment(
        {
            "APP_ENV": "test",
            "API_ACCESS_TOKEN": "test-token",
            "TRUSTED_PROXY_NETWORKS": networks,
        }
    )


def request(peer: str, headers: dict[str, str]) -> Request:
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/",
        "raw_path": b"/",
        "query_string": b"",
        "headers": [(key.lower().encode(), value.encode()) for key, value in headers.items()],
        "client": (peer, 1234),
        "server": ("api", 8000),
        "scheme": "http",
        "root_path": "",
        "app": SimpleNamespace(state=SimpleNamespace(settings=settings())),
    }
    return Request(scope)


def test_trusted_proxy_forwarded_identity_and_https_are_accepted() -> None:
    current = request(
        "172.30.0.2",
        {
            "X-Forwarded-For": "203.0.113.7, 172.30.0.2",
            "X-Forwarded-Proto": "https",
            "X-Forwarded-Host": "api.example.com",
        },
    )
    networks = tuple(settings().trusted_proxy_networks)
    assert client_ip(current, networks) == "203.0.113.7"
    assert request_scheme(current, networks) == "https"
    assert request_host(current, networks) == "api.example.com"


def test_untrusted_peer_cannot_spoof_forwarded_identity_or_scheme() -> None:
    current = request(
        "198.51.100.10",
        {"X-Forwarded-For": "203.0.113.7", "X-Forwarded-Proto": "https"},
    )
    networks = tuple(settings().trusted_proxy_networks)
    assert client_ip(current, networks) == "198.51.100.10"
    assert request_scheme(current, networks) == "http"


def test_invalid_trusted_proxy_network_is_rejected() -> None:
    with pytest.raises(ConfigurationError, match="invalid"):
        Settings.from_environment({"APP_ENV": "test", "TRUSTED_PROXY_NETWORKS": "not-a-network"})
