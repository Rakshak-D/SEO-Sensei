"""Small typed HTTP client used by the Streamlit dashboard."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

import httpx
from pydantic import ValidationError

from ..schemas.requests import ArticleGenerationRequest, SEOBoostRequest, URLAnalysisRequest
from ..schemas.responses import (
    ArticleGenerationResponse,
    ErrorResponse,
    HealthResponse,
    SEOBoostResponse,
    URLAnalysisResponse,
)


@dataclass
class DashboardAPIError(Exception):
    code: str
    message: str
    status_code: int | None = None
    request_id: str | None = None
    retry_after: int | None = None

    def __str__(self) -> str:
        suffix = f" (request {self.request_id})" if self.request_id else ""
        return f"{self.message}{suffix}"


class DashboardAPIClient:
    """Authenticated, no-retry client for the public FastAPI contract."""

    def __init__(self, base_url: str, access_token: str, timeout_seconds: float = 15.0, transport: Any = None) -> None:
        normalized = base_url.strip().rstrip("/")
        parsed = urlsplit(normalized)
        if not normalized or not access_token or parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise DashboardAPIError("configuration_error", "Dashboard API configuration is incomplete.")
        self._base_url = normalized
        self._access_token = access_token
        self._timeout = httpx.Timeout(timeout_seconds, connect=min(timeout_seconds, 5.0))
        self._transport = transport

    def health(self) -> HealthResponse:
        response = self._request("GET", "/health", authenticated=False)
        return self._parse(response, HealthResponse)

    def analyze_url(self, url: str, include_ai_recommendations: bool = True) -> URLAnalysisResponse:
        request = URLAnalysisRequest.model_validate(
            {"url": url, "include_ai_recommendations": include_ai_recommendations}
        )
        response = self._request("POST", "/analyse-url", request.model_dump(mode="json"))
        return self._parse(response, URLAnalysisResponse)

    def generate_article(self, request: ArticleGenerationRequest) -> ArticleGenerationResponse:
        response = self._request("POST", "/generate-article", request.model_dump(mode="json"))
        return self._parse(response, ArticleGenerationResponse)

    def boost_seo(self, url: str) -> SEOBoostResponse:
        request = SEOBoostRequest.model_validate({"url": url})
        response = self._request("POST", "/boost-seo", request.model_dump(mode="json"))
        return self._parse(response, SEOBoostResponse)

    def _request(
        self, method: str, path: str, payload: dict[str, Any] | None = None, authenticated: bool = True
    ) -> httpx.Response:
        request_id = uuid.uuid4().hex
        headers = {"Accept": "application/json", "X-Request-ID": request_id}
        if authenticated:
            headers["Authorization"] = f"Bearer {self._access_token}"
        try:
            with httpx.Client(timeout=self._timeout, transport=self._transport, follow_redirects=False) as client:
                response = client.request(method, f"{self._base_url}{path}", json=payload, headers=headers)
        except httpx.TimeoutException as exc:
            raise DashboardAPIError(
                "timeout", "The SEO API timed out. Please try again.", request_id=request_id
            ) from exc
        except httpx.HTTPError as exc:
            raise DashboardAPIError(
                "api_unavailable", "The SEO API could not be reached.", request_id=request_id
            ) from exc

        if response.is_success:
            return response
        self._raise_api_error(response, request_id)
        raise AssertionError("unreachable")

    @staticmethod
    def _parse(response: httpx.Response, model: type[Any]) -> Any:
        try:
            return model.model_validate(response.json())
        except (ValueError, ValidationError) as exc:
            raise DashboardAPIError(
                "malformed_response", "The SEO API returned an invalid response.", response.status_code
            ) from exc

    @staticmethod
    def _raise_api_error(response: httpx.Response, fallback_request_id: str) -> None:
        request_id = response.headers.get("x-request-id") or fallback_request_id
        code = "api_error"
        message = "The SEO API request failed."
        try:
            error = ErrorResponse.model_validate(response.json()).error
            code, message, request_id = error.code, error.message, error.request_id
        except (ValueError, ValidationError):
            pass
        retry_after: int | None = None
        if response.headers.get("retry-after", "").isdigit():
            retry_after = int(response.headers["retry-after"])
        raise DashboardAPIError(code, message, response.status_code, request_id, retry_after)
