import requests
from bs4 import BeautifulSoup
from collections import Counter
from typing import Tuple, Dict, Any
import logging

def fetch_html(url: str) -> Tuple[str | None, int]:
    """
    Fetches HTML content for a URL and returns the content and status code.
    """
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Connection": "keep-alive"
    }

    try:
        response = requests.get(url, headers=headers, timeout=10)
        response.raise_for_status()
        return response.text, response.status_code
    except requests.exceptions.HTTPError as e:
        logging.warning(f"HTTP Error fetching {url}: {e}")
        return None, e.response.status_code
    except requests.exceptions.RequestException as e:
        logging.error(f"General Error fetching {url}: {e}")
        return None, 0

def extract_seo_data(html_content: str) -> Dict[str, Any]:
    """
    Parses HTML to extract title, description, and body text.
    """
    soup = BeautifulSoup(html_content, 'html.parser')
    
    title_tag = soup.find('title')
    title = title_tag.text.strip() if title_tag else ""
    
    desc_tag = soup.find('meta', attrs={'name': 'description'})
    description = desc_tag.get('content', '').strip() if desc_tag else ""
    
    body_tag = soup.find('body')
    body_text = body_tag.get_text(separator=' ', strip=True) if body_tag else ""
    
    return {
        "title": title,
        "description": description,
        "body_text": body_text
    }

def fetch_headers(html_content: str) -> Dict[str, Any]:
    """
    Parses HTML to extract H1, H2, and H3 tags.
    """
    soup = BeautifulSoup(html_content, "html.parser")
    
    h1_tags = [tag.get_text(strip=True) for tag in soup.find_all("h1")]
    h2_tags = [tag.get_text(strip=True) for tag in soup.find_all("h2")]
    h3_tags = [tag.get_text(strip=True) for tag in soup.find_all("h3")]
    
    return {
        "h1": h1_tags,
        "h2": h2_tags,
        "h3": h3_tags
    }

async def get_full_seo_analysis_for_url(url: str) -> Dict[str, Any]:
    """
    Orchestrates the full scraping process for a given URL.
    """
    html_content, status_code = fetch_html(url)
    
    if not html_content:
        return {"status": "failed", "status_code": status_code}

    scraped_data = extract_seo_data(html_content)
    header_data = fetch_headers(html_content)
    
    body_text = scraped_data.get("body_text", "")
    words = [word.lower() for word in body_text.split() if len(word) > 4 and word.isalpha()]
    keywords = [word for word, count in Counter(words).most_common(10)]
    
    return {
        "title": scraped_data.get("title", ""),
        "description": scraped_data.get("description", ""),
        "body_text": body_text,
        "headers": header_data,
        "keywords": keywords,
        "status_code": status_code,
        "status": "success"
    }
