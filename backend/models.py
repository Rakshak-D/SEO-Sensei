"""Compatibility exports for the typed application schemas.

New code should import from ``backend.app.schemas`` directly. The aliases keep
older local integrations from importing the former free-form model module.
"""

try:
    from .app.schemas.requests import ArticleGenerationRequest, SEOBoostRequest, URLAnalysisRequest
    from .app.schemas.responses import ArticleGenerationResponse, SEOBoostResponse, URLAnalysisResponse
except ImportError:
    from app.schemas.requests import ArticleGenerationRequest, SEOBoostRequest, URLAnalysisRequest
    from app.schemas.responses import ArticleGenerationResponse, SEOBoostResponse, URLAnalysisResponse

UrlRequest = URLAnalysisRequest
AnalyseResponse = URLAnalysisResponse
ArticleRequest = ArticleGenerationRequest
ArticleResponse = ArticleGenerationResponse
SeoBoostResponse = SEOBoostResponse

__all__ = [
    "UrlRequest",
    "AnalyseResponse",
    "ArticleRequest",
    "ArticleResponse",
    "SeoBoostResponse",
]
