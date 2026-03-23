// reddit.js - Reddit content extraction
// Handles both subreddit/home view and specific post views 
// Depends on: core/state.js

(function() {
    'use strict';

    const reddit = {};

    // Scroll tracking state
    let scrollTimeout = null;
    let lastScrollPosition = 0;
    let isScrollListenerAttached = false;
    let lastExtractedTitles = new Set();
    let lastExtractedParagraphs = new Set();
    let lastExtractedComments = new Set();


    /**
     * Detect if we're on Reddit homepage vs post page
     * @returns {'homepage' | 'post' | null}
     */
    reddit.getPageType = function() {
        const hostname = window.location.hostname;
        if (!hostname.includes('reddit.com')) {
            return null;
        }

        const pathname = window.location.pathname;
        const searchQuery = new URLSearchParams(window.location.search).get('q'); 


        // Homepage
        if (pathname === '/' || pathname === '' || 
    pathname.startsWith('/r/') && !pathname.includes('/comments/') ||
    pathname === '/search/' || searchQuery) {
    return 'homepage';
}

       

        // post patterns - typically have /comments/ in URL
        if (pathname.includes('/comments/')) {
            return 'post';
        }

        return null;
    };

    /**
     * Extract post titles from Reddit homepage/subreddit/search
     * @param {boolean} viewportOnly - If true, only return visible posts
     * @returns {Array<{title: string, snippet: string}>} Array of post objects
     */
    reddit.getHomepageTitles = function(viewportOnly = true) {
        const posts = [];
        const seenTitles = new Set();

        const isInViewport = (element) => {
            const rect = element.getBoundingClientRect();
            return (
                rect.top < window.innerHeight &&
                rect.bottom > 0 &&
                rect.left < window.innerWidth &&
                rect.right > 0
            );
        };

        // Get post titles - multiple selectors for different Reddit views
        // 1. a[slot="full-post-link"] - homepage and subreddit views
        // 2. a[data-testid="post-title-text"] - search results
        const postTitles = document.querySelectorAll('a[slot="full-post-link"], a[data-testid="post-title-text"]');

        postTitles.forEach(el => {
            // Skip elements inside masthead (trending/promoted content)
            if (el.closest('div.masthead')) {
                return;
            }

            const text = el.textContent?.trim();

            if (!text || seenTitles.has(text)) {
                return;
            }

            if (viewportOnly && !isInViewport(el)) {
                return;
            }

            seenTitles.add(text);
            posts.push({
                title: text,
                snippet: ''
            });
        });

        // Get snippets - find shreddit-post elements and match by title
        let snippetsFound = 0;
        const shredditPosts = document.querySelectorAll('shreddit-post');

        shredditPosts.forEach(shredditPost => {
            // Get the title from this shreddit-post
            const titleEl = shredditPost.querySelector('a[slot="full-post-link"]');
            if (!titleEl) return;

            const title = titleEl.textContent?.trim();

            // Find matching post in our array
            const matchingPost = posts.find(p => p.title === title);
            if (!matchingPost) return;

            // Get snippet from the text body - only the p tags inside div.md
            const snippetEl = shredditPost.querySelector('shreddit-post-text-body div.md');
            if (snippetEl) {
                // Only get text from p tags to avoid grabbing other content
                const paragraphs = snippetEl.querySelectorAll('p');
                if (paragraphs.length > 0) {
                    const snippetText = Array.from(paragraphs)
                        .map(p => p.textContent?.trim())
                        .filter(t => t)
                        .join(' ')
                        .slice(0, 200); // Limit snippet length
                    if (snippetText) {
                        matchingPost.snippet = snippetText;
                        snippetsFound++;
                    }
                }
            }
        });

        // Search results format - snippet is in search-telemetry-tracker
        // The snippet tracker is a SIBLING of the title link, NOT inside faceplate-hovercard
        const searchPostUnits = document.querySelectorAll('[data-testid="sdui-post-unit"]');
        searchPostUnits.forEach(unit => {
            const titleEl = unit.querySelector('a[data-testid="post-title-text"]');
            if (!titleEl) return;

            const title = titleEl.textContent?.trim();
            if (!title) return;

            // Find snippet - it's in a search-telemetry-tracker that is a SIBLING after the title
            // NOT the one inside faceplate-hovercard (that's the community link)
            let snippet = '';

            // Get all search-telemetry-tracker elements that are direct children (not nested in hovercard)
            const allTrackers = unit.querySelectorAll(':scope > search-telemetry-tracker, :scope > div > search-telemetry-tracker');
            for (const tracker of allTrackers) {
                // Skip if it's inside a hovercard (that's the community link)
                if (tracker.closest('faceplate-hovercard')) continue;

                const link = tracker.querySelector('a:not([data-testid])');
                if (link) {
                    const text = link.textContent?.trim();
                    // Skip if it looks like a subreddit name
                    if (text && text.length > 15 && !text.startsWith('r/')) {
                        snippet = text.slice(0, 200);
                        break;
                    }
                }
            }

            // Check if we already have this title in posts array
            const existingPost = posts.find(p => p.title === title);
            if (existingPost) {
                if (snippet && !existingPost.snippet) {
                    existingPost.snippet = snippet;
                    snippetsFound++;
                }
            } else if (!seenTitles.has(title)) {
                if (viewportOnly && !isInViewport(titleEl)) return;
                seenTitles.add(title);
                posts.push({ title, snippet });
                if (snippet) snippetsFound++;
            }
        });

        // Debug: log posts with snippets
        const postsWithSnippets = posts.filter(p => p.snippet);
        if (postsWithSnippets.length > 0) {
        }
        return posts;
    };

    /**
     * Extract content from Reddit post page
     * Gets title, body, and visible comments
     * @param {boolean} viewportOnly - If true, only return visible comments
     * @returns {Object} Post data with title, body, comments
     */
    reddit.getPostContent = function(viewportOnly = true) {
        const post = {
            title: '',
            body: '',
            comments: []
        };

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

        // Get title
        const titleEl = document.querySelector('h1[slot="title"]');
        if (titleEl) {
            post.title = titleEl.textContent?.trim() || '';
        }

        // Get post body
        const bodyEl = document.querySelector('div[slot="text-body"]');
        if (bodyEl) {
            const paragraphs = bodyEl.querySelectorAll('p');
            post.body = Array.from(paragraphs)
                .map(p => p.textContent?.trim())
                .filter(text => text)
                .join('\n\n');
        }

        // Get comments
        const commentEls = document.querySelectorAll('div[slot="comment"]');
        const seenComments = new Set();

        commentEls.forEach(el => {
            const text = el.textContent?.trim();

            // Skip empty, duplicate, or bot comments
            if (!text || seenComments.has(text)) {
                return;
            }
            if (text.includes('I am a bot') || text.includes('action was performed automatically')) {
                return;
            }

            if (viewportOnly && !isInViewport(el)) {
                return;
            }

            seenComments.add(text);
            post.comments.push(text);
        });

        return post;
    };

    /**
     * Get formatted content string for memory retrieval
     * @param {boolean} viewportOnly - For homepage, only get visible titles
     * @returns {string} Formatted content for API
     */
    reddit.getContent = function(viewportOnly = true) {
        const pageType = reddit.getPageType();

        if (pageType === 'homepage') {
            const posts = reddit.getHomepageTitles(viewportOnly);
            if (posts.length === 0) {
                return '';
            }
            let content = 'RS: ';
            for (const post of posts) {
                const itemParts = [`TI: ${post.title}`];
                if (post.snippet) {
                    itemParts.push(`TX: ${post.snippet}`);
                }
                const item = itemParts.join(' : ');
                const separator = content === 'RS: ' ? '' : ' | ';
                if ((content + separator + item).length > 950) { // Leave some buffer
                    break;
                }
                content += separator + item;
            }
            return content.trim();
        }

        if (pageType === 'post') {
            const post = reddit.getPostContent(viewportOnly);
            const parts = [];
            if (post.title) {
                parts.push(`TI: ${post.title}`);
            }
            if (post.body) {
                parts.push(`TX: ${post.body}`);
            }
            if (post.comments.length > 0) {
                parts.push(`CM: ${post.comments.join(' | ')}`);
            }

            let content = parts.join('\n\n');
            if (content.length > 950) {
                content = content.slice(0, 950);
            }

            return content.trim();
        }

        return '';
    };

    /**
     * Check if this is a Reddit page
     * @returns {boolean}
     */
    reddit.isReddit = function() {
        return window.location.hostname.includes('reddit.com');
    };

    /**
     * Check if we should extract from this page
     * @returns {boolean}
     */
    reddit.shouldExtract = function() {
        if (!reddit.isReddit()) {
            return false;
        }
        const pageType = reddit.getPageType();
        return pageType === 'homepage' || pageType === 'post';
    };

    /**
     * Check if new titles are visible that weren't extracted before
     * @returns {boolean}
     */
    reddit.hasNewVisibleTitles = function() {
        const currentPosts = reddit.getHomepageTitles(true);
        let hasNew = false;

        for (const post of currentPosts) {
            if (!lastExtractedTitles.has(post.title)) {
                hasNew = true;
                break;
            }
        }

        return hasNew;
    };

    /**
     * Update the set of extracted titles (call after successful extraction)
     */
    reddit.updateExtractedTitles = function() {
        const currentPosts = reddit.getHomepageTitles(true);
        currentPosts.forEach(post => lastExtractedTitles.add(post.title));
    };

    /**
     * Handle scroll event - debounced re-extraction
     * Waits 3 seconds after scroll stops, then fetches what's on screen
     */
    function handleScroll() {
        if (scrollTimeout) {
            clearTimeout(scrollTimeout);
        }

        scrollTimeout = setTimeout(() => {
            const pageType = reddit.getPageType();
            lastScrollPosition = window.scrollY;

            const memoryRefresh = window.Engramme?.memoryRefresh;
            if (memoryRefresh && memoryRefresh.updateForGenericPage) {
                memoryRefresh.updateForGenericPage();
            }

            if (pageType === 'homepage') {
                reddit.updateExtractedTitles();
            }
        }, 3000);
    }

    /**
     * Start scroll monitoring for Reddit
     */
    reddit.startScrollMonitoring = function() {
        if (isScrollListenerAttached) {
            return;
        }

        const pageType = reddit.getPageType();
        if (pageType !== 'homepage' && pageType !== 'post') {
            return;
        }

        window.addEventListener('scroll', handleScroll, { passive: true });
        isScrollListenerAttached = true;

        if (pageType === 'homepage') {
            reddit.updateExtractedTitles();
        }
        lastScrollPosition = window.scrollY;
    };

    /**
     * Stop scroll monitoring
     */
    reddit.stopScrollMonitoring = function() {
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
    reddit.reset = function() {
        lastExtractedTitles.clear();
        lastExtractedComments.clear();
        lastScrollPosition = 0;
        reddit.stopScrollMonitoring();
    };

    // Auto-start scroll monitoring if on Reddit
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            const pageType = reddit.getPageType();
            if (reddit.isReddit() && (pageType === 'homepage' || pageType === 'post')) {
                setTimeout(() => reddit.startScrollMonitoring(), 1500);
            }
        });
    } else {
        const pageType = reddit.getPageType();
        if (reddit.isReddit() && (pageType === 'homepage' || pageType === 'post')) {
            setTimeout(() => reddit.startScrollMonitoring(), 1500);
        }
    }

    // Export to namespace
    window.Engramme = window.Engramme || {};
    window.Engramme.reddit = reddit;

})();
