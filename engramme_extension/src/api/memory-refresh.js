// memory-refresh.js - Memory refresh orchestration
// Coordinates when and how to update memory suggestions across different contexts

(function() {
    'use strict';

    const state = window.Engramme.state;
    const utils = window.Engramme.utils;
    const api = window.Engramme.api;
    const gmail = window.Engramme.gmail;

    // Return the active mail module (Gmail or Outlook) based on hostname
    function getMailModule() {
        if (utils.isOutlookHost(window.location.hostname)) return window.Engramme.outlook;
        return gmail;
    }
    const overlay = window.Engramme.overlay;
    const feedback = window.Engramme.feedback;
    const memoryDisplay = window.Engramme.memoryDisplay;

    // Check if display should proceed based on eligibility criteria
    async function displayMemoriesIfEligible({ memories, mode, queryText, requestId, requestKey, normalizedQuery, isMeaningfulChange, baselineMode = mode, recallId = null, recallKey = '' }) {
        if (feedback.hasTypedFeedback()) {
            return;
        }
        const isEligible = isMeaningfulChange || memories.length > 0;
        if (!isEligible) {
            utils.markDisplayedRecallKey(baselineMode, recallKey || normalizedQuery);
            return;
        }
        if (requestId < state.latestEligibleRequestId) {
            return;
        }
        state.latestEligibleRequestId = requestId;
        state.latestEligibleRequestKey = requestKey;
        const effectiveRecallKey = recallKey || normalizedQuery;
        const previousRecallKey = state.lastDisplayedRecallKeyByMode[baselineMode] || '';
        if (effectiveRecallKey !== previousRecallKey) {
            overlay.clearAllFeedback();
        }

        // Canary injection: 3% chance to prepend a fake memory card
        const canary = window.Engramme.canary;
        const displayMemories = canary ? await canary.maybeInject(memories) : memories;

        memoryDisplay.display(displayMemories, mode, queryText, { recallId });
        utils.markDisplayedQuery(baselineMode, normalizedQuery);
        utils.markDisplayedRecallKey(baselineMode, effectiveRecallKey);

        // Auto-open only when cards are actually displayed after filtering/demo-mode trimming.
        const hasDisplayedMemories = Array.isArray(state.currentMemories) && state.currentMemories.length > 0;
        if (hasDisplayedMemories && state.overlayElement && !state.overlayElement.classList.contains('show') && !state.userClosedOverlay) {
            overlay.reopen();
        }
    }

    async function getRecallAmbienceMetadata(participantEmails = []) {
        const result = await new Promise((resolve) => {
            chrome.storage.sync.get(['enableEntityResolution'], resolve);
        });
        const ambienceMetadata = {
            enable_entity_resolution: result.enableEntityResolution ?? false
        };
        if (participantEmails.length > 0) {
            ambienceMetadata.participant_emails = participantEmails;
        }
        return ambienceMetadata;
    }

    // Update memory suggestions for compose mode (Gmail)
    async function updateForCompose() {
        if (!state.currentComposeElement || !state.overlayElement) {
            return;
        }

        if (state.activeContext && state.activeContext !== 'compose') {
            return;
        }

        // Don't refresh memories when chat is open (prevents destroying chat UI)
        if (state.isChatMode) {
            return;
        }

        const emailContent = getMailModule().getEmailContent();
        const recipientNames = emailContent.recipients || [];
        const participantEmails = emailContent.participant_emails || [];
        // Include recipient names in query text when email addresses aren't available
        // (Outlook compose pills only expose display names, not emails)
        const recipientLine = recipientNames.length > 0 && participantEmails.length === 0
            ? `to: ${recipientNames.join(', ')}` : '';
        const baseText = [
            recipientLine,
            emailContent.subject ? `sb: ${emailContent.subject}` : '',
            emailContent.body
        ].filter(Boolean).join('\n').trim();
        const queryText = baseText;


        if (baseText.length <= 50) {
            const memoryList = state.overlayElement.querySelector('.memory-list');
            memoryList.innerHTML = '<div class="memories-loading">Type 50+ characters to see memories...</div>';
            overlay.hideFeedbackButtons();
            overlay.clearQueryText();
            return;
        }

        if (!state.isApiConfigured) {
            overlay.showNotLoggedIn();
            overlay.hideFeedbackButtons();
            overlay.clearQueryText();
            return;
        }

        const diffInfo = utils.evaluateQueryChange('compose', queryText);
        const normalizedQuery = diffInfo.normalized;
        const recallAmbienceMetadata = await getRecallAmbienceMetadata(participantEmails);
        const cacheKey = utils.getRecallCacheKey(normalizedQuery, recallAmbienceMetadata);
        const lastDisplayedRecallKey = state.lastDisplayedRecallKeyByMode.compose || '';
        const recallMetadataChanged = cacheKey !== lastDisplayedRecallKey;
        if (diffInfo.isSameQuery && !recallMetadataChanged) {
            return;
        }
        if (diffInfo.isSameQuery && recallMetadataChanged) {
        }
        if (!diffInfo.isMeaningfulChange) {
        }

        const requestKey = utils.getRequestKey('compose', normalizedQuery);
        const requestId = api.startRequest(requestKey, diffInfo.isMeaningfulChange);
        const cached = api.getCachedMemories(cacheKey);
        if (cached) {
            const cachedAgeMs = Date.now() - cached.fetchedAt;
            displayMemoriesIfEligible({ memories: cached.memories, mode: 'compose', queryText, requestId, requestKey, normalizedQuery, isMeaningfulChange: diffInfo.isMeaningfulChange, recallId: cached.recallId || null, recallKey: cacheKey });
            return;
        }

        const composeState = state.requestState.compose;
        if (composeState.inFlight) {
            composeState.needsRefresh = true;
            return;
        }

        if (diffInfo.isMeaningfulChange) {
            const memoryList = state.overlayElement.querySelector('.memory-list');
            memoryList.innerHTML = '<div class="memories-loading"><div class="memories-loading-spinner"></div>Recalling memories...</div>';
            overlay.hideFeedbackButtons();
        }

        composeState.inFlight = true;
        try {
            const recallResult = await api.findRelevantMemories(normalizedQuery, participantEmails, queryText);
            if (!recallResult.error) {
                api.setCachedMemories(cacheKey, recallResult.memories, recallResult.recallId || null);
            }
            displayMemoriesIfEligible({ memories: recallResult.memories, mode: 'compose', queryText, requestId, requestKey, normalizedQuery, isMeaningfulChange: diffInfo.isMeaningfulChange, recallId: recallResult.recallId || null, recallKey: cacheKey });
        } finally {
            composeState.inFlight = false;
            if (composeState.needsRefresh) {
                composeState.needsRefresh = false;
                updateForCompose();
            }
        }
    }

    // Update memory suggestions for view mode (Gmail email reading)
    async function updateForView() {
        if (!state.overlayElement) {
            return;
        }
        
        // Try to find view element if not already set
        if (!state.currentViewElement) {
            const viewElement = document.querySelector('.ii.gt, .a3s.aiL, .gE.iv.gt') ||
                                document.querySelector('[role="main"][aria-label="Reading Pane"] [role="document"]');
            if (viewElement) {
                state.currentViewElement = viewElement;
            } else {
                return;
            }
        }

        if (state.activeContext && state.activeContext !== 'view') {
            return;
        }

        // Don't refresh memories when chat is open (prevents destroying chat UI)
        if (state.isChatMode) {
            return;
        }

        const emailContent = getMailModule().getViewedEmailContent();
        const extraParts = [];
        if (emailContent.recipients && emailContent.recipients.length > 0) {
            // Recipients already appear in labeled headers; avoid duplicate list.
        }
        const queryText = [
            ...extraParts,
            emailContent.subject ? `sb: ${emailContent.subject}` : '',
            emailContent.body
        ].filter(Boolean).join('\n').trim();

        // Extract participant emails for ambience_metadata
        const participantEmails = emailContent.participant_emails || [];


        if (!state.isApiConfigured) {
            overlay.showNotLoggedIn();
            overlay.hideFeedbackButtons();
            overlay.clearQueryText();
            return;
        }

        const diffInfo = utils.evaluateQueryChange('view', queryText);
        const normalizedQuery = diffInfo.normalized;
        const recallAmbienceMetadata = await getRecallAmbienceMetadata(participantEmails);
        const cacheKey = utils.getRecallCacheKey(normalizedQuery, recallAmbienceMetadata);
        const lastDisplayedRecallKey = state.lastDisplayedRecallKeyByMode.view || '';
        const recallMetadataChanged = cacheKey !== lastDisplayedRecallKey;
        if (diffInfo.isSameQuery && !recallMetadataChanged) {
            return;
        }
        if (diffInfo.isSameQuery && recallMetadataChanged) {
        }
        if (!diffInfo.isMeaningfulChange) {
        }

        const requestKey = utils.getRequestKey('view', normalizedQuery);
        const requestId = api.startRequest(requestKey, diffInfo.isMeaningfulChange);
        const cached = api.getCachedMemories(cacheKey);
        if (cached) {
            const cachedAgeMs = Date.now() - cached.fetchedAt;
            displayMemoriesIfEligible({ memories: cached.memories, mode: 'view', queryText, requestId, requestKey, normalizedQuery, isMeaningfulChange: diffInfo.isMeaningfulChange, recallId: cached.recallId || null, recallKey: cacheKey });
            return;
        }

        const viewState = state.requestState.view;
        if (viewState.inFlight) {
            viewState.needsRefresh = true;
            return;
        }

        if (diffInfo.isMeaningfulChange) {
            const memoryList = state.overlayElement.querySelector('.memory-list');
            memoryList.innerHTML = '<div class="memories-loading"><div class="memories-loading-spinner"></div>Recalling memories...</div>';
            overlay.hideFeedbackButtons();
        }

        viewState.inFlight = true;
        try {
            const recallResult = await api.findRelevantMemories(normalizedQuery, participantEmails, queryText);
            if (!recallResult.error) {
                api.setCachedMemories(cacheKey, recallResult.memories, recallResult.recallId || null);
            }
            displayMemoriesIfEligible({ memories: recallResult.memories, mode: 'view', queryText, requestId, requestKey, normalizedQuery, isMeaningfulChange: diffInfo.isMeaningfulChange, recallId: recallResult.recallId || null, recallKey: cacheKey });
        } finally {
            viewState.inFlight = false;
            if (viewState.needsRefresh) {
                viewState.needsRefresh = false;
                updateForView();
            }
        }
    }

    // Module-level debounce timer for generic page updates
    let genericDebounceTimer = null;
    // Holds the newest participant emails so deferred retries use fresh metadata.
    let latestGenericParticipantEmails = [];

    function normalizeParticipantEmails(participantEmails) {
        if (!Array.isArray(participantEmails)) return [];
        return Array.from(new Set(
            participantEmails
                .map(email => String(email || '').trim().toLowerCase())
                .filter(email => email.includes('@'))
        ));
    }

    // Update memory suggestions for generic (non-Gmail) pages
    function updateForGenericPage(participantEmails) {
        if (!state.overlayElement) return;
        latestGenericParticipantEmails = normalizeParticipantEmails(participantEmails);

        // Clear existing debounce timer
        if (genericDebounceTimer) {
            clearTimeout(genericDebounceTimer);
        }

        // Debounce the update to avoid excessive API calls
        genericDebounceTimer = setTimeout(async () => {
            const extractors = window.Engramme.extractors;
            const pageContent = extractors.getGenericPageContent();
            const queryText = pageContent.trim();


            const memoryList = state.overlayElement.querySelector('.memory-list');
            if (!memoryList) return;

            if (window.location.hostname === 'google.com' || window.location.hostname === 'www.google.com') {
                const queryParam = new URLSearchParams(window.location.search).get('q');
                if (!queryParam) {
                    memoryList.innerHTML = '<div class="no-memories">Make a search to see memories.</div>';
                    overlay.clearQueryText();
                    return;
                }
            }

            if (!state.isApiConfigured) {
                overlay.showNotLoggedIn();
                overlay.clearQueryText();
                return;
            }

            // Lowered from 50 to 10 chars - let API decide what's useful
            if (queryText.length < 10) {
                memoryList.innerHTML = '<div class="no-memories">Not enough content on this page to find relevant memories.</div>';
                overlay.clearQueryText();
                return;
            }

            const diffInfo = utils.evaluateQueryChange('generic', queryText);
            const normalizedQuery = diffInfo.normalized;
            const emails = latestGenericParticipantEmails;
            const recallAmbienceMetadata = await getRecallAmbienceMetadata(emails);
            const cacheKey = utils.getRecallCacheKey(normalizedQuery, recallAmbienceMetadata);
            const lastDisplayedRecallKey = state.lastDisplayedRecallKeyByMode.generic || '';
            const recallMetadataChanged = cacheKey !== lastDisplayedRecallKey;
            if (diffInfo.isSameQuery && !recallMetadataChanged) {
                return;
            }
            if (diffInfo.isSameQuery && recallMetadataChanged) {
            }
            if (!diffInfo.isMeaningfulChange) {
            }

            const requestKey = utils.getRequestKey('generic', normalizedQuery);
            const requestId = api.startRequest(requestKey, diffInfo.isMeaningfulChange);
            const cached = api.getCachedMemories(cacheKey);
            if (cached) {
                const cachedAgeMs = Date.now() - cached.fetchedAt;
                displayMemoriesIfEligible({ memories: cached.memories, mode: 'compose', queryText, requestId, requestKey, normalizedQuery, isMeaningfulChange: diffInfo.isMeaningfulChange, baselineMode: 'generic', recallId: cached.recallId || null, recallKey: cacheKey });
                return;
            }

            const genericState = state.requestState.generic;
            if (genericState.inFlight) {
                genericState.needsRefresh = true;
                return;
            }

            if (diffInfo.isMeaningfulChange) {
                memoryList.innerHTML = '<div class="memories-loading"><div class="memories-loading-spinner"></div>Recalling memories...</div>';
            }

            genericState.inFlight = true;
            try {
                const recallResult = await api.findRelevantMemories(normalizedQuery, emails, queryText);
                if (!recallResult.error) {
                    api.setCachedMemories(cacheKey, recallResult.memories, recallResult.recallId || null);
                }
                displayMemoriesIfEligible({ memories: recallResult.memories, mode: 'compose', queryText, requestId, requestKey, normalizedQuery, isMeaningfulChange: diffInfo.isMeaningfulChange, baselineMode: 'generic', recallId: recallResult.recallId || null, recallKey: cacheKey });
            } finally {
                genericState.inFlight = false;
                if (genericState.needsRefresh) {
                    genericState.needsRefresh = false;
                    updateForGenericPage(latestGenericParticipantEmails);
                }
            }
        }, 1000); // 1000ms debounce delay to reduce API calls
    }

    // Update memory suggestions with custom text (e.g., Meet transcripts)
    async function updateWithCustomText(customText, transcriptTiming = null) {
        if (!state.overlayElement) return;
        if (!customText || !customText.trim()) {
            return;
        }

        const queryText = customText.trim();
        const normalizedQuery = utils.normalizeQueryText(queryText);
        const recallAmbienceMetadata = await getRecallAmbienceMetadata();
        const cacheKey = utils.getRecallCacheKey(normalizedQuery, recallAmbienceMetadata);
        const requestKey = utils.getRequestKey('generic', normalizedQuery);
        const requestId = api.startRequest(requestKey, true);

        const memoryList = state.overlayElement.querySelector('.memory-list');
        if (!state.isApiConfigured) {
            if (memoryList) {
                memoryList.innerHTML = '<div class="no-memories">API key not configured.<br><br>Please configure your API key in the extension settings.</div>';
            }
            overlay.clearQueryText();
            return;
        }

        if (memoryList) {
            memoryList.innerHTML = '<div class="memories-loading"><div class="memories-loading-spinner"></div>Recalling memories...</div>';
        }

        const genericState = state.requestState.generic;
        if (genericState.inFlight) {
            genericState.needsRefresh = true;
            genericState.pendingCustomText = customText;
            genericState.pendingTranscriptTiming = transcriptTiming;
            console.log('⏭️ Custom request in flight, scheduling refresh');
            return;
        }

        genericState.inFlight = true;
        try {
            const recallResult = await api.findRelevantMemories(normalizedQuery, [], queryText, transcriptTiming);
            if (!recallResult.error) {
                api.setCachedMemories(cacheKey, recallResult.memories, recallResult.recallId || null);
            }
            displayMemoriesIfEligible({ memories: recallResult.memories, mode: 'compose', queryText, requestId, requestKey, normalizedQuery, isMeaningfulChange: true, baselineMode: 'generic', recallId: recallResult.recallId || null, recallKey: cacheKey });
        } finally {
            genericState.inFlight = false;
            if (genericState.needsRefresh) {
                const queuedCustomText = genericState.pendingCustomText || customText;
                const queuedTranscriptTiming = genericState.pendingTranscriptTiming;
                genericState.needsRefresh = false;
                genericState.pendingCustomText = null;
                genericState.pendingTranscriptTiming = null;
                updateWithCustomText(queuedCustomText, queuedTranscriptTiming);
            }
        }
    }

    // Create debounced versions using shared utility
    const debouncedUpdateForCompose = utils.debounce(updateForCompose, 300);
    const debouncedUpdateForView = utils.debounce(updateForView, 300);

    // Expose to namespace
    window.Engramme.memoryRefresh = {
        updateForCompose,
        updateForView,
        updateForGenericPage,
        updateWithCustomText,
        debouncedUpdateForCompose,
        debouncedUpdateForView,
        displayMemoriesIfEligible
    };

})();
