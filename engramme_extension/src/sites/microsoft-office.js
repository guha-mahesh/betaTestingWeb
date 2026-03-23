// microsoft-office.js - Microsoft Office Online content extraction and MTE monitoring
// Handles Word Online (officeapps.live.com) with MTE triggers like google-docs.js
// Depends on: core/state.js

(function() {
    'use strict';

    const msOffice = {};

    // MTE tracking state
    let lastMTETime = 0;
    let lastMTEWordCount = 0;
    let lastMTEContent = '';
    let isMonitoring = false;
    let timeCheckInterval = null;
    let viewportCheckInterval = null;
    let mutationObserver = null;
    let lastViewportText = '';
    let viewportStableCount = 0;
    const VIEWPORT_CHECK_MS = 1000; // check every 1s
    const VIEWPORT_STABLE_THRESHOLD = 3; // trigger after 3s stable (3 checks)

    // MTE thresholds (same as Google Docs)
    const WORD_THRESHOLD = 30;
    const TIME_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes

    /**
     * Check if we're inside a Word Online editor iframe
     */
    msOffice.isWordOnline = function() {
        const h = window.location.hostname;
        return h.includes('officeapps.live.com') && h.includes('word');
    };

    /**
     * Check if we're inside an Excel Online editor iframe
     */
    msOffice.isExcelOnline = function() {
        const h = window.location.hostname;
        return h.includes('officeapps.live.com') && h.includes('excel');
    };

    /**
     * Check if we're inside a PowerPoint Online editor iframe
     */
    msOffice.isPowerPointOnline = function() {
        const h = window.location.hostname;
        return h.includes('officeapps.live.com') && (h.includes('powerpoint') || h.includes('ppt'));
    };

    /**
     * Check if we're on any supported Office Online page
     */
    msOffice.shouldExtract = function() {
        return msOffice.isWordOnline() || msOffice.isExcelOnline() || msOffice.isPowerPointOnline();
    };

    function countWords(text) {
        if (!text) return 0;
        return text.trim().split(/\s+/).filter(w => w.length > 0).length;
    }

    /**
     * Get the document title from the page
     */
    function getDocTitle() {
        // Word Online sets the page title to "Word" or the doc name
        // Try the rename field first, then page title
        const renameField = document.querySelector('[class*="RenameFile"], [aria-label*="Rename"]');
        if (renameField) {
            const val = renameField.value || renameField.textContent;
            if (val && val.trim() && val.trim() !== 'Word') return val.trim();
        }
        const title = document.title;
        if (title && title !== 'Word' && title !== 'Excel' && title !== 'PowerPoint') {
            return title;
        }
        return '';
    }

    /**
     * Get the scrollable editor container
     */
    function getEditorContainer() {
        return document.querySelector('#WACViewPanel_EditingElement') ||
               document.querySelector('#WACViewPanel') ||
               document.querySelector('[class*="WACViewPanel"]') ||
               document.querySelector('[class*="EditingElement"]') ||
               document.querySelector('[contenteditable="true"]');
    }

    /**
     * Check if an element is visible in the viewport
     */
    function isInViewport(el) {
        const rect = el.getBoundingClientRect();
        return rect.top < window.innerHeight && rect.bottom > 0 &&
               rect.left < window.innerWidth && rect.right > 0 &&
               rect.height > 0;
    }

    /**
     * Get paragraph-level elements from Word Online.
     * OutlineElement divs are the actual line-level elements (43 in test doc).
     * They may not be inside #WACViewPanel_EditingElement, so search the whole document.
     */
    function getEditorParagraphs() {
        // OutlineElement = actual content lines in Word Online
        const outlines = document.querySelectorAll('[class*="OutlineElement"]');
        if (outlines.length > 2) return Array.from(outlines);

        // Fallback selectors
        const textRuns = document.querySelectorAll('[class*="TextRun"]');
        if (textRuns.length > 2) return Array.from(textRuns);

        // Last resort: paragraphs inside the editor
        const editor = getEditorContainer();
        if (editor) {
            return Array.from(editor.querySelectorAll('p')).filter(el => el.textContent?.trim().length > 0);
        }
        return [];
    }

    /**
     * Extract content from Word Online.
     * Tries viewport-based extraction first (OutlineElement), falls back to body.innerText.
     */
    msOffice.getContent = function() {
        try {
            let content = '';
            const docTitle = getDocTitle();
            if (docTitle) {
                content += `Document: ${docTitle}\n\n`;
            }

            // Try 1: OutlineElement viewport filtering
            const paragraphs = getEditorParagraphs();
            if (paragraphs.length > 2) {
                const visible = paragraphs.filter(el => isInViewport(el));
                const visibleTexts = visible
                    .map(el => el.textContent?.trim())
                    .filter(t => t && t.length > 0);

                if (visibleTexts.length > 0) {
                    content += visibleTexts.join('\n');
                }
            }

            // Try 2: body.innerText with noise stripping (reliable fallback)
            if (content.length < 50) {
                let bodyText = document.body?.innerText?.trim() || '';
                if (bodyText.length > 50) {
                    bodyText = bodyText.replace(/\nPage \d+ of \d+[\s\S]*$/, '');
                    bodyText = bodyText.replace(/Loading additional document content/g, '');
                    bodyText = bodyText.replace(/Press Alt Shift A for accessibility help\./g, '');
                    bodyText = bodyText.replace(/Heading \d+\./g, '');
                    content += bodyText.trim();
                }
            }

            // Strip remaining noise
            content = content.replace(/Loading additional document content/g, '');

            return content.replace(/\s+/g, ' ').replace(/\n\s+/g, '\n').trim();
        } catch (e) {
            console.error('Error extracting Office Online content:', e);
            return '';
        }
    };

    /**
     * Send extracted content to the parent frame via postMessage
     * so the parent page's overlay can use it for recall
     */
    function sendContentToParent(content) {
        if (window.parent !== window) {
            window.parent.postMessage({
                type: 'engramme-office-content',
                content: content,
                url: window.location.href
            }, '*');
        }
    }

    /**
     * Trigger MTE (Memory Trigger Event)
     */
    async function triggerMTE(reason) {
        const content = msOffice.getContent();
        if (!content || content.length < 10) return;

        const wordCount = countWords(content);

        // Send to parent frame for its overlay to use
        sendContentToParent(content);

        lastMTETime = Date.now();
        lastMTEWordCount = wordCount;
        lastMTEContent = content;

        const memoryRefresh = window.Engramme?.memoryRefresh;
        if (memoryRefresh && memoryRefresh.updateForGenericPage) {
            memoryRefresh.updateForGenericPage();
        }
    }

    /**
     * Check for word count MTE
     */
    function checkWordCountMTE() {
        const content = msOffice.getContent();
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
     * Check if viewport content changed — polls every 1s, fires after 3s stable.
     * Word Online uses custom scrolling so native scroll events don't fire.
     */
    let lastTriggeredViewportText = '';

    function checkViewportChange() {
        const paragraphs = getEditorParagraphs();
        const visibleTexts = paragraphs
            .filter(el => isInViewport(el))
            .map(el => el.textContent?.trim())
            .filter(t => t && t.length > 0);
        const currentText = visibleTexts.join(' ').substring(0, 200);

        if (currentText.length < 10) return;

        if (currentText !== lastViewportText) {
            // Viewport content changed (user scrolled) — reset stability counter
            lastViewportText = currentText;
            viewportStableCount = 0;
        } else if (currentText !== lastTriggeredViewportText) {
            // Content is stable but different from last trigger
            viewportStableCount++;
            if (viewportStableCount >= VIEWPORT_STABLE_THRESHOLD) {
                viewportStableCount = 0;
                lastTriggeredViewportText = currentText;
                triggerMTE('viewport changed');
            }
        }
    }

    /**
     * Start MTE monitoring
     */
    msOffice.startMonitoring = function() {
        if (isMonitoring) return;
        if (!msOffice.shouldExtract()) return;

        isMonitoring = true;

        // Initialize state
        const content = msOffice.getContent();
        lastMTETime = Date.now();
        lastMTEWordCount = countWords(content);
        lastMTEContent = content;
        // Mutation observer for content changes (word count + structure)
        const editor = getEditorContainer();
        if (editor) {
            mutationObserver = new MutationObserver(() => {
                checkWordCountMTE();
            });
            mutationObserver.observe(editor, {
                childList: true,
                subtree: true,
                characterData: true
            });
        }

        // Viewport change detection (polls every 1s, fires after 3s stable)
        // Word Online uses custom scrolling, so native scroll events don't work
        viewportCheckInterval = setInterval(checkViewportChange, VIEWPORT_CHECK_MS);

        // Time-based check every 30 seconds
        timeCheckInterval = setInterval(checkTimeMTE, 30000);

        // Initial MTE
        triggerMTE('initial load');
    };

    /**
     * Stop monitoring
     */
    msOffice.stopMonitoring = function() {
        if (!isMonitoring) return;

        isMonitoring = false;

        if (mutationObserver) {
            mutationObserver.disconnect();
            mutationObserver = null;
        }

        if (timeCheckInterval) {
            clearInterval(timeCheckInterval);
            timeCheckInterval = null;
        }

        if (viewportCheckInterval) {
            clearInterval(viewportCheckInterval);
            viewportCheckInterval = null;
        }
    };

    msOffice.isMonitoring = function() {
        return isMonitoring;
    };

    // Export to namespace
    window.Engramme.msOffice = msOffice;

    // Auto-start monitoring if on an Office Online page
    if (msOffice.shouldExtract()) {
        if (document.readyState === 'complete') {
            setTimeout(() => msOffice.startMonitoring(), 3500);
        } else {
            window.addEventListener('load', () => {
                setTimeout(() => msOffice.startMonitoring(), 3500);
            });
        }
    }

})();
