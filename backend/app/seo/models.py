"""Typed models for deterministic SEO analysis."""

from __future__ import annotations

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from typing_extensions import Annotated


Text = Annotated[str, StringConstraints(max_length=500)]
LongText = Annotated[str, StringConstraints(max_length=2_000)]


class CheckStatus(StrEnum):
    PASS = "pass"
    WARNING = "warning"
    FAIL = "fail"
    NOT_APPLICABLE = "not_applicable"


class SEOCategory(StrEnum):
    TECHNICAL_INDEXABILITY = "technical_indexability"
    METADATA = "metadata"
    HEADINGS_CONTENT = "headings_content_structure"
    LINKS = "links"
    IMAGES = "images"
    STRUCTURED_DATA = "structured_data"
    SOCIAL_METADATA = "social_metadata"
    HTML_SIGNALS = "html_signals"


class Evidence(BaseModel):
    model_config = ConfigDict(extra="forbid")

    observed: LongText
    value: str | int | float | bool | None = None


class SEOCheck(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: Annotated[str, StringConstraints(min_length=1, max_length=80)]
    category: SEOCategory
    title: Text
    status: CheckStatus
    points: float = Field(ge=0, le=100)
    max_points: float = Field(ge=0, le=100)
    evidence: Evidence
    recommendation: LongText


class FetchMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")

    requested_url: Annotated[str, StringConstraints(min_length=1, max_length=2_048)]
    final_url: Annotated[str, StringConstraints(min_length=1, max_length=2_048)]
    status_code: int = Field(ge=0, le=599)
    content_type: Annotated[str, StringConstraints(max_length=128)] = ""
    content_length: int | None = Field(default=None, ge=0)
    bytes_read: int = Field(ge=0)
    redirect_count: int = Field(ge=0, le=10)
    elapsed_time: float = Field(ge=0, le=120)
    x_robots_tag: Annotated[str, StringConstraints(max_length=2_000)] | None = None


class PageMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: Text = ""
    title_length: int = Field(ge=0)
    title_count: int = Field(ge=0)
    description: LongText = ""
    description_length: int = Field(ge=0)
    canonical: Annotated[str, StringConstraints(max_length=2_048)] | None = None
    canonical_resolved: Annotated[str, StringConstraints(max_length=2_048)] | None = None
    canonical_relationship: Literal["missing", "valid_same_host", "valid_other_host", "relative", "malformed"]
    robots_directives: list[Annotated[str, StringConstraints(max_length=64)]] = Field(default_factory=list, max_length=30)
    language: Annotated[str, StringConstraints(max_length=32)] | None = None
    viewport: Annotated[str, StringConstraints(max_length=500)] | None = None
    charset: Annotated[str, StringConstraints(max_length=64)] | None = None
    mixed_content_reference_count: int = Field(ge=0)


class HeadingSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    h1: list[Text] = Field(default_factory=list, max_length=20)
    h2: list[Text] = Field(default_factory=list, max_length=50)
    h3: list[Text] = Field(default_factory=list, max_length=100)
    empty_heading_count: int = Field(ge=0)
    hierarchy_jumps: list[str] = Field(default_factory=list, max_length=20)


class ImageStatistics(BaseModel):
    model_config = ConfigDict(extra="forbid")

    total: int = Field(ge=0)
    with_alt: int = Field(ge=0)
    missing_alt: int = Field(ge=0)
    empty_alt: int = Field(ge=0)
    alt_coverage_percent: float = Field(ge=0, le=100)


class LinkStatistics(BaseModel):
    model_config = ConfigDict(extra="forbid")

    total: int = Field(ge=0)
    internal: int = Field(ge=0)
    external: int = Field(ge=0)
    empty_anchors: int = Field(ge=0)
    nofollow: int = Field(ge=0)
    sponsored: int = Field(ge=0)
    ugc: int = Field(ge=0)


class StructuredDataInfo(BaseModel):
    model_config = ConfigDict(extra="forbid")

    block_count: int = Field(ge=0)
    valid_blocks: int = Field(ge=0)
    malformed_blocks: int = Field(ge=0)
    types: list[Annotated[str, StringConstraints(max_length=100)]] = Field(default_factory=list, max_length=30)


class HreflangLink(BaseModel):
    model_config = ConfigDict(extra="forbid")

    language_region: Annotated[str, StringConstraints(min_length=1, max_length=32)]
    href: Annotated[str, StringConstraints(min_length=1, max_length=2_048)]


class HreflangInfo(BaseModel):
    model_config = ConfigDict(extra="forbid")

    links: list[HreflangLink] = Field(default_factory=list, max_length=50)
    malformed_count: int = Field(ge=0)


class SocialMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")

    og_title: Annotated[str, StringConstraints(max_length=500)] | None = None
    og_description: Annotated[str, StringConstraints(max_length=2_000)] | None = None
    og_image: Annotated[str, StringConstraints(max_length=2_048)] | None = None
    og_url: Annotated[str, StringConstraints(max_length=2_048)] | None = None
    twitter_card: Annotated[str, StringConstraints(max_length=100)] | None = None
    twitter_title: Annotated[str, StringConstraints(max_length=500)] | None = None
    twitter_description: Annotated[str, StringConstraints(max_length=2_000)] | None = None
    twitter_image: Annotated[str, StringConstraints(max_length=2_048)] | None = None


class TermFrequency(BaseModel):
    model_config = ConfigDict(extra="forbid")

    term: Annotated[str, StringConstraints(min_length=1, max_length=80)]
    count: int = Field(ge=1, le=100_000)


class LexicalSignals(BaseModel):
    model_config = ConfigDict(extra="forbid")

    visible_word_count: int = Field(ge=0, le=1_000_000)
    frequent_terms: list[TermFrequency] = Field(default_factory=list, max_length=10)


class CategoryScore(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category: SEOCategory
    weight: float = Field(gt=0, le=100)
    points_earned: float = Field(ge=0, le=100)
    max_points: float = Field(gt=0, le=100)
    raw_points: float = Field(ge=0, le=100)
    raw_max_points: float = Field(ge=0, le=100)
    check_ids: list[str] = Field(default_factory=list, max_length=30)


class SEOScore(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: str = "1.0"
    overall_score: int = Field(ge=0, le=100)
    points_earned: float = Field(ge=0, le=100)
    max_points: float = Field(default=100, gt=0, le=100)
    categories: list[CategoryScore] = Field(max_length=8)


class SEOAnalysis(BaseModel):
    model_config = ConfigDict(extra="forbid")

    requested_url: Annotated[str, StringConstraints(min_length=1, max_length=2_048)]
    final_url: Annotated[str, StringConstraints(min_length=1, max_length=2_048)]
    fetch: FetchMetadata
    deterministic_score: SEOScore
    checks: list[SEOCheck] = Field(max_length=100)
    metadata: PageMetadata
    headings: HeadingSummary
    images: ImageStatistics
    links: LinkStatistics
    structured_data: StructuredDataInfo
    hreflang: HreflangInfo
    social_metadata: SocialMetadata
    lexical_signals: LexicalSignals
