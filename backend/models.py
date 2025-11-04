# DEMO/backend/models.py
from pydantic import BaseModel
from typing import List, Optional, Dict

# --- Models for Article Writer ---

class ArticleRequest(BaseModel):
    topic: str
    keywords: List[str]
    tone: str

class ArticleResponse(BaseModel):
    title: str
    content: str
    seo_suggestions: List[str]

# --- Models for Page Analyzer ---

class UrlRequest(BaseModel):
    url: str

class AnalyseResponse(BaseModel):
    # From Gemini
    seo_score: int
    ai_suggestions: List[str]
    strengths: List[str]
    critical_issues: List[str]
    content_quality: str
    
    # From Crawler
    page_title: str
    meta_description: str
    keywords: List[str]
    status_code: int
    headers: Dict[str, List[str]]

# --- NEW: Model for SEO Boost (Extension) ---

class SeoBoostResponse(BaseModel):
    suggested_description: str
    suggested_keywords: List[str]