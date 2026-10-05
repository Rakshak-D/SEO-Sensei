"""Typed, centralized application configuration.

This module deliberately contains configuration loading only. It does not
implement URL/network safety policy; that is a later hardening phase.
"""

from __future__ import annotations

import ipaddress
import os
from functools import lru_cache
from typing import Any

from dotenv import load_dotenv
from pydantic import BaseModel, ConfigDict, Field, field_validator


class ConfigurationError(RuntimeError):
    """Raised when required production configuration is missing or invalid."""


class Settings(BaseModel):
    """Application settings loaded from environment variables."""

    model_config = ConfigDict(extra="ignore", frozen=True)

    environment: str = Field(default="development", min_length=1, max_length=32)
    gemini_api_key: str | None = Field(default=None, min_length=1)
    gemini_model: str = Field(default="gemini-3.8-flash", min_length=1, max_length=100)
    allowed_cors_origins: list[str] = Field(default_factory=list)
    api_access_token: str | None = Field(default=None, min_length=1)
    api_base_url: str | None = Field(default=None, max_length=500)
    dashboard_api_access_token: str | None = Field(default=None, min_length=1)
    cors_allow_credentials: bool = False
    trusted_proxy_networks: list[str] = Field(default_factory=list)
    app_version: str = Field(default="1.0.0", min_length=1, max_length=64)
    log_level: str = Field(default="INFO", min_length=1, max_length=16)
    metrics_enabled: bool = True
    graceful_shutdown_timeout_seconds: int = Field(default=10, ge=1, le=120)

    request_timeout_seconds: float = Field(default=10.0, gt=0, le=120)
    max_request_body_size_bytes: int = Field(default=1_000_000, gt=0, le=10_000_000)
    max_crawl_response_size_bytes: int = Field(default=2_000_000, gt=0, le=20_000_000)
    max_redirects: int = Field(default=3, ge=0, le=10)
    max_fetch_connections: int = Field(default=10, ge=1, le=100)
    max_fetch_keepalive_connections: int = Field(default=5, ge=0, le=100)
    max_url_length: int = Field(default=2_048, ge=256, le=8_192)
    max_topic_length: int = Field(default=500, ge=32, le=5_000)
    max_keyword_count: int = Field(default=20, ge=1, le=100)
    max_keyword_length: int = Field(default=80, ge=8, le=500)
    max_ai_input_size: int = Field(default=30_000, ge=1_000, le=200_000)
    max_ai_output_size: int = Field(default=50_000, ge=1_000, le=50_000)
    ai_request_timeout_seconds: float = Field(default=20.0, gt=0, le=120)
    ai_retry_count: int = Field(default=1, ge=0, le=3)
    ai_retry_backoff_seconds: float = Field(default=0.5, ge=0, le=10)
    ai_max_concurrency: int = Field(default=3, ge=1, le=20)
    max_ai_recommendation_count: int = Field(default=5, ge=1, le=10)
    max_ai_recommendation_length: int = Field(default=1_000, ge=100, le=2_000)
    analysis_rate_limit_per_minute: int = Field(default=30, ge=1, le=10_000)
    analysis_rate_limit_per_hour: int = Field(default=300, ge=1, le=100_000)
    ai_rate_limit_per_minute: int = Field(default=10, ge=1, le=10_000)
    ai_rate_limit_per_hour: int = Field(default=60, ge=1, le=100_000)
    article_rate_limit_per_minute: int = Field(default=3, ge=1, le=10_000)
    article_rate_limit_per_hour: int = Field(default=20, ge=1, le=100_000)
    boost_rate_limit_per_minute: int = Field(default=5, ge=1, le=10_000)
    boost_rate_limit_per_hour: int = Field(default=30, ge=1, le=100_000)
    rate_limit_max_keys: int = Field(default=10_000, ge=100, le=100_000)

    @field_validator("allowed_cors_origins", mode="before")
    @classmethod
    def parse_origins(cls, value: Any) -> list[str]:
        if value is None or value == "":
            return []
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return list(value)

    @field_validator("trusted_proxy_networks", mode="before")
    @classmethod
    def parse_proxy_networks(cls, value: Any) -> list[str]:
        if value is None or value == "":
            return []
        if isinstance(value, str):
            return [network.strip() for network in value.split(",") if network.strip()]
        return list(value)

    @field_validator("trusted_proxy_networks")
    @classmethod
    def validate_proxy_networks(cls, value: list[str]) -> list[str]:
        for network in value:
            try:
                ipaddress.ip_network(network, strict=False)
            except ValueError as exc:
                raise ValueError("Invalid trusted proxy network.") from exc
        return value

    @field_validator("environment")
    @classmethod
    def normalize_environment(cls, value: str) -> str:
        return value.strip().lower()

    @classmethod
    def from_environment(cls, environ: dict[str, str] | None = None) -> "Settings":
        """Load settings without ever printing secret values."""

        load_dotenv()
        source = os.environ if environ is None else environ

        values: dict[str, Any] = {
            "environment": source.get("APP_ENV", "development"),
            "gemini_api_key": source.get("GEMINI_API_KEY") or None,
            "gemini_model": source.get("GEMINI_MODEL", "gemini-3.8-flash"),
            "allowed_cors_origins": source.get("ALLOWED_CORS_ORIGINS", ""),
            "api_access_token": source.get("API_ACCESS_TOKEN") or None,
            "api_base_url": source.get("API_BASE_URL") or None,
            "dashboard_api_access_token": source.get("DASHBOARD_API_ACCESS_TOKEN") or None,
            "cors_allow_credentials": source.get("CORS_ALLOW_CREDENTIALS", "false"),
            "trusted_proxy_networks": source.get("TRUSTED_PROXY_NETWORKS", ""),
            "app_version": source.get("APP_VERSION", "1.0.0"),
            "log_level": source.get("LOG_LEVEL", "INFO"),
            "metrics_enabled": source.get("METRICS_ENABLED", "true"),
            "graceful_shutdown_timeout_seconds": source.get("GRACEFUL_SHUTDOWN_TIMEOUT_SECONDS", 10),
            "request_timeout_seconds": source.get("REQUEST_TIMEOUT_SECONDS", 10.0),
            "max_request_body_size_bytes": source.get("MAX_REQUEST_BODY_SIZE_BYTES", 1_000_000),
            "max_crawl_response_size_bytes": source.get("MAX_CRAWL_RESPONSE_SIZE_BYTES", 2_000_000),
            "max_redirects": source.get("MAX_REDIRECTS", 3),
            "max_fetch_connections": source.get("MAX_FETCH_CONNECTIONS", 10),
            "max_fetch_keepalive_connections": source.get("MAX_FETCH_KEEPALIVE_CONNECTIONS", 5),
            "max_url_length": source.get("MAX_URL_LENGTH", 2_048),
            "max_topic_length": source.get("MAX_TOPIC_LENGTH", 500),
            "max_keyword_count": source.get("MAX_KEYWORD_COUNT", 20),
            "max_keyword_length": source.get("MAX_KEYWORD_LENGTH", 80),
            "max_ai_input_size": source.get("MAX_AI_INPUT_SIZE", 30_000),
            "max_ai_output_size": source.get("MAX_AI_OUTPUT_SIZE", 50_000),
            "ai_request_timeout_seconds": source.get("AI_REQUEST_TIMEOUT_SECONDS", 20.0),
            "ai_retry_count": source.get("AI_RETRY_COUNT", 1),
            "ai_retry_backoff_seconds": source.get("AI_RETRY_BACKOFF_SECONDS", 0.5),
            "ai_max_concurrency": source.get("AI_MAX_CONCURRENCY", 3),
            "max_ai_recommendation_count": source.get("MAX_AI_RECOMMENDATION_COUNT", 5),
            "max_ai_recommendation_length": source.get("MAX_AI_RECOMMENDATION_LENGTH", 1_000),
            "analysis_rate_limit_per_minute": source.get("ANALYSIS_RATE_LIMIT_PER_MINUTE", 30),
            "analysis_rate_limit_per_hour": source.get("ANALYSIS_RATE_LIMIT_PER_HOUR", 300),
            "ai_rate_limit_per_minute": source.get("AI_RATE_LIMIT_PER_MINUTE", 10),
            "ai_rate_limit_per_hour": source.get("AI_RATE_LIMIT_PER_HOUR", 60),
            "article_rate_limit_per_minute": source.get("ARTICLE_RATE_LIMIT_PER_MINUTE", 3),
            "article_rate_limit_per_hour": source.get("ARTICLE_RATE_LIMIT_PER_HOUR", 20),
            "boost_rate_limit_per_minute": source.get("BOOST_RATE_LIMIT_PER_MINUTE", 5),
            "boost_rate_limit_per_hour": source.get("BOOST_RATE_LIMIT_PER_HOUR", 30),
            "rate_limit_max_keys": source.get("RATE_LIMIT_MAX_KEYS", 10_000),
        }

        try:
            settings = cls.model_validate(values)
        except ValueError as exc:
            raise ConfigurationError("Application configuration is invalid.") from exc

        if settings.environment in {"production", "prod"} and not settings.api_access_token:
            raise ConfigurationError("API_ACCESS_TOKEN is required when APP_ENV is production.")
        if "*" in settings.allowed_cors_origins:
            raise ConfigurationError("Wildcard CORS origins are not permitted for this API.")

        return settings


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the process-wide immutable settings instance."""

    return Settings.from_environment()
