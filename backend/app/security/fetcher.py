"""Bounded async HTTP(S) fetcher with DNS-pinned outbound connections."""

from __future__ import annotations

import asyncio
import logging
import ssl
import time
from collections.abc import AsyncIterable
from dataclasses import dataclass, field
from typing import Any, cast
from urllib.parse import urljoin

import httpcore
import httpx
from httpx._transports.default import AsyncResponseStream, map_httpcore_exceptions

from ..config import Settings
from ..metrics import Metrics
from .errors import FetchError, FetchErrorCode
from .url_policy import resolve_safe_addresses, validate_url


logger = logging.getLogger("seo_sensei.fetcher")
HTML_CONTENT_TYPES = frozenset({"text/html", "application/xhtml+xml"})
REDIRECT_STATUSES = frozenset({301, 302, 303, 307, 308})


@dataclass(frozen=True)
class FetchResult:
    requested_url: str
    final_url: str | None = None
    status_code: int | None = None
    content_type: str | None = None
    content_length: int | None = None
    bytes_read: int = 0
    redirect_count: int = 0
    redirect_chain: tuple[str, ...] = field(default_factory=tuple)
    elapsed_time: float = 0.0
    x_robots_tag: str | None = None
    body: str | None = None
    error: FetchErrorCode | None = None

    @property
    def succeeded(self) -> bool:
        return self.error is None and self.body is not None and self.status_code is not None


class _PinnedNetworkBackend(httpcore.AsyncNetworkBackend):
    """Connect to a prevalidated IP while preserving HTTPX's origin hostname.

    httpcore performs TLS using the request origin, so HTTPS certificate
    validation/SNI still use the original hostname. Only the TCP destination
    is replaced with the IP selected by the policy resolver. The fetcher holds
    a lock for the complete redirect chain, preventing another request from
    replacing this mapping while a connection is being established.
    """

    def __init__(self) -> None:
        self._backend = httpcore.AnyIOBackend()
        self._pinned: dict[str, str] = {}

    def pin(self, hostname: str, address: str) -> None:
        self._pinned[hostname] = address

    async def connect_tcp(self, host: str, port: int, **kwargs: Any) -> Any:  # type: ignore[override]
        address = self._pinned.get(host)
        if address is None:
            raise httpcore.ConnectError("No validated destination is pinned for this host.")
        return await self._backend.connect_tcp(address, port, **kwargs)

    async def connect_unix_socket(self, *args: Any, **kwargs: Any) -> Any:
        raise httpcore.ConnectError("Unix sockets are not supported by the safe fetcher.")

    async def sleep(self, seconds: float) -> None:
        await self._backend.sleep(seconds)


class _PinnedTransport(httpx.AsyncBaseTransport):
    """HTTPX transport backed by a pinned-IP httpcore connection pool."""

    def __init__(self, settings: Settings) -> None:
        self.network = _PinnedNetworkBackend()
        ssl_context = ssl.create_default_context()
        self.pool = httpcore.AsyncConnectionPool(
            ssl_context=ssl_context,
            max_connections=settings.max_fetch_connections,
            max_keepalive_connections=settings.max_fetch_keepalive_connections,
            keepalive_expiry=15.0,
            http1=True,
            http2=False,
            retries=0,
            network_backend=self.network,
        )

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        req = httpcore.Request(
            method=request.method,
            url=httpcore.URL(
                scheme=request.url.raw_scheme,
                host=request.url.raw_host,
                port=request.url.port,
                target=request.url.raw_path,
            ),
            headers=request.headers.raw,
            content=request.stream,
            extensions=request.extensions,
        )
        with map_httpcore_exceptions():
            response = await self.pool.handle_async_request(req)
        return httpx.Response(
            status_code=response.status,
            headers=response.headers,
            stream=AsyncResponseStream(cast(AsyncIterable[bytes], response.stream)),
            extensions=response.extensions,
            request=request,
        )

    async def aclose(self) -> None:
        await self.pool.aclose()


class SafeFetcher:
    """Application-scoped, bounded, redirect-aware safe HTTP(S) fetcher."""

    def __init__(self, settings: Settings, metrics: Metrics | None = None) -> None:
        self.settings = settings
        self._metrics = metrics
        self._transport = _PinnedTransport(settings)
        timeout = httpx.Timeout(
            timeout=settings.request_timeout_seconds,
            connect=min(5.0, settings.request_timeout_seconds),
            read=settings.request_timeout_seconds,
            write=settings.request_timeout_seconds,
            pool=settings.request_timeout_seconds,
        )
        self._client = httpx.AsyncClient(
            transport=self._transport,
            timeout=timeout,
            follow_redirects=False,
            trust_env=False,
            headers={
                "User-Agent": "SEO-Sensei/1.0 (+safe-crawler)",
                "Accept": "text/html, application/xhtml+xml",
                "Accept-Language": "en-US,en;q=0.9",
            },
        )
        self._request_lock = asyncio.Lock()

    async def aclose(self) -> None:
        await self._client.aclose()

    async def fetch_url(self, url: str, request_id: str | None = None) -> FetchResult:
        started = time.perf_counter()
        result: FetchResult | None = None
        try:
            result = await self._fetch_url(url, request_id=request_id)
            return result
        finally:
            if self._metrics is not None:
                self._metrics.increment("fetch_requests_total", "fetch")
            logger.info(
                "safe_fetch_complete",
                extra={
                    "request_id": request_id or "-",
                    "endpoint": "safe_fetcher",
                    "duration_ms": round((time.perf_counter() - started) * 1000, 2),
                    "status": result.status_code if result else None,
                    "bytes_read": result.bytes_read if result else 0,
                    "redirect_count": result.redirect_count if result else 0,
                    "error_code": result.error.value if result and result.error else None,
                },
            )

    async def _fetch_url(self, url: str, request_id: str | None = None) -> FetchResult:
        """Fetch bounded HTML while validating every connection and redirect."""

        started = time.perf_counter()
        try:
            validated = validate_url(url, self.settings)
        except FetchError as exc:
            return self._failure(url, exc.code, started, request_id=request_id)

        redirects: list[str] = []
        current = validated
        requested_url = validated.url
        deadline = started + self.settings.request_timeout_seconds

        # The lock protects the host->IP mapping used by the custom backend.
        # This closes the validation-to-connect race for this process: every
        # new TCP connection uses the already-validated literal address, while
        # TLS still authenticates the original hostname.
        async with self._request_lock:
            for redirect_count in range(self.settings.max_redirects + 1):
                try:
                    remaining = deadline - time.perf_counter()
                    if remaining <= 0:
                        return self._failure(
                            requested_url,
                            FetchErrorCode.OVERALL_TIMEOUT,
                            started,
                            current.url,
                            redirect_count,
                            redirects,
                        )
                    addresses = await asyncio.wait_for(resolve_safe_addresses(current), timeout=remaining)
                    self._transport.network.pin(current.hostname, addresses[0])
                    self._client.cookies.clear()
                    remaining = deadline - time.perf_counter()
                    if remaining <= 0:
                        return self._failure(
                            requested_url,
                            FetchErrorCode.OVERALL_TIMEOUT,
                            started,
                            current.url,
                            redirect_count,
                            redirects,
                        )
                    request = self._client.build_request("GET", current.url)
                    response = await asyncio.wait_for(self._client.send(request, stream=True), timeout=remaining)
                except FetchError as exc:
                    return self._failure(requested_url, exc.code, started, current.url, redirect_count, redirects)
                except asyncio.TimeoutError:
                    return self._failure(
                        requested_url, FetchErrorCode.OVERALL_TIMEOUT, started, current.url, redirect_count, redirects
                    )
                except httpx.ConnectTimeout:
                    return self._failure(
                        requested_url,
                        FetchErrorCode.CONNECTION_TIMEOUT,
                        started,
                        current.url,
                        redirect_count,
                        redirects,
                    )
                except httpx.ReadTimeout:
                    return self._failure(
                        requested_url, FetchErrorCode.READ_TIMEOUT, started, current.url, redirect_count, redirects
                    )
                except httpx.ConnectError:
                    return self._failure(
                        requested_url, FetchErrorCode.CONNECTION_FAILED, started, current.url, redirect_count, redirects
                    )
                except httpx.HTTPError:
                    return self._failure(
                        requested_url,
                        FetchErrorCode.UNEXPECTED_FETCH_ERROR,
                        started,
                        current.url,
                        redirect_count,
                        redirects,
                    )
                except Exception:
                    logger.exception("safe_fetch_unexpected_error", extra={"request_id": "-", "endpoint": "fetcher"})
                    return self._failure(
                        requested_url,
                        FetchErrorCode.UNEXPECTED_FETCH_ERROR,
                        started,
                        current.url,
                        redirect_count,
                        redirects,
                    )

                try:
                    content_type = _content_type(response.headers.get("content-type"))
                    content_length = _content_length(response.headers.get("content-length"))
                    if response.status_code in REDIRECT_STATUSES:
                        if redirect_count >= self.settings.max_redirects:
                            return self._failure(
                                requested_url,
                                FetchErrorCode.REDIRECT_LIMIT_EXCEEDED,
                                started,
                                current.url,
                                redirect_count,
                                redirects,
                            )
                        location = response.headers.get("location")
                        if not location:
                            return self._failure(
                                requested_url,
                                FetchErrorCode.HTTP_ERROR,
                                started,
                                current.url,
                                redirect_count,
                                redirects,
                                response.status_code,
                            )
                        try:
                            next_url = validate_url(urljoin(current.url, location), self.settings)
                        except FetchError as exc:
                            raise FetchError(
                                FetchErrorCode.UNSAFE_REDIRECT, "The redirect destination is not allowed."
                            ) from exc
                        if next_url.hostname != validated.hostname:
                            return self._failure(
                                requested_url,
                                FetchErrorCode.UNSAFE_REDIRECT,
                                started,
                                current.url,
                                redirect_count,
                                redirects,
                                response.status_code,
                            )
                        redirects.append(next_url.url)
                        current = next_url
                        continue

                    if response.status_code >= 400:
                        return self._failure(
                            requested_url,
                            FetchErrorCode.HTTP_ERROR,
                            started,
                            current.url,
                            redirect_count,
                            redirects,
                            response.status_code,
                            content_type,
                            content_length,
                        )
                    if content_type not in HTML_CONTENT_TYPES:
                        return self._failure(
                            requested_url,
                            FetchErrorCode.UNSUPPORTED_CONTENT_TYPE,
                            started,
                            current.url,
                            redirect_count,
                            redirects,
                            response.status_code,
                            content_type,
                            content_length,
                        )
                    if content_length is not None and content_length > self.settings.max_crawl_response_size_bytes:
                        return self._failure(
                            requested_url,
                            FetchErrorCode.RESPONSE_TOO_LARGE,
                            started,
                            current.url,
                            redirect_count,
                            redirects,
                            response.status_code,
                            content_type,
                            content_length,
                        )

                    remaining = deadline - time.perf_counter()
                    if remaining <= 0:
                        return self._failure(
                            requested_url,
                            FetchErrorCode.OVERALL_TIMEOUT,
                            started,
                            current.url,
                            redirect_count,
                            redirects,
                            response.status_code,
                            content_type,
                            content_length,
                        )
                    body, bytes_read = await self._read_bounded(response, remaining)
                    return FetchResult(
                        requested_url=requested_url,
                        final_url=current.url,
                        status_code=response.status_code,
                        content_type=content_type,
                        content_length=content_length,
                        bytes_read=bytes_read,
                        redirect_count=redirect_count,
                        redirect_chain=tuple(redirects),
                        elapsed_time=time.perf_counter() - started,
                        x_robots_tag=response.headers.get("x-robots-tag"),
                        body=body,
                    )
                except FetchError as exc:
                    return self._failure(
                        requested_url,
                        exc.code,
                        started,
                        current.url,
                        redirect_count,
                        redirects,
                        response.status_code,
                        content_type,
                        content_length,
                    )
                except asyncio.TimeoutError:
                    return self._failure(
                        requested_url,
                        FetchErrorCode.READ_TIMEOUT,
                        started,
                        current.url,
                        redirect_count,
                        redirects,
                        response.status_code,
                        content_type,
                        content_length,
                    )
                except httpx.ReadTimeout:
                    return self._failure(
                        requested_url,
                        FetchErrorCode.READ_TIMEOUT,
                        started,
                        current.url,
                        redirect_count,
                        redirects,
                        response.status_code,
                        content_type,
                        content_length,
                    )
                finally:
                    await response.aclose()
                    self._client.cookies.clear()

            return self._failure(requested_url, FetchErrorCode.UNEXPECTED_FETCH_ERROR, started, request_id=request_id)

    async def _read_bounded(self, response: httpx.Response, timeout: float) -> tuple[str, int]:
        try:
            return await asyncio.wait_for(self._read_bounded_inner(response), timeout=timeout)
        except asyncio.TimeoutError as exc:
            raise FetchError(FetchErrorCode.OVERALL_TIMEOUT, "The response exceeded the overall timeout.") from exc

    async def _read_bounded_inner(self, response: httpx.Response) -> tuple[str, int]:
        chunks: list[bytes] = []
        bytes_read = 0
        async for chunk in response.aiter_bytes():
            bytes_read += len(chunk)
            if bytes_read > self.settings.max_crawl_response_size_bytes:
                raise FetchError(FetchErrorCode.RESPONSE_TOO_LARGE, "The response exceeded the configured size limit.")
            chunks.append(chunk)
        try:
            return b"".join(chunks).decode(response.encoding or "utf-8", errors="replace"), bytes_read
        except LookupError:
            return b"".join(chunks).decode("utf-8", errors="replace"), bytes_read

    def _failure(
        self,
        requested_url: str,
        code: FetchErrorCode,
        started: float,
        final_url: str | None = None,
        redirect_count: int = 0,
        redirects: list[str] | None = None,
        status_code: int | None = None,
        content_type: str | None = None,
        content_length: int | None = None,
        request_id: str | None = None,
    ) -> FetchResult:
        return FetchResult(
            requested_url=requested_url,
            final_url=final_url,
            status_code=status_code,
            content_type=content_type,
            content_length=content_length,
            redirect_count=redirect_count,
            redirect_chain=tuple(redirects or []),
            elapsed_time=time.perf_counter() - started,
            error=code,
        )


def _content_type(value: str | None) -> str | None:
    if not value:
        return None
    return value.split(";", 1)[0].strip().lower()


def _content_length(value: str | None) -> int | None:
    if value is None:
        return None
    try:
        parsed = int(value)
    except ValueError:
        return None
    return parsed if parsed >= 0 else None
