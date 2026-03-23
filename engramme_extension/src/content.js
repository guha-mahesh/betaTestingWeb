// content.js - Entry point for Engramme Assistant content script
// Orchestrates module initialization and callback wiring

// Create local aliases for frequently accessed namespace objects
const state = window.Engramme.state;
const utils = window.Engramme.utils;
const gmail = window.Engramme.gmail;
const overlay = window.Engramme.overlay;
const feedback = window.Engramme.feedback;
const chat = window.Engramme.chat;
const memoryDisplay = window.Engramme.memoryDisplay;
const openai = window.Engramme.openai;
const genericPage = window.Engramme.genericPage;
const googleCalendar = window.Engramme.googleCalendar;
const googleSheets = window.Engramme.googleSheets;
const outlookCalendar = window.Engramme.outlookCalendar;
const memoryRefresh = window.Engramme.memoryRefresh;


// Detect page context
const isGmailPage = window.location.hostname.includes('mail.google.com');
const isCalendarPage = window.location.hostname === 'calendar.google.com';
const isOutlookHost = utils.isOutlookHost(window.location.hostname);
const isOutlookCalendarPage = isOutlookHost && window.location.pathname.includes('/calendar');
const isOutlookPage = isOutlookHost && !isOutlookCalendarPage;
const isMailPage = isGmailPage || isOutlookPage;
// Defense-in-depth: also blocked by manifest exclude_matches
const isBlockedDomain = window.location.hostname === 'app.engramme.com';
const pageContext = isGmailPage ? 'Gmail' : isOutlookCalendarPage ? 'Outlook Calendar' : isOutlookPage ? 'Outlook' : isCalendarPage ? 'Calendar' : 'Generic Web Page';

let runtimeMessageListener = null;
let gmailUrlPollInterval = null;
let overlayInitTimeout = null;
let observerInitTimeout = null;
let genericMonitorInitTimeout = null;
let recoveryRetryTimeout = null;
let recoveryInProgress = false;

function clearStartupTimers() {
    if (overlayInitTimeout) {
        clearTimeout(overlayInitTimeout);
        overlayInitTimeout = null;
    }
    if (observerInitTimeout) {
        clearTimeout(observerInitTimeout);
        observerInitTimeout = null;
    }
    if (genericMonitorInitTimeout) {
        clearTimeout(genericMonitorInitTimeout);
        genericMonitorInitTimeout = null;
    }
}

function startGmailUrlMonitor() {
    if (!isGmailPage || gmailUrlPollInterval) return;

    let lastUrl = window.location.href;
    gmailUrlPollInterval = setInterval(() => {
        const currentUrl = window.location.href;
        if (currentUrl !== lastUrl) {
            lastUrl = currentUrl;
            setTimeout(gmail.checkForEmailView, 500);
        }
    }, 1000);
}

function stopGmailUrlMonitor() {
    if (!gmailUrlPollInterval) return;
    clearInterval(gmailUrlPollInterval);
    gmailUrlPollInterval = null;
}

let outlookUrlPollInterval = null;

function startOutlookUrlMonitor() {
    if (!isOutlookPage || outlookUrlPollInterval) return;

    let lastUrl = window.location.href;
    outlookUrlPollInterval = setInterval(() => {
        const currentUrl = window.location.href;
        if (currentUrl !== lastUrl) {
            const wasOnEmail = lastUrl.includes('/id/');
            const isOnEmail = currentUrl.includes('/id/');
            const wasCompose = lastUrl.includes('/compose/');
            const isCompose = currentUrl.includes('/compose/');
            lastUrl = currentUrl;

            const outlookMod = window.Engramme.outlook;
            if (isOnEmail) {
                // Clear compose state so view recall isn't blocked by stale activeContext
                state.currentComposeElement = null;
                state.activeContext = null;
                state.currentMode = null;
                state.lastDisplayedQueryByMode.view = '';
                setTimeout(() => outlookMod.checkForEmailView(), 500);
            } else if (isCompose && !wasCompose) {
                setTimeout(() => outlookMod.checkForComposeWindow(), 500);
            } else if ((wasOnEmail || wasCompose) && !isOnEmail && !isCompose) {
                state.currentViewElement = null;
                state.previousViewElement = null;
                state.currentComposeElement = null;
                state.lastDisplayedQueryByMode.view = '';
                state.currentMode = null;
                overlay.showEmptyState(true);
            }
        }
    }, 1000);
}

function stopOutlookUrlMonitor() {
    if (!outlookUrlPollInterval) return;
    clearInterval(outlookUrlPollInterval);
    outlookUrlPollInterval = null;
}

function clearRecoveryRetry() {
    if (!recoveryRetryTimeout) return;
    clearTimeout(recoveryRetryTimeout);
    recoveryRetryTimeout = null;
}

// Check if an email view is already visible in the DOM (for Gmail reload detection)
function isEmailViewVisible() {
    const emailBody = document.querySelector('.ii.gt');
    if (emailBody) return true;
    const subjectElement = document.querySelector('h2[data-legacy-thread-id]') ||
                          document.querySelector('.hP');
    return !!(subjectElement && gmail.isThreadViewUrl());
}

// Initialize API configuration state
function initializeMemories() {
    if (!utils.isExtensionValid()) return;


    try {
        chrome.storage.local.get(['apiConfigured'], (result) => {
            if (chrome.runtime.lastError) {
                console.error('❌ Storage error:', chrome.runtime.lastError);
                state.isApiConfigured = false;
            } else {
                state.isApiConfigured = result.apiConfigured || false;
            }
        });
    } catch (e) {
        console.error('💥 Extension context error:', e);
        state.isApiConfigured = false;
    }

    // Load demo mode setting
    try {
        chrome.storage.sync.get(['demoMode'], (result) => {
            if (!chrome.runtime.lastError) {
                state.demoMode = result.demoMode ?? false;
            }
        });
    } catch (e) {
        state.demoMode = false;
    }
}

// Set up message listener for extension communication
function setupMessageListener() {
    if (!utils.isExtensionValid()) return;

    try {
        if (!runtimeMessageListener) {
            runtimeMessageListener = (request) => {

                if (request.action === 'apiConfigured') {
                    initializeMemories();
                    const effectiveMode = overlay.getEffectiveMode();
                    if (effectiveMode === 'compose') {
                        memoryRefresh.updateForCompose();
                    } else if (effectiveMode === 'view') {
                        memoryRefresh.updateForView();
                    }
                }

                if (request.action === 'toggleDebug') {
                    if (window.Engramme.debug) {
                        window.Engramme.debug.toggle();
                    }
                }

                if (request.action === 'demoModeChanged') {
                    state.demoMode = !!request.enabled;
                    // Toggle header feedback buttons
                    if (state.demoMode) {
                        overlay.hideFeedbackButtons();
                    } else if (state.currentMemories && state.currentMemories.length > 0) {
                        overlay.showFeedbackButtons();
                    }
                    // Re-render current memories so error codes appear/disappear
                    if (state.currentMemories && state.currentMemories.length > 0) {
                        const effectiveMode = overlay.getEffectiveMode() || 'compose';
                        memoryDisplay.display(state.currentMemories, effectiveMode, null, { forceDisplay: true, skipSelfRefFilter: true });
                    }
                }
            };
        }

        if (!chrome.runtime.onMessage.hasListener(runtimeMessageListener)) {
            chrome.runtime.onMessage.addListener(runtimeMessageListener);
        }
    } catch (e) {
        console.error('💥 Error setting up message listener:', e);
    }
}

// Cleanup resources on unload
function cleanup() {
    clearStartupTimers();
    clearRecoveryRetry();
    stopGmailUrlMonitor();
    stopOutlookUrlMonitor();

    // Stop page monitoring
    genericPage.stopMonitoring();
    if (googleCalendar) {
        googleCalendar.stopMonitoring();
    }
    if (outlookCalendar) {
        outlookCalendar.stopMonitoring();
    }
    if (googleSheets) {
        googleSheets.stopMonitoring();
        googleSheets.stopUrlPoller();
    }

    if (state.observer) {
        state.observer.disconnect();
        state.observer = null;
    }

    // Clean up input listeners
    state.inputListeners.forEach(({ element, type, listener }) => {
        try {
            element.removeEventListener(type, listener);
        } catch (e) {
            // Element might be removed from DOM
        }
    });
    state.inputListeners = [];

    if (overlay.teardownTooltipPortal) {
        overlay.teardownTooltipPortal();
    }

    // Remove UI elements (remove host element which contains shadow DOM)
    if (state.overlayHost) {
        state.overlayHost.remove();
        state.overlayHost = null;
        state.shadowRoot = null;
        state.overlayElement = null;
    } else if (state.overlayElement) {
        state.overlayElement.remove();
        state.overlayElement = null;
    }
    const hostStyles = document.getElementById('engramme-host-styles');
    if (hostStyles) {
        hostStyles.remove();
    }
    const toastSpinnerStyle = document.getElementById('engramme-toast-spinner-style');
    if (toastSpinnerStyle) {
        toastSpinnerStyle.remove();
    }
    const reopenTab = document.querySelector('.memory-reopen-tab');
    if (reopenTab) {
        reopenTab.remove();
    }
}

// Main initialization function
function initialize() {
    recoveryInProgress = false;

    if (isBlockedDomain) {
        cleanup();
        return;
    }

    cleanup();
    initializeMemories();
    setupMessageListener();

    // Create overlay in minimized state — only auto-open once memories arrive
    overlayInitTimeout = setTimeout(() => {
        overlayInitTimeout = null;
        if (!state.overlayElement) {
            overlay.create();
            // Overlay starts hidden (CSS display:none) — show reopen tab so user can open manually
            const reopenTab = document.querySelector('.memory-reopen-tab');
            if (reopenTab) reopenTab.style.display = 'flex';

            // On Gmail/Outlook, trigger early email view detection so memories start loading
            if (isGmailPage && isEmailViewVisible()) {
                gmail.checkForEmailView();
            }
            if (isOutlookPage) {
                const outlookMod = window.Engramme.outlook;
                if (outlookMod && outlookMod.isEmailViewUrl()) {
                    outlookMod.checkForEmailView();
                } else if (outlookMod && outlookMod.isComposeUrl()) {
                    outlookMod.checkForComposeWindow();
                } else {
                    overlay.showEmptyState(true);
                }
            }
        }
    }, 1500);

    if (isGmailPage) {
        overlay.setupIntentListeners(isGmailPage);

        // Register callbacks for gmail module
        gmail.registerCallbacks({
            createOverlay: overlay.create,
            showEmptyState: () => overlay.showEmptyState('gmail'),
            clearAllFeedback: overlay.clearAllFeedback,
            updateMemorySuggestionsForView: memoryRefresh.updateForView,
            setActiveContext: overlay.setActiveContext,
            adjustOverlayPosition: overlay.adjustPosition,
            debouncedUpdateMemorySuggestions: memoryRefresh.debouncedUpdateForCompose
        });

        // Register callbacks for overlay module
        overlay.registerCallbacks({
            updateMemorySuggestions: memoryRefresh.updateForCompose,
            updateMemorySuggestionsForView: memoryRefresh.updateForView
        });

        // Register callbacks for feedback module
        feedback.registerCallbacks({
            getEffectiveMode: overlay.getEffectiveMode,
            showFeedback: overlay.showToast,
            dismissFeedback: overlay.dismissToast,
            isEmailPage: true
        });

        // Register callbacks for chat module
        chat.registerCallbacks({
            getEffectiveMode: overlay.getEffectiveMode,
            updateMemorySuggestions: memoryRefresh.updateForCompose,
            updateMemorySuggestionsForView: memoryRefresh.updateForView,
            showEmptyState: () => overlay.showEmptyState('gmail')
        });

        // Register callbacks for memoryDisplay module
        memoryDisplay.registerCallbacks({
            showFeedbackButtons: overlay.showFeedbackButtons,
            getEffectiveMode: overlay.getEffectiveMode,
            insertMemory: openai.insertMemory,
            toggleMemoryCommentPanel: overlay.toggleMemoryCommentPanel,
            showFeedback: overlay.showToast,
            setupDetailViewScrollIndicator: overlay.setupDetailViewScrollIndicator
        });

        startGmailUrlMonitor();

        observerInitTimeout = setTimeout(() => {
            observerInitTimeout = null;
            gmail.startObserver();
        }, 2000);
    } else if (isCalendarPage) {

        // Register callbacks (same as generic pages)
        feedback.registerCallbacks({
            getEffectiveMode: overlay.getEffectiveMode,
            showFeedback: overlay.showToast,
            dismissFeedback: overlay.dismissToast,
            isEmailPage: false
        });

        overlay.registerCallbacks({
            updateMemorySuggestions: memoryRefresh.updateForCompose,
            updateMemorySuggestionsForView: memoryRefresh.updateForView
        });

        memoryDisplay.registerCallbacks({
            showFeedbackButtons: overlay.showFeedbackButtons,
            getEffectiveMode: overlay.getEffectiveMode,
            insertMemory: openai.insertMemory,
            toggleMemoryCommentPanel: overlay.toggleMemoryCommentPanel,
            showFeedback: overlay.showToast,
            setupDetailViewScrollIndicator: overlay.setupDetailViewScrollIndicator
        });

        chat.registerCallbacks({
            getEffectiveMode: overlay.getEffectiveMode,
            updateMemorySuggestions: memoryRefresh.updateForCompose,
            updateMemorySuggestionsForView: memoryRefresh.updateForView,
            showEmptyState: () => overlay.showEmptyState('calendar')
        });

        // Start Calendar event monitoring instead of generic page monitoring
        setTimeout(() => {
            googleCalendar.startMonitoring({
                onEventSelected: () => memoryRefresh.updateForGenericPage(googleCalendar.getParticipantEmails()),
                onEventClosed: () => {
                    // Force a refresh when reopening the same event after close.
                    if (utils && utils.clearQueryCache) {
                        utils.clearQueryCache('generic', false);
                    }
                    overlay.showEmptyState('calendar');
                }
            });
            overlay.showEmptyState('calendar');
        }, 2000);
    } else if (isOutlookCalendarPage) {

        feedback.registerCallbacks({
            getEffectiveMode: overlay.getEffectiveMode,
            showFeedback: overlay.showToast,
            dismissFeedback: overlay.dismissToast,
            isEmailPage: false
        });

        overlay.registerCallbacks({
            updateMemorySuggestions: memoryRefresh.updateForCompose,
            updateMemorySuggestionsForView: memoryRefresh.updateForView
        });

        memoryDisplay.registerCallbacks({
            showFeedbackButtons: overlay.showFeedbackButtons,
            getEffectiveMode: overlay.getEffectiveMode,
            insertMemory: openai.insertMemory,
            toggleMemoryCommentPanel: overlay.toggleMemoryCommentPanel,
            showFeedback: overlay.showToast,
            setupDetailViewScrollIndicator: overlay.setupDetailViewScrollIndicator
        });

        chat.registerCallbacks({
            getEffectiveMode: overlay.getEffectiveMode,
            updateMemorySuggestions: memoryRefresh.updateForCompose,
            updateMemorySuggestionsForView: memoryRefresh.updateForView,
            showEmptyState: () => overlay.showEmptyState('outlook-calendar')
        });

        // Start Outlook Calendar event monitoring
        setTimeout(() => {
            outlookCalendar.startMonitoring({
                onEventSelected: () => memoryRefresh.updateForGenericPage(outlookCalendar.getParticipantEmails()),
                onEventClosed: () => {
                    if (utils && utils.clearQueryCache) {
                        utils.clearQueryCache('generic', false);
                    }
                    overlay.showEmptyState('outlook-calendar');
                }
            });
            overlay.showEmptyState('outlook-calendar');
        }, 2000);
    } else if (isOutlookPage) {
        const outlookModule = window.Engramme.outlook;
        overlay.setupIntentListeners(true);

        // Register callbacks for outlook module (mirrors gmail callbacks)
        outlookModule.registerCallbacks({
            createOverlay: overlay.create,
            showEmptyState: () => overlay.showEmptyState(true),
            clearAllFeedback: overlay.clearAllFeedback,
            updateMemorySuggestionsForView: memoryRefresh.updateForView,
            setActiveContext: overlay.setActiveContext,
            adjustOverlayPosition: overlay.adjustPosition,
            debouncedUpdateMemorySuggestions: memoryRefresh.debouncedUpdateForCompose
        });

        overlay.registerCallbacks({
            updateMemorySuggestions: memoryRefresh.updateForCompose,
            updateMemorySuggestionsForView: memoryRefresh.updateForView
        });

        feedback.registerCallbacks({
            getEffectiveMode: overlay.getEffectiveMode,
            showFeedback: overlay.showToast,
            dismissFeedback: overlay.dismissToast,
            isEmailPage: true,
            emailModule: outlookModule
        });

        chat.registerCallbacks({
            getEffectiveMode: overlay.getEffectiveMode,
            updateMemorySuggestions: memoryRefresh.updateForCompose,
            updateMemorySuggestionsForView: memoryRefresh.updateForView,
            showEmptyState: () => overlay.showEmptyState(true)
        });

        memoryDisplay.registerCallbacks({
            showFeedbackButtons: overlay.showFeedbackButtons,
            getEffectiveMode: overlay.getEffectiveMode,
            insertMemory: openai.insertMemory,
            toggleMemoryCommentPanel: overlay.toggleMemoryCommentPanel,
            showFeedback: overlay.showToast,
            setupDetailViewScrollIndicator: overlay.setupDetailViewScrollIndicator
        });

        startOutlookUrlMonitor();

        observerInitTimeout = setTimeout(() => {
            observerInitTimeout = null;
            outlookModule.startObserver();
        }, 2000);
    } else {

        // Register callbacks for feedback module (generic pages)
        feedback.registerCallbacks({
            getEffectiveMode: overlay.getEffectiveMode,
            showFeedback: overlay.showToast,
            dismissFeedback: overlay.dismissToast,
            isEmailPage: false
        });

        // Register callbacks for overlay module (generic pages)
        overlay.registerCallbacks({
            updateMemorySuggestions: memoryRefresh.updateForCompose,
            updateMemorySuggestionsForView: memoryRefresh.updateForView
        });

        // Register callbacks for memoryDisplay module (generic pages)
        memoryDisplay.registerCallbacks({
            showFeedbackButtons: overlay.showFeedbackButtons,
            getEffectiveMode: overlay.getEffectiveMode,
            insertMemory: openai.insertMemory,
            toggleMemoryCommentPanel: overlay.toggleMemoryCommentPanel,
            showFeedback: overlay.showToast,
            setupDetailViewScrollIndicator: overlay.setupDetailViewScrollIndicator
        });

        // Register callbacks for chat module (generic pages)
        chat.registerCallbacks({
            getEffectiveMode: overlay.getEffectiveMode,
            updateMemorySuggestions: memoryRefresh.updateForCompose,
            updateMemorySuggestionsForView: memoryRefresh.updateForView,
            showEmptyState: () => overlay.showEmptyState('generic')
        });

        genericMonitorInitTimeout = setTimeout(() => {
            genericMonitorInitTimeout = null;
            genericPage.startMonitoring();
            if (googleSheets && googleSheets.shouldExtract && googleSheets.shouldExtract()) {
                googleSheets.startUrlPoller();
                googleSheets.startMonitoring();
            }
        }, 2000);
    }

}

// Heartbeat — detect stale extension context after laptop sleep/wake.
// Instead of force-reloading the page (which destroys unsaved work such as
// email drafts), tear down the Engramme overlay and attempt to re-initialize.
// If the extension was updated, Chrome restores the runtime context and
// re-initialization succeeds; if truly dead, the overlay simply disappears
// and the user can reload manually when convenient.
let heartbeatInterval = null;
let heartbeatRetries = 0;
const HEARTBEAT_MAX_RETRIES = 3;
const HEARTBEAT_RECOVERY_DELAY_MS = 2000;
const HEARTBEAT_MAX_RECOVERY_ATTEMPTS = 30; // ~1 minute at 2s intervals

function startHeartbeat() {
    if (heartbeatInterval) return;
    heartbeatInterval = setInterval(() => {
        try {
            if (!chrome?.runtime?.id) throw new Error('context dead');
            chrome.runtime.sendMessage({ action: 'heartbeat' }, (response) => {
                if (chrome.runtime.lastError || !response?.alive) {
                    handleStaleContext();
                } else {
                    heartbeatRetries = 0;
                }
            });
        } catch (e) {
            handleStaleContext();
        }
    }, 30000);
}

function handleStaleContext() {
    if (recoveryInProgress) return;

    heartbeatRetries++;
    if (heartbeatRetries < HEARTBEAT_MAX_RETRIES) {
        return;
    }
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
    heartbeatRetries = 0;
    recoveryInProgress = true;

    // Clean up current UI without reloading the page
    cleanup();

    // Retry recovery up to ~1 minute so a transient outage does not
    // permanently remove the overlay for the rest of the page session.
    let recoveryAttempts = 0;
    const attemptRecovery = () => {
        recoveryRetryTimeout = null;
        recoveryAttempts++;
        try {
            if (chrome?.runtime?.id) {
                initialize();
                startHeartbeat();
            } else if (recoveryAttempts < HEARTBEAT_MAX_RECOVERY_ATTEMPTS) {
                recoveryRetryTimeout = setTimeout(attemptRecovery, HEARTBEAT_RECOVERY_DELAY_MS);
            } else {
                recoveryInProgress = false;
            }
        } catch (e) {
            if (recoveryAttempts < HEARTBEAT_MAX_RECOVERY_ATTEMPTS) {
                recoveryRetryTimeout = setTimeout(attemptRecovery, HEARTBEAT_RECOVERY_DELAY_MS);
            } else {
                recoveryInProgress = false;
            }
        }
    };

    recoveryRetryTimeout = setTimeout(attemptRecovery, HEARTBEAT_RECOVERY_DELAY_MS);
}

// Start initialization
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
} else {
    initialize();
}
startHeartbeat();

window.addEventListener('unload', cleanup);
