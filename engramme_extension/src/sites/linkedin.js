// linkedin.js - LinkedIn content extraction via OCR/Vision API
// Uses screenshot capture + GPT-4V to extract professional information

(function() {
    'use strict';

    const linkedin = {};

    // MTE tracking state
    let lastMTETime = 0;
    let lastProfileUrl = '';
    let isMonitoring = false;
    let urlCheckInterval = null;

    // MTE thresholds
    const TIME_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes

    // OCR extraction prompt
    const EXTRACTION_PROMPT = `You are analyzing a screenshot of a LinkedIn page to extract professional information.

TASK: Extract only the primary professional content, ignoring all secondary elements.

IGNORE:
- Advertisements and promotional banners
- Navigation menus and headers
- Sidebars with "People also viewed" or recommendations
- Footer information
- "LinkedIn News" and trending topics
- Cookie consent banners and popups
- Comments sections (unless specifically requested)
- "Suggested connections" or "You might like" sections
- Sponsored content markers
- Chat widgets and notification badges

EXTRACT:
- Person's full name (if profile page)
- Current job title and company
- Location
- Profile headline/tagline
- About/Summary section
- Work experience (company names, titles, dates)
- Education (institutions, degrees, dates)
- Skills listed
- If it's a post: author name, their title/company, post content
- If it's a job posting: job title, company, location, key requirements

OUTPUT FORMAT:
Return the extracted content as clean, structured text with:
1. Name
2. Current Title at Company
3. Location
4. Professional Summary
5. Experience (reverse chronological)
6. Education
7. Key Skills

Focus on professional information that would be useful for networking, hiring decisions, or understanding someone's career background.`;

    /**
     * Check if we're on LinkedIn
     */
    linkedin.shouldExtract = function() {
        const hostname = window.location.hostname;
        return hostname.includes('linkedin.com');
    };

    /**
     * Get the current profile/page identifier
     */
    function getCurrentPageId() {
        const url = window.location.href;
        // Extract profile ID or post ID from URL
        const profileMatch = url.match(/\/in\/([^\/\?]+)/);
        const postMatch = url.match(/\/posts\/([^\/\?]+)/);
        const feedMatch = url.match(/\/feed\//);

        if (profileMatch) return `profile:${profileMatch[1]}`;
        if (postMatch) return `post:${postMatch[1]}`;
        if (feedMatch) return 'feed';
        return url;
    }

    /**
     * Capture screenshot of visible viewport using canvas
     */
    async function captureScreenshot() {
        try {
            // Request screenshot from background script via tabCapture
            return new Promise((resolve, reject) => {
                chrome.runtime.sendMessage(
                    { action: 'captureVisibleTab' },
                    (response) => {
                        if (chrome.runtime.lastError) {
                            reject(new Error(chrome.runtime.lastError.message));
                            return;
                        }
                        if (response && response.success) {
                            resolve(response.dataUrl);
                        } else {
                            reject(new Error(response?.error || 'Failed to capture screenshot'));
                        }
                    }
                );
            });
        } catch (error) {
            console.error('LinkedIn: Screenshot capture failed:', error);
            return null;
        }
    }

    /**
     * Send screenshot to Vision API for OCR extraction
     */
    async function extractWithVision(imageDataUrl) {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(
                {
                    action: 'visionOCR',
                    imageDataUrl: imageDataUrl,
                    prompt: EXTRACTION_PROMPT
                },
                (response) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                        return;
                    }
                    if (response && response.success) {
                        resolve(response.content);
                    } else {
                        reject(new Error(response?.error || 'Vision API extraction failed'));
                    }
                }
            );
        });
    }

    /**
     * Get content from LinkedIn page via OCR
     * This is async because it captures screenshot and calls Vision API
     */
    linkedin.getContent = async function() {
        if (!linkedin.shouldExtract()) {
            return '';
        }

        try {
            const screenshot = await captureScreenshot();

            if (!screenshot) {
                return '';
            }

            const content = await extractWithVision(screenshot);

            if (content) {
                return content;
            }

            return '';
        } catch (error) {
            console.error('LinkedIn: Content extraction error:', error);
            return '';
        }
    };

    /**
     * Synchronous fallback - returns empty (OCR requires async)
     * Used by scrapers.js getGenericPageContent which expects sync
     */
    linkedin.getContentSync = function() {
        // LinkedIn requires async OCR, return empty for sync calls
        // The async getContent will be called by memory-refresh for MTE
        return '';
    };

    /**
     * Trigger memory recall with current content
     */
    async function triggerMTE(reason) {

        const content = await linkedin.getContent();
        if (!content || content.length < 20) {
            return;
        }

        // Update tracking state
        lastMTETime = Date.now();
        lastProfileUrl = getCurrentPageId();

        // Trigger memory refresh
        const memoryRefresh = window.Engramme?.memoryRefresh;
        if (memoryRefresh && memoryRefresh.updateForGenericPage) {
            // Pass the extracted content directly to avoid re-extraction
            memoryRefresh.updateWithContent(content);
        }
    }

    /**
     * Check for URL changes (navigating between profiles/posts)
     */
    function checkUrlChange() {
        const currentPageId = getCurrentPageId();
        if (currentPageId !== lastProfileUrl) {
            lastProfileUrl = currentPageId;

            // Clear cache to force fresh fetch
            const utils = window.Engramme?.utils;
            if (utils && utils.clearQueryCache) {
                utils.clearQueryCache('generic', true);
            }

            // Trigger MTE for new page after a delay for content to load
            setTimeout(() => triggerMTE('page navigation'), 2000);
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
     * Start monitoring for MTEs
     */
    linkedin.startMonitoring = function() {
        if (isMonitoring) {
            return;
        }
        if (!linkedin.shouldExtract()) {
            return;
        }

        isMonitoring = true;

        // Initialize state
        lastMTETime = Date.now();
        lastProfileUrl = getCurrentPageId();

        // Check for URL changes (LinkedIn is SPA)
        urlCheckInterval = setInterval(() => {
            checkUrlChange();
            checkTimeMTE();
        }, 2000);

        // Initial MTE after page loads
        setTimeout(() => {
            triggerMTE('initial load');
        }, 3000);
    };

    /**
     * Stop monitoring
     */
    linkedin.stopMonitoring = function() {
        if (!isMonitoring) return;

        isMonitoring = false;

        if (urlCheckInterval) {
            clearInterval(urlCheckInterval);
            urlCheckInterval = null;
        }
    };

    /**
     * Check if monitoring is active
     */
    linkedin.isMonitoring = function() {
        return isMonitoring;
    };

    // Export to namespace
    window.Engramme.linkedin = linkedin;

    // Auto-start monitoring if on LinkedIn
    if (linkedin.shouldExtract()) {
        if (document.readyState === 'complete') {
            setTimeout(() => linkedin.startMonitoring(), 2000);
        } else {
            window.addEventListener('load', () => {
                setTimeout(() => linkedin.startMonitoring(), 2000);
            });
        }
    }

})();
