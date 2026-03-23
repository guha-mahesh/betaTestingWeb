// google-docs.js - Google Docs content extraction and MTE monitoring
// Depends on: core/state.js

(function() {
    'use strict';

    const googleDocs = {};

    // MTE tracking state
    let lastMTETime = 0;
    let lastMTEWordCount = 0;
    let lastMTEContent = '';
    let lastScrollPosition = 0;
    let isMonitoring = false;
    let paragraphCount = 0;
    let scrollCheckInterval = null;
    let timeCheckInterval = null;

    // MTE thresholds
    const WORD_THRESHOLD = 30;
    const TIME_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes
    const SCROLL_THRESHOLD = 0.33; // 1/3 of screen height

    /**
     * Check if we're on a Google Docs document page
     */
    googleDocs.shouldExtract = function() {
        const hostname = window.location.hostname;
        const pathname = window.location.pathname;
        return hostname.includes('docs.google.com') && pathname.includes('/document/');
    };

    /**
     * Count words in text
     */
    function countWords(text) {
        if (!text) return 0;
        return text.trim().split(/\s+/).filter(w => w.length > 0).length;
    }

    /**
     * Get the scrollable container for Google Docs
     */
    function getScrollContainer() {
        // Google Docs uses .kix-appview-editor as the scrollable container
        return document.querySelector('.kix-appview-editor') ||
               document.querySelector('.docs-editor-container') ||
               document.querySelector('.kix-paginateddocumentplugin');
    }

    /**
     * Get current paragraph count
     */
    function getParagraphCount() {
        const paragraphs = document.querySelectorAll('.kix-paragraphrenderer');
        return paragraphs.length;
    }

    /**
     * Extract content from Google Docs
     */
    googleDocs.getContent = function() {
        try {

            // Method 1: Extract from DOCS_modelChunk in script tags
            // Google Docs splits content across multiple script tags each assigning DOCS_modelChunk = {...}
            const scriptTags = document.querySelectorAll('script');
            let allTextFragments = [];

            function extractTextFromObject(obj) {
                if (!obj || typeof obj !== 'object') return;
                if (obj.ty === 'is' && obj.s) {
                    allTextFragments.push(obj.s);
                }
                if (Array.isArray(obj)) {
                    obj.forEach(item => extractTextFromObject(item));
                } else {
                    for (const key in obj) {
                        if (typeof obj[key] === 'object') {
                            extractTextFromObject(obj[key]);
                        }
                    }
                }
            }

            for (const script of scriptTags) {
                const scriptContent = script.textContent || script.innerHTML;
                if (!scriptContent.includes('DOCS_modelChunk')) continue;

                // Find DOCS_modelChunk = { ... }; assignments using bracket counting
                let searchFrom = 0;
                while (true) {
                    const assignIdx = scriptContent.indexOf('DOCS_modelChunk =', searchFrom);
                    if (assignIdx === -1) break;

                    const braceStart = scriptContent.indexOf('{', assignIdx);
                    if (braceStart === -1) break;

                    // Bracket-count to find the matching closing brace
                    let depth = 0;
                    let braceEnd = -1;
                    for (let i = braceStart; i < scriptContent.length; i++) {
                        if (scriptContent[i] === '{') depth++;
                        else if (scriptContent[i] === '}') {
                            depth--;
                            if (depth === 0) { braceEnd = i; break; }
                        }
                    }

                    if (braceEnd === -1) { searchFrom = braceStart + 1; continue; }

                    try {
                        const jsonData = JSON.parse(scriptContent.substring(braceStart, braceEnd + 1));
                        extractTextFromObject(jsonData);
                    } catch (e) {
                        // Skip unparseable chunks
                    }
                    searchFrom = braceEnd + 1;
                }
            }

            if (allTextFragments.length > 0) {
                const extractedText = allTextFragments.join('');
                if (extractedText.length > 10) {
                    return extractedText;
                }
            }

            // Method 2: Fallback - try paragraph renderers
            const paragraphs = document.querySelectorAll('.kix-paragraphrenderer');
            if (paragraphs.length > 0) {
                const paragraphList = Array.from(paragraphs)
                    .map(p => p.innerText.trim())
                    .filter(text => text.length > 0);
                const content = paragraphList.length > 0
                    ? `PG: ${paragraphList.join(' | ')}`
                    : '';

                if (content.length > 10) {
                    return content;
                }
            }

            // Method 3: Fallback - try editor container
            const editor = document.querySelector('.kix-appview-editor');
            if (editor) {
                const text = editor.innerText.trim();
                if (text.length > 10) {
                    return text;
                }
            }

            return '';

        } catch (e) {
            console.error('Error extracting Google Docs content:', e);
            return '';
        }
    };

    /**
     * Trigger memory recall with current doc content
     */
    async function triggerMTE(reason) {
        const content = googleDocs.getContent();
        if (!content || content.length < 10) {
            return;
        }

        const wordCount = countWords(content);

        // Update tracking state
        lastMTETime = Date.now();
        lastMTEWordCount = wordCount;
        lastMTEContent = content;
        paragraphCount = getParagraphCount();

        // Trigger memory refresh if overlay exists
        const memoryRefresh = window.Engramme?.memoryRefresh;
        if (memoryRefresh && memoryRefresh.updateForGenericPage) {
            memoryRefresh.updateForGenericPage();
        }
    }

    /**
     * Check for new paragraph MTE
     */
    function checkParagraphMTE() {
        const currentParagraphCount = getParagraphCount();
        if (currentParagraphCount > paragraphCount) {
            triggerMTE('new paragraph');
        }
        paragraphCount = currentParagraphCount;
    }

    /**
     * Check for word count MTE (30 words since last MTE)
     */
    function checkWordCountMTE() {
        const content = googleDocs.getContent();
        const currentWordCount = countWords(content);
        const wordsSinceLastMTE = currentWordCount - lastMTEWordCount;

        if (wordsSinceLastMTE >= WORD_THRESHOLD) {
            triggerMTE(`${wordsSinceLastMTE} new words`);
        }
    }

    /**
     * Check for time-based MTE (2 minutes)
     */
    function checkTimeMTE() {
        const now = Date.now();
        if (lastMTETime > 0 && (now - lastMTETime) >= TIME_THRESHOLD_MS) {
            triggerMTE('2 minute interval');
        }
    }

    /**
     * Check for scroll MTE (scrolled > 1/3 of screen)
     */
    function checkScrollMTE() {
        const scrollContainer = getScrollContainer();
        if (!scrollContainer) return;

        const currentScroll = scrollContainer.scrollTop || window.scrollY;
        const scrollDiff = Math.abs(currentScroll - lastScrollPosition);
        const screenHeight = window.innerHeight;

        if (scrollDiff > screenHeight * SCROLL_THRESHOLD) {
            lastScrollPosition = currentScroll;
            triggerMTE(`scrolled ${Math.round(scrollDiff)}px`);
        }
    }

    /**
     * Start monitoring for MTEs
     */
    googleDocs.startMonitoring = function() {
        if (isMonitoring) return;
        if (!googleDocs.shouldExtract()) return;

        isMonitoring = true;

        // Initialize state
        const content = googleDocs.getContent();
        lastMTETime = Date.now();
        lastMTEWordCount = countWords(content);
        lastMTEContent = content;
        paragraphCount = getParagraphCount();
        lastScrollPosition = getScrollContainer()?.scrollTop || 0;

        // Set up mutation observer for paragraph/content changes
        const editor = document.querySelector('.kix-appview-editor');
        if (editor) {
            const observer = new MutationObserver(() => {
                checkParagraphMTE();
                checkWordCountMTE();
            });
            observer.observe(editor, {
                childList: true,
                subtree: true,
                characterData: true
            });
        }

        // Set up scroll listener
        const scrollContainer = getScrollContainer();
        if (scrollContainer) {
            scrollContainer.addEventListener('scroll', checkScrollMTE, { passive: true });
        }
        window.addEventListener('scroll', checkScrollMTE, { passive: true });

        // Set up time-based check (every 30 seconds)
        timeCheckInterval = setInterval(checkTimeMTE, 30000);

        // Initial MTE
        triggerMTE('initial load');
    };

    /**
     * Stop monitoring for MTEs
     */
    googleDocs.stopMonitoring = function() {
        if (!isMonitoring) return;

        isMonitoring = false;

        if (scrollCheckInterval) {
            clearInterval(scrollCheckInterval);
            scrollCheckInterval = null;
        }
        if (timeCheckInterval) {
            clearInterval(timeCheckInterval);
            timeCheckInterval = null;
        }

        const scrollContainer = getScrollContainer();
        if (scrollContainer) {
            scrollContainer.removeEventListener('scroll', checkScrollMTE);
        }
        window.removeEventListener('scroll', checkScrollMTE);
    };

    /**
     * Check if monitoring is active
     */
    googleDocs.isMonitoring = function() {
        return isMonitoring;
    };

    // Export to namespace
    window.Engramme.googleDocs = googleDocs;

    // Track URL for navigation detection
    let lastUrl = window.location.href;

    // Check for URL changes (client-side navigation)
    function checkUrlChange() {
        const currentUrl = window.location.href;
        if (currentUrl !== lastUrl) {
            lastUrl = currentUrl;

            // Clear both query cache and API cache to force fresh memory fetch
            const utils = window.Engramme.utils;
            if (utils && utils.clearQueryCache) {
                utils.clearQueryCache('generic', true);
            }

            // Stop old monitoring
            googleDocs.stopMonitoring();

            // Start new monitoring if on a doc page
            if (googleDocs.shouldExtract()) {
                setTimeout(() => googleDocs.startMonitoring(), 1000);
            }
        }
    }

    // Poll for URL changes (handles client-side routing)
    setInterval(checkUrlChange, 500);

    // Auto-start monitoring if on Google Docs
    if (googleDocs.shouldExtract()) {
        if (document.readyState === 'complete') {
            setTimeout(() => googleDocs.startMonitoring(), 1000);
        } else {
            window.addEventListener('load', () => {
                setTimeout(() => googleDocs.startMonitoring(), 1000);
            });
        }
    }

})();
