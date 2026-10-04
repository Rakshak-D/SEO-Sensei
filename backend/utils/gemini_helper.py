import google.generativeai as genai
import json
import logging
from typing import Dict, List, Any, Union

class GeminiService:
    """
    A unified service to handle all interactions with the Gemini API.
    """
    def __init__(self, api_key: str, model_name: str = "gemini-2.5-flash"):
        if not api_key:
            raise ValueError("A Gemini API key is required to initialize GeminiService.")
        genai.configure(api_key=api_key)
        self.model = genai.GenerativeModel(model_name)

    async def generate_article_with_ai(self, topic: str, keywords: List[str], tone: str) -> Dict:
        """
        Generates an SEO-optimized article based on a prompt.
        (From Article Writer)
        """
        keyword_str = ", ".join(keywords)
        prompt = f"""
        You are an expert SEO content writer. Your task is to write a high-quality, engaging, and well-structured article.

        Topic: {topic}
        Keywords to include: {keyword_str}
        Tone: {tone}

        Please provide the following:
        1.  A compelling, SEO-friendly title.
        2.  The full article content, formatted in clean HTML (use <p>, <h2>, <h3>, <ul>, <li>, <strong> tags).
        3.  A list of 3-5 brief, actionable SEO suggestions for improving this article's ranking.

        Respond with a single, valid JSON object in this format:
        {{
          "title": "Your Generated Title",
          "content": "<p>Your <strong>HTML</strong> article content...</p><h2>Subtitle</h2><p>More content...</p>",
          "seo_suggestions": [
            "Suggestion 1...",
            "Suggestion 2...",
            "Suggestion 3..."
          ]
        }}
        """
        
        try:
            response = await self.model.generate_content_async(prompt)
            article_data = self._extract_json(response.text)
            return article_data
        except Exception as e:
            logging.error(f"AI Article Generation failed: {e}", exc_info=True)
            return {
                "title": "Error: Generation Failed",
                "content": "<p>Could not generate the article. Please check the backend logs.</p>",
                "seo_suggestions": []
            }

    async def generate_seo_boost(self, analysis_data: Dict) -> Dict:
        """
        Generates a proposed meta description based on existing page facts.
        """
        # Clean up the input description
        current_desc = analysis_data.get('meta_description', 'N/A')
        if not current_desc or current_desc.lower() == 'no meta description found.':
            current_desc = 'N/A'

        prompt = f"""
        You are an expert SEO copywriter.
        Based on this analysis of a webpage, generate what's missing.
        
        PAGE DATA:
        Title: {analysis_data.get('page_title', '')}
        Current Description: {current_desc}
        Content Quality: {analysis_data.get('content_quality', 'unknown')}
        
        Your task is to provide:
        1.  A new, compelling meta description (155 characters max). If the 'Current Description' is 'N/A', write a new one. If it already exists, write an *improved* version.
        Provide a JSON response with:
        {{
          "suggested_description": "Your generated meta description..."
        }}
        """
        try:
            response = await self.model.generate_content_async(prompt)
            boost_data = self._extract_json(response.text)
            return boost_data
        except Exception as e:
            logging.error(f"AI SEO Boost failed: {e}", exc_info=True)
            return {
                "suggested_description": "Error: Could not generate a description."
            }

    def _extract_json(self, text: str) -> Union[Dict, List]:
        """
        Robustly extracts a JSON object OR a JSON list from a string.
        """
        # First, try to find a JSON object
        try:
            start = text.find('{')
            end = text.rfind('}') + 1
            if start != -1 and end != 0:
                json_str = text[start:end].replace("```json", "").replace("```", "").strip()
                return json.loads(json_str)
        except Exception:
            pass  # If object parsing fails, try list parsing

        # If no object, try to find a JSON list
        try:
            start_list = text.find('[')
            end_list = text.rfind(']') + 1
            if start_list != -1 and end_list != 0:
                json_str = text[start_list:end_list].replace("```json", "").replace("```", "").strip()
                return json.loads(json_str)
        except Exception as e:
            logging.error("Failed to parse Gemini JSON: %s", type(e).__name__)
            pass
        
        return {
            "title": "Error: Parsing Failed",
            "content": "<p>Could not parse the AI's response. Please try again.</p>",
            "seo_suggestions": [],
            "suggested_description": "Error: Could not parse AI response."
        }
