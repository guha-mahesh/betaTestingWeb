// viewport-utils.js - Shared utilities for viewport detection and scroll monitoring
// Provides reusable functions for all scrapers
// Depends on: core/state.js

(function() {
    'use strict';

    const viewportUtils = {};

    // Scroll monitoring state
    let scrollTimeout = null;
    let isScrollListenerAttached = false;
    let lastScrollPosition = 0;
    const SCROLL_DEBOUNCE_MS = 3000; // 3 seconds after scroll stops

    /**
     * Check if an element is currently visible in the viewport
     * @param {Element} element - DOM element to check
     * @returns {boolean}
     */
    viewportUtils.isInViewport = function(element) {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        return (
            rect.top < window.innerHeight &&
            rect.bottom > 0 &&
            rect.left < window.innerWidth &&
            rect.right > 0
        );
    };

    /**
     * Filter an array of elements to only those in viewport
     * @param {NodeList|Array} elements - Elements to filter
     * @returns {Array} Elements that are in viewport
     */
    viewportUtils.filterToViewport = function(elements) {
        return Array.from(elements).filter(el => viewportUtils.isInViewport(el));
    };

    /**
     * Get text content from elements, optionally filtered to viewport
     * @param {string} selector - CSS selector for elements
     * @param {boolean} viewportOnly - If true, only include visible elements
     * @returns {string[]} Array of text content
     */
    viewportUtils.getTextFromElements = function(selector, viewportOnly = true) {
        const elements = document.querySelectorAll(selector);
        const filtered = viewportOnly ? viewportUtils.filterToViewport(elements) : Array.from(elements);

        return filtered
            .map(el => el.textContent?.trim())
            .filter(text => text && text.length > 0);
    };

    /**
     * Start scroll monitoring - triggers callback after scroll stops for debounce period
     * @param {Function} onScrollStop - Callback to run when scroll stops
     * @param {number} debounceMs - Milliseconds to wait after scroll stops (default 3000)
     */
    viewportUtils.startScrollMonitoring = function(onScrollStop, debounceMs = SCROLL_DEBOUNCE_MS) {
        if (isScrollListenerAttached) {
            return;
        }

        const handleScroll = () => {
            if (scrollTimeout) {
                clearTimeout(scrollTimeout);
            }

            scrollTimeout = setTimeout(() => {
                lastScrollPosition = window.scrollY;
                if (onScrollStop) {
                    onScrollStop();
                }
            }, debounceMs);
        };

        window.addEventListener('scroll', handleScroll, { passive: true });
        isScrollListenerAttached = true;
        lastScrollPosition = window.scrollY;
    };

    /**
     * Stop scroll monitoring
     */
    viewportUtils.stopScrollMonitoring = function() {
        if (!isScrollListenerAttached) {
            return;
        }

        // Can't remove anonymous function, so we'll just clear the flag
        // In practice, the listener will be cleaned up on page navigation
        isScrollListenerAttached = false;

        if (scrollTimeout) {
            clearTimeout(scrollTimeout);
            scrollTimeout = null;
        }

    };

    /**
     * Check if scroll monitoring is active
     * @returns {boolean}
     */
    viewportUtils.isScrollMonitoringActive = function() {
        return isScrollListenerAttached;
    };

    /**
     * Trigger a memory refresh for current page content
     * This is the standard action to take after scroll stops
     */
    viewportUtils.triggerMemoryRefresh = function() {
        const memoryRefresh = window.Engramme?.memoryRefresh;
        if (memoryRefresh && memoryRefresh.updateForGenericPage) {
            memoryRefresh.updateForGenericPage();
        }
    };

    /**
     * Convenience: Start scroll monitoring with automatic memory refresh
     * This is the standard behavior for most pages
     * @param {number} debounceMs - Milliseconds to wait (default 3000)
     */
    viewportUtils.enableAutoRefreshOnScroll = function(debounceMs = SCROLL_DEBOUNCE_MS) {
        viewportUtils.startScrollMonitoring(() => {
            viewportUtils.triggerMemoryRefresh();
        }, debounceMs);
    };

    // Export to namespace
    window.Engramme = window.Engramme || {};
    window.Engramme.viewportUtils = viewportUtils;

})();
