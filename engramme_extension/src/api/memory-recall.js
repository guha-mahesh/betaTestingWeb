// memory-recall.js - Memory recall API client with caching
// Handles API requests to fetch relevant memories based on context
// Depends on: core/state.js

(function() {
    'use strict';

    const api = {};
    const state = window.Engramme.state;
    const constants = window.Engramme.constants;

    /**
     * Get cached memories for a given cache key
     * @param {string} cacheKey - The cache key to look up
     * @returns {Object|null} Cached entry with memories, recallId, and fetchedAt, or null if not found/expired
     */
    api.getCachedMemories = function(cacheKey) {
        const entry = state.recallCache.get(cacheKey);
        if (!entry) return null;
        if (Date.now() - entry.fetchedAt > constants.REQUEST_CACHE_TTL_MS) {
            state.recallCache.delete(cacheKey);
            return null;
        }
        return entry;
    };

    /**
     * Cache memories for a given cache key
     * @param {string} cacheKey - The cache key to store under
     * @param {Array} memories - Array of memory objects to cache
     * @param {string|null} recallId - Recall context identifier from service worker
     */
    api.setCachedMemories = function(cacheKey, memories, recallId = null) {
        state.recallCache.set(cacheKey, { memories, recallId, fetchedAt: Date.now() });
    };

    /**
     * Start a new request and track it
     * @param {string} requestKey - Unique key for this request
     * @param {boolean} isMeaningfulChange - Whether this represents a meaningful query change
     * @returns {number} The request ID
     */
    api.startRequest = function(requestKey, isMeaningfulChange) {
        state.requestCounter += 1;
        const requestId = state.requestCounter;
        if (isMeaningfulChange) {
            state.latestEligibleRequestId = requestId;
            state.latestEligibleRequestKey = requestKey;
        }
        return requestId;
    };

    /**
     * Recall relevant memories via the API
     * @param {string} text - The text to use for memory recall
     * @param {string[]} participantEmails - Array of participant email addresses for metadata filtering
     * @param {string|null} originalText - Original query text before normalization
     * @returns {Promise<{memories: Array, recallId: string|null, error: boolean}>} Recall results
     */
    api.findRelevantMemories = async function(text, participantEmails = [], originalText = null, transcriptTiming = null) {
        console.log(`🔍 Recalling memories via API: "${text.substring(0, 100)}..."`);

        if (participantEmails.length > 0) {
        }

        if (!state.isApiConfigured) {
            return { memories: [], recallId: null, error: true };
        }

        const estimatedWasTruncated = text.length > 1000;

        // Store the payload for debug display (estimate shown until background confirms sent payload)
        // Note: URL is dynamically determined by background.js based on selected environment
        state.lastRecallPayload = {
            url: '[Environment-specific URL determined by background.js]',
            method: 'POST',
            headers: {
                'x-api-key': '[HIDDEN]'
            },
            formData: {
                text: estimatedWasTruncated ? text.slice(-1000) : text,
                top_k: '3',
                ambience_metadata: participantEmails.length > 0 ? JSON.stringify({ participant_emails: participantEmails }) : undefined
            },
            textLength: estimatedWasTruncated ? 1000 : text.length,
            pretruncationTextLength: text.length,
            wasTruncated: estimatedWasTruncated,
            truncationMode: estimatedWasTruncated ? 'last_1000_chars' : 'none',
            status: 'pending',
            timestamp: new Date().toISOString(),
            note: 'Actual URL and final text length depend on background.js processing'
        };
        state.lastRecallTrace = null;

        // Map a confirmedPayload from background.js into the debug state
        const applyConfirmedPayload = (cp, status, errorMsg) => {
            state.lastRecallPayload = {
                url: cp.url,
                method: cp.method,
                headers: { 'x-api-key': '[HIDDEN]' },
                formData: {
                    text: cp.text,
                    top_k: cp.top_k,
                    enable_llm_proxy_filter: cp.enable_llm_proxy_filter,
                    llm_proxy_filter_is_soft: cp.llm_proxy_filter_is_soft,
                    alpha: cp.alpha,
                    enable_trace: cp.enable_trace,
                    participant_match_mode: cp.participant_match_mode,
                    diversity_match_mode: cp.diversity_match_mode,
                    source_filter: cp.source_filter,
                    sim_threshold: cp.sim_threshold,
                    min_age: cp.min_age,
                    max_age: cp.max_age,
                    ambience_metadata: cp.ambience_metadata
                },
                textLength: cp.textLength,
                pretruncationTextLength: cp.pretruncationTextLength,
                wasTruncated: cp.wasTruncated,
                truncationMode: cp.truncationMode,
                status,
                timestamp: cp.timestamp,
                ...(errorMsg ? { error: errorMsg } : {})
            };
        };

        try {
            // Send message to background script to recall memories
            const response = await chrome.runtime.sendMessage({
                action: 'recallMemories',
                text: text,
                originalText: originalText || text,
                participantEmails: participantEmails,
                transcriptTiming: transcriptTiming
            });

            if (!response) {
                console.error('❌ No response from background script (service worker may be inactive)');
                if (state.lastRecallPayload) {
                    state.lastRecallPayload = { ...state.lastRecallPayload, status: 'failed', error: 'No response from background script' };
                }
                return { memories: [], recallId: null, error: true };
            }
            if (response.success) {
                state.lastRecallTrace = response.trace || null;
                if (response.confirmedPayload) {
                    applyConfirmedPayload(response.confirmedPayload, 'confirmed');
                }
                return { memories: response.memories || [], recallId: response.recallId || null, error: false };
            }
            if (response.confirmedPayload) {
                applyConfirmedPayload(response.confirmedPayload, 'failed', response.error || 'Memory recall failed');
            } else if (state.lastRecallPayload) {
                state.lastRecallPayload = { ...state.lastRecallPayload, status: 'failed', error: response.error || 'Memory recall failed' };
            }
            console.error('❌ Memory recall failed:', response.error);
            return { memories: [], recallId: null, error: true };
        } catch (error) {
            // chrome.runtime.sendMessage itself failed (e.g. extension context invalidated);
            // no confirmedPayload available — fall back to the pre-populated estimate.
            if (state.lastRecallPayload) {
                state.lastRecallPayload = { ...state.lastRecallPayload, status: 'failed', error: error?.message || 'Error calling memory recall' };
            }
            console.error('❌ Error calling memory recall:', error);
            return { memories: [], recallId: null, error: true };
        }
    };

    // Export api to namespace
    window.Engramme.api = api;

})();
