// google-search.js - Google Search content extraction
// Extracts search query, AI Overview, and search results
// Depends on: core/state.js, core/viewport-utils.js

(function() {
    'use strict';

    const googleSearch = {};
    const viewportUtils = window.Engramme?.viewportUtils;

    /**
     * Check if we're on a Google Search results page
     * @returns {boolean}
     */
    googleSearch.isSearchPage = function() {
        const hostname = window.location.hostname;
        if (hostname !== 'google.com' && hostname !== 'www.google.com') {
            return false;
        }
        // Must have search query parameter
        const query = new URLSearchParams(window.location.search).get('q');
        return !!query;
    };

    /**
     * Check if we're on Google homepage (no search query)
     * @returns {boolean}
     */
    googleSearch.isGoogleHomepage = function() {
        const hostname = window.location.hostname;
        if (hostname !== 'google.com' && hostname !== 'www.google.com') {
            return false;
        }
        const query = new URLSearchParams(window.location.search).get('q');
        return !query;
    };

    /**
     * Get the search query from URL
     * @returns {string}
     */
    googleSearch.getSearchQuery = function() {
        return new URLSearchParams(window.location.search).get('q') || '';
    };

    /**
     * Extract AI Overview content if present
     * @param {boolean} viewportOnly - If true, only return if visible in viewport
     * @returns {string}
     */
    googleSearch.getAIOverview = function(viewportOnly = true) {
        // Try to find the AI Overview container
        // Based on the HTML structure: div.Y3BBE contains the AI response
        const selectors = [
            'div.Y3BBE',                          // Main AI Overview container
            'div[data-attrid="wa:/description"]', // Alternative attribute
        ];

        for (const selector of selectors) {
            try {
                const container = document.querySelector(selector);
                if (!container) continue;

                // Skip if not in viewport and viewportOnly is true
                if (viewportOnly && viewportUtils && !viewportUtils.isInViewport(container)) {
                    continue;
                }

                // Clone to manipulate without affecting DOM
                const clone = container.cloneNode(true);

                // Remove script, style, and other noise
                const removeSelectors = ['script', 'style', 'noscript', 'img', 'button', 'svg', '[style*="display: none"]'];
                removeSelectors.forEach(sel => {
                    clone.querySelectorAll(sel).forEach(el => el.remove());
                });

                const text = clone.textContent?.trim();

                // Skip if it looks like code (starts with function, var, const, etc.)
                if (text && text.match(/^(function|var|const|let|\(function)/)) {
                    continue;
                }

                if (text && text.length > 50) {
                    const cleaned = text.replace(/\s+/g, ' ').trim();
                    return cleaned;
                }
            } catch (e) {
            }
        }

        return '';
    };

    /**
     * Extract special Google answer blocks (knowledge panel, direct answers)
     * @param {boolean} viewportOnly - If true, only return if visible in viewport
     * @param {string} excludeText - Exclude text already captured (e.g., AI Overview)
     * @returns {string[]}
     */
    googleSearch.getSpecialAnswers = function(viewportOnly = true, excludeText = '') {
        const answers = [];
        const seen = new Set();

        const cleanText = (text) => (text || '').replace(/\s+/g, ' ').trim();
        const addText = (text) => {
            const cleaned = cleanText(text);
            if (!cleaned || cleaned.length < 20) return;
            if (excludeText && cleaned === excludeText) return;
            if (excludeText && excludeText.includes(cleaned)) return;
            if (seen.has(cleaned)) return;
            seen.add(cleaned);
            answers.push(cleaned);
        };

        const directAnswerSelectors = [
            '#search .Z0LcW', // Direct answer (calculator, conversions, etc.)
            '#search [data-attrid$="/description"]',
            '#search [data-attrid="hw:/description"]',
            '#search [data-attrid="kc:/description"]',
            '#search [data-attrid="tw:/description"]',
            '#search .V3FYCf', // Featured snippet container
            '#search .LGOjhe', // Snippet-like answers
            '#search .hgKElc'  // Dictionary / definition style blocks
        ];

        directAnswerSelectors.forEach((selector) => {
            document.querySelectorAll(selector).forEach((el) => {
                if (el.closest('#rso')) return; // Avoid normal result snippets
                if (viewportOnly && viewportUtils && !viewportUtils.isInViewport(el)) return;
                addText(el.textContent);
            });
        });

        const knowledgePanel = document.querySelector('#rhs');
        if (knowledgePanel) {
            const kpSelectors = [
                '[data-attrid="title"]',
                '[data-attrid$="/description"]',
                '[data-attrid^="kc:/"]',
                '[data-attrid^="hw:/"]',
                '[data-attrid^="tw:/"]'
            ];

            kpSelectors.forEach((selector) => {
                knowledgePanel.querySelectorAll(selector).forEach((el) => {
                    if (viewportOnly && viewportUtils && !viewportUtils.isInViewport(el)) return;
                    addText(el.textContent);
                });
            });
        }

        return answers;
    };

    /**
     * Extract regular search results
     * Uses multiple selector strategies for robustness
     * @returns {Array<{title: string, snippet: string, url: string}>}
     */
    googleSearch.getSearchResults = function() {
        const results = [];
        const seenUrls = new Set();

        // Multiple container selectors for different Google layouts
        const containerSelectors = [
            'div#rso div.g',                    // Standard organic results
            'div#search div.g',                 // Alternative search container
            'div.Ww4FFb',                       // Another organic result class
            'div[data-hveid][lang]',            // Data attribute based
            'div.MjjYud > div.g',               // Grouped results
        ];

        let resultContainers = [];

        // Try each container selector
        for (const selector of containerSelectors) {
            const containers = document.querySelectorAll(selector);
            if (containers.length > 0) {
                resultContainers = containers;
                break;
            }
        }

        // Fallback to basic div.g if nothing found
        if (resultContainers.length === 0) {
            resultContainers = document.querySelectorAll('div.g');
        }

        resultContainers.forEach(container => {
            try {
                // Get the link element - try multiple approaches
                let linkEl = container.querySelector('a[href^="http"]');
                if (!linkEl) {
                    linkEl = container.querySelector('.yuRUbf a');
                }
                if (!linkEl) return;

                const url = linkEl.href;

                // Skip duplicates
                if (seenUrls.has(url)) return;
                seenUrls.add(url);

                // Skip Google's own pages, ads, and internal links
                if (url.includes('google.com/search') ||
                    url.includes('googleadservices.com') ||
                    url.includes('google.com/aclk') ||
                    url.includes('support.google.com') ||
                    url.includes('accounts.google.com')) {
                    return;
                }

                // Get title - multiple selectors
                let title = '';
                const titleSelectors = ['h3', '.DKV0Md', '.LC20lb'];
                for (const sel of titleSelectors) {
                    const titleEl = container.querySelector(sel);
                    if (titleEl?.textContent) {
                        title = titleEl.textContent.trim();
                        break;
                    }
                }

                // Get snippet - multiple possible selectors
                let snippet = '';
                const snippetSelectors = [
                    'div[data-sncf]',           // Newer snippet container
                    'div[data-content-feature]', // Content feature
                    'div.VwiC3b',               // Common snippet class (has spans inside)
                    '.lEBKkf',                  // Another snippet class
                    'span.aCOpRe',              // Alternative snippet
                    '.IsZvec',                  // Another snippet container
                    '.st'                       // Basic snippet class
                ];

                for (const selector of snippetSelectors) {
                    const snippetEl = container.querySelector(selector);
                    if (snippetEl && snippetEl.textContent) {
                        // Get all text from spans, filter out "Read more" and similar
                        const spans = snippetEl.querySelectorAll('span');
                        if (spans.length > 0) {
                            const spanTexts = Array.from(spans)
                                .map(s => s.textContent?.trim())
                                .filter(t => t && t.length > 0 && !/^(Read more|More)$/i.test(t));
                            snippet = spanTexts.join(' ').trim();
                        } else {
                            snippet = snippetEl.textContent.trim();
                        }
                        // Filter out "Read more" from final text too
                        snippet = snippet.replace(/\s*Read more\s*$/i, '').trim();
                        if (snippet) break;
                    }
                }

                if (title || snippet) {
                    results.push({ title, snippet, url });
                }
            } catch (e) {
                // Skip problematic result
            }
        });

        return results;
    };

    /**
     * Extract "People also ask" questions
     * @returns {string[]}
     */
    googleSearch.getPeopleAlsoAsk = function() {
        const questions = [];

        // PAA questions are in expandable divs
        const paaContainer = document.querySelector('[data-initq], [jsname="Cpkphb"]');
        if (!paaContainer) {
            return questions;
        }

        const questionEls = paaContainer.querySelectorAll('[data-q], .related-question-pair');
        questionEls.forEach(el => {
            const question = el.getAttribute('data-q') || el.textContent?.trim();
            if (question && question.length > 10) {
                questions.push(question);
            }
        });

        return questions;
    };

    /**
     * Get visible search result titles (viewport only)
     * @returns {string[]}
     */
    googleSearch.getVisibleTitles = function() {
        const titles = [];
        const seenTitles = new Set();

        // Get all h3 titles with the known class
        const titleElements = document.querySelectorAll('h3.LC20lb');

        titleElements.forEach(el => {
            // Skip if not in viewport
            if (viewportUtils && !viewportUtils.isInViewport(el)) {
                return;
            }

            const text = el.textContent?.trim();
            if (text && text.length > 5 && !seenTitles.has(text)) {
                seenTitles.add(text);
                titles.push(text);
            }
        });

        return titles;
    };

    /**
     * Get visible search result snippets (viewport only)
     * Uses VwiC3b class which contains spans with the actual text
     * @returns {string[]}
     */
    googleSearch.getVisibleSnippets = function() {
        const snippets = [];
        const seenSnippets = new Set();

        // Get all snippet containers - VwiC3b can have multiple classes like "VwiC3b yXK7lf p4wth..."
        // Use attribute selector to match class containing VwiC3b
        const snippetElements = document.querySelectorAll('[class*="VwiC3b"]');


        snippetElements.forEach(el => {
            // Skip if not in viewport
            if (viewportUtils && !viewportUtils.isInViewport(el)) {
                return;
            }

            // Clone and remove "Read more" links before extracting text
            const clone = el.cloneNode(true);
            clone.querySelectorAll('a').forEach(a => {
                if (a.textContent?.trim().toLowerCase().includes('read more')) {
                    a.remove();
                }
            });

            let snippet = clone.textContent?.trim() || '';
            snippet = snippet.replace(/\s*Read more\s*$/i, '').trim();
            snippet = snippet.replace(/\s+/g, ' '); // Normalize whitespace

            if (snippet && snippet.length > 20 && !seenSnippets.has(snippet)) {
                seenSnippets.add(snippet);
                snippets.push(snippet);
            }
        });

        return snippets;
    };

    /**
     * Get visible "People Also Ask" questions (viewport only)
     * @returns {string[]}
     */
    googleSearch.getVisiblePeopleAlsoAsk = function() {
        const questions = [];
        const seenQuestions = new Set();

        // Get all PAA question containers
        const paaElements = document.querySelectorAll('.related-question-pair span.CSkcDe');

        paaElements.forEach(el => {
            // Skip if not in viewport
            if (viewportUtils && !viewportUtils.isInViewport(el)) {
                return;
            }

            const text = el.textContent?.trim();
            if (text && text.length > 10 && !seenQuestions.has(text)) {
                seenQuestions.add(text);
                questions.push(text);
            }
        });

        return questions;
    };

    /**
     * Get formatted content string for memory/recall
     * Returns search query + AI Overview + visible result titles (no labels)
     * @returns {string}
     */
    googleSearch.getContent = function() {
        if (googleSearch.isGoogleHomepage()) {
            return 'Make a search to see memories.';
        }
        if (!googleSearch.isSearchPage()) {
            return '';
        }

        const parts = [];

        // 1. Search query
        const query = googleSearch.getSearchQuery();
        if (query) {
            parts.push(`RQ: ${query}`);
        }

        // 2. AI Overview (if visible)
        const aiOverview = googleSearch.getAIOverview(true); // viewport only
        if (aiOverview && aiOverview.length > 20) {
            parts.push(`TX: ${aiOverview}`);
        }

        // 3. Special answer blocks (featured snippets, knowledge panels)
        const specialAnswers = googleSearch.getSpecialAnswers(true, aiOverview);
        if (specialAnswers.length > 0) {
            parts.push(`TX: ${specialAnswers.join(' | ')}`);
        }

        // 4. Visible search result titles
        const titles = googleSearch.getVisibleTitles();
        if (titles.length > 0) {
            parts.push(`TI: ${titles.join(' | ')}`);
        }

        // 5. Visible search result snippets
        const snippets = googleSearch.getVisibleSnippets();
        if (snippets.length > 0) {
            parts.push(`TX: ${snippets.join(' | ')}`);
        }

        // 6. Visible "People Also Ask" questions
        const paaQuestions = googleSearch.getVisiblePeopleAlsoAsk();
        if (paaQuestions.length > 0) {
            parts.push(`AA: ${paaQuestions.join(' | ')}`);
        }

        const content = parts.join('\n\n');

        return content;
    };

    /**
     * Check if we should extract content from this page
     * @returns {boolean}
     */
    googleSearch.shouldExtract = function() {
        return googleSearch.isSearchPage() || googleSearch.isGoogleHomepage();
    };

    /**
     * Start scroll monitoring for Google Search pages
     * Triggers memory refresh when user stops scrolling
     */
    googleSearch.startScrollMonitoring = function() {
        if (!viewportUtils) {
            return;
        }
        if (viewportUtils.isScrollMonitoringActive()) {
            return;
        }
        viewportUtils.enableAutoRefreshOnScroll(3000);
    };

    // Auto-start scroll monitoring if on Google Search
    if (googleSearch.isSearchPage()) {
        // Delay to let page settle
        setTimeout(() => googleSearch.startScrollMonitoring(), 1500);
    }

    // Export to namespace
    window.Engramme = window.Engramme || {};
    window.Engramme.googleSearch = googleSearch;

})();
