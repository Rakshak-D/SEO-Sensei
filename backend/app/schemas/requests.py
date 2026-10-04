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


class ArticleGenerationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    topic: Annotated[BoundedText, Field(max_length=500)]
    keywords: list[KeywordText] = Field(default_factory=list, max_length=20)
    tone: Literal["professional", "friendly", "authoritative", "witty", "conversational"]


class SEOBoostRequest(BaseModel):
    """Client-provided page facts for a boost request, never internal analysis state."""

    model_config = ConfigDict(extra="forbid")

    url: Annotated[HttpUrl, Field(max_length=2_048)] | None = None
    page_title: Annotated[str, Field(max_length=500)] = ""
    meta_description: Annotated[str, Field(max_length=2_000)] = ""
    content_quality: Literal["poor", "fair", "good", "excellent", "unknown"] = "unknown"
