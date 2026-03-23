// monitor.js - Page content monitoring and memorization
// Watches for content changes on non-Gmail pages and triggers memory updates

(function() {
    'use strict';

    const state = window.Engramme.state;
    const utils = window.Engramme.utils;

    // Module-level state
    let lastPageContent = '';
    let checkInterval = null;
    let scrollTimeout = null;
    let scrollHandler = null;
    let isScrollListenerAttached = false;

    // Extract FULL page content for memorization (no truncation)
    // Routes to specialized extractors when available
    function getFullContent() {
        try {
            const hostname = window.location.hostname;

            // Route to specialized extractors first
            // SF Chronicle - use dedicated extractor
            if (hostname.includes('sfchronicle.com')) {
                const sfchronicle = window.Engramme?.sfchronicle;
                if (sfchronicle && sfchronicle.shouldExtract()) {
                    const sfcContent = sfchronicle.getContent(false); // Get all content, not just viewport
                    if (sfcContent && sfcContent.length > 0) {
                        return sfcContent;
                    }
                }
            }

            // Google Search - use dedicated extractor
            if (hostname.includes('google.com')) {
                const googleSearch = window.Engramme?.googleSearch;
                if (googleSearch && googleSearch.shouldExtract()) {
                    const searchContent = googleSearch.getContent();
                    if (searchContent && searchContent.length > 0) {
                        return searchContent;
                    }
                }
            }

            // Use extractors module if available for other sites
            const extractors = window.Engramme?.extractors;
            if (extractors && extractors.getGenericPageContent) {
                const extractedContent = extractors.getGenericPageContent();
                if (extractedContent && extractedContent.length > 100) {
                    return extractedContent;
                }
            }

            // Generic fallback for sites without specialized extractors
            let fullText = '';

            // Get page title
            if (document.title) {
                fullText += document.title + '\n\n';
            }

            // Get URL
            fullText += `URL: ${window.location.href}\n\n`;

            // Get meta description
            const metaDesc = document.querySelector('meta[name="description"]');
            if (metaDesc && metaDesc.content) {
                fullText += metaDesc.content + '\n\n';
            }

            // Main content extraction strategies
            const mainSelectors = [
                'main',
                'article',
                '[role="main"]',
                '#content',
                '.content',
                '#main',
                '.main',
                '.post',
                '.entry-content',
                '.article-body',
                '.story-body'
            ];

            for (const selector of mainSelectors) {
                const elements = document.querySelectorAll(selector);
                elements.forEach(el => {
                    if (el && el.textContent) {
                        fullText += el.textContent + '\n';
                    }
                });
            }

            // If no main content found, get all meaningful text
            if (fullText.length < 200) {
                // Get headings
                const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
                headings.forEach(h => {
                    if (h.textContent) fullText += h.textContent + '\n';
                });

                // Get paragraphs
                const paragraphs = document.querySelectorAll('p');
                paragraphs.forEach(p => {
                    if (p.textContent && p.textContent.length > 20) {
                        fullText += p.textContent + '\n';
                    }
                });

                // Get list items
                const listItems = document.querySelectorAll('li');
                listItems.forEach(li => {
                    if (li.textContent && li.textContent.length > 20) {
                        fullText += li.textContent + '\n';
                    }
                });
            }

            // Clean up the text but preserve structure
            fullText = fullText
                .replace(/\s+/g, ' ')  // Replace multiple spaces with single space
                .replace(/\n\s+/g, '\n')  // Clean up newlines
                .trim();

            return fullText;
        } catch (e) {
            console.error('❌ Error getting full generic page content:', e);
            return '';
        }
    }

    // Memorize page content by sending to background script
    async function memorize() {

        if (!utils.isExtensionValid()) {
            return;
        }

        // Skip auto-memorization on Gmail and Google Docs
        const hostname = window.location.hostname;
        if (hostname === 'app.engramme.com') {
            return;
        }
        if (hostname.includes('mail.google.com') ||
            hostname.includes('gmail.com') ||
            hostname.includes('docs.google.com') ||
            hostname === 'calendar.google.com' ||
            utils.isOutlookHost(hostname)) {
            return;
        }
        if (hostname === 'google.com' || hostname === 'www.google.com') {
            const queryParam = new URLSearchParams(window.location.search).get('q');
            if (!queryParam) {
                return;
            }
        }

        if (!state.isApiConfigured) {
            return;
        }

        try {
            const fullContent = getFullContent();

            if (fullContent.trim().length < 100) {
                return;
            }


            const response = await chrome.runtime.sendMessage({
                action: 'memorizeContent',
                text: fullContent,
                url: window.location.href
            });

            if (response.success) {
            } else {
                console.error('❌ Failed to memorize content:', response.error);
            }
        } catch (error) {
            console.error('❌ Error memorizing page content:', error);
        }
    }

    // Check if refresh should be blocked due to active user interaction
    function shouldBlockRefresh() {
        if (!state.overlayElement) return false;

        // 1. Block if in detailed view
        const detailView = state.overlayElement.querySelector('.memory-detail-view');
        if (detailView) {
            return true;
        }

        // 2. Block if chat mode is active
        if (state.isChatMode) {
            return true;
        }

        // 3. Block if any comment panel is open
        const openCommentPanels = state.overlayElement.querySelectorAll('.memory-comment-panel.show, .feedback-panel.show');
        if (openCommentPanels && openCommentPanels.length > 0) {
            return true;
        }

        return false;
    }

    function scheduleDebouncedRefresh(getMemoryRefresh) {
        if (scrollTimeout) {
            clearTimeout(scrollTimeout);
        }

        scrollTimeout = setTimeout(() => {
            if (shouldBlockRefresh()) {
                return;
            }

            const extractors = window.Engramme.extractors;
            const currentContent = extractors.getGenericPageContent();
            if (currentContent !== lastPageContent && currentContent.length > 50) {
                lastPageContent = currentContent;

                memorize();

                const memoryRefresh = getMemoryRefresh();
                if (memoryRefresh) {
                    memoryRefresh.updateForGenericPage();
                }
            }
        }, 3000);
    }

    // Start monitoring generic page for content changes
    function startMonitoring() {
        // Skip monitoring on Google Meet - it has its own 1-minute timer in google-meets.js
        if (window.location.hostname === 'meet.google.com') {
            return;
        }

        if (window.location.hostname === 'app.engramme.com') {
            return;
        }

        // Get memoryRefresh module (loaded after this module)
        const getMemoryRefresh = () => window.Engramme.memoryRefresh;

        // Initial memorization after 1 second
        setTimeout(() => {
            memorize();
            const memoryRefresh = getMemoryRefresh();
            if (memoryRefresh) {
                memoryRefresh.updateForGenericPage();
            }
        }, 1000);

        if (isScrollListenerAttached) {
            return;
        }

        scrollHandler = () => scheduleDebouncedRefresh(getMemoryRefresh);
        window.addEventListener('scroll', scrollHandler, { passive: true });
        isScrollListenerAttached = true;
    }

    // Stop monitoring (for cleanup)
    function stopMonitoring() {
        if (checkInterval) {
            clearInterval(checkInterval);
            checkInterval = null;
        }

        if (scrollHandler) {
            window.removeEventListener('scroll', scrollHandler);
            scrollHandler = null;
            isScrollListenerAttached = false;
        }

        if (scrollTimeout) {
            clearTimeout(scrollTimeout);
            scrollTimeout = null;
        }
    }

    // Get check interval for cleanup
    function getCheckInterval() {
        return checkInterval;
    }

    // Expose to namespace
    window.Engramme.genericPage = {
        getFullContent,
        memorize,
        startMonitoring,
        stopMonitoring,
        shouldBlockRefresh,
        getCheckInterval
    };

})();
