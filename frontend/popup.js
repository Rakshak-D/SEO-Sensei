// DEMO/frontend/popup.js
document.addEventListener("DOMContentLoaded", () => {
    // Get all DOM elements
    const analyzeBtn = document.getElementById("analyzeBtn");
    const loader = document.getElementById("loader");
    const errorEl = document.getElementById("error");
    const resultsEl = document.getElementById("results");
    const welcomeEl = document.getElementById("welcome");
    const dashboardBtn = document.getElementById("dashboardBtn");
    const boostBtn = document.getElementById("boostBtn"); // <-- NEW

    // --- Result fields (from models.py) ---
    const scoreValueEl = document.getElementById("scoreValue");
    const scoreCardEl = document.getElementById("scoreCard");
    const suggestionsListEl = document.getElementById("suggestionsList");
    const issuesListEl = document.getElementById("issuesList");
    const strengthsListEl = document.getElementById("strengthsList");
    const qualityValueEl = document.getElementById("qualityValue");
    const pageTitleValueEl = document.getElementById("pageTitleValue");
    const keywordsListEl = document.getElementById("keywordsList");
    const toggleDetailsBtn = document.getElementById("toggleDetailsBtn");
    const extraDetailsEl = document.getElementById("extraDetails");
    const statusCodeValueEl = document.getElementById("statusCodeValue");
    const metaDescriptionValueEl = document.getElementById("metaDescriptionValue");
    const headersListEl = document.getElementById("headersList");

    // --- NEW: Boost Result Fields ---
    const boostResultsEl = document.getElementById("boostResults");
    const boostMetaEl = document.getElementById("boostMeta");
    const boostTagsEl = document.getElementById("boostTags");

    // API URLs
    const API_BASE_URL = "http://127.0.0.1:8000";
    const ANALYZE_API_URL = `${API_BASE_URL}/analyse-url`;
    const BOOST_API_URL = `${API_BASE_URL}/boost-seo`; // <-- NEW

    // --- NEW: State variable to hold analysis data ---
    let currentAnalysisData = null;

    // Main function to call the API
    const analyzePage = async () => {
        // 1. Set UI to Loading state
        showLoading();

        try {
            // 2. Get the active tab URL
            const [tab] = await chrome.tabs.query({
                active: true,
                currentWindow: true,
            });

            if (!tab.url) {
                showError("Could not get current tab URL.");
                return;
            }
            
            // 3. Call the backend
            const response = await fetch(ANALYZE_API_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url: tab.url }),
            });

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.detail || `HTTP error! Status: ${response.status}`);
            }

            const data = await response.json();
            
            // --- NEW: Store analysis data ---
            currentAnalysisData = data;

            // 4. Show results
            showResults(data);

        } catch (e) {
            console.error("Analysis failed:", e);
            showError(`⚠ ${e.message}`);
        }
    };

    // --- NEW: Function to get SEO Boost ---
    const getSeoBoost = async () => {
        if (!currentAnalysisData) {
            showError("No analysis data to boost.");
            return;
        }
        
        // Show loader, hide old boost results
        loader.style.display = "flex";
        boostResultsEl.style.display = "none";
        errorEl.style.display = "none";

        try {
            const response = await fetch(BOOST_API_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(currentAnalysisData), // Send full analysis data
            });

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.detail || `HTTP error! Status: ${response.status}`);
            }

            const boostData = await response.json();
            
            // Populate boost results
            boostMetaEl.textContent = boostData.suggested_description || "N/A";
            populateList(boostTagsEl, boostData.suggested_keywords, "No new tags generated.");
            
            // Show boost results
            loader.style.display = "none";
            boostResultsEl.style.display = "block";

        } catch (e) {
            console.error("Boost failed:", e);
            showError(`⚠ ${e.message}`);
        }
    };

    // --- UI State Functions ---

    function showLoading() {
        welcomeEl.style.display = "none";
        resultsEl.style.display = "none";
        errorEl.style.display = "none";
        loader.style.display = "flex";
        extraDetailsEl.style.display = "none";
        toggleDetailsBtn.textContent = "Show More Details";
        
        // --- NEW: Reset boost elements ---
        boostBtn.style.display = "none";
        boostResultsEl.style.display = "none";
        currentAnalysisData = null;
    }

    function showError(message) {
        loader.style.display = "none";
        welcomeEl.style.display = "none";
        resultsEl.style.display = "none";
        errorEl.textContent = message;
        errorEl.style.display = "block";
    }

    function showResults(data) {
        // 1. Set Score and Color
        scoreValueEl.textContent = `${data.seo_score}/100`;
        scoreCardEl.className = "score-card"; // Reset classes
        if (data.seo_score > 80) {
            scoreCardEl.classList.add("score-green");
        } else if (data.seo_score >= 60) {
            scoreCardEl.classList.add("score-yellow");
        } else {
            scoreCardEl.classList.add("score-red");
        }

        // 2. Populate AI lists
        populateList(suggestionsListEl, data.ai_suggestions);
        populateList(issuesListEl, data.critical_issues);
        populateList(strengthsListEl, data.strengths);

        // 3. Set Content Quality
        qualityValueEl.textContent = data.content_quality || "N/A";

        // 4. Populate Page Details
        pageTitleValueEl.textContent = data.page_title || "N/A";
        populateList(keywordsListEl, data.keywords, "No keywords found.");

        // 5. Populate Extra Details (hidden)
        statusCodeValueEl.textContent = data.status_code || "N/A";
        metaDescriptionValueEl.textContent = data.meta_description || "No meta description found.";
        
        populateHeadersList(headersListEl, data.headers);

        // 6. Show the results container
        loader.style.display = "none";
        welcomeEl.style.display = "none";
        errorEl.style.display = "none";
        resultsEl.style.display = "block";

        // --- NEW: Show the boost button ---
        boostBtn.style.display = "block";
    }

    // --- Helper Functions ---

    function populateList(listElement, items, emptyMessage = "None found.") {
        listElement.innerHTML = "";
        if (items && items.length > 0) {
            items.forEach(text => {
                const li = document.createElement("li");
                li.textContent = text;
                listElement.appendChild(li);
            });
        } else {
            const li = document.createElement("li");
            li.textContent = emptyMessage;
            li.className = "empty-list-item";
            if (listElement.id === 'keywordsList' || listElement.id === 'boostTags') {
                li.style.background = 'none';
                li.style.border = 'none';
                li.style.padding = '0';
            }
            listElement.appendChild(li);
        }
    }
    
    function populateHeadersList(element, headers) {
        element.innerHTML = "";
        let count = 0;
        const escapeHTML = (str) => str.replace(/[&<>"']/g, (match) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[match]));

        ['h1', 'h2', 'h3'].forEach(tag => {
            if (headers[tag] && headers[tag].length > 0) {
                headers[tag].forEach(text => {
                    const p = document.createElement("p");
                    p.innerHTML = `<strong>${tag.toUpperCase()}:</strong> ${escapeHTML(text)}`;
                    element.appendChild(p);
                    count++;
                });
            }
        });
        if (count === 0) {
            element.innerHTML = "<p>No H1, H2, or H3 tags found.</p>";
        }
    }
    
    function toggleExtraDetails() {
        const isHidden = extraDetailsEl.style.display === "none";
        extraDetailsEl.style.display = isHidden ? "block" : "none";
        toggleDetailsBtn.textContent = isHidden ? "Hide Details" : "Show More Details";
    }

    // --- Event Listeners ---
    analyzeBtn.addEventListener("click", analyzePage);
    toggleDetailsBtn.addEventListener("click", toggleExtraDetails);
    
    // --- NEW: Dashboard Button Listener ---
    dashboardBtn.addEventListener("click", () => {
        chrome.tabs.create({ url: "http://localhost:8501" });
    });

    // --- NEW: Boost Button Listener ---
    boostBtn.addEventListener("click", getSeoBoost);
});