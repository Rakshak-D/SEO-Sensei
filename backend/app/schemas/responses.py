"""Public response schemas and bounded internal response contracts."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from typing_extensions import Annotated

from ..seo.models import SEOAnalysis


ResponseText = Annotated[str, StringConstraints(max_length=2_000)]
ShortText = Annotated[str, StringConstraints(max_length=500)]


class URLAnalysisResponse(SEOAnalysis):
    """Public response for deterministic URL analysis."""

    pass


class ArticleGenerationResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: Annotated[str, Field(min_length=1, max_length=500)]
    content: Annotated[str, Field(min_length=1, max_length=50_000)]
    seo_suggestions: list[ResponseText] = Field(default_factory=list, max_length=10)


class SEOBoostResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    suggested_description: Annotated[str, Field(max_length=320)]


class HealthResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["ok", "degraded"]
    service: str = "SEO-Sensei API"
    environment: str


class ErrorDetail(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str = Field(min_length=1, max_length=64)
    message: str = Field(min_length=1, max_length=500)
    request_id: str = Field(min_length=1, max_length=64)


class ErrorResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    error: ErrorDetail
