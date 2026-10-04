"""SEO-Sensei Streamlit dashboard.

The dashboard is a presentation client only. All crawling, deterministic SEO
analysis, scoring, and Gemini work happens behind the authenticated FastAPI
API.
"""

from __future__ import annotations

import urllib.parse

import streamlit as st
from pydantic import ValidationError

from app.client.api_client import DashboardAPIClient, DashboardAPIError
from app.config import get_settings
from app.schemas.requests import ArticleGenerationRequest
from app.schemas.responses import URLAnalysisResponse


st.set_page_config(page_title="SEO-Sensei", page_icon="🧭", layout="wide", initial_sidebar_state="expanded")


def api_client() -> DashboardAPIClient | None:
    settings = get_settings()
    if not settings.api_base_url or not settings.dashboard_api_access_token:
        return None
    return DashboardAPIClient(settings.api_base_url, settings.dashboard_api_access_token, settings.request_timeout_seconds)


def basic_url_error(value: str) -> str | None:
    if not value.strip():
        return "Enter a URL to analyze."
    if len(value) > 2_048:
        return "That URL is too long."
    parsed = urllib.parse.urlsplit(value.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return "Use a complete HTTP or HTTPS URL."
    return None


def show_api_error(error: DashboardAPIError) -> None:
    if error.code == "rate_limited":
        retry = f" Try again in about {error.retry_after} seconds." if error.retry_after else " Try again later."
        st.warning(error.message + retry)
    elif error.code in {"auth_required", "auth_invalid", "configuration_error"}:
        st.error(error.message)
    elif error.code in {"invalid_url", "unsupported_url", "blocked_destination"}:
        st.warning(error.message)
    else:
        st.error(error.message)
    if error.request_id:
        st.caption(f"Request ID: `{error.request_id}`")


def render_score(analysis: URLAnalysisResponse) -> None:
    score = analysis.deterministic_score.overall_score
    st.subheader("Deterministic score")
    left, middle, right = st.columns([1, 2, 1])
    with left:
        st.metric("Overall", f"{score}/100")
    with middle:
        st.progress(score / 100, text=f"Engineering heuristic · {score}/100")
        st.caption("Reproducible from fetched HTML and transport metadata. Not a Google ranking prediction.")
    with right:
        st.metric("Visible words", analysis.lexical_signals.visible_word_count)

    st.markdown("**Category scores**")
    columns = st.columns(4)
    for index, category in enumerate(analysis.deterministic_score.categories):
        with columns[index % 4]:
            label = category.category.value.replace("_", " ").title()
            st.metric(label, f"{category.points_earned:.1f}/{category.max_points:.0f}")


def render_checks(analysis: URLAnalysisResponse) -> None:
    st.subheader("Deterministic findings")
    for status, label in (("fail", "Needs attention"), ("warning", "Watch list"), ("pass", "Passing checks")):
        checks = [check for check in analysis.checks if check.status.value == status]
        with st.expander(f"{label} · {len(checks)}", expanded=status == "fail"):
            if not checks:
                st.caption("None recorded.")
            for check in checks:
                st.write(check.title, f"({check.id})")
                st.write(check.evidence.observed)
                st.caption(check.recommendation)


def render_report(analysis: URLAnalysisResponse) -> None:
    render_score(analysis)
    st.divider()
    overview, technical, content, sharing = st.tabs(["Overview", "Technical", "Content", "Sharing"])
    with overview:
        metadata = analysis.metadata
        st.subheader("Page metadata")
        st.write("Title:", metadata.title or "Missing", f"({metadata.title_length} characters)")
        st.write("Description:", metadata.description or "Missing", f"({metadata.description_length} characters)")
        st.write("Canonical:", metadata.canonical_resolved or metadata.canonical or "Missing")
        st.write("Robots:", ", ".join(metadata.robots_directives) or "No directives detected")
        st.subheader("Fetch metadata")
        st.write("Final URL:", analysis.final_url)
        st.write("HTTP status:", analysis.fetch.status_code)
        st.write("Content type:", analysis.fetch.content_type or "unknown content type")
        st.write("Bytes:", f"{analysis.fetch.bytes_read:,}", "· elapsed:", f"{analysis.fetch.elapsed_time:.2f}s")
        st.write("Redirects:", analysis.fetch.redirect_count, "· HTTPS:", analysis.final_url.startswith("https://"))
    with technical:
        st.subheader("Technical and indexability")
        st.json(
            {
                "language": analysis.metadata.language,
                "viewport": analysis.metadata.viewport,
                "charset": analysis.metadata.charset,
                "mixed_content_references": analysis.metadata.mixed_content_reference_count,
                "hreflang_links": [link.model_dump() for link in analysis.hreflang.links],
                "malformed_hreflang": analysis.hreflang.malformed_count,
            }
        )
        st.subheader("Images")
        st.json(analysis.images.model_dump())
        st.subheader("Links")
        st.json(analysis.links.model_dump())
    with content:
        st.subheader("Heading structure")
        st.write(f"H1: {len(analysis.headings.h1)} · H2: {len(analysis.headings.h2)} · H3: {len(analysis.headings.h3)}")
        if analysis.headings.h1:
            st.write("H1 headings:", analysis.headings.h1)
        if analysis.headings.hierarchy_jumps:
            st.warning("Heading jumps: " + ", ".join(analysis.headings.hierarchy_jumps))
        st.subheader("Lexical signals")
        st.caption("Frequent terms are descriptive signals, not inferred keywords or ranking factors.")
        st.write([(term.term, term.count) for term in analysis.lexical_signals.frequent_terms])
        st.subheader("Structured data")
        st.json(analysis.structured_data.model_dump())
    with sharing:
        st.subheader("Social metadata")
        st.json(analysis.social_metadata.model_dump())

    render_checks(analysis)
    st.divider()
    st.subheader("Optional AI recommendations")
    st.caption("Gemini interprets deterministic findings; it never changes the score.")
    ai = analysis.ai_recommendations
    if ai is None:
        st.info("AI recommendations were not requested.")
    elif ai.state.value != "available":
        st.info(ai.message or "AI recommendations are unavailable. The deterministic report remains authoritative.")
    else:
        for recommendation in ai.recommendations:
            with st.expander(f"{recommendation.priority.value.upper()} · {recommendation.issue}"):
                st.write(recommendation.explanation)
                st.write("Action:", recommendation.recommendation)
                if recommendation.evidence:
                    st.caption(f"Evidence: {recommendation.evidence}")


st.title("SEO-Sensei")
st.caption("A disciplined SEO workbench: inspect what the page actually exposes, then decide what to improve.")

client = api_client()
if client is None:
    st.error("Dashboard API configuration is incomplete. Set API_BASE_URL and DASHBOARD_API_ACCESS_TOKEN in the dashboard environment.")
else:
    with st.sidebar:
        st.subheader("API connection")
        st.caption("Server-side credentials are used by this dashboard process and are never shown in the page.")
        if st.button("Check API health", use_container_width=True):
            try:
                health = client.health()
                st.success(f"API online · {health.environment}")
                if health.status != "ok":
                    st.warning("The API is reachable but reports degraded optional services.")
            except DashboardAPIError as error:
                show_api_error(error)

    st.header("Analyze a page")
    with st.form("analysis_form"):
        url = st.text_input("Page URL", placeholder="https://example.com", help="The API performs all fetching and SSRF checks.")
        include_ai = st.checkbox("Request optional Gemini recommendations", value=True)
        submitted = st.form_submit_button("Analyze page", type="primary", use_container_width=True)

    if submitted:
        validation_error = basic_url_error(url)
        if validation_error:
            st.warning(validation_error)
        else:
            with st.spinner("Sending the page to the SEO-Sensei API…"):
                try:
                    st.session_state.analysis = client.analyze_url(url.strip(), include_ai_recommendations=include_ai)
                    st.session_state.analysis_url = url.strip()
                except DashboardAPIError as error:
                    show_api_error(error)
                except ValidationError:
                    st.error("The API response could not be displayed safely.")

    analysis = st.session_state.get("analysis")
    if isinstance(analysis, URLAnalysisResponse):
        st.caption("Analyzing URL")
        st.code(st.session_state.get("analysis_url", analysis.requested_url), language=None)
        render_report(analysis)

    st.divider()
    st.header("Content tools")
    st.caption("These actions use the authenticated API and are separate from the deterministic score.")
    article_tab, boost_tab = st.tabs(["Article draft", "Meta description boost"])
    with article_tab:
        with st.form("article_form"):
            topic = st.text_input("Topic", max_chars=500)
            keywords = st.text_input("Related terms (comma separated)")
            tone = st.selectbox("Tone", ["professional", "friendly", "authoritative", "witty", "conversational"])
            article_submitted = st.form_submit_button("Generate article", use_container_width=True)
        if article_submitted:
            try:
                request = ArticleGenerationRequest(
                    topic=topic,
                    keywords=[item.strip() for item in keywords.split(",") if item.strip()][:20],
                    tone=tone,
                )
                with st.spinner("Generating a bounded plain-text draft…"):
                    article = client.generate_article(request)
                st.success(article.title)
                st.text_area("Generated article", article.content, height=360, disabled=True)
                if article.seo_suggestions:
                    st.write("Suggestions", article.seo_suggestions)
            except ValidationError:
                st.warning("Enter a topic and keep the related-term list within the configured limits.")
            except DashboardAPIError as error:
                show_api_error(error)
    with boost_tab:
        with st.form("boost_form"):
            boost_url = st.text_input("URL to improve", value=st.session_state.get("analysis_url", ""))
            boost_submitted = st.form_submit_button("Suggest a description", use_container_width=True)
        if boost_submitted:
            validation_error = basic_url_error(boost_url)
            if validation_error:
                st.warning(validation_error)
            else:
                try:
                    with st.spinner("Analyzing the page and drafting a description…"):
                        boost = client.boost_seo(boost_url.strip())
                    st.write(boost.suggested_description)
                except DashboardAPIError as error:
                    show_api_error(error)
                except ValidationError:
                    st.warning("Enter a valid HTTP or HTTPS URL.")

st.caption("SEO-Sensei · deterministic evidence first, optional AI second")
