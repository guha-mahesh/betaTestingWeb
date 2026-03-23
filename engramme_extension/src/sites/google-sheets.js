// google-sheets.js - Google Sheets content extraction and MTE monitoring
// Google Sheets JS destroys readable cell content in the live DOM after load.
// We re-fetch the page URL to get the initial server-rendered HTML which has
// the cell data in a <table class="waffle"> with readable <td> elements.
// Depends on: core/state.js

(function() {
    'use strict';

    const googleSheets = {};

    // Cached cell content from fetch (avoid re-fetching on every MTE check)
    let cachedContent = null;
    let cachedUrl = null;
    let fetchInFlight = null; // Promise when a fetch is in progress; null otherwise

    // MTE tracking state
    let lastMTETime = 0;

    let lastScrollPosition = 0;
    let isMonitoring = false;
    let timeCheckInterval = null;
    let contentPollInterval = null;
    let tabBarElement = null;
    let scrollContainerElement = null;
    let urlPollInterval = null;
    // Incremented on start/stop to ignore stale async fetch+MTE completions.
    let monitoringGeneration = 0;

    // MTE thresholds
    const TIME_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes
    const CONTENT_POLL_INTERVAL_MS = 30 * 1000; // 30 seconds
    const SCROLL_THRESHOLD = 0.33; // 1/3 of screen height

    /**
     * Check if we're on a Google Sheets page
     */
    googleSheets.shouldExtract = function() {
        const hostname = window.location.hostname;
        const pathname = window.location.pathname;
        return hostname.includes('docs.google.com') && pathname.includes('/spreadsheets/');
    };

    /**
     * Get the spreadsheet title from the live DOM
     */
    function getTitle() {
        const titleInput = document.querySelector('#doc-title input, .docs-title-input');
        if (titleInput) {
            const val = titleInput.value || titleInput.textContent || '';
            if (val.trim()) return val.trim();
        }
        const titleEl = document.querySelector('.docs-title-outer .docs-title-widget');
        if (titleEl) return titleEl.textContent.trim();
        return '';
    }

    /**
     * Get the active sheet tab name from the live DOM
     */
    function getSheetName() {
        const activeTab = document.querySelector('.docs-sheet-tab.docs-sheet-active-tab .docs-sheet-tab-name');
        return activeTab ? activeTab.textContent.trim() : '';
    }

    /**
     * Fetch the page's initial server-rendered HTML and parse cell content
     * from the <table class="waffle"> that Google Sheets includes before JS runs.
     */
    async function fetchAndParseInitialHTML(expectedUrl, generation, forceRefetch = false) {
        const currentUrl = expectedUrl || window.location.href;

        // Return cache if URL hasn't changed
        if (!forceRefetch && cachedContent && cachedUrl === currentUrl) {
            return cachedContent;
        }

        // If a fetch is already in flight, wait for its result instead of
        // silently returning stale cache.
        if (fetchInFlight) return fetchInFlight;

        const promise = (async () => {
            try {
                const response = await fetch(currentUrl, {
                    credentials: 'include'
                });

                if (!response.ok) {
                    return '';
                }

                const html = await response.text();

                // Parse the HTML and extract from the waffle table
                const parser = new DOMParser();
                const doc = parser.parseFromString(html, 'text/html');
                const tables = doc.querySelectorAll('table.waffle');

                if (tables.length === 0) {
                    return '';
                }

                const rows = [];
                for (const table of tables) {
                    const trs = table.querySelectorAll('tbody tr');
                    for (const tr of trs) {
                        const cells = tr.querySelectorAll('td');
                        const rowData = [];
                        for (const cell of cells) {
                            const text = cell.textContent.trim();
                            if (text) rowData.push(text);
                        }
                        if (rowData.length > 0) {
                            rows.push(rowData.join(' | '));
                        }
                    }
                }

                const content = rows.join('\n');
                const isStaleResult = generation !== monitoringGeneration ||
                    window.location.href !== currentUrl ||
                    !googleSheets.shouldExtract();
                if (isStaleResult) {
                    return '';
                }

                cachedContent = content;
                cachedUrl = currentUrl;

                return content;
            } catch (e) {
                console.error('📊 Fetch/parse error:', e);
                return '';
            } finally {
                fetchInFlight = null;
            }
        })();

        fetchInFlight = promise;
        return promise;
    }

    /**
     * Extract content from Google Sheets (sync - uses cache)
     */
    googleSheets.getContent = function() {
        const title = getTitle();
        const sheetName = getSheetName();
        const header = [title, sheetName].filter(Boolean).join(' - ');

        // Use cached fetched content
        if (cachedContent && cachedContent.length > 10) {
            return header ? `${header}\n${cachedContent}` : cachedContent;
        }

        // If no cache yet, return title only (fetch is async, will update on next MTE)
        if (header) return header;
        return '';
    };

    /**
     * Async version - fetches fresh content if needed
     */
    async function getContentAsync(expectedUrl, generation, forceRefetch = false) {
        const title = getTitle();
        const sheetName = getSheetName();
        const header = [title, sheetName].filter(Boolean).join(' - ');

        const cellContent = await fetchAndParseInitialHTML(expectedUrl, generation, forceRefetch);
        if (cellContent && cellContent.length > 10) {
            return header ? `${header}\n${cellContent}` : cellContent;
        }

        return header || '';
    }

    /**
     * Trigger memory recall with current sheet content
     */
    async function triggerMTE(reason) {
        const triggerUrl = window.location.href;
        const triggerGeneration = monitoringGeneration;
        const content = await getContentAsync(triggerUrl, triggerGeneration);
        const isStaleTrigger = triggerGeneration !== monitoringGeneration ||
            window.location.href !== triggerUrl ||
            !isMonitoring ||
            !googleSheets.shouldExtract();
        if (isStaleTrigger) {
            return;
        }

        if (!content || content.length < 10) {
            return;
        }


        lastMTETime = Date.now();

        const memoryRefresh = window.Engramme?.memoryRefresh;
        if (memoryRefresh && memoryRefresh.updateForGenericPage) {
            memoryRefresh.updateForGenericPage();
        }
    }

    /**
     * Check for time-based MTE (2 minutes)
     */
    function checkTimeMTE() {
        if (document.visibilityState !== 'visible') return;
        const now = Date.now();
        if (lastMTETime > 0 && (now - lastMTETime) >= TIME_THRESHOLD_MS) {
            triggerMTE('2 minute interval');
        }
    }

    /**
     * Check for scroll MTE (scrolled > 1/3 of screen)
     */
    function checkScrollMTE() {
        const currentScroll = scrollContainerElement?.scrollTop || window.scrollY;
        const scrollDiff = Math.abs(currentScroll - lastScrollPosition);
        const screenHeight = window.innerHeight;

        if (scrollDiff > screenHeight * SCROLL_THRESHOLD) {
            lastScrollPosition = currentScroll;
            triggerMTE(`scrolled ${Math.round(scrollDiff)}px`);
        }
    }

    function handleTabSwitch() {
        cachedContent = null; // Invalidate cache on tab switch
        cachedUrl = null;
        setTimeout(() => triggerMTE('sheet tab switch'), 1000);
    }

    /**
     * Poll for content changes while this is the active browser tab.
     * Uses a forced re-fetch (ignores cache) every 30s and only triggers
     * recall when extracted content actually changes.
     */
    async function pollForContentChange() {
        if (!isMonitoring || !googleSheets.shouldExtract()) return;
        if (document.visibilityState !== 'visible') return;

        const pollUrl = window.location.href;
        const pollGeneration = monitoringGeneration;
        const previousContent = googleSheets.getContent();
        const refreshedContent = await getContentAsync(pollUrl, pollGeneration, true);
        const isStalePoll = pollGeneration !== monitoringGeneration ||
            window.location.href !== pollUrl ||
            !isMonitoring ||
            !googleSheets.shouldExtract();
        if (isStalePoll) {
            return;
        }

        if (!refreshedContent || refreshedContent.length < 10) return;

        if (refreshedContent !== previousContent) {
            triggerMTE('30s active-tab content change');
        }
    }

    /**
     * Start monitoring for MTEs
     */
    googleSheets.startMonitoring = function() {
        if (isMonitoring) return;
        if (!googleSheets.shouldExtract()) return;

        isMonitoring = true;
        monitoringGeneration += 1;

        lastMTETime = Date.now();
        lastScrollPosition = 0;

        // Watch for sheet tab switches (invalidate cache since different sheet)
        tabBarElement = document.querySelector('.docs-sheet-tab-bar');
        if (tabBarElement) {
            tabBarElement.addEventListener('click', handleTabSwitch);
        }

        // Scroll listener
        scrollContainerElement = document.querySelector('.grid-container') ||
                                 document.querySelector('#grid-container') ||
                                 document.querySelector('[role="grid"]');
        if (scrollContainerElement) {
            scrollContainerElement.addEventListener('scroll', checkScrollMTE, { passive: true });
        }
        window.addEventListener('scroll', checkScrollMTE, { passive: true });

        // Time-based check every 30 seconds
        timeCheckInterval = setInterval(checkTimeMTE, 30000);
        contentPollInterval = setInterval(pollForContentChange, CONTENT_POLL_INTERVAL_MS);

        // Initial fetch + MTE
        triggerMTE('initial load');
    };

    /**
     * Stop monitoring for MTEs
     */
    googleSheets.stopMonitoring = function() {
        monitoringGeneration += 1;

        if (!isMonitoring) return;

        isMonitoring = false;
        lastMTETime = 0;
        lastScrollPosition = 0;

        if (timeCheckInterval) {
            clearInterval(timeCheckInterval);
            timeCheckInterval = null;
        }
        if (contentPollInterval) {
            clearInterval(contentPollInterval);
            contentPollInterval = null;
        }

        if (tabBarElement) {
            tabBarElement.removeEventListener('click', handleTabSwitch);
            tabBarElement = null;
        }

        if (scrollContainerElement) {
            scrollContainerElement.removeEventListener('scroll', checkScrollMTE);
            scrollContainerElement = null;
        }

        window.removeEventListener('scroll', checkScrollMTE);
    };

    /**
     * Check if monitoring is active
     */
    googleSheets.isMonitoring = function() {
        return isMonitoring;
    };

    /**
     * Stop the URL change poller. Called from content.js cleanup()
     * separately from stopMonitoring() since the poller drives
     * stop/restart cycles and must outlive individual monitoring sessions.
     */
    googleSheets.stopUrlPoller = function() {
        if (urlPollInterval) {
            clearInterval(urlPollInterval);
            urlPollInterval = null;
        }
    };

    // Track URL for navigation detection
    let lastUrl = window.location.href;

    function checkUrlChange() {
        const currentUrl = window.location.href;
        if (currentUrl !== lastUrl) {
            lastUrl = currentUrl;

            // Invalidate cache on URL change
            cachedContent = null;
            cachedUrl = null;

            const utils = window.Engramme?.utils;
            if (utils && utils.clearQueryCache) {
                utils.clearQueryCache('generic', true);
            }

            googleSheets.stopMonitoring();

            if (googleSheets.shouldExtract()) {
                setTimeout(() => googleSheets.startMonitoring(), 1000);
            }
        }
    }

    /**
     * Start the URL change poller. Called from content.js to begin
     * navigation detection. Separate from startMonitoring() since
     * the poller drives stop/restart cycles and must outlive
     * individual monitoring sessions.
     */
    googleSheets.startUrlPoller = function() {
        if (urlPollInterval) return;
        urlPollInterval = setInterval(checkUrlChange, 500);
    };

    // Export to namespace
    window.Engramme = window.Engramme || {};
    window.Engramme.googleSheets = googleSheets;

})();
