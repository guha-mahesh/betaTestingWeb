// sfchronicle.js - San Francisco Chronicle content extraction
// Handles both homepage (article titles) and article pages (full content)
// Depends on: core/state.js

(function() {
    'use strict';

    const sfchronicle = {};

    // Scroll tracking state
    let scrollTimeout = null;
    let lastScrollPosition = 0;
    let isScrollListenerAttached = false;
    let lastExtractedTitles = new Set();
    let lastExtractedParagraphs = new Set();

    /**
     * Detect if we're on SF Chronicle homepage vs article page
     * @returns {'homepage' | 'article' | null}
     */
    sfchronicle.getPageType = function() {
        const hostname = window.location.hostname;
        if (!hostname.includes('sfchronicle.com')) {
            return null;
        }

        const pathname = window.location.pathname;

        // Homepage
        if (pathname === '/' || pathname === '') {
            return 'homepage';
        }

        // Section pages (like /food, /bayarea, /sports) - treat like homepage
        const sectionPatterns = [
            /^\/food\/?$/,
            /^\/bayarea\/?$/,
            /^\/sports\/?$/,
            /^\/politics\/?$/,
            /^\/business\/?$/,
            /^\/entertainment\/?$/,
            /^\/opinion\/?$/,
            /^\/local\/?$/
        ];
        if (sectionPatterns.some(pattern => pattern.test(pathname))) {
            return 'homepage';
        }

        // Article patterns - typically have /article/ in URL
        if (pathname.includes('/article/')) {
            return 'article';
        }

        return null;
    };

    /**
     * Extract article titles from SF Chronicle homepage
     * Uses a[data-link="native"] selector for article links
     * @param {boolean} viewportOnly - If true, only return visible articles
     * @returns {Array<{title: string, url: string}>} Array of article objects
     */
    sfchronicle.getHomepageTitles = function(viewportOnly = true) {
        const articles = [];
        const seenTitles = new Set();

        // Noise patterns to filter out
        const noisePatterns = [
            /San Francisco Chronicle/i,
            /Chronicle Logo/i,
            /^Subscribe$/i,
            /^Sign In$/i,
            /^Menu$/i,
            /^Search$/i,
            /^Advertisement$/i,
            /^More$/i,
            /^See All$/i,
            /^\d{1,2}:\d{2}\s*(AM|PM)?$/i,
            // Section headers
            /^Arts\s*&?\s*Entertainment$/i,
            /^Food\s*&?\s*Wine$/i,
            /^Bay Area$/i,
            /^Sports$/i,
            /^Politics$/i,
            /^Business$/i,
            /^Opinion$/i,
            /^Local$/i,
            /^Weather$/i,
            /^Real Estate$/i,
            /^Obituaries$/i,
            /^Tech$/i,
        ];

        const isNoise = (text) => {
            const trimmed = text.trim();
            if (trimmed.length < 15) return true; // Too short to be a real title
            if (trimmed.length > 300) return true; // Too long
            return noisePatterns.some(pattern => pattern.test(trimmed));
        };

        const isInViewport = (element) => {
            const rect = element.getBoundingClientRect();
            return (
                rect.top < window.innerHeight &&
                rect.bottom > 0 &&
                rect.left < window.innerWidth &&
                rect.right > 0
            );
        };

        // Primary strategy: Find a[data-link="native"] elements - these are article links
        // Exclude: links with <p> tags (descriptions), links inside <nav> (navigation)
        const articleLinks = document.querySelectorAll('a[data-link="native"]');

        articleLinks.forEach(el => {
            // Skip if inside a <nav> or <header> element (navigation/logo links, not articles)
            if (el.closest('nav') || el.closest('header')) {
                return;
            }

            // Skip if this link contains a <p> tag (it's a description, not a title)
            if (el.querySelector('p')) {
                return;
            }

            const text = el.textContent?.trim();
            const url = el.href;

            // Skip noise BEFORE considering for inclusion
            if (!text || isNoise(text) || seenTitles.has(text)) {
                return;
            }

            // Skip if not visible and viewportOnly is true (do this AFTER noise filtering)
            if (viewportOnly && !isInViewport(el)) {
                return;
            }

            seenTitles.add(text);
            articles.push({
                title: text,
                url: url
            });
        });

        // Fallback: Also try cmp-ltrk="HP - Centerpiece" links
        if (articles.length === 0) {
            const centerpieceLinks = document.querySelectorAll('a[cmp-ltrk="HP - Centerpiece"]');
            centerpieceLinks.forEach(el => {
                // Skip if inside <nav> or <header>
                if (el.closest('nav') || el.closest('header')) {
                    return;
                }

                // Skip if contains <p>
                if (el.querySelector('p')) {
                    return;
                }

                const text = el.textContent?.trim();
                const url = el.href;

                // Skip noise BEFORE considering for inclusion
                if (!text || isNoise(text) || seenTitles.has(text)) {
                    return;
                }

                // Viewport check AFTER noise filtering
                if (viewportOnly && !isInViewport(el)) {
                    return;
                }

                seenTitles.add(text);
                articles.push({
                    title: text,
                    url: url
                });
            });
        }

        return articles;
    };

    /**
     * Extract content from SF Chronicle article page
     * Gets title and author from meta tags, plus visible paragraphs from viewport
     * @param {boolean} viewportOnly - If true, only return visible paragraphs
     * @returns {Object} Article data with title, author, paragraphs
     */
    sfchronicle.getArticleContent = function(viewportOnly = true) {
        const article = {
            title: '',
            author: '',
            paragraphs: []
        };

        // Get title from sailthru.title meta tag (more descriptive than <title>)
        const titleMeta = document.querySelector('meta[name="sailthru.title"]');
        if (titleMeta) {
            article.title = titleMeta.content?.trim() || '';
        }

        // Get author from <meta name="author">
        const authorMeta = document.querySelector('meta[name="author"]');
        if (authorMeta) {
            article.author = authorMeta.content?.trim() || '';
        }

        // Check if title/author meta tags are in viewport
        const isInViewport = (element) => {
            if (!element) return false;
            const rect = element.getBoundingClientRect();
            return (
                rect.top < window.innerHeight &&
                rect.bottom > 0 &&
                rect.left < window.innerWidth &&
                rect.right > 0
            );
        };

        // For title/author, check if the article header area is visible
        // Use the first h1 or article header as proxy
        const headerElement = document.querySelector('h1') || document.querySelector('header');
        const headerVisible = !viewportOnly || isInViewport(headerElement);

        // Only include title/author if header is visible
        if (!headerVisible) {
            article.title = '';
            article.author = '';
        }

        // Get paragraphs with the specific data attribute
        const paragraphElements = document.querySelectorAll('p[data-mrf-recirculation="Article - Paragraph links"]');

        paragraphElements.forEach(p => {
            const text = p.textContent?.trim();
            if (!text || text.length < 10) return; // Skip empty or tiny paragraphs

            if (viewportOnly && !isInViewport(p)) {
                return; // Skip paragraphs not in viewport
            }

            article.paragraphs.push(text);
        });

        return article;
    };

    /**
     * Get formatted content string for memory retrieval
     * @param {boolean} viewportOnly - For homepage, only get visible titles
     * @returns {string} Formatted content for API
     */
    sfchronicle.getContent = function(viewportOnly = true) {
        const pageType = sfchronicle.getPageType();

        if (pageType === 'homepage') {
            const articles = sfchronicle.getHomepageTitles(viewportOnly);
            if (articles.length === 0) {
                return '';
            }
            // Build content but stay under 1000 chars
            let content = 'RS: ';
            for (const article of articles) {
                const separator = content === 'RS: ' ? '' : ' | ';
                if ((content + separator + article.title).length > 950) { // Leave some buffer
                    break;
                }
                content += separator + article.title;
            }
            return content.trim();
        }

        if (pageType === 'article') {
            const article = sfchronicle.getArticleContent(viewportOnly);
            const parts = [];

            if (article.title) {
                parts.push(`TI: ${article.title}`);
            }
            if (article.author) {
                parts.push(`AU: ${article.author}`);
            }
            if (article.paragraphs.length > 0) {
                parts.push(`PG: ${article.paragraphs.join(' | ')}`);
            }

            // Trim to stay under 1000 chars (API will truncate anyway, but cleaner to do here)
            let content = parts.join('\n\n');
            if (content.length > 950) {
                content = content.slice(0, 950);
            }

            return content.trim();
        }

        return '';
    };

    /**
     * Check if this is an SF Chronicle page we should handle
     * @returns {boolean}
     */
    sfchronicle.isSFChronicle = function() {
        return window.location.hostname.includes('sfchronicle.com');
    };

    /**
     * Check if we should extract from this page
     * @returns {boolean}
     */
    sfchronicle.shouldExtract = function() {
        if (!sfchronicle.isSFChronicle()) {
            return false;
        }
        const pageType = sfchronicle.getPageType();
        return pageType === 'homepage' || pageType === 'article';
    };

    /**
     * Check if new titles are visible that weren't extracted before
     * @returns {boolean}
     */
    sfchronicle.hasNewVisibleTitles = function() {
        const currentArticles = sfchronicle.getHomepageTitles(true);
        let hasNew = false;

        for (const article of currentArticles) {
            if (!lastExtractedTitles.has(article.title)) {
                hasNew = true;
                break;
            }
        }

        return hasNew;
    };

    /**
     * Update the set of extracted titles (call after successful extraction)
     */
    sfchronicle.updateExtractedTitles = function() {
        const currentArticles = sfchronicle.getHomepageTitles(true);
        currentArticles.forEach(article => lastExtractedTitles.add(article.title));
    };

    /**
     * Handle scroll event - debounced re-extraction
     * Waits 3 seconds after scroll stops, then fetches what's on screen
     */
    function handleScroll() {
        // Clear any existing timeout - user is still scrolling
        if (scrollTimeout) {
            clearTimeout(scrollTimeout);
        }

        // Wait 3 seconds after scroll stops
        scrollTimeout = setTimeout(() => {
            const pageType = sfchronicle.getPageType();
            lastScrollPosition = window.scrollY;

            // Always trigger a refresh with current viewport content
            const memoryRefresh = window.Engramme?.memoryRefresh;
            if (memoryRefresh && memoryRefresh.updateForGenericPage) {
                memoryRefresh.updateForGenericPage();
            }

            // Update our tracking of what's been extracted
            if (pageType === 'homepage') {
                sfchronicle.updateExtractedTitles();
            }
        }, 3000); // 3 second debounce
    }

    /**
     * Start scroll monitoring for SF Chronicle (homepage or article)
     */
    sfchronicle.startScrollMonitoring = function() {
        if (isScrollListenerAttached) {
            return;
        }

        const pageType = sfchronicle.getPageType();
        if (pageType !== 'homepage' && pageType !== 'article') {
            return;
        }

        window.addEventListener('scroll', handleScroll, { passive: true });
        isScrollListenerAttached = true;

        if (pageType === 'homepage') {
            sfchronicle.updateExtractedTitles();
        }
        lastScrollPosition = window.scrollY;
    };

    /**
     * Stop scroll monitoring
     */
    sfchronicle.stopScrollMonitoring = function() {
        if (!isScrollListenerAttached) {
            return;
        }

        window.removeEventListener('scroll', handleScroll);
        isScrollListenerAttached = false;

        if (scrollTimeout) {
            clearTimeout(scrollTimeout);
            scrollTimeout = null;
        }

    };

    /**
     * Reset extraction state
     */
    sfchronicle.reset = function() {
        lastExtractedTitles.clear();
        lastScrollPosition = 0;
        sfchronicle.stopScrollMonitoring();
    };

    // Auto-start scroll monitoring if on SF Chronicle (homepage or article)
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            const pageType = sfchronicle.getPageType();
            if (sfchronicle.isSFChronicle() && (pageType === 'homepage' || pageType === 'article')) {
                setTimeout(() => sfchronicle.startScrollMonitoring(), 1500);
            }
        });
    } else {
        const pageType = sfchronicle.getPageType();
        if (sfchronicle.isSFChronicle() && (pageType === 'homepage' || pageType === 'article')) {
            setTimeout(() => sfchronicle.startScrollMonitoring(), 1500);
        }
    }

    // Export to namespace
    window.Engramme = window.Engramme || {};
    window.Engramme.sfchronicle = sfchronicle;

})();
