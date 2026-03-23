// amazon.js - Amazon content extraction (product pages, search results, homepage)
// Handles product pages, search results, and homepage recommendations with viewport-based extraction and 3s scroll debounce
// Depends on: core/state.js

(function() {
    'use strict';

    const amazon = {};

    // Scroll tracking state
    let scrollTimeout = null;
    let lastScrollPosition = 0;
    let isScrollListenerAttached = false;

    /**
     * Check if we're on Amazon
     */
    amazon.isAmazon = function() {
        const hostname = window.location.hostname;
        return hostname.includes('amazon.com') || hostname.includes('amazon.');
    };

    /**
     * Detect page type: product page, search results, or homepage
     * @returns {'product' | 'search' | 'homepage' | null}
     */
    amazon.getPageType = function() {
        if (!amazon.isAmazon()) {
            return null;
        }

        const pathname = window.location.pathname;
        const search = window.location.search;

        // Product page patterns: /dp/ or /gp/product/
        if (pathname.includes('/dp/') || pathname.includes('/gp/product/')) {
            return 'product';
        }

        // Search results: /s? with k= parameter
        if (pathname === '/s' || pathname.startsWith('/s?') || search.includes('k=')) {
            return 'search';
        }

        // Homepage: root path or empty
        if (pathname === '/' || pathname === '') {
            return 'homepage';
        }

        return null;
    };

    /**
     * Check if we should extract from this page
     */
    amazon.shouldExtract = function() {
        const pageType = amazon.getPageType();
        return pageType === 'product' || pageType === 'search' || pageType === 'homepage';
    };

    /**
     * Check if we should monitor scroll events on this page
     */
    amazon.shouldMonitor = function() {
        const pageType = amazon.getPageType();
        return pageType === 'product' || pageType === 'search' || pageType === 'homepage';
    };

    /**
     * Check if element is in viewport
     */
    function isInViewport(element) {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        return (
            rect.top < window.innerHeight &&
            rect.bottom > 0 &&
            rect.left < window.innerWidth &&
            rect.right > 0
        );
    }

    /**
     * Extract search results from Amazon search page
     * @param {boolean} viewportOnly - If true, only return visible results
     * @returns {Array} Array of search result objects
     */
    amazon.getSearchResults = function(viewportOnly = true) {
        const results = [];
        const seenTitles = new Set();

        // Search result items - each has data-cy="title-recipe"
        const searchItems = document.querySelectorAll('[data-cy="title-recipe"], [data-component-type="s-search-result"]');

        searchItems.forEach(item => {
            if (viewportOnly && !isInViewport(item)) return;

            // Get brand name (small text above title)
            const brandEl = item.querySelector('h2 span.a-size-base-plus, .a-row.a-size-base span');
            const brand = brandEl?.textContent?.trim() || '';

            // Get product title
            const titleEl = item.querySelector('h2 a span, a.a-link-normal h2 span');
            const title = titleEl?.textContent?.trim() || '';

            if (!title || seenTitles.has(title)) return;
            seenTitles.add(title);

            results.push({
                brand: brand,
                title: title
            });
        });

        return results;
    };

    /**
     * Extract product recommendations from Amazon homepage
     * @param {boolean} viewportOnly - If true, only return visible recommendations
     * @returns {Array} Array of recommendation card objects
     */
    amazon.getHomepageContent = function(viewportOnly = true) {
        const recommendations = [];
        const seenTitles = new Set();

        // Find recommendation cards (.a-cardui with product quadrants)
        const cards = document.querySelectorAll('.a-cardui[data-card-metrics-id], div[data-csa-c-type="widget"]');

        cards.forEach(card => {
            if (viewportOnly && !isInViewport(card)) return;

            // Get card header/section title
            const headerEl = card.querySelector('.a-cardui-header h2 span.a-truncate-full, h2 span.a-truncate-full, .a-section h2');
            const sectionTitle = headerEl?.textContent?.trim() || '';
            if (sectionTitle && sectionTitle.toLowerCase().includes('keep shopping for')) {
                return;
            }

            // Get product items within this card
            const productItems = card.querySelectorAll('[data-csa-c-type="item"], .a-section[data-csa-c-item-id]');
            const products = [];

            productItems.forEach(item => {
                if (viewportOnly && !isInViewport(item)) return;

                // Product title - try multiple selectors including _multi-asin-thumbnails hero title
                const titleEl = item.querySelector(
                    'span.a-truncate-full, ' +
                    '[class*="_multi-asin-thumbnails_desktopStyle_heroTitle"] span.a-truncate-full, ' +
                    'a.a-link-normal span, ' +
                    '.a-size-base'
                );
                const title = titleEl?.textContent?.trim() || '';

                if (title && !seenTitles.has(title) && title.length > 5) {
                    seenTitles.add(title);
                    products.push(title);
                }
            });

            // Only add sections that have products
            if (products.length > 0) {
                recommendations.push({
                    section: sectionTitle,
                    products: products
                });
            }
        });

        // Also try _multi-asin-thumbnails sections directly (hero product titles)
        const heroTitles = document.querySelectorAll('[class*="_multi-asin-thumbnails_desktopStyle_heroTitle"] span.a-truncate-full');
        heroTitles.forEach(el => {
            if (viewportOnly && !isInViewport(el)) return;
            const title = el.textContent?.trim();
            if (title && !seenTitles.has(title) && title.length > 5) {
                seenTitles.add(title);
                // Add to existing recommendations or create new section
                if (recommendations.length === 0) {
                    recommendations.push({ section: '', products: [title] });
                } else {
                    // Find a section without a name or add to last one
                    const lastSection = recommendations[recommendations.length - 1];
                    lastSection.products.push(title);
                }
            }
        });

        // Fallback: also try direct product links on homepage
        if (recommendations.length === 0) {
            const productLinks = document.querySelectorAll('a[href*="/dp/"] span.a-truncate-full, a[href*="/gp/product/"] span');
            productLinks.forEach(el => {
                if (viewportOnly && !isInViewport(el)) return;
                const title = el.textContent?.trim();
                if (title && !seenTitles.has(title) && title.length > 5) {
                    seenTitles.add(title);
                    recommendations.push({
                        section: '',
                        products: [title]
                    });
                }
            });
        }

        return recommendations;
    };

    /**
     * Extract product content from Amazon product page
     * @param {boolean} viewportOnly - If true, only return visible content
     * @returns {Object} Product data
     */
    amazon.getProductContent = function(viewportOnly = true) {
        const product = {
            title: '',
            brand: '',
            features: [],
            description: '',
            details: []
        };

        // Get product title
        const titleEl = document.querySelector('#productTitle');
        if (titleEl && (!viewportOnly || isInViewport(titleEl))) {
            product.title = titleEl.textContent?.trim() || '';
        }

        // Get brand/store name
        const brandEl = document.querySelector('#bylineInfo');
        if (brandEl && (!viewportOnly || isInViewport(brandEl))) {
            product.brand = brandEl.textContent?.trim() || '';
        }

        // Get feature bullets
        const featureList = document.querySelector('#feature-bullets ul, ul.a-unordered-list.a-vertical.a-spacing-mini');
        if (featureList) {
            const featureItems = featureList.querySelectorAll('li span.a-list-item');
            featureItems.forEach(item => {
                if (viewportOnly && !isInViewport(item)) return;
                const text = item.textContent?.trim();
                if (text && text.length > 10) {
                    product.features.push(text);
                }
            });
        }

        // Get product description (the longer prose section)
        const descriptionEl = document.querySelector('#productDescription p, #productDescription span, .a-expander-content span');
        if (descriptionEl && (!viewportOnly || isInViewport(descriptionEl))) {
            product.description = descriptionEl.textContent?.trim() || '';
        }

        // Get product details (dimensions, manufacturer, etc.)
        const detailBullets = document.querySelectorAll('.detail-bullet-list li span.a-list-item');
        detailBullets.forEach(item => {
            if (viewportOnly && !isInViewport(item)) return;

            const boldEl = item.querySelector('.a-text-bold');
            const valueSpan = item.querySelector('span:not(.a-text-bold)');

            if (boldEl && valueSpan) {
                const label = boldEl.textContent?.trim().replace(/[:\s‏‎]+$/, '') || '';
                const value = valueSpan.textContent?.trim() || '';

                // Skip certain fields
                if (label && value &&
                    !label.includes('Best Sellers Rank') &&
                    !label.includes('Customer Reviews') &&
                    !label.includes('ASIN')) {
                    product.details.push(`${label}: ${value}`);
                }
            }
        });

        // Also try the technical details table
        const techDetailsRows = document.querySelectorAll('#productDetails_techSpec_section_1 tr, #prodDetails tr');
        techDetailsRows.forEach(row => {
            if (viewportOnly && !isInViewport(row)) return;

            const label = row.querySelector('th')?.textContent?.trim();
            const value = row.querySelector('td')?.textContent?.trim();

            if (label && value) {
                product.details.push(`${label}: ${value}`);
            }
        });

        return product;
    };

    /**
     * Get formatted content string for memory retrieval
     * @param {boolean} viewportOnly - Only get visible content
     * @returns {string} Formatted content for API
     */
    amazon.getContent = function(viewportOnly = true) {
        const pageType = amazon.getPageType();

        if (pageType === 'search') {
            const results = amazon.getSearchResults(viewportOnly);
            if (results.length === 0) {
                return '';
            }

            // Get search query from URL
            const urlParams = new URLSearchParams(window.location.search);
            const query = urlParams.get('k') || '';

            const parts = [];
            if (query) {
                parts.push(`RQ: ${query}`);
            }

            let resultContent = 'RS: ';
            for (const result of results) {
                const itemParts = [];
                if (result.brand) {
                    itemParts.push(`BR: ${result.brand}`);
                }
                itemParts.push(`TI: ${result.title}`);
                const item = itemParts.join(' : ');
                const separator = resultContent === 'RS: ' ? '' : ' | ';

                if ((parts.join('\n\n') + '\n\n' + resultContent + separator + item).length > 950) {
                    break;
                }
                resultContent += separator + item;
            }
            parts.push(resultContent);

            return parts.join('\n\n').trim();
        }

        if (pageType === 'product') {
            const product = amazon.getProductContent(viewportOnly);
            const parts = [];

            // Build content string
            if (product.title) {
                parts.push(`TI: ${product.title}`);
            }
            if (product.brand) {
                parts.push(`BR: ${product.brand}`);
            }
            if (product.features.length > 0) {
                parts.push(`FT: ${product.features.join(' | ')}`);
            }
            if (product.description) {
                parts.push(`TX: ${product.description}`);
            }
            if (product.details.length > 0) {
                parts.push(`DT: ${product.details.join(' | ')}`);
            }

            // Trim to stay under 1000 chars
            let content = parts.join('\n\n');
            if (content.length > 950) {
                content = content.slice(0, 950);
            }

            return content.trim();
        }

        if (pageType === 'homepage') {
            const recommendations = amazon.getHomepageContent(viewportOnly);
            if (recommendations.length === 0) {
                return '';
            }

            let content = 'RC: ';

            // Build content from recommendation sections
            for (const section of recommendations) {
                const sectionLabel = section.section || 'General';
                for (const product of section.products) {
                    const item = `section: ${sectionLabel} : product: ${product}`;
                    const separator = content === 'RC: ' ? '' : ' | ';
                    if ((content + separator + item).length > 950) {
                        break;
                    }
                    content += separator + item;
                }
                if (content.length > 900) {
                    break;
                }
            }

            return content.trim();
        }

        return '';
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
            const pageType = amazon.getPageType();
            const contentType = pageType === 'search' ? 'search results' : pageType === 'homepage' ? 'recommendations' : 'product content';
            lastScrollPosition = window.scrollY;

            const memoryRefresh = window.Engramme?.memoryRefresh;
            if (memoryRefresh && memoryRefresh.updateForGenericPage) {
                memoryRefresh.updateForGenericPage();
            }
        }, 3000);
    }

    /**
     * Start scroll monitoring for Amazon pages
     */
    amazon.startScrollMonitoring = function() {
        if (isScrollListenerAttached) {
            return;
        }

        if (!amazon.shouldMonitor()) {
            return;
        }

        const pageType = amazon.getPageType();
        window.addEventListener('scroll', handleScroll, { passive: true });
        isScrollListenerAttached = true;
        lastScrollPosition = window.scrollY;
    };

    /**
     * Stop scroll monitoring
     */
    amazon.stopScrollMonitoring = function() {
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
    amazon.reset = function() {
        lastScrollPosition = 0;
        amazon.stopScrollMonitoring();
    };

    // Auto-start scroll monitoring if on Amazon product or search page
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            if (amazon.shouldMonitor()) {
                setTimeout(() => amazon.startScrollMonitoring(), 1500);
            }
        });
    } else {
        if (amazon.shouldMonitor()) {
            setTimeout(() => amazon.startScrollMonitoring(), 1500);
        }
    }

    // Export to namespace
    window.Engramme = window.Engramme || {};
    window.Engramme.amazon = amazon;

})();
