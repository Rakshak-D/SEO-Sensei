"""Public request schemas."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, StringConstraints
from typing_extensions import Annotated


BoundedText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
KeywordText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]


class URLAnalysisRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    url: Annotated[HttpUrl, Field(max_length=2_048)]
    include_ai_recommendations: bool = False


class ArticleGenerationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    topic: Annotated[BoundedText, Field(max_length=500)]
    keywords: list[KeywordText] = Field(default_factory=list, max_length=20)
    tone: Literal["professional", "friendly", "authoritative", "witty", "conversational"]


class SEOBoostRequest(BaseModel):
    """Request a suggestion from server-generated deterministic findings."""

    model_config = ConfigDict(extra="forbid")

    url: Annotated[HttpUrl, Field(max_length=2_048)]
