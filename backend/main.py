# DEMO/backend/main.py
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import os
import validators
import logging

# Import all models from our single models file
from models import (
    UrlRequest, AnalyseResponse, 
    ArticleRequest, ArticleResponse,
    SeoBoostResponse  # <-- NEW
)

# --- CORRECTED IMPORTS ---
from seo_crawler import get_full_seo_analysis_for_url
from utils.gemini_helper import GeminiService
# -------------------------

# --- Production-Ready Setup ---
load_dotenv()
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

if not os.getenv("GEMINI_API_KEY"):
    logging.critical("GEMINI_API_KEY environment variable not set. The server cannot start.")
    raise RuntimeError("GEMINI_API_KEY environment variable not set. The server cannot start.")
# ------------------------------

app = FastAPI(title="Seo Sensei Merged API")
service = GeminiService()

# --- Production-Ready CORS ---
# This whitelist allows your specific extension ID to make requests.
PRODUCTION_ORIGINS = [
    "chrome-extension://lpghoglnkdpkokoimcjkjndiaoomdpen",
    # FOR DEV: You might need to add your local streamlit origin if it's different
    # "http://localhost:8501", 
]
# -----------------------------

app.add_middleware(
    CORSMiddleware,
    # Allow all origins for dev, or lock down with PRODUCTION_ORIGINS
    allow_origins=["*"], # Using wildcard for simpler dev, change to PRODUCTION_ORIGINS for prod
    allow_credentials=True,
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

# --- Endpoint 1: Page Analyzer (From Seo Sensei) ---
@app.post("/analyse-url", 
          response_model=AnalyseResponse,
          summary="Analyze a URL for SEO metrics")
async def post_url(request: UrlRequest):
    url_received = request.url

    try:
        if not (url_received.startswith("http://") or url_received.startswith("https://")):
            url_received = "https://" + url_received
        if not validators.url(url_received):
            raise ValueError("Invalid URL format")
    except ValueError as ve:
        logging.warning(f"Validation Error for URL '{url_received}': {ve}")
        raise HTTPException(status_code=400, detail=f"Validation Error: {str(ve)}")

    try:
        # 1. Scrape the raw data
        scraped_data = await get_full_seo_analysis_for_url(url_received)
        if not scraped_data or scraped_data.get("status") == "failed":
            error_message = "Could not fetch or analyze the URL. "
            error_message += f"(Status Code: {scraped_data.get('status_code', 'N/A')})"
            logging.warning(f"Scraping failed for '{url_received}': {error_message}")
            raise ValueError(error_message)

        # 2. Pass scraped data to Gemini for analysis
        ai_analysis_data = await service.analyze_seo_with_ai(scraped_data)

        # 3. Combine scraped data and AI data for the final response
        full_response_data = ai_analysis_data.copy()
        full_response_data['page_title'] = scraped_data.get('title', 'N/A')
        full_response_data['meta_description'] = scraped_data.get('description', 'N/A')
        full_response_data['keywords'] = scraped_data.get('keywords', [])
        full_response_data['status_code'] = scraped_data.get('status_code', 0)
        full_response_data['headers'] = scraped_data.get('headers', {})

        # 4. Return the combined analysis
        return AnalyseResponse(**full_response_data)

    except Exception as e:
        logging.error(f"Error during full analysis for '{url_received}': {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error analyzing URL: {str(e)}")


# --- Endpoint 2: Article Writer (From AI Article Writer) ---
@app.post("/generate-article", 
          response_model=ArticleResponse,
          summary="Generate an SEO-optimized article")
async def generate_article(request: ArticleRequest):
    try:
        article_data = await service.generate_article_with_ai(
            request.topic, 
            request.keywords, 
            request.tone
        )
        return ArticleResponse(**article_data)
        
    except Exception as e:
        logging.error(f"Error during article generation for topic '{request.topic}': {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error generating article: {str(e)}")

# --- Endpoint 3: SEO Booster (NEW) ---
@app.post("/boost-seo", 
          response_model=SeoBoostResponse,
          summary="Generate missing SEO tags")
async def post_boost_seo(request: AnalyseResponse):
    """
    Receives the full analysis data from the extension and passes it
    to Gemini to generate missing/improved tags.
    """
    try:
        # We pass the entire analysis data received from the extension
        boost_data = await service.generate_seo_boost(request.dict())
        return SeoBoostResponse(**boost_data)
    except Exception as e:
        logging.error(f"Error during SEO boost: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error generating boost: {str(e)}")

# --- Root endpoint for testing ---
@app.get("/")
def read_root():
    return {"message": "Seo Sensei Merged API is running!"}