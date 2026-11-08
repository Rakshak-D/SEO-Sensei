from __future__ import annotations

import asyncio
import importlib
import json
from collections.abc import Iterable
from typing import Any

import pytest
from fastapi.testclient import TestClient

from backend.app.config import get_settings
from backend.app.seo.engine import analyze_html
from backend.app.seo.models import FetchMetadata


@pytest.fixture()
def main_module(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("API_ACCESS_TOKEN", "request-body-test-token")
    monkeypatch.setenv("GEMINI_API_KEY", "")
    monkeypatch.setenv("BROWSER_AUTH_ENABLED", "false")
    get_settings.cache_clear()
    import backend.app.main as main

    loaded = importlib.reload(main)
    yield loaded
    get_settings.cache_clear()


def _scope(headers: Iterable[tuple[bytes, bytes]] = (), path: str = "/legacy") -> dict[str, Any]:
    return {
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.4"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": path,
        "raw_path": path.encode("ascii"),
        "query_string": b"",
        "root_path": "",
        "headers": list(headers),
        "client": ("127.0.0.1", 40000),
        "server": ("testserver", 80),
        "state": {},
    }


def _run_middleware(
    middleware_type,
    events: list[dict[str, Any]],
    *,
    headers: Iterable[tuple[bytes, bytes]] = (),
    path: str = "/legacy",
    limit: int = 8,
    path_limits: dict[str, int] | None = None,
    downstream: Any = None,
):
    async def run():
        receive_calls = 0
        sent: list[dict[str, Any]] = []
        delivered = bytearray()
        downstream_calls = 0
        pending = list(events)

        async def receive():
            nonlocal receive_calls
            receive_calls += 1
            if pending:
                return pending.pop(0)
            return {"type": "http.disconnect"}

        async def send(message):
            sent.append(message)

        async def endpoint(scope, endpoint_receive, endpoint_send):
            nonlocal downstream_calls
            downstream_calls += 1
            if downstream is not None:
                await downstream(scope, endpoint_receive, endpoint_send)
                return
            while True:
                message = await endpoint_receive()
                if message["type"] == "http.disconnect":
                    return
                delivered.extend(message.get("body", b""))
                if not message.get("more_body", False):
                    break
            await endpoint_send({"type": "http.response.start", "status": 200, "headers": []})
            await endpoint_send({"type": "http.response.body", "body": bytes(delivered), "more_body": False})

        middleware = middleware_type(endpoint, limit, path_limits)
        await middleware(_scope(headers, path), receive, send)
        return sent, bytes(delivered), downstream_calls, receive_calls

    return asyncio.run(run())


def _response_start(sent: list[dict[str, Any]]) -> dict[str, Any] | None:
    return next((message for message in sent if message["type"] == "http.response.start"), None)


def _response_body(sent: list[dict[str, Any]]) -> bytes:
    return b"".join(message.get("body", b"") for message in sent if message["type"] == "http.response.body")


def test_empty_and_exact_limit_bodies_are_replayed(main_module) -> None:
    for body in (b"", b"12345678"):
        events = [{"type": "http.request", "body": body, "more_body": False}]
        sent, delivered, calls, _ = _run_middleware(main_module.RequestContextMiddleware, events)
        assert calls == 1
        assert delivered == body
        assert _response_start(sent)["status"] == 200


def test_multiple_chunks_summing_to_limit_are_replayed_in_order(main_module) -> None:
    events = [
        {"type": "http.request", "body": b"123", "more_body": True},
        {"type": "http.request", "body": b"", "more_body": True},
        {"type": "http.request", "body": b"45678", "more_body": False},
    ]
    sent, delivered, calls, _ = _run_middleware(
        main_module.RequestContextMiddleware,
        events,
        headers=[(b"transfer-encoding", b"chunked")],
    )
    assert calls == 1
    assert delivered == b"12345678"
    assert _response_start(sent)["status"] == 200


def test_replay_chunk_metadata_is_bounded_for_large_asgi_chunks(main_module) -> None:
    received_lengths: list[int] = []
    final_markers: list[bool] = []

    async def consume(scope, receive, send):
        while True:
            message = await receive()
            received_lengths.append(len(message.get("body", b"")))
            final_markers.append(not message.get("more_body", False))
            if final_markers[-1]:
                break
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"", "more_body": False})

    replay_chunk_bytes = main_module.REQUEST_BODY_REPLAY_CHUNK_BYTES
    body = b"x" * (replay_chunk_bytes + 3)
    sent, _, calls, _ = _run_middleware(
        main_module.RequestContextMiddleware,
        [{"type": "http.request", "body": body, "more_body": False}],
        limit=len(body),
        downstream=consume,
    )
    assert calls == 1
    assert received_lengths == [replay_chunk_bytes, 3]
    assert final_markers == [False, True]
    assert _response_start(sent)["status"] == 200


def test_oversized_stream_is_rejected_before_downstream_with_safe_response(
    caplog: pytest.LogCaptureFixture, main_module
):
    caplog.set_level("INFO")
    private_body = b"key=12345"
    events = [
        {"type": "http.request", "body": private_body[:8], "more_body": True},
        {"type": "http.request", "body": private_body[8:], "more_body": False},
    ]
    sent, delivered, calls, _ = _run_middleware(
        main_module.RequestContextMiddleware,
        events,
        headers=[(b"x-request-id", b"req-body-limit-1")],
    )

    start = _response_start(sent)
    assert calls == 0
    assert delivered == b""
    assert start["status"] == 413
    headers = dict(start["headers"])
    assert headers[b"x-request-id"] == b"req-body-limit-1"
    assert headers[b"cache-control"] == b"no-store"
    payload = json.loads(_response_body(sent))
    assert payload["error"] == {
        "code": "request_too_large",
        "message": "Request body is too large.",
        "request_id": "req-body-limit-1",
    }
    assert len([message for message in sent if message["type"] == "http.response.start"]) == 1
    assert private_body.decode() not in caplog.text
    assert private_body.decode() not in _response_body(sent).decode()


def test_declared_oversize_is_rejected_without_reading_body(main_module) -> None:
    sent, _, calls, receive_calls = _run_middleware(
        main_module.RequestContextMiddleware,
        [{"type": "http.request", "body": b"", "more_body": False}],
        headers=[(b"content-length", b"9")],
    )
    assert calls == 0
    assert receive_calls == 0
    assert _response_start(sent)["status"] == 413
    assert json.loads(_response_body(sent))["error"]["code"] == "request_too_large"


def test_application_uses_configured_limit_and_marks_rejection_no_store(
    main_module, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("MAX_REQUEST_BODY_SIZE_BYTES", "8")
    get_settings.cache_clear()
    main_module = importlib.reload(main_module)

    with TestClient(main_module.app) as client:
        response = client.post("/health", content=b"123456789")

    assert response.status_code == 413
    assert response.json()["error"]["code"] == "request_too_large"
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-request-id"] == response.json()["error"]["request_id"]


def test_oversized_legacy_payloads_do_not_invoke_analysis_or_ai(main_module, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MAX_REQUEST_BODY_SIZE_BYTES", "32")
    get_settings.cache_clear()
    main_module = importlib.reload(main_module)
    calls = {"analysis": 0, "article": 0, "boost": 0}

    async def fake_analysis(url: str, fetcher=None):
        calls["analysis"] += 1
        return {}

    class FakeAI:
        async def generate_article(self, payload, *, request_id=None):
            calls["article"] += 1
            return {}

        async def generate_boost(self, analysis, *, request_id=None):
            calls["boost"] += 1
            return {}

        async def aclose(self):
            return None

    import backend.seo_crawler as crawler

    monkeypatch.setattr(crawler, "get_full_seo_analysis_for_url", fake_analysis)
    with TestClient(main_module.app) as client:
        client.app.state.gemini_service = FakeAI()
        authorization = {"Authorization": "Bearer request-body-test-token"}
        responses = [
            client.post(
                "/analyse-url",
                json={"url": "https://example.test/a/path/longer/than/the/configured/body/limit"},
                headers=authorization,
            ),
            client.post(
                "/generate-article",
                json={
                    "topic": "An article topic longer than the configured limit",
                    "keywords": [],
                    "tone": "professional",
                },
                headers=authorization,
            ),
            client.post(
                "/boost-seo",
                json={"url": "https://example.test/a/path/longer/than/the/configured/body/limit"},
                headers=authorization,
            ),
        ]

    assert [response.status_code for response in responses] == [413, 413, 413]
    assert [response.json()["error"]["code"] for response in responses] == [
        "request_too_large",
        "request_too_large",
        "request_too_large",
    ]
    assert calls == {"analysis": 0, "article": 0, "boost": 0}


@pytest.mark.parametrize(
    ("declared", "actual"),
    [(b"3", b"1234"), (b"5", b"1234")],
)
def test_inaccurate_declared_lengths_fail_closed(main_module, declared: bytes, actual: bytes) -> None:
    sent, _, calls, _ = _run_middleware(
        main_module.RequestContextMiddleware,
        [{"type": "http.request", "body": actual, "more_body": False}],
        headers=[(b"content-length", declared)],
    )
    start = _response_start(sent)
    assert calls == 0
    assert start["status"] == 400
    assert json.loads(_response_body(sent))["error"]["code"] == "invalid_request"


@pytest.mark.parametrize(
    "headers",
    [
        [(b"content-length", b"4"), (b"content-length", b"4")],
        [(b"content-length", b"4"), (b"transfer-encoding", b"chunked")],
        [(b"content-length", b"four")],
        [(b"transfer-encoding", b"gzip, chunked")],
        [(b"transfer-encoding", b"chunked"), (b"transfer-encoding", b"chunked")],
    ],
)
def test_malformed_or_conflicting_framing_is_rejected_before_read(main_module, headers) -> None:
    sent, _, calls, receive_calls = _run_middleware(
        main_module.RequestContextMiddleware,
        [{"type": "http.request", "body": b"1234", "more_body": False}],
        headers=headers,
    )
    assert calls == 0
    assert receive_calls == 0
    assert _response_start(sent)["status"] == 400
    assert json.loads(_response_body(sent))["error"]["code"] == "invalid_request"


def test_browser_analysis_uses_stricter_path_limit(main_module) -> None:
    path = "/api/browser/v1/analyse-url"
    events = [{"type": "http.request", "body": b"12345", "more_body": False}]
    sent, _, calls, _ = _run_middleware(
        main_module.RequestContextMiddleware,
        events,
        path=path,
        limit=8,
        path_limits={path: 4},
    )
    assert calls == 0
    assert _response_start(sent)["status"] == 413
    assert json.loads(_response_body(sent))["error"]["code"] == "request_too_large"


def test_disconnect_before_body_completion_sends_no_response_or_route_work(main_module) -> None:
    events = [
        {"type": "http.request", "body": b"123", "more_body": True},
        {"type": "http.disconnect"},
    ]
    sent, _, calls, _ = _run_middleware(main_module.RequestContextMiddleware, events)
    assert sent == []
    assert calls == 0


def test_cancellation_while_receiving_propagates_without_route_work(main_module) -> None:
    async def run():
        receiving = asyncio.Event()
        sent: list[dict[str, Any]] = []
        downstream_calls = 0

        async def receive():
            receiving.set()
            await asyncio.Future()

        async def send(message):
            sent.append(message)

        async def endpoint(scope, endpoint_receive, endpoint_send):
            nonlocal downstream_calls
            downstream_calls += 1

        middleware = main_module.RequestContextMiddleware(endpoint, 8)
        task = asyncio.create_task(middleware(_scope(), receive, send))
        await receiving.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        return sent, downstream_calls

    sent, calls = asyncio.run(run())
    assert sent == []
    assert calls == 0


def test_valid_legacy_json_requests_still_reach_existing_handlers(main_module, monkeypatch: pytest.MonkeyPatch) -> None:
    html = "<html lang='en'><head><title>Valid bounded request</title></head><body><h1>Example</h1></body></html>"

    async def fake_analysis(url: str, fetcher=None):
        metadata = FetchMetadata(
            requested_url=url,
            final_url=url,
            status_code=200,
            content_type="text/html",
            content_length=len(html),
            bytes_read=len(html),
            redirect_count=0,
            elapsed_time=0.01,
        )
        return {"status": "success", **analyze_html(html, url, metadata).model_dump(mode="json")}

    class FakeAI:
        async def generate_article(self, payload, *, request_id=None):
            return {"title": "Generated title", "content": "Generated article text.", "seo_suggestions": []}

        async def generate_boost(self, analysis, *, request_id=None):
            return {"suggested_description": "A concise, useful description for this page."}

        async def aclose(self):
            return None

    import backend.seo_crawler as crawler

    monkeypatch.setattr(crawler, "get_full_seo_analysis_for_url", fake_analysis)
    with TestClient(main_module.app) as client:
        client.app.state.gemini_service = FakeAI()
        authorization = {"Authorization": "Bearer request-body-test-token"}
        analysis = client.post("/analyse-url", json={"url": "https://example.test/"}, headers=authorization)
        article = client.post(
            "/generate-article",
            json={"topic": "A bounded test topic", "keywords": ["seo"], "tone": "professional"},
            headers=authorization,
        )
        boost = client.post("/boost-seo", json={"url": "https://example.test/"}, headers=authorization)

    assert analysis.status_code == 200
    assert article.status_code == 200
    assert article.json()["title"] == "Generated title"
    assert boost.status_code == 200
    assert "suggested_description" in boost.json()


def test_disconnected_request_does_not_log_body_or_credentials(caplog: pytest.LogCaptureFixture, main_module) -> None:
    caplog.set_level("INFO")
    private_body = b"request-body-private-value"
    events = [
        {"type": "http.request", "body": private_body[:3], "more_body": True},
        {"type": "http.disconnect"},
    ]
    sent, _, calls, _ = _run_middleware(main_module.RequestContextMiddleware, events)
    assert sent == []
    assert calls == 0
    assert private_body.decode() not in caplog.text
