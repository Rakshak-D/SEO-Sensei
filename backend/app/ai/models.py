"""Typed contracts at the AI service boundary."""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from typing_extensions import Annotated


class RecommendationPriority(StrEnum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class AIRecommendationState(StrEnum):
    AVAILABLE = "available"
    UNAVAILABLE = "unavailable"
    TIMED_OUT = "timed_out"
    INVALID_RESPONSE = "invalid_response"
    CONFIGURATION_ERROR = "configuration_error"


RecommendationText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2_000)]


class SEORecommendation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    issue: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=240)]
    explanation: RecommendationText
    priority: RecommendationPriority
    recommendation: RecommendationText
    evidence: Annotated[str, StringConstraints(strip_whitespace=True, max_length=1_000)] = ""


class SEORecommendationsResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    recommendations: list[SEORecommendation] = Field(default_factory=list, max_length=10)


class AIRecommendationsResult(BaseModel):
    """Safe optional AI state returned alongside deterministic analysis."""

    model_config = ConfigDict(extra="forbid")

    state: AIRecommendationState
    recommendations: list[SEORecommendation] = Field(default_factory=list, max_length=10)
    message: Annotated[str, StringConstraints(max_length=300)] | None = None


class ArticleGenerationResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
    content: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=50_000)]
    seo_suggestions: list[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2_000)]] = (
        Field(
            default_factory=list,
            max_length=10,
        )
    )


class SEOBoostResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    suggested_description: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=320)]
