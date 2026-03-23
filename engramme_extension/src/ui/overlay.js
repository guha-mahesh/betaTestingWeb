// overlay.js - Main overlay panel UI management
// Creates, positions, and controls the sidebar overlay panel
// Depends on: core/state.js, extraction/gmail.js, ui/feedback.js, ui/chat.js

(function() {
    'use strict';

    const overlay = {};
    const state = window.Engramme.state;
    const gmail = window.Engramme.gmail;
    const feedback = window.Engramme.feedback;
    const chat = window.Engramme.chat;

    // Route to the active mail module's adjustLayout (Gmail or Outlook)
    function adjustMailLayout(sidebarVisible) {
        const h = window.location.hostname;
        if (window.Engramme.utils.isOutlookHost(h)) {
            const outlook = window.Engramme.outlook;
            if (outlook && outlook.adjustLayout) outlook.adjustLayout(sidebarVisible);
        } else {
            gmail.adjustLayout(sidebarVisible);
        }
    }

    // Callbacks for functions defined in content.js
    overlay.callbacks = {
        updateMemorySuggestions: null,
        updateMemorySuggestionsForView: null
    };

    /**
     * Register callbacks from content.js
     * @param {Object} callbacks - Object with callback functions
     */
    overlay.registerCallbacks = function(callbacks) {
        Object.assign(overlay.callbacks, callbacks);
    };

    overlay.isVisible = function() {
        return !!(
            state.overlayElement &&
            state.overlayElement.classList.contains('show') &&
            !state.overlayElement.classList.contains('closed')
        );
    };

    /**
     * Adjust overlay position (delegates to mail module adjustLayout)
     */
    overlay.adjustPosition = function() {
        const sidebarVisible = overlay.isVisible();
        adjustMailLayout(sidebarVisible);
    };

    overlay.teardownTooltipPortal = function() {
        const tooltipPortal = state.tooltipPortal;
        if (!tooltipPortal) return;

        tooltipPortal.hide?.();

        if (tooltipPortal.shadowRoot && tooltipPortal.handlePointerOver) {
            tooltipPortal.shadowRoot.removeEventListener('pointerover', tooltipPortal.handlePointerOver, true);
        }
        if (tooltipPortal.shadowRoot && tooltipPortal.handlePointerOut) {
            tooltipPortal.shadowRoot.removeEventListener('pointerout', tooltipPortal.handlePointerOut, true);
        }
        if (tooltipPortal.scrollTarget && tooltipPortal.handleScroll) {
            tooltipPortal.scrollTarget.removeEventListener('scroll', tooltipPortal.handleScroll, true);
        }
        if (tooltipPortal.handleScroll) {
            window.removeEventListener('scroll', tooltipPortal.handleScroll, true);
        }

        if (tooltipPortal.element && tooltipPortal.element.isConnected) {
            tooltipPortal.element.remove();
        }

        state.tooltipPortal = null;
    };

    overlay.setupTooltipPortal = function(shadowRoot) {
        if (!shadowRoot || !state.overlayElement) return;

        if (state.tooltipPortal) {
            const sameRoot = state.tooltipPortal.shadowRoot === shadowRoot;
            const portalConnected = !!state.tooltipPortal.element?.isConnected;
            if (sameRoot && portalConnected) {
                return;
            }
            overlay.teardownTooltipPortal();
        }

        const tooltip = document.createElement('div');
        tooltip.className = 'engramme-tooltip';
        tooltip.setAttribute('role', 'tooltip');
        tooltip.setAttribute('aria-hidden', 'true');
        shadowRoot.appendChild(tooltip);
        let tooltipPortal = null;

        const setPosition = (target, placement) => {
            const rect = target.getBoundingClientRect();
            const padding = 8;
            const spacing = 8;
            const tooltipRect = tooltip.getBoundingClientRect();
            let resolvedPlacement = placement;

            if (resolvedPlacement === 'top' && rect.top - spacing - tooltipRect.height < padding) {
                resolvedPlacement = 'bottom';
            } else if (resolvedPlacement === 'bottom' && rect.bottom + spacing + tooltipRect.height > window.innerHeight - padding) {
                resolvedPlacement = 'top';
            }

            const left = Math.min(
                Math.max(rect.left + rect.width / 2, padding + tooltipRect.width / 2),
                window.innerWidth - padding - tooltipRect.width / 2
            );
            const top = resolvedPlacement === 'bottom'
                ? rect.bottom + spacing
                : rect.top - spacing;

            tooltip.style.left = `${left}px`;
            tooltip.style.top = `${top}px`;
            tooltip.dataset.placement = resolvedPlacement;
        };

        const hideTooltip = () => {
            tooltip.classList.remove('visible');
            tooltip.setAttribute('aria-hidden', 'true');
            tooltip.textContent = '';
            tooltipPortal.activeTarget = null;
        };

        const showTooltip = (target) => {
            const text = target.getAttribute('data-tooltip');
            if (!text) return;
            const placement = target.getAttribute('data-tooltip-position') === 'bottom' ? 'bottom' : 'top';

            tooltip.textContent = text;
            tooltip.style.display = 'block';
            tooltip.setAttribute('aria-hidden', 'false');
            tooltip.dataset.placement = placement;
            // Position after layout so getBoundingClientRect returns accurate tooltip dimensions
            requestAnimationFrame(() => {
                if (tooltipPortal.activeTarget !== target) return;
                setPosition(target, placement);
                tooltip.classList.add('visible');
            });
            tooltipPortal.activeTarget = target;
        };

        const handlePointerOver = (event) => {
            const target = event.target?.closest?.('[data-tooltip]');
            if (!target || !state.overlayElement.contains(target)) return;
            if (tooltipPortal.activeTarget === target) return;
            showTooltip(target);
        };

        const handlePointerOut = (event) => {
            const activeTarget = tooltipPortal.activeTarget;
            if (!activeTarget) return;
            const related = event.relatedTarget;
            if (related && activeTarget.contains(related)) return;
            hideTooltip();
        };

        const handleScroll = () => {
            if (tooltipPortal.activeTarget) {
                hideTooltip();
            }
        };

        tooltipPortal = {
            element: tooltip,
            activeTarget: null,
            hide: hideTooltip,
            shadowRoot,
            scrollTarget: state.overlayElement,
            handlePointerOver,
            handlePointerOut,
            handleScroll
        };
        state.tooltipPortal = tooltipPortal;
        shadowRoot.addEventListener('pointerover', handlePointerOver, true);
        shadowRoot.addEventListener('pointerout', handlePointerOut, true);
        tooltipPortal.scrollTarget.addEventListener('scroll', handleScroll, true);
        window.addEventListener('scroll', handleScroll, true);
    };

    /**
     * Get the effective mode (activeContext or currentMode)
     * @returns {string} The effective mode
     */
    overlay.getEffectiveMode = function() {
        return state.activeContext || state.currentMode;
    };

    /**
     * Check if target is within compose window
     * @param {Element} target - DOM element to check
     * @returns {boolean}
     */
    overlay.isWithinCompose = function(target) {
        if (!state.currentComposeElement || !target) return false;
        return state.currentComposeElement === target || state.currentComposeElement.contains(target);
    };

    /**
     * Check if target is a compose header interaction (minimize, etc.)
     * @param {Element} target - DOM element to check
     * @returns {boolean}
     */
    overlay.isComposeHeaderInteraction = function(target) {
        if (!state.currentComposeElement || !target || !target.closest) return false;

        const minimizeSelectors = [
            '[aria-label*="Minimize"]', '[aria-label*="minimize"]',
            '[aria-label*="Minimise"]', '[aria-label*="minimise"]',
            '[data-tooltip*="Minimize"]', '[data-tooltip*="minimize"]',
            '[data-tooltip*="Minimise"]', '[data-tooltip*="minimise"]',
            '[title*="Minimize"]', '[title*="minimize"]',
            '[title*="Minimise"]', '[title*="minimise"]'
        ];
        if (target.closest(minimizeSelectors.join(','))) {
            return true;
        }

        const headerSelectors = [
            '[role="heading"]',
            '[aria-label*="New Message"]', '[aria-label*="New message"]',
            '.Hp', '.a3E', '.aYF'
        ];
        const header = state.currentComposeElement.querySelector(headerSelectors.join(','));
        return !!(header && header.contains(target));
    };

    const threadHeaderViewSelector = '.nH .aHU [data-url], .nH .aHU [data-legacy-thread-id], .nH .aHU .hP';

    function hasThreadHeaderViewContext() {
        if (!gmail.isThreadViewUrl || !gmail.isThreadViewUrl()) return false;
        return !!document.querySelector(threadHeaderViewSelector);
    }

    /**
     * Check if there's a view context available
     * @returns {boolean}
     */
    overlay.hasViewContext = function() {
        if (state.currentViewElement) return true;
        // Gmail selectors
        if (document.querySelector('.ii.gt, .a3s.aiL, .gE.iv.gt') || hasThreadHeaderViewContext()) return true;
        // Outlook reading pane
        const rp = document.querySelector('[role="main"][aria-label="Reading Pane"]');
        if (rp && rp.querySelector('[role="document"]')) return true;
        return false;
    };

    /**
     * Check if target is within email view
     * @param {Element} target - DOM element to check
     * @returns {boolean}
     */
    overlay.isWithinView = function(target) {
        if (!target) return false;

        if (state.currentViewElement && (state.currentViewElement === target || state.currentViewElement.contains(target))) {
            return true;
        }

        if (!target.closest) return false;

        const viewSelectors = [
            '.ii.gt', '.a3s.aiL', '.gE.iv.gt', '.zA'
        ];
        if (target.closest(viewSelectors.join(','))) {
            return true;
        }

        if (target.closest(threadHeaderViewSelector)) {
            return hasThreadHeaderViewContext();
        }

        // Outlook reading pane
        if (target.closest('[role="main"][aria-label="Reading Pane"]')) {
            return true;
        }

        return false;
    };

    /**
     * Set active context
     * @param {string} nextContext - 'compose' or 'view'
     * @param {string} reason - Reason for context change
     */
    overlay.setActiveContext = function(nextContext) {
        if (!nextContext || nextContext === state.activeContext) return;

        state.activeContext = nextContext;

        if (nextContext === 'compose' && overlay.callbacks.updateMemorySuggestions) {
            overlay.callbacks.updateMemorySuggestions();
        } else if (nextContext === 'view' && overlay.callbacks.updateMemorySuggestionsForView) {
            overlay.callbacks.updateMemorySuggestionsForView();
        }
    };

    /**
     * Setup intent listeners for Gmail compose/view context switching
     * @param {boolean} isGmailPage - Whether current page is Gmail
     */
    overlay.setupIntentListeners = function(isGmailPage) {
        if (state.intentListenersAttached || !isGmailPage) return;
        state.intentListenersAttached = true;

        const handleInteraction = (event) => {
            if (!event || !event.target) return;
            if (state.overlayElement && state.overlayElement.contains(event.target)) return;

            if (overlay.isWithinCompose(event.target)) {
                if (overlay.isComposeHeaderInteraction(event.target)) {
                    if (overlay.hasViewContext()) {
                        overlay.setActiveContext('view', 'compose-titlebar');
                    }
                    return;
                }
                overlay.setActiveContext('compose', 'interaction');
            } else if (overlay.isWithinView(event.target)) {
                overlay.setActiveContext('view', 'interaction');
            }
        };

        document.addEventListener('mousedown', handleInteraction, true);
        document.addEventListener('focusin', handleInteraction, true);
        document.addEventListener('keydown', handleInteraction, true);
    };

    /**
     * Setup scroll indicator for memory list
     */
    overlay.setupScrollIndicator = function() {
        const memoryList = state.shadowRoot ? state.shadowRoot.querySelector('.memory-list') : document.querySelector('.memory-list');
        if (!memoryList) return;

        let scrollTimeout;

        memoryList.addEventListener('scroll', () => {
            const hasMoreContent = memoryList.scrollHeight > memoryList.clientHeight + memoryList.scrollTop + 10;

            if (hasMoreContent) {
                memoryList.classList.add('scrolling');
                clearTimeout(scrollTimeout);
                scrollTimeout = setTimeout(() => {
                    memoryList.classList.remove('scrolling');
                }, 1000);
            }
        });
    };

    /**
     * Setup scroll indicator for detail view
     */
    overlay.setupDetailViewScrollIndicator = function() {
        const detailView = state.shadowRoot ? state.shadowRoot.querySelector('.memory-detail-view') : document.querySelector('.memory-detail-view');
        if (!detailView) return;

        let scrollTimeout;

        detailView.addEventListener('scroll', () => {
            const hasMoreContent = detailView.scrollHeight > detailView.clientHeight + detailView.scrollTop + 10;

            if (hasMoreContent) {
                detailView.classList.add('scrolling');
                clearTimeout(scrollTimeout);
                scrollTimeout = setTimeout(() => {
                    detailView.classList.remove('scrolling');
                }, 1000);
            }
        });
    };

    /**
     * Setup resize handle with a specific element
     * @param {HTMLElement} resizeHandle - The resize handle element
     */
    overlay.setupResizeHandleElement = function(resizeHandle) {
        if (!resizeHandle || !state.overlayElement) return;

        let isResizing = false;
        let startX = 0;
        let startWidth = 0;

        resizeHandle.addEventListener('mousedown', (e) => {
            isResizing = true;
            startX = e.clientX;
            startWidth = state.overlayElement.offsetWidth;
            document.body.style.cursor = 'ew-resize';
            document.body.style.userSelect = 'none';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const deltaX = startX - e.clientX;
            const newWidth = startWidth + deltaX;
            if (newWidth >= 280 && newWidth <= 1650) {
                state.overlayElement.style.width = newWidth + 'px';
            }
        });

        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                overlay.adjustPosition();
            }
        });
    };

    /**
     * Create the overlay DOM element with Shadow DOM for CSS isolation
     */
    overlay.create = function() {
        if (state.overlayElement) {
            return;
        }

        // Create host element for shadow DOM
        const hostElement = document.createElement('div');
        hostElement.id = 'engramme-overlay-host';

        // Detect CSS zoom on html/body that would scale our overlay
        const htmlZoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
        const bodyZoom = parseFloat(getComputedStyle(document.body).zoom) || 1;
        const pageZoom = htmlZoom * bodyZoom;
        const counterZoom = Math.abs(pageZoom - 1) > 0.01 ? ` zoom: ${1 / pageZoom} !important;` : '';

        // all:initial blocks inherited properties; counter-zoom undoes ancestor zoom
        hostElement.style.cssText = `all: initial !important; position: fixed !important; top: 0 !important; right: 0 !important; z-index: 999999 !important; pointer-events: none !important;${counterZoom}`;

        // Attach shadow root
        const shadowRoot = hostElement.attachShadow({ mode: 'open' });
        state.shadowRoot = shadowRoot;
        state.overlayHost = hostElement;

        // Load CSS files into shadow DOM (track loading for show-readiness)
        const cssFiles = [
            'assets/styles/overlay.css',
            'assets/styles/memory-cards.css',
            'assets/styles/feedback.css',
            'assets/styles/chat.css'
        ];
        const cssLoadPromises = [];

        cssFiles.forEach(cssFile => {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = chrome.runtime.getURL(cssFile);
            cssLoadPromises.push(new Promise((resolve) => {
                const settle = () => resolve();
                link.addEventListener('load', settle, { once: true });
                link.addEventListener('error', settle, { once: true });
            }));
            shadowRoot.appendChild(link);
        });

        // Track CSS readiness so overlay.show() can wait for styles
        state._cssReady = Promise.all(cssLoadPromises);

        // Inject host stylesheet (font faces + reopen tab styles)
        if (!document.getElementById('engramme-host-styles')) {
            const hostLink = document.createElement('link');
            hostLink.id = 'engramme-host-styles';
            hostLink.rel = 'stylesheet';
            hostLink.href = chrome.runtime.getURL('assets/styles/host.css');
            document.head.appendChild(hostLink);
        }

        // Create the overlay element inside shadow DOM
        state.overlayElement = document.createElement('div');
        state.overlayElement.className = 'gmail-memory-overlay';
        state.overlayElement.style.pointerEvents = 'auto';
        state.overlayElement.innerHTML = `
            <div class="memory-header">
                <div class="memory-header-title">
                    <img src="${chrome.runtime.getURL('assets/icons/icon-48.png')}" alt="Engramme" class="memory-header-icon">
                    <span>Engramme</span>
                </div>
                <div class="memory-header-buttons">
                    <div class="feedback-stats">
                        <span class="feedback-stat likes" data-tooltip="Likes" data-tooltip-position="bottom">
                            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" /></svg>
                            <span class="feedback-stat-count likes-count">0</span>
                        </span>
                        <span class="feedback-stat dislikes" data-tooltip="Dislikes" data-tooltip-position="bottom">
                            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14H5.236a2 2 0 01-1.789-2.894l3.5-7A2 2 0 018.736 3h4.018a2 2 0 01.485.06l3.76.94m-7 10v5a2 2 0 002 2h.096c.5 0 .905-.405.905-.904 0-.715.211-1.413.608-2.008L17 13V4m-7 10h2m5-10h2a2 2 0 012 2v6a2 2 0 01-2 2h-2.5" /></svg>
                            <span class="feedback-stat-count dislikes-count">0</span>
                        </span>
                        <span class="feedback-stat total" data-tooltip="Total ratings" data-tooltip-position="bottom">
                            <span class="feedback-stat-count total-count">0</span> rated
                        </span>
                    </div>
                    <button class="close-overlay-btn" aria-label="Close">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8 2.146 2.854Z"/>
                        </svg>
                    </button>
                </div>
            </div>
            <div class="feedback-panel"></div>
            <div class="memory-list">
                <div class="memories-loading">Type 50+ characters to see memories...</div>
            </div>
            <button class="chat-mode-toggle" aria-label="Toggle Chat Mode">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                </svg>
            </button>
        `;

        // Append overlay to shadow root, then host to body
        shadowRoot.appendChild(state.overlayElement);
        document.body.appendChild(hostElement);

        // CSS readiness is handled via state._cssReady in overlay.show()

        overlay.setupTooltipPortal(shadowRoot);

        // Add resize handle element
        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'memory-resize-handle';
        resizeHandle.innerHTML = '<div class="resize-handle-bar"></div>';
        state.overlayElement.appendChild(resizeHandle);
        overlay.setupResizeHandleElement(resizeHandle);

        // Setup scroll indicator for memory list
        overlay.setupScrollIndicator();

        // Create reopen tab (outside shadow DOM, styled by host.css)
        const reopenTab = document.createElement('div');
        reopenTab.className = 'memory-reopen-tab';
        reopenTab.innerHTML = `
            <img src="${chrome.runtime.getURL('assets/icons/icon-48.png')}" alt="Engramme" class="reopen-tab-logo">
            <span class="reopen-tab-label">Memories</span>
        `;
        reopenTab.title = 'Show memories';
        document.body.appendChild(reopenTab);

        reopenTab.addEventListener('click', () => {
            overlay.reopen();
        });

        // Close button
        state.overlayElement.querySelector('.close-overlay-btn').addEventListener('click', () => {
            overlay.close();
        });

        // Chat mode toggle button
        const chatModeToggle = state.overlayElement.querySelector('.chat-mode-toggle');
        if (chatModeToggle) {
            chatModeToggle.addEventListener('click', () => {
                chat.toggle();
            });
        }

        // Initialize feedback stats from backend tracker
        const tracker = window.Engramme.feedbackTracker;
        if (tracker) {
            tracker.load().then(() => overlay.updateFeedbackStats());
        }

    };

    /**
     * Show the overlay
     */
    overlay.show = function() {
        if (!state.overlayElement) return;

        const doShow = () => {
            // Clear closed state if present so show actually takes effect
            if (state.overlayElement.classList.contains('closed')) {
                state.overlayElement.classList.remove('closed');
                state.userClosedOverlay = false;
                const reopenTab = document.querySelector('.memory-reopen-tab');
                if (reopenTab) reopenTab.style.display = 'none';
            }
            state.overlayElement.classList.add('show');
            overlay.adjustPosition();

            const effectiveMode = overlay.getEffectiveMode();
            if (effectiveMode === 'compose' && overlay.callbacks.updateMemorySuggestions) {
                overlay.callbacks.updateMemorySuggestions();
            } else if (effectiveMode === 'view' && overlay.callbacks.updateMemorySuggestionsForView) {
                overlay.callbacks.updateMemorySuggestionsForView();
            }
        };

        // Wait for shadow DOM CSS to load before showing to avoid layout jumps
        if (state._cssReady) {
            state._cssReady.then(doShow);
        } else {
            doShow();
        }
    };

    /**
     * Hide the overlay
     */
    overlay.hide = function() {
        if (state.overlayElement) {
            state.overlayElement.classList.remove('show');
            state.tooltipPortal?.hide?.();
            adjustMailLayout(false);
        }
    };

    /**
     * Close the overlay and show reopen tab
     */
    overlay.close = function() {
        if (state.overlayElement) {
            state.userClosedOverlay = true;
            state.overlayElement.classList.remove('show');
            state.overlayElement.classList.add('closed');
            state.tooltipPortal?.hide?.();
            adjustMailLayout(false);

            // Show reopen tab (uses inline styles since it's outside shadow DOM)
            const reopenTab = document.querySelector('.memory-reopen-tab');
            if (reopenTab) {
                reopenTab.style.display = 'flex';
            }
        }
    };

    /**
     * Reopen the overlay
     */
    overlay.reopen = function() {
        if (state.overlayElement) {
            state.userClosedOverlay = false;
            state.overlayElement.classList.remove('closed');
            state.overlayElement.classList.add('show');
            adjustMailLayout(true);

            // Hide reopen tab (uses inline styles since it's outside shadow DOM)
            const reopenTab = document.querySelector('.memory-reopen-tab');
            if (reopenTab) {
                reopenTab.style.display = 'none';
            }
        }
    };

    /**
     * Hide only feedback buttons (not close button)
     */
    overlay.hideFeedbackButtons = function() {
        if (!state.overlayElement) return;
        const thumbsUpBtn = state.overlayElement.querySelector('.global-rating-btn.thumbs-up');
        const thumbsDownBtn = state.overlayElement.querySelector('.global-rating-btn.thumbs-down');
        const commentToggleBtn = state.overlayElement.querySelector('.comment-toggle-btn');

        if (thumbsUpBtn) thumbsUpBtn.style.display = 'none';
        if (thumbsDownBtn) thumbsDownBtn.style.display = 'none';
        if (commentToggleBtn) commentToggleBtn.style.display = 'none';
    };

    /**
     * Show feedback buttons (suppressed in demo mode)
     */
    overlay.showFeedbackButtons = function() {
        if (!state.overlayElement) return;
        // In demo mode, keep global feedback buttons hidden
        if (state.demoMode) {
            overlay.hideFeedbackButtons();
            return;
        }
        const thumbsUpBtn = state.overlayElement.querySelector('.global-rating-btn.thumbs-up');
        const thumbsDownBtn = state.overlayElement.querySelector('.global-rating-btn.thumbs-down');
        const commentToggleBtn = state.overlayElement.querySelector('.comment-toggle-btn');

        if (thumbsUpBtn) thumbsUpBtn.style.display = '';
        if (thumbsDownBtn) thumbsDownBtn.style.display = '';
        if (commentToggleBtn) commentToggleBtn.style.display = '';
    };

    /**
     * Update feedback stats display in header
     */
    overlay.updateFeedbackStats = function() {
        if (!state.overlayElement) return;
        const tracker = window.Engramme.feedbackTracker;
        if (!tracker) return;

        const likesEl = state.overlayElement.querySelector('.likes-count');
        const dislikesEl = state.overlayElement.querySelector('.dislikes-count');
        const totalEl = state.overlayElement.querySelector('.total-count');
        if (likesEl) likesEl.textContent = tracker.totalLikes;
        if (dislikesEl) dislikesEl.textContent = tracker.totalDislikes;
        if (totalEl) totalEl.textContent = tracker.totalFeedbackCount;
    };

    /**
     * Clear query text
     */
    overlay.clearQueryText = function() {
        state.lastQueryText = '';
    };

    /**
     * Toggle feedback panel visibility
     */
    overlay.toggleFeedbackPanel = function() {
        const feedbackPanel = state.overlayElement?.querySelector('.feedback-panel');
        if (feedbackPanel) {
            feedbackPanel.classList.toggle('show');
        }
    };

    /**
     * Toggle memory comment panel visibility
     * @param {string} memoryId - Memory ID
     * @param {number} index - Memory index
     */
    overlay.toggleMemoryCommentPanel = function(memoryId, index) {
        const memoryCard = state.overlayElement?.querySelector(`.memory-card[data-index="${index}"]`);
        if (memoryCard) {
            const commentPanel = memoryCard.querySelector('.memory-comment-panel');
            if (commentPanel) {
                commentPanel.classList.toggle('show');
                state.memoryCommentPanelsOpen[memoryId] = commentPanel.classList.contains('show');
            }
        }
    };

    /**
     * Clear all feedback state (delegates to feedback module)
     */
    overlay.clearAllFeedback = function() {
        feedback.clearAll();
    };

    /**
     * Show empty state in the overlay
     * @param {'gmail'|'calendar'|'generic'} pageContext - Page type for empty state message
     */
    overlay.showEmptyState = function(pageContext) {
        if (state.overlayElement) {
            const memoryList = state.overlayElement.querySelector('.memory-list');
            if (memoryList) {
                let emptyMessage;
                if (pageContext === 'calendar' || pageContext === 'outlook-calendar') {
                    emptyMessage = 'Select an event to see memories.';
                } else if (pageContext === 'gmail') {
                    emptyMessage = 'Memories will show up when you select an email.';
                } else {
                    emptyMessage = 'Memories will show up as you browse the web.';
                }
                memoryList.innerHTML = `<div class="no-memories">${emptyMessage}</div>`;
            }

            // Hide the feedback panel if it's open
            const feedbackPanel = state.overlayElement.querySelector('.feedback-panel');
            if (feedbackPanel) {
                feedbackPanel.classList.remove('show');
            }

            overlay.hideFeedbackButtons();
            overlay.clearAllFeedback();
            overlay.clearQueryText();
            state.activeContext = null;
        }
    };

    /**
     * Show "not logged in" state with Google sign-in button.
     */
    overlay.showNotLoggedIn = function() {
        if (!state.overlayElement) return;
        const memoryList = state.overlayElement.querySelector('.memory-list');
        if (!memoryList) return;

        memoryList.innerHTML = `
            <div class="no-memories not-logged-in">
                <div class="not-logged-in-title">Sign in to see memories</div>
                <button class="google-btn" type="button">
                    <svg class="google-icon" viewBox="0 0 24 24">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                    Sign in with Google
                </button>
            </div>
        `;

        const loginBtn = memoryList.querySelector('.google-btn');
        if (loginBtn) {
            loginBtn.addEventListener('click', () => {
                loginBtn.disabled = true;
                loginBtn.textContent = 'Signing in...';
                chrome.runtime.sendMessage({ action: 'startGoogleAuth' }, (response) => {
                    if (chrome.runtime.lastError || !response || !response.success) {
                        loginBtn.disabled = false;
                        loginBtn.innerHTML = `
                            <svg class="google-icon" viewBox="0 0 24 24">
                                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                            </svg>
                            Sign in with Google
                        `;
                    } else {
                        overlay.showToast('Signed in successfully', 'success');
                    }
                });
            });
        }

        overlay.hideFeedbackButtons();
        overlay.clearQueryText();
    };

    /**
     * Show a toast feedback message
     * @param {string} message - Message to display
     * @param {string} type - 'success', 'error', 'warning', or 'loading'
     * @returns {HTMLElement} The feedback element
     */
    overlay.showToast = function(message, type = 'success') {
        const toastElement = document.createElement('div');

        if (type === 'loading') {
            toastElement.innerHTML = `
                <div style="display: flex; align-items: center; gap: 8px;">
                    <div style="
                        width: 14px;
                        height: 14px;
                        border: 2px solid rgba(255,255,255,0.3);
                        border-top-color: white;
                        border-radius: 50%;
                        animation: engramme-toast-spin 0.6s linear infinite;
                    "></div>
                    <span>${message}</span>
                </div>
            `;
        } else {
            toastElement.innerHTML = message;
        }

        let backgroundColor = '#4CAF50'; // success (green)
        if (type === 'error') backgroundColor = '#f44336';
        if (type === 'warning') backgroundColor = '#ff9800';
        if (type === 'loading') backgroundColor = '#2196F3';

        toastElement.style.cssText = `
            position: fixed;
            top: 20px;
            right: 420px;
            background: ${backgroundColor};
            color: white;
            padding: 8px 16px;
            border-radius: 6px;
            font-size: 13px;
            font-weight: 500;
            z-index: 1000000;
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
            opacity: 0;
            transition: opacity 0.3s, transform 0.3s;
            transform: translateY(-10px);
        `;

        if (!document.getElementById('engramme-toast-spinner-style')) {
            const style = document.createElement('style');
            style.id = 'engramme-toast-spinner-style';
            style.textContent = `
                @keyframes engramme-toast-spin {
                    to { transform: rotate(360deg); }
                }
            `;
            document.head.appendChild(style);
        }

        document.body.appendChild(toastElement);

        setTimeout(() => {
            toastElement.style.opacity = '1';
            toastElement.style.transform = 'translateY(0)';
        }, 10);

        const duration = type === 'loading' ? null : (type === 'success' ? 1500 : 2000);
        if (duration !== null) {
            toastElement._timeout = setTimeout(() => {
                overlay.dismissToast(toastElement);
            }, duration);
        }

        return toastElement;
    };

    /**
     * Dismiss a toast element
     * @param {HTMLElement} toastElement - The toast to dismiss
     */
    overlay.dismissToast = function(toastElement) {
        if (!toastElement || !toastElement.parentNode) return;

        if (toastElement._timeout) {
            clearTimeout(toastElement._timeout);
        }

        toastElement.style.opacity = '0';
        toastElement.style.transform = 'translateY(-10px)';
        setTimeout(() => {
            if (toastElement.parentNode) {
                toastElement.parentNode.removeChild(toastElement);
            }
        }, 300);
    };

    /**
     * Show insert success feedback
     */
    overlay.showInsertFeedback = function() {
        overlay.showToast('✓ Memory inserted', 'success');
    };

    // Keyboard shortcuts (non-interfering: Alt+E to toggle, Escape to close)
    document.addEventListener('keydown', (e) => {
        // Alt+E: toggle overlay open/close
        if (e.altKey && (e.key === 'e' || e.key === 'E') && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
            e.preventDefault();
            if (overlay.isVisible()) {
                overlay.close();
            } else {
                overlay.reopen();
            }
            return;
        }
        // Escape: close overlay if open and focus is not in an input
        if (e.key === 'Escape' && overlay.isVisible()) {
            const active = document.activeElement;
            const shadowActive = state.shadowRoot?.activeElement;
            const isInInput = active?.tagName === 'TEXTAREA' || active?.tagName === 'INPUT' ||
                              active?.isContentEditable ||
                              shadowActive?.tagName === 'TEXTAREA' || shadowActive?.tagName === 'INPUT';
            if (!isInInput) {
                overlay.close();
            }
        }
    }, true);

    // Export overlay to namespace
    window.Engramme.overlay = overlay;

})();
