"""Controlled, offline tests for the URL policy and safe transport."""

from __future__ import annotations

import asyncio
import socket
from collections.abc import Awaitable, Callable

import httpx
import pytest

from backend.app.config import Settings
from backend.app.security.errors import FetchErrorCode
from backend.app.security.fetcher import SafeFetcher
from backend.app.security.fetcher import FetchResult
from backend.app.security.url_policy import classify_ip, resolve_safe_addresses, validate_url
import backend.app.security.fetcher as fetcher_module
import backend.app.security.url_policy as policy_module


def settings(**overrides: object) -> Settings:
    values = {"APP_ENV": "test", "MAX_CRAWL_RESPONSE_SIZE_BYTES": "128", "MAX_REDIRECTS": "3"}
    values.update({key: str(value) for key, value in overrides.items()})
    return Settings.from_environment(values)


def run(coro: Awaitable[object]) -> object:
    return asyncio.run(coro)


@pytest.mark.parametrize("url", ["http://example.com", "https://example.com/path"])
def test_http_and_https_are_accepted(url: str) -> None:
    parsed = validate_url(url, settings())
    assert parsed.scheme in {"http", "https"}


@pytest.mark.parametrize(
    "url",
    [
        "ftp://example.com",
        "file:///etc/passwd",
        "gopher://example.com",
        "data:text/html,hello",
        "javascript:alert(1)",
        "ws://example.com",
        "wss://example.com",
    ],
)
def test_unsupported_schemes_are_rejected(url: str) -> None:
    with pytest.raises(Exception) as exc_info:
        validate_url(url, settings())
    assert exc_info.value.code == FetchErrorCode.UNSUPPORTED_SCHEME


def test_malformed_credentials_and_overlong_urls_are_rejected() -> None:
    for url, code in [
        ("https:///missing-host", FetchErrorCode.INVALID_URL),
        ("https://user:password@example.com", FetchErrorCode.CREDENTIALS_NOT_ALLOWED),
        ("https://example.com/" + "x" * 2_100, FetchErrorCode.INVALID_URL),
    ]:
        with pytest.raises(Exception) as exc_info:
            validate_url(url, settings())
        assert exc_info.value.code == code


@pytest.mark.parametrize(
    "address",
    [
        "127.0.0.1",
        "10.0.0.1",
        "169.254.1.1",
        "::1",
        "fc00::1",
        "fe80::1",
        "ff02::1",
        "0.0.0.0",
        "192.0.2.1",
        "::ffff:127.0.0.1",
    ],
)
def test_non_global_destinations_are_rejected(address: str) -> None:
    with pytest.raises(Exception) as exc_info:
        classify_ip(address)
    assert exc_info.value.code == FetchErrorCode.BLOCKED_DESTINATION


@pytest.mark.parametrize("host", ["2130706433", "0x7f000001", "127.1", "0177.0.0.1"])
def test_alternate_numeric_ip_forms_are_rejected(host: str) -> None:
    with pytest.raises(Exception) as exc_info:
        validate_url(f"http://{host}/", settings())
    assert exc_info.value.code == FetchErrorCode.BLOCKED_DESTINATION


def test_safe_hostname_resolution_accepts_all_global_answers(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_getaddrinfo(*args: object, **kwargs: object):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 80))]

    monkeypatch.setattr(policy_module.socket, "getaddrinfo", fake_getaddrinfo)
    result = run(resolve_safe_addresses(validate_url("http://example.test", settings())))
    assert result == ("93.184.216.34",)


@pytest.mark.parametrize("answers", [("127.0.0.1",), ("93.184.216.34", "10.0.0.1")])
def test_private_or_mixed_dns_answers_are_rejected(monkeypatch: pytest.MonkeyPatch, answers: tuple[str, ...]) -> None:
    def fake_getaddrinfo(*args: object, **kwargs: object):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (address, 80)) for address in answers]

    monkeypatch.setattr(policy_module.socket, "getaddrinfo", fake_getaddrinfo)
    with pytest.raises(Exception) as exc_info:
        run(resolve_safe_addresses(validate_url("http://example.test", settings())))
    assert exc_info.value.code == FetchErrorCode.BLOCKED_DESTINATION


def test_dns_failure_is_classified_safely(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_getaddrinfo(*args: object, **kwargs: object):
        raise socket.gaierror("internal resolver detail")

    monkeypatch.setattr(policy_module.socket, "getaddrinfo", fake_getaddrinfo)
    with pytest.raises(Exception) as exc_info:
        run(resolve_safe_addresses(validate_url("http://example.test", settings())))
    assert exc_info.value.code == FetchErrorCode.DNS_RESOLUTION_FAILED


def test_localhost_hostname_is_rejected_by_resolved_ip(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_getaddrinfo(*args: object, **kwargs: object):
        return [
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 80)),
            (socket.AF_INET6, socket.SOCK_STREAM, 6, "", ("::1", 80, 0, 0)),
        ]

    monkeypatch.setattr(policy_module.socket, "getaddrinfo", fake_getaddrinfo)
    with pytest.raises(Exception) as exc_info:
        run(resolve_safe_addresses(validate_url("http://localhost", settings())))
    assert exc_info.value.code == FetchErrorCode.BLOCKED_DESTINATION


async def _serve(handler: Callable[[str], Awaitable[tuple[int, dict[str, str], bytes]]]):
    async def connection(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        request = (await reader.read(4096)).decode("ascii", errors="ignore")
        path = request.split(" ", 2)[1].split("?", 1)[0]
        status, headers, body = await handler(path)
        writer.write(f"HTTP/1.1 {status} OK\r\n".encode())
        for key, value in headers.items():
            writer.write(f"{key}: {value}\r\n".encode())
        writer.write(b"Connection: close\r\n\r\n")
        writer.write(body)
        await writer.drain()
        writer.close()
        await writer.wait_closed()

    server = await asyncio.start_server(connection, "127.0.0.1", 0)
    return server


async def _fetch_from_local(
    handler: Callable[[str], Awaitable[tuple[int, dict[str, str], bytes]]],
    fetch_settings: Settings | None = None,
    url_path: str = "/",
):
    server = await _serve(handler)
    port = server.sockets[0].getsockname()[1]
    original_resolver = fetcher_module.resolve_safe_addresses

    async def local_resolver(validated):
        return ("127.0.0.1",)

    fetcher_module.resolve_safe_addresses = local_resolver
    fetcher = SafeFetcher(fetch_settings or settings())
    try:
        return await fetcher.fetch_url(f"http://example.test:{port}{url_path}")
    finally:
        await fetcher.aclose()
        fetcher_module.resolve_safe_addresses = original_resolver
        server.close()
        await server.wait_closed()


def test_bounded_html_is_accepted() -> None:
    async def handler(path: str):
        body = b"<html><title>ok</title></html>"
        return 200, {"Content-Type": "text/html", "Content-Length": str(len(body))}, body

    result = run(_fetch_from_local(handler))
    assert result.succeeded is True
    assert result.body.startswith("<html>")
    assert result.bytes_read == len(result.body.encode())


@pytest.mark.parametrize(
    "content_type",
    [None, "application/pdf", "image/png", "application/octet-stream"],
)
def test_non_html_content_types_are_rejected(content_type: str | None) -> None:
    async def handler(path: str):
        body = b"not html"
        headers = {"Content-Length": str(len(body))}
        if content_type:
            headers["Content-Type"] = content_type
        return 200, headers, body

    result = run(_fetch_from_local(handler))
    assert result.error == FetchErrorCode.UNSUPPORTED_CONTENT_TYPE


def test_xhtml_content_type_is_accepted() -> None:
    async def handler(path: str):
        body = b"<html xmlns='http://www.w3.org/1999/xhtml'></html>"
        return 200, {"Content-Type": "application/xhtml+xml", "Content-Length": str(len(body))}, body

    result = run(_fetch_from_local(handler))
    assert result.succeeded is True


def test_content_length_and_streamed_body_limits_are_enforced() -> None:
    async def declared_large(path: str):
        return 200, {"Content-Type": "text/html", "Content-Length": "129"}, b"small"

    async def streamed_large(path: str):
        return 200, {"Content-Type": "text/html"}, b"x" * 129

    assert run(_fetch_from_local(declared_large)).error == FetchErrorCode.RESPONSE_TOO_LARGE
    assert run(_fetch_from_local(streamed_large)).error == FetchErrorCode.RESPONSE_TOO_LARGE


def test_safe_redirect_is_followed_and_chain_is_bounded() -> None:
    async def handler(path: str):
        if path == "/":
            return 302, {"Location": "/ok"}, b""
        body = b"<html></html>"
        return 200, {"Content-Type": "text/html", "Content-Length": str(len(body))}, body

    result = run(_fetch_from_local(handler))
    assert result.succeeded is True
    assert result.redirect_count == 1
    assert len(result.redirect_chain) == 1


@pytest.mark.parametrize(
    "location",
    [
        "http://127.0.0.1/private",
        "http://internal.test/private",
        "ftp://example.test/file",
    ],
)
def test_unsafe_redirects_are_rejected(location: str) -> None:
    async def handler(path: str):
        return 302, {"Location": location}, b""

    result = run(_fetch_from_local(handler))
    assert result.error == FetchErrorCode.UNSAFE_REDIRECT


def test_redirect_limit_and_loop_are_rejected() -> None:
    async def handler(path: str):
        return 302, {"Location": "/loop"}, b""

    result = run(_fetch_from_local(handler, settings(MAX_REDIRECTS=2)))
    assert result.error == FetchErrorCode.REDIRECT_LIMIT_EXCEEDED
    assert result.redirect_count == 2
    assert len(result.redirect_chain) == 2


@pytest.mark.parametrize(
    ("timeout_exception", "expected"),
    [
        (httpx.ConnectTimeout("connect timeout"), FetchErrorCode.CONNECTION_TIMEOUT),
        (httpx.ReadTimeout("read timeout"), FetchErrorCode.READ_TIMEOUT),
    ],
)
def test_connection_and_read_timeouts_are_typed(
    monkeypatch: pytest.MonkeyPatch,
    timeout_exception: Exception,
    expected: FetchErrorCode,
) -> None:
    async def fake_resolver(validated):
        return ("93.184.216.34",)

    monkeypatch.setattr(fetcher_module, "resolve_safe_addresses", fake_resolver)

    class TimeoutClient:
        cookies = httpx.Cookies()

        def build_request(self, method, url):
            return (method, url)

        async def send(self, request, stream=True):
            raise timeout_exception

        async def aclose(self):
            pass

    fetcher = SafeFetcher(settings())
    fetcher._client = TimeoutClient()
    result = run(fetcher.fetch_url("http://example.test/"))
    assert result.error == expected


def test_overall_timeout_is_typed(monkeypatch: pytest.MonkeyPatch) -> None:
    async def slow_resolver(validated):
        await asyncio.sleep(0.05)
        return ("93.184.216.34",)

    monkeypatch.setattr(fetcher_module, "resolve_safe_addresses", slow_resolver)
    result = run(SafeFetcher(settings(REQUEST_TIMEOUT_SECONDS=0.01)).fetch_url("http://example.test/"))
    assert result.error == FetchErrorCode.OVERALL_TIMEOUT


def test_crawler_consumes_only_safe_fetch_result() -> None:
    pytest.importorskip("bs4")
    from backend import seo_crawler

    class FakeFetcher:
        async def fetch_url(self, url: str) -> FetchResult:
            body = "<html><head><title>Bounded</title></head><body><h1>Heading</h1></body></html>"
            return FetchResult(
                requested_url=url,
                final_url=url,
                status_code=200,
                content_type="text/html",
                bytes_read=len(body.encode()),
                body=body,
            )

    result = run(seo_crawler.get_full_seo_analysis_for_url("https://example.test", fetcher=FakeFetcher()))
    assert result["status"] == "success"
    assert result["title"] == "Bounded"
    assert result["headers"]["h1"] == ["Heading"]
