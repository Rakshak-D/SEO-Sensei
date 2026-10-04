document.addEventListener("DOMContentLoaded", () => {
    // Get all DOM elements
    const analyzeBtn = document.getElementById("analyzeBtn");
    const loader = document.getElementById("loader");
    const errorEl = document.getElementById("error");
    const resultsEl = document.getElementById("results");
    const welcomeEl = document.getElementById("welcome");
    const dashboardBtn = document.getElementById("dashboardBtn");
    const boostBtn = document.getElementById("boostBtn");

    // --- Result fields ---
    const scoreValueEl = document.getElementById("scoreValue");
    const scoreCardEl = document.getElementById("scoreCard");
    const suggestionsListEl = document.getElementById("suggestionsList");
    const issuesListEl = document.getElementById("issuesList");
    const strengthsListEl = document.getElementById("strengthsList");
    const qualityValueEl = document.getElementById("qualityValue");
    const pageTitleValueEl = document.getElementById("pageTitleValue");
    const toggleDetailsBtn = document.getElementById("toggleDetailsBtn");
    const extraDetailsEl = document.getElementById("extraDetails");
    const statusCodeValueEl = document.getElementById("statusCodeValue");
    const metaDescriptionValueEl = document.getElementById("metaDescriptionValue");
    const headersListEl = document.getElementById("headersList");

    const boostResultsEl = document.getElementById("boostResults");
    const boostMetaEl = document.getElementById("boostMeta");

    // API URLs
    const API_BASE_URL = "http://127.0.0.1:8000";
    const ANALYZE_API_URL = `${API_BASE_URL}/analyse-url`;
    const BOOST_API_URL = `${API_BASE_URL}/boost-seo`;

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
                throw new Error(errData.error?.message || errData.detail || `HTTP error! Status: ${response.status}`);
            }

            const data = await response.json();
            
            currentAnalysisData = data;

            // 4. Show results
            showResults(data);

        } catch (e) {
            console.error("Analysis failed:", e);
            showError(`⚠ ${e.message}`);
        }
    };

    const getSeoBoost = async () => {
        if (!currentAnalysisData) {
            showError("No analysis data to boost.");
            return;
        }
        
        // Show loader and hide old boost results.
        loader.style.display = "flex";
        boostResultsEl.style.display = "none";
        errorEl.style.display = "none";

        try {
            const response = await fetch(BOOST_API_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    url: currentAnalysisData.final_url
                }),
            });

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error?.message || errData.detail || `HTTP error! Status: ${response.status}`);
            }

            const boostData = await response.json();
            
            // Populate boost results
            boostMetaEl.textContent = boostData.suggested_description || "N/A";
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
        // 1. Set deterministic score and color.
        const score = data.deterministic_score.overall_score;
        scoreValueEl.textContent = `${score}/100`;
        scoreCardEl.className = "score-card"; // Reset classes
        if (score > 80) {
            scoreCardEl.classList.add("score-green");
        } else if (score >= 60) {
            scoreCardEl.classList.add("score-yellow");
        } else {
            scoreCardEl.classList.add("score-red");
        }

        // 2. Populate deterministic check lists.
        populateList(suggestionsListEl, data.checks.filter(check => check.status === "warning").map(check => check.recommendation));
        populateList(issuesListEl, data.checks.filter(check => check.status === "fail").map(check => check.title));
        populateList(strengthsListEl, data.checks.filter(check => check.status === "pass").map(check => check.title));

        // 3. Set bounded content signal.
        qualityValueEl.textContent = `${data.lexical_signals.visible_word_count} visible words`;

        // 4. Populate Page Details
        pageTitleValueEl.textContent = data.metadata.title || "N/A";

        // 5. Populate Extra Details (hidden)
        statusCodeValueEl.textContent = data.fetch.status_code || "N/A";
        metaDescriptionValueEl.textContent = data.metadata.description || "No meta description found.";
        
        populateHeadersList(headersListEl, data.headings);

        // 6. Show the results container
        loader.style.display = "none";
        welcomeEl.style.display = "none";
        errorEl.style.display = "none";
        resultsEl.style.display = "block";

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
    
    dashboardBtn.addEventListener("click", () => {
        chrome.tabs.create({ url: "http://localhost:8501" });
    });

    boostBtn.addEventListener("click", getSeoBoost);
});
