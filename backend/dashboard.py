# DEMO/backend/dashboard.py
import streamlit as st
import plotly.graph_objects as go
import plotly.express as px
import asyncio
import os
import logging
from dotenv import load_dotenv
from typing import Dict, Any
import urllib.parse

# Import your existing utilities
from seo_crawler import get_full_seo_analysis_for_url
from utils.gemini_helper import GeminiService

# --- Page & Service Setup ---
st.set_page_config(
    page_title="Metamorph SEO Dashboard", 
    layout="wide",
    initial_sidebar_state="collapsed"
)

# --- PROFESSIONAL STYLING (Clean, Aligned, Modern Dark Theme) ---
st.markdown("""
<style>
/* Global Typography and Reset */
* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}
body, [data-testid="stAppViewContainer"] {
    background: linear-gradient(135deg, #0f1419 0%, #1a2332 50%, #0a0e17 100%);
    background-attachment: fixed;
    font-family: 'Inter', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    color: #e2e8f0;
    line-height: 1.6;
}

/* Main Container */
.main .block-container {
    padding: 1rem 2rem;
    max-width: 1400px;
    margin: 0 auto;
}

/* Hero Section - Centered and Prominent */
.hero-section {
    text-align: center;
    padding: 4rem 2rem;
    background: rgba(15, 20, 25, 0.6);
    border-radius: 24px;
    margin-bottom: 4rem;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
    border: 1px solid rgba(59, 130, 246, 0.1);
    border-bottom: 2px solid rgba(59, 130, 246, 0.3);
}

.main-title {
    font-size: 4rem !important;
    font-weight: 800 !important;
    color: #3b82f6 !important;
    margin-bottom: 1rem;
    letter-spacing: -0.025em;
    text-shadow: 0 2px 10px rgba(59, 130, 246, 0.3);
}

.subtitle {
    font-size: 1.25rem !important;
    color: #94a3b8 !important;
    font-weight: 400 !important;
    max-width: 600px;
    margin: 0 auto;
}

/* Section Headers - Aligned with Icon */
.section-header {
    display: flex;
    align-items: center;
    margin-bottom: 2rem;
    padding-bottom: 1rem;
    border-bottom: 2px solid rgba(59, 130, 246, 0.2);
}

.section-icon {
    font-size: 2.5rem;
    margin-right: 1rem;
    flex-shrink: 0;
}

.section-title {
    color: #f8fafc !important;
    font-size: 2.25rem !important;
    font-weight: 700 !important;
    margin: 0 !important;
    letter-spacing: -0.01em;
}

/* Glassmorphism Containers - Subtle and Clean */
.glass-container {
    background: rgba(15, 20, 25, 0.6);
    border: 1px solid rgba(59, 130, 246, 0.15);
    border-radius: 20px;
    padding: 3rem;
    margin-bottom: 3rem;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
    position: relative;
    overflow: hidden;
    border-top: 2px solid rgba(59, 130, 246, 0.3);
}

.glass-container::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 1px;
    background: rgba(59, 130, 246, 0.3);
}

/* Sub-cards for Analysis */
.analysis-card {
    background: rgba(20, 25, 30, 0.6);
    border: 1px solid rgba(59, 130, 246, 0.1);
    border-radius: 16px;
    padding: 2rem;
    margin: 1.5rem 0;
}

.score-display {
    font-size: 4rem !important;
    font-weight: 900 !important;
    color: #3b82f6 !important;
    text-align: center;
    margin: 1.5rem 0;
    text-shadow: 0 2px 10px rgba(59, 130, 246, 0.3);
}

/* Inputs - Clean and Aligned */
[data-testid="stTextInput"] input, 
[data-testid="stSelectbox"] div > div > div {
    background: rgba(20, 25, 30, 0.8) !important;
    color: #f8fafc !important;
    border: 1px solid rgba(59, 130, 246, 0.3) !important;
    border-radius: 12px !important;
    padding: 1rem !important;
    font-size: 1rem !important;
}

[data-testid="stTextInput"] label, 
[data-testid="stSelectbox"] label {
    color: #94a3b8 !important;
    font-weight: 500 !important;
    margin-bottom: 0.5rem !important;
}

/* Buttons - Professional Hover Effects */
[data-testid="stButton"] button {
    background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%) !important;
    color: #ffffff !important;
    border: none !important;
    border-radius: 12px !important;
    padding: 1rem 2rem !important;
    font-weight: 600 !important;
    font-size: 1rem !important;
    box-shadow: 0 4px 14px rgba(59, 130, 246, 0.3) !important;
    transition: all 0.2s ease !important;
    min-height: 44px !important;
}

[data-testid="stButton"] button:hover {
    transform: translateY(-1px) !important;
    box-shadow: 0 6px 20px rgba(59, 130, 246, 0.4) !important;
    background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%) !important;
}

/* Metrics - Use Streamlit's Built-in for Better Alignment */
[data-testid="metric-container"] {
    background: rgba(20, 25, 30, 0.6) !important;
    border: 1px solid rgba(59, 130, 246, 0.1) !important;
    border-radius: 16px !important;
    padding: 1.5rem !important;
    text-align: center !important;
    margin: 1rem 0 !important;
}

[data-testid="metric-container"] .stMetricLabel {
    color: #94a3b8 !important;
    font-size: 0.95rem !important;
    font-weight: 500 !important;
}

[data-testid="metric-container"] .stMetricValue {
    color: #f8fafc !important;
    font-size: 2.5rem !important;
    font-weight: 700 !important;
}

/* List Items - Clean Bullets */
.strength-item, .issue-item, .keyword-item, .idea-item {
    padding: 1rem;
    margin: 0.75rem 0;
    border-left: 4px solid #10b981;
    background: rgba(16, 185, 129, 0.1);
    border-radius: 0 12px 12px 0;
    padding-left: 1.5rem;
    font-size: 1rem;
    line-height: 1.5;
}

.issue-item {
    border-left-color: #ef4444;
    background: rgba(239, 68, 68, 0.1);
}

.keyword-item, .idea-item {
    border-left-color: #f59e0b;
    background: rgba(245, 158, 11, 0.1);
}

/* Plotly - Clean and Bordered */
.plotly-chart {
    border-radius: 16px !important;
    overflow: hidden !important;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2) !important;
    margin: 2rem 0 !important;
}

/* Fix Legend for Long Names */
.plotly .legend {
    padding: 0.5rem !important;
    background: rgba(15, 20, 25, 0.8) !important;
    border-radius: 8px !important;
    border: 1px solid rgba(59, 130, 246, 0.2) !important;
}

.plotly .legendtext {
    font-size: 0.85rem !important;
    max-width: 200px !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
    white-space: nowrap !important;
    color: #e2e8f0 !important;
}

/* Form Alignment */
[data-testid="column"] > div {
    width: 100% !important;
}

/* Descriptions and Infos */
.stInfo, .stWarning, .stError, .stSuccess {
    border-radius: 12px !important;
    border: none !important;
    padding: 1rem !important;
    margin: 1rem 0 !important;
}

.stInfo {
    background-color: rgba(34, 197, 94, 0.1) !important;
    border-left: 4px solid #22c55e !important;
}

.stWarning {
    background-color: rgba(245, 158, 11, 0.1) !important;
    border-left: 4px solid #f59e0b !important;
}

.stError {
    background-color: rgba(239, 68, 68, 0.1) !important;
    border-left: 4px solid #ef4444 !important;
}

.stSuccess {
    background-color: rgba(34, 197, 94, 0.1) !important;
    border-left: 4px solid #22c55e !important;
}

/* Footer */
.footer {
    text-align: center;
    color: #64748b;
    padding: 3rem 2rem;
    background: rgba(15, 20, 25, 0.6);
    border-radius: 20px;
    margin-top: 4rem;
    border: 1px solid rgba(59, 130, 246, 0.1);
    font-size: 1.1rem;
    font-weight: 500;
}

/* Responsive */
@media (max-width: 768px) {
    .main-title { font-size: 2.75rem !important; }
    .section-title { font-size: 1.75rem !important; }
    .glass-container { padding: 2rem !important; }
    .plotly .legend { 
        flex-direction: column !important; 
        align-items: flex-start !important; 
    }
}
</style>
""", unsafe_allow_html=True)

# --- HERO SECTION ---
st.markdown("""
<div class="hero-section">
    <h1 class="main-title">🚀 Metamorph SEO Dashboard</h1>
    <p class="subtitle">Advanced AI-Powered SEO Intelligence Platform – Unlock Insights, Optimize Effortlessly</p>
</div>
""", unsafe_allow_html=True)

# --- ASYNC EVENT LOOP FIX ---
@st.cache_resource
def get_event_loop():
    try:
        loop = asyncio.get_event_loop_policy().get_event_loop()
    except RuntimeError as e:
        if "There is no current event loop in thread" in str(e):
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
        else:
            raise
    return loop

def run_async_in_session(coro):
    loop = get_event_loop()
    return loop.run_until_complete(coro)

loop = get_event_loop()

# Load environment variables
load_dotenv()

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

@st.cache_resource
def get_gemini_service():
    try:
        return GeminiService()
    except ValueError as e:
        st.error("Fatal Error: GEMINI_API_KEY not found. Please set it in .env file.")
        return None

service = get_gemini_service()

# --- Re-usable Data Fetcher ---
async def get_analysis_data_async(url: str, service_instance: GeminiService) -> Dict[str, Any]:
    if not service_instance:
        return {"error": "Gemini Service not initialized."}
    
    try:
        scraped_data = await get_full_seo_analysis_for_url(url)
        
        if not scraped_data or scraped_data.get("status") == "failed":
            error_msg = f"Failed to scrape {url}. Status: {scraped_data.get('status_code')}"
            logging.warning(error_msg)
            return {"error": error_msg}
        
        ai_analysis = await service_instance.analyze_seo_with_ai(scraped_data)
        
        return {**scraped_data, **ai_analysis}
    
    except Exception as e:
        logging.error(f"Error analyzing {url}: {e}", exc_info=True)
        return {"error": f"An error occurred: {e}"}

# --- Section 1: Site vs. Site Comparison ---
st.markdown('<div class="glass-container">', unsafe_allow_html=True)
st.markdown("""
<div class="section-header">
    <span class="section-icon">🏆</span>
    <h2 class="section-title">Site vs. Site Comparison</h2>
</div>
""", unsafe_allow_html=True)
st.markdown("""
<p style="color: #94a3b8; font-size: 1.1rem; margin-bottom: 2rem; max-width: 800px;">
    Compare two websites side-by-side to uncover strengths, weaknesses, and optimization opportunities on core SEO metrics.
</p>
""", unsafe_allow_html=True)

# Inputs with Labels
col1, col2 = st.columns([1, 1], gap="medium")
with col1:
    st.markdown("<label style='color: #94a3b8; font-weight: 500; margin-bottom: 0.5rem; display: block;'>Website 1</label>", unsafe_allow_html=True)
    url1 = st.text_input("", placeholder="https://example.com", key="url1_input")
with col2:
    st.markdown("<label style='color: #94a3b8; font-weight: 500; margin-bottom: 0.5rem; display: block;'>Website 2</label>", unsafe_allow_html=True)
    url2 = st.text_input("", placeholder="https://competitor.com", key="url2_input")

# Buttons
col_btn1, col_btn2 = st.columns([1, 1], gap="medium")
with col_btn1:
    compare_btn = st.button("🔍 Compare Sites", type="primary", use_container_width=True)
with col_btn2:
    clear_btn = st.button("🗑️ Clear Comparison", use_container_width=True)

if compare_btn:
    if service and url1 and url2:
        with st.spinner(f"🔍 Analyzing {url1} and {url2}..."):
            async def run_analyses():
                task1 = get_analysis_data_async(url1, service)
                task2 = get_analysis_data_async(url2, service)
                results = await asyncio.gather(task1, task2, return_exceptions=True)
                return results
            
            results = run_async_in_session(run_analyses())
            
            st.session_state.data1 = results[0] if not isinstance(results[0], Exception) else {"error": str(results[0])}
            st.session_state.data2 = results[1] if not isinstance(results[1], Exception) else {"error": str(results[1])}
    else:
        st.warning("⚠️ Please enter two valid URLs to compare.")

if clear_btn:
    st.session_state.pop('data1', None)
    st.session_state.pop('data2', None)
    st.success("Comparison cleared!")

# Display Results
if 'data1' in st.session_state and 'data2' in st.session_state:
    data1 = st.session_state.data1
    data2 = st.session_state.data2
    
    if "error" in data1:
        st.error(f"❌ Error analyzing {url1}: {data1['error']}")
    if "error" in data2:
        st.error(f"❌ Error analyzing {url2}: {data2['error']}")
    
    if "error" not in data1 and "error" not in data2:
        st.markdown("""
        <div class="section-header">
            <span class="section-icon">📊</span>
            <h3 style="color: #f8fafc; font-size: 1.75rem; font-weight: 600;">High-Level Comparison</h3>
        </div>
        """, unsafe_allow_html=True)
        
        # Improved Bar Chart with Truncated Names
        parsed_url1 = urllib.parse.urlparse(url1)
        domain1 = parsed_url1.netloc.replace('www.', '') if parsed_url1.netloc else 'Site 1'
        parsed_url2 = urllib.parse.urlparse(url2)
        domain2 = parsed_url2.netloc.replace('www.', '') if parsed_url2.netloc else 'Site 2'
        
        fig = go.Figure()
        fig.add_trace(go.Bar(
            name=domain1, 
            x=['SEO Score'], 
            y=[data1.get('seo_score', 0)], 
            marker_color='#3b82f6',
            marker_line_color='#60a5fa',
            marker_line_width=2,
            text=[f"{data1.get('seo_score', 0)}/100"],
            textposition='auto'
        ))
        fig.add_trace(go.Bar(
            name=domain2, 
            x=['SEO Score'], 
            y=[data2.get('seo_score', 0)], 
            marker_color='#ef4444',
            marker_line_color='#f87171',
            marker_line_width=2,
            text=[f"{data2.get('seo_score', 0)}/100"],
            textposition='auto'
        ))
        
        fig.update_layout(
            title_text='SEO Score Comparison',
            title_font=dict(size=20, color='#f8fafc'),
            plot_bgcolor='rgba(0,0,0,0)',
            paper_bgcolor='rgba(0,0,0,0)',
            font=dict(color='#e2e8f0', size=14),
            showlegend=True,
            legend=dict(
                orientation="h",
                yanchor="bottom",
                y=1.02,
                xanchor="right",
                x=1,
                bgcolor='rgba(15, 20, 25, 0.9)',
                bordercolor='rgba(59, 130, 246, 0.3)',
                borderwidth=1
            ),
            bargap=0.3,
            margin=dict(t=60, b=20, l=0, r=0),
            height=400
        )
        st.plotly_chart(fig, use_container_width=True)

        # Side-by-Side Columns
        col_res1, col_res2 = st.columns(2, gap="large")
        
        with col_res1:
            st.markdown(f"""
            <div style="text-align: center; margin-bottom: 2rem;">
                <h4 style="color: #f8fafc; font-size: 1.5rem; margin-bottom: 1rem;">🌐 {domain1.capitalize()}</h4>
                <div class="score-display">{data1.get("seo_score", 0)}/100</div>
            </div>
            """, unsafe_allow_html=True)
            
            col_m1, col_m2 = st.columns(2)
            with col_m1:
                st.metric("SEO Score", f"{data1.get('seo_score', 0)}", delta=None)
            with col_m2:
                st.metric("Content Quality", data1.get('content_quality', 'N/A').title())
            
            with st.container():
                st.markdown('<h5 style="color: #10b981; margin-bottom: 1rem;">✅ Strengths</h5>', unsafe_allow_html=True)
                strengths1 = data1.get('strengths', [])
                if strengths1:
                    for item in strengths1:
                        st.markdown(f'<div class="strength-item">{item}</div>', unsafe_allow_html=True)
                else:
                    st.info("No strengths identified yet.")
            
            with st.container():
                st.markdown('<h5 style="color: #ef4444; margin-bottom: 1rem;">❌ Critical Issues</h5>', unsafe_allow_html=True)
                issues1 = data1.get('critical_issues', [])
                if issues1:
                    for item in issues1:
                        st.markdown(f'<div class="issue-item">{item}</div>', unsafe_allow_html=True)
                else:
                    st.success("No critical issues detected!")

        with col_res2:
            st.markdown(f"""
            <div style="text-align: center; margin-bottom: 2rem;">
                <h4 style="color: #f8fafc; font-size: 1.5rem; margin-bottom: 1rem;">🌐 {domain2.capitalize()}</h4>
                <div class="score-display">{data2.get("seo_score", 0)}/100</div>
            </div>
            """, unsafe_allow_html=True)
            
            col_m3, col_m4 = st.columns(2)
            with col_m3:
                st.metric("SEO Score", f"{data2.get('seo_score', 0)}", delta=None)
            with col_m4:
                st.metric("Content Quality", data2.get('content_quality', 'N/A').title())
            
            with st.container():
                st.markdown('<h5 style="color: #10b981; margin-bottom: 1rem;">✅ Strengths</h5>', unsafe_allow_html=True)
                strengths2 = data2.get('strengths', [])
                if strengths2:
                    for item in strengths2:
                        st.markdown(f'<div class="strength-item">{item}</div>', unsafe_allow_html=True)
                else:
                    st.info("No strengths identified yet.")
            
            with st.container():
                st.markdown('<h5 style="color: #ef4444; margin-bottom: 1rem;">❌ Critical Issues</h5>', unsafe_allow_html=True)
                issues2 = data2.get('critical_issues', [])
                if issues2:
                    for item in issues2:
                        st.markdown(f'<div class="issue-item">{item}</div>', unsafe_allow_html=True)
                else:
                    st.success("No critical issues detected!")

st.markdown('</div>', unsafe_allow_html=True)

# --- Section 2: Gap Analysis & Content Generation ---
st.markdown('<div class="glass-container">', unsafe_allow_html=True)
st.markdown("""
<div class="section-header">
    <span class="section-icon">🔍</span>
    <h2 class="section-title">Gap Analysis & Content Generation</h2>
</div>
""", unsafe_allow_html=True)
st.markdown("""
<p style="color: #94a3b8; font-size: 1.1rem; margin-bottom: 2rem; max-width: 800px;">
    Dive deep into your site's SEO gaps and leverage AI to generate tailored content strategies and drafts.
</p>
""", unsafe_allow_html=True)

gap_url = st.text_input("Enter your URL for gap analysis", placeholder="https://my-website.com", key="gap_url_input", label_visibility="collapsed")

if st.button("📊 Analyze Gaps", type="primary", use_container_width=True):
    if service and gap_url:
        with st.spinner("🔍 Analyzing SEO gaps..."):
            async def run_gap_analysis():
                analysis_data = await get_analysis_data_async(gap_url, service)
                
                if "error" in analysis_data:
                    return analysis_data, None
                
                gap_prompt = f"""
                Analyze this webpage's SEO data: {analysis_data}
                Compare this to an 'ideal' website (100/100 SEO score).
                Identify critical gaps. Suggest 3-5 'lacking keywords' 
                and 3-5 'new content ideas' to fill these gaps.
                
                Return a single, valid JSON object:
                {{
                    "gap_summary": "A concise summary of key gaps (1-2 sentences).",
                    "lacking_keywords": ["keyword1", "keyword2"],
                    "content_ideas": ["Idea 1: Title and brief description", "Idea 2: ..."]
                }}
                """
                gap_response = await service.model.generate_content_async(gap_prompt)
                gap_data = service._extract_json(gap_response.text)
                
                return analysis_data, gap_data
            
            analysis_data, gap_data = run_async_in_session(run_gap_analysis())

            if "error" in analysis_data:
                st.error(analysis_data['error'])
            else:
                st.session_state.analysis_data = analysis_data
                st.session_state.gap_data = gap_data
    else:
        st.warning("⚠️ Please enter a valid URL to analyze.")

# Display Gap Results
if 'gap_data' in st.session_state:
    analysis_data = st.session_state.analysis_data
    gap_data = st.session_state.gap_data
    
    if not gap_data or not isinstance(gap_data, dict) or "gap_summary" not in gap_data:
         st.error("❌ AI gap analysis failed to return valid data. Please try again.")
    else:
        # Gauge Chart
        fig = go.Figure(go.Indicator(
            mode="gauge+number+delta",
            value=analysis_data.get('seo_score', 0),
            title={'text': "Overall SEO Score", 'font': {'color': '#f8fafc', 'size': 24}},
            delta={'reference': 80},
            gauge={
                'axis': {'range': [None, 100], 'tickwidth': 1, 'tickcolor': "#94a3b8"},
                'bar': {'color': "#3b82f6"},
                'bgcolor': "rgba(0,0,0,0)",
                'borderwidth': 2,
                'bordercolor': "rgba(59, 130, 246, 0.2)",
                'steps': [
                    {'range': [0, 50], 'color': 'rgba(239, 68, 68, 0.3)'},
                    {'range': [50, 80], 'color': 'rgba(245, 158, 11, 0.3)'},
                    {'range': [80, 100], 'color': 'rgba(16, 185, 129, 0.3)'}],
                'threshold': {
                    'line': {'color': "rgba(16, 185, 129, 1)", 'width': 4},
                    'thickness': 0.75,
                    'value': 90}
            }
        ))
        fig.update_layout(
            plot_bgcolor='rgba(0,0,0,0)',
            paper_bgcolor='rgba(0,0,0,0)',
            font={'color': "#e2e8f0", 'family': "Inter"},
            height=350,
            margin=dict(l=20, r=20, t=50, b=20)
        )
        st.plotly_chart(fig, use_container_width=True)

        st.markdown("""
        <div class="section-header">
            <span class="section-icon">📋</span>
            <h3 style="color: #f8fafc; font-size: 1.75rem; font-weight: 600;">AI-Powered Gap Summary</h3>
        </div>
        """, unsafe_allow_html=True)
        st.info(gap_data.get('gap_summary', 'No summary available.'))
        
        # Columns for Keywords and Ideas
        col_k, col_i = st.columns(2, gap="large")
        with col_k:
            st.markdown('<h4 style="color: #f8fafc; margin-bottom: 1rem;">🔑 Lacking Keywords</h4>', unsafe_allow_html=True)
            keywords = gap_data.get('lacking_keywords', [])
            if keywords:
                for i, keyword in enumerate(keywords, 1):
                    st.markdown(f'<div class="keyword-item"><strong>{i}.</strong> {keyword}</div>', unsafe_allow_html=True)
            else:
                st.info("No lacking keywords identified.")
                
        with col_i:
            st.markdown('<h4 style="color: #f8fafc; margin-bottom: 1rem;">💡 New Content Ideas</h4>', unsafe_allow_html=True)
            ideas = gap_data.get('content_ideas', [])
            if ideas:
                for i, idea in enumerate(ideas, 1):
                    st.markdown(f'<div class="idea-item"><strong>{i}.</strong> {idea}</div>', unsafe_allow_html=True)
            else:
                st.info("No content ideas generated.")

        # Content Generation
        st.markdown("""
        <div class="section-header">
            <span class="section-icon">✍️</span>
            <h3 style="color: #f8fafc; font-size: 1.75rem; font-weight: 600;">AI Content Generation</h3>
        </div>
        <p style="color: #94a3b8; margin-bottom: 2rem;">Select an idea and tone to craft a professional article draft optimized for SEO.</p>
        """, unsafe_allow_html=True)
        
        with st.form("content_gen_form", clear_on_submit=False):
            col_f1, col_f2 = st.columns(2, gap="medium")
            with col_f1:
                content_ideas_list = gap_data.get('content_ideas', [])
                idea = st.selectbox("Select Content Idea", options=content_ideas_list if content_ideas_list else ["No ideas available"])
            with col_f2:
                tone = st.selectbox("Content Tone", options=["Professional", "Friendly", "Authoritative", "Witty", "Conversational"])
            
            submitted = st.form_submit_button("🚀 Generate Draft", use_container_width=True)
            
            if submitted and idea != "No ideas available":
                with st.spinner(f"✍️ Generating content for '{idea}'..."):
                    async def run_article_gen():
                        return await service.generate_article_with_ai(
                            topic=idea,
                            keywords=gap_data.get('lacking_keywords', []),
                            tone=tone
                        )
                    
                    article_data = run_async_in_session(run_article_gen())
                
                if article_data:
                    st.success("✅ Content generated successfully!")
                    st.markdown(f'<h4 style="color: #f8fafc; text-align: center; margin-bottom: 1.5rem;">📝 {article_data.get("title", "Generated Article")}</h4>', unsafe_allow_html=True)
                    
                    st.markdown(f"""
                    <div style="
                        background: rgba(20, 25, 30, 0.6);
                        border: 1px solid rgba(59, 130, 246, 0.1);
                        border-radius: 16px;
                        padding: 2rem;
                        margin: 1.5rem 0;
                        color: #e2e8f0;
                        line-height: 1.8;
                        max-height: 500px;
                        overflow-y: auto;
                        font-size: 1.05rem;
                    ">
                        {article_data.get('content', 'Content generation encountered an issue.')}
                    </div>
                    """, unsafe_allow_html=True)
                    
                    st.markdown('<h4 style="color: #f8fafc; margin-bottom: 1rem;">🎯 Integrated SEO Suggestions</h4>', unsafe_allow_html=True)
                    suggestions = article_data.get('seo_suggestions', [])
                    if suggestions:
                        for i, suggestion in enumerate(suggestions, 1):
                            st.markdown(f'<div class="strength-item"><strong>{i}.</strong> {suggestion}</div>', unsafe_allow_html=True)
                    else:
                        st.info("General SEO best practices apply – focus on keyword density and readability.")

st.markdown('</div>', unsafe_allow_html=True)

# --- Section 3: Competitor Finder ---
st.markdown('<div class="glass-container">', unsafe_allow_html=True)
st.markdown("""
<div class="section-header">
    <span class="section-icon">🎯</span>
    <h2 class="section-title">Top Competitor Finder</h2>
</div>
""", unsafe_allow_html=True)
st.markdown("""
<p style="color: #94a3b8; font-size: 1.1rem; margin-bottom: 2rem; max-width: 800px;">
    Identify your fiercest competitors in the niche – get actionable intel to outrank them.
</p>
""", unsafe_allow_html=True)

with st.form("competitor_form"):
    col_c1, col_c2 = st.columns(2, gap="medium")
    with col_c1:
        comp_domain = st.text_input("Your Domain", placeholder="my-website.com")
    with col_c2:
        comp_industry = st.text_input("Industry/Niche", placeholder="e.g., E-commerce Fashion or SaaS Tools")
    
    submitted = st.form_submit_button("🔍 Discover Competitors", type="primary", use_container_width=True)

    if submitted:
        if service and comp_domain and comp_industry:
            with st.spinner(f"🌐 Researching competitors for {comp_domain} in {comp_industry}..."):
                async def run_competitor_find():
                    competitor_prompt = f"""
                    As an elite SEO expert, for domain {comp_domain} in {comp_industry}, 
                    list the top 5 most direct, high-authority competitors. 
                    Focus on sites with similar audience, content, and traffic.
                    
                    Respond ONLY with a JSON array of clean domain URLs: ["example.com", "competitor2.com"]
                    """
                    comp_response = await service.model.generate_content_async(competitor_prompt)
                    return service._extract_json(comp_response.text)

                competitors = run_async_in_session(run_competitor_find())
                
                if competitors and isinstance(competitors, list) and len(competitors) > 0:
                    st.success(f"✅ Identified {len(competitors)} top competitors!")
                    st.markdown(f'<h3 style="color: #f8fafc; text-align: center; margin-bottom: 2rem;">🏅 Key Competitors in {comp_industry}</h3>', unsafe_allow_html=True)
                    
                    for i, competitor in enumerate(competitors[:5], 1):  # Limit to 5
                        st.markdown(f"""
                        <div style="
                            background: rgba(20, 25, 30, 0.6);
                            border: 1px solid rgba(59, 130, 246, 0.2);
                            border-radius: 12px;
                            padding: 1.5rem;
                            margin: 1rem 0;
                            text-align: center;
                            transition: all 0.2s ease;
                        " onmouseover="this.style.background='rgba(59, 130, 246, 0.1)';" onmouseout="this.style.background='rgba(20, 25, 30, 0.6)';">
                            <strong style="color: #3b82f6; font-size: 1.2rem;">{i}.</strong> 
                            <a href="https://{competitor}" target="_blank" style="color: #60a5fa; text-decoration: none; font-weight: 500;">{competitor}</a>
                        </div>
                        """, unsafe_allow_html=True)
                    
                    st.info("💡 Pro Tip: Paste these domains into the comparison tool above for a full SEO breakdown.")
                else:
                    st.error("❌ Unable to generate competitors. Refine your industry description and try again.")
        else:
            st.warning("⚠️ Provide both your domain and industry for accurate results.")

st.markdown('</div>', unsafe_allow_html=True)

# --- Footer ---
st.markdown("""
<div class="footer">
    © 2025 Metamorph SEO Dashboard | Elevate Your Search Game
</div>
""", unsafe_allow_html=True)