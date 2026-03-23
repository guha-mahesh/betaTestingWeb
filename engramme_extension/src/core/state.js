// state.js - Global state management and shared utilities
// Establishes window.Engramme namespace with state, utils, and constants
// This file MUST be loaded first before other modules

(function() {
    'use strict';

    // Create global namespace
    window.Engramme = window.Engramme || {};

    // ========================================
    // State Container - All shared state lives here
    // ========================================
    window.Engramme.state = {
        // UI State
        overlayElement: null,
        overlayHost: null,      // Shadow DOM host element
        shadowRoot: null,       // Shadow root for CSS isolation
        tooltipPortal: null,    // Tooltip portal lifecycle + listeners
        demoMode: false,
        userClosedOverlay: false, // true once user manually closes — suppresses auto-open

        // Gmail State
        observer: null,
        inputListeners: [],
        currentComposeElement: null,
        currentViewElement: null,
        previousViewElement: null,
        currentMode: null, // 'compose' | 'view' | 'generic'
        intentListenersAttached: false,
        activeContext: null, // 'compose' | 'view'
        
        // API State
        isApiConfigured: false,
        lastRecallPayload: null,
        lastRecallTrace: null,
        
        // Memory State
        currentMemories: [],
        currentRecallId: null,
        memoriesTimestamp: null,
        currentEmailText: '',
        currentEmailSubject: '',
        lastQueryText: '',
        
        // Feedback State
        memoryRatings: {},
        memoryComments: {},
        submittedMemoryComments: {},
        submittedMemoryErrorCodes: {},
        memoryCommentPanelsOpen: {},
        globalRating: null,
        mostRecentThumb: null,
        selectedErrorCodes: {},
        errorCodeScrollPositions: {},
        
        // Chat State
        isChatMode: false,
        chatMessages: [],
        
        // Request Management
        requestCounter: 0,
        latestEligibleRequestId: 0,
        latestEligibleRequestKey: '',
        lastDisplayedQueryByMode: { compose: '', view: '', generic: '' },
        lastDisplayedRecallKeyByMode: { compose: '', view: '', generic: '' },
        requestState: {
            compose: { inFlight: false, needsRefresh: false },
            view: { inFlight: false, needsRefresh: false },
            generic: {
                inFlight: false,
                needsRefresh: false,
                pendingCustomText: null,
                pendingTranscriptTiming: null
            }
        },
        recallCache: new Map()
    };

    // ========================================
    // Constants
    // ========================================
    window.Engramme.constants = {
        REQUEST_CACHE_TTL_MS: 5 * 60 * 1000,
        QUERY_DIFF_THRESHOLD: 0.10,
        QUERY_ABS_DIFF_THRESHOLD_CHARS: 250,
        QUERY_ABS_DIFF_THRESHOLD_TOKENS: 50
    };
    
    window.Engramme.errorCodes = [
        { code: 'IR', label: 'Irrelevant' },
        { code: 'WP', label: 'Wrong People' },
        { code: 'VA', label: 'Vague' },
        { code: 'IN', label: 'Incorrect' },
        { code: 'IP', label: 'I Problem' },
        { code: 'RP', label: 'Repetitive' },
        { code: 'HL', label: 'Hallucination' },
        { code: 'WC', label: 'Wrong Company' },
        { code: 'NT', label: 'Not Timely' },
        { code: 'NM', label: 'No Memory' },
        { code: 'SR', label: 'Self-Reference' },
        { code: 'EE', label: 'Excessive Emotions' },
        { code: 'VB', label: 'Verbose' },
        { code: 'LK', label: 'Leaked Memory' },
        { code: 'TR', label: 'Trivial' }
    ];

    // ========================================
    // Utility Functions
    // ========================================
    const utils = {};

    /**
     * Debounce a function call
     * @param {Function} func - Function to debounce
     * @param {number} wait - Wait time in milliseconds
     * @returns {Function} Debounced function
     */
    utils.debounce = function(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    };

    /**
     * Normalize query text by collapsing whitespace
     * @param {string} text - Text to normalize
     * @returns {string} Normalized text
     */
    utils.normalizeQueryText = function(text) {
        return (text || '').replace(/\s+/g, ' ').trim();
    };

    /**
     * Count tokens (words) in text
     * @param {string} text - Text to count tokens in
     * @returns {number} Token count
     */
    utils.countTokens = function(text) {
        if (!text) return 0;
        return text.split(/\s+/).filter(Boolean).length;
    };

    /**
     * Compute difference score between two texts (0 = identical, 1 = completely different)
     * @param {string} previousText - Previous text
     * @param {string} nextText - Next text
     * @returns {number} Difference score between 0 and 1
     */
    utils.computeDiffScore = function(previousText, nextText) {
        if (!previousText && !nextText) return 0;
        if (previousText === nextText) return 0;

        const prevLen = previousText.length;
        const nextLen = nextText.length;
        const lengthDiff = Math.abs(prevLen - nextLen) / Math.max(prevLen, nextLen);

        const prevTokens = new Set(previousText.toLowerCase().split(/\s+/).filter(Boolean));
        const nextTokens = new Set(nextText.toLowerCase().split(/\s+/).filter(Boolean));

        if (prevTokens.size === 0 && nextTokens.size === 0) {
            return lengthDiff;
        }

        let intersection = 0;
        prevTokens.forEach(token => {
            if (nextTokens.has(token)) intersection += 1;
        });
        const union = prevTokens.size + nextTokens.size - intersection;
        const tokenDiff = union === 0 ? 0 : 1 - intersection / union;

        return Math.max(lengthDiff, tokenDiff);
    };

    /**
     * Generate a cache key from query text plus recall ambience metadata.
     * @param {string} text - Query text
     * @param {{participant_emails?: string[], enable_entity_resolution?: boolean}|null} ambienceMetadata - Optional recall ambience metadata
     * @returns {string} Cache key (text max 1000 chars + normalized metadata segment)
     */
    utils.getRecallCacheKey = function(text, ambienceMetadata = null) {
        const normalized = utils.normalizeQueryText(text);
        const baseKey = normalized.length > 1000
            ? normalized.slice(-1000)
            : normalized;

        if (!ambienceMetadata || typeof ambienceMetadata !== 'object') {
            return baseKey;
        }

        const metadataSegments = [];
        const participantEmails = Array.isArray(ambienceMetadata.participant_emails)
            ? ambienceMetadata.participant_emails
            : [];

        if (participantEmails.length > 0) {
            const normalizedEmails = Array.from(new Set(
                participantEmails
                    .map(email => String(email || '').trim().toLowerCase())
                    .filter(email => email.includes('@'))
            )).sort();

            if (normalizedEmails.length > 0) {
                metadataSegments.push(`participants:${normalizedEmails.join(',')}`);
            }
        }

        if (typeof ambienceMetadata.enable_entity_resolution === 'boolean') {
            metadataSegments.push(`enable_entity_resolution:${ambienceMetadata.enable_entity_resolution}`);
        }

        if (metadataSegments.length === 0) {
            return baseKey;
        }

        return `${baseKey}\n__ambience__:${metadataSegments.join('|')}`;
    };

    /**
     * Generate a request key combining mode and text
     * @param {string} mode - Request mode (compose/view/generic)
     * @param {string} text - Query text
     * @returns {string} Request key
     */
    utils.getRequestKey = function(mode, text) {
        const normalized = utils.normalizeQueryText(text);
        return `${mode}:${normalized}`;
    };

    /**
     * Evaluate if a query change is meaningful enough to trigger a new recall
     * @param {string} mode - Request mode
     * @param {string} queryText - New query text
     * @returns {Object} Evaluation result with diffScore, isMeaningfulChange, etc.
     */
    utils.evaluateQueryChange = function(mode, queryText) {
        const state = window.Engramme.state;
        const constants = window.Engramme.constants;
        const normalized = utils.normalizeQueryText(queryText);
        const previous = state.lastDisplayedQueryByMode[mode] || '';
        
        if (!previous) {
            return {
                normalized,
                diffScore: 1,
                deltaChars: normalized.length,
                deltaTokens: utils.countTokens(normalized),
                isMeaningfulChange: true,
                isSameQuery: false
            };
        }

        const isSameQuery = normalized === previous;
        if (isSameQuery) {
            return {
                normalized,
                diffScore: 0,
                deltaChars: 0,
                deltaTokens: 0,
                isMeaningfulChange: false,
                isSameQuery: true
            };
        }

        const diffScore = utils.computeDiffScore(previous, normalized);
        const deltaChars = Math.abs(previous.length - normalized.length);
        const deltaTokens = Math.abs(utils.countTokens(previous) - utils.countTokens(normalized));
        const isMeaningfulChange = diffScore > constants.QUERY_DIFF_THRESHOLD ||
            deltaChars > constants.QUERY_ABS_DIFF_THRESHOLD_CHARS ||
            deltaTokens > constants.QUERY_ABS_DIFF_THRESHOLD_TOKENS;

        return { normalized, diffScore, deltaChars, deltaTokens, isMeaningfulChange, isSameQuery: false };
    };

    /**
     * Mark a query as displayed for a given mode
     * @param {string} mode - Request mode
     * @param {string} normalizedQuery - Normalized query text
     */
    utils.markDisplayedQuery = function(mode, normalizedQuery) {
        window.Engramme.state.lastDisplayedQueryByMode[mode] = normalizedQuery;
    };

    /**
     * Mark a recall cache key as displayed for a given mode
     * @param {string} mode - Request mode
     * @param {string} recallKey - Recall cache key including metadata
     */
    utils.markDisplayedRecallKey = function(mode, recallKey) {
        window.Engramme.state.lastDisplayedRecallKeyByMode[mode] = recallKey || '';
    };

    /**
     * Clear the cached query for a mode to force refresh on next update
     * @param {string} mode - Request mode to clear
     * @param {boolean} clearApiCache - Also clear the API response cache
     */
    utils.clearQueryCache = function(mode, clearApiCache) {
        window.Engramme.state.lastDisplayedQueryByMode[mode] = '';
        window.Engramme.state.lastDisplayedRecallKeyByMode[mode] = '';
        if (clearApiCache) {
            window.Engramme.state.recallCache.clear();
        }
    };

    /**
     * Check if a hostname is an Outlook host
     * @param {string} hostname - Hostname to check
     * @returns {boolean} True if Outlook host
     */
    utils.isOutlookHost = function(hostname) {
        return hostname === 'outlook.office.com' ||
               hostname === 'outlook.live.com' ||
               hostname === 'outlook.office365.com' ||
               hostname === 'outlook.cloud.microsoft';
    };

    /**
     * Check if the Chrome extension context is still valid
     * @returns {boolean} True if extension is valid
     */
    utils.isExtensionValid = function() {
        try {
            return chrome && chrome.runtime && !!chrome.runtime.id;
        } catch (e) {
            return false;
        }
    };

    // Export utils
    window.Engramme.utils = utils;

})();
