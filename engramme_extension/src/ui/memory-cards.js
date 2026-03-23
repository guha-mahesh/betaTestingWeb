// memory-cards.js - Memory card rendering and detail view
// Renders memory cards, handles card interactions, and displays detail views
// Depends on: core/state.js, extraction/gmail.js, ui/feedback.js

(function() {
    'use strict';

    const memoryDisplay = {};
    const state = window.Engramme.state;
    const feedback = window.Engramme.feedback;
    const gmail = window.Engramme.gmail;

    // Callbacks for functions defined in content.js
    memoryDisplay.callbacks = {
        showFeedbackButtons: null,
        getEffectiveMode: null,
        insertMemory: null,
        toggleMemoryCommentPanel: null,
        showFeedback: null,
        setupDetailViewScrollIndicator: null
    };

    /**
     * Register callbacks from content.js
     * @param {Object} callbacks - Object with callback functions
     */
    memoryDisplay.registerCallbacks = function(callbacks) {
        Object.assign(memoryDisplay.callbacks, callbacks);
    };

    // Demo mode: replace Memorious / Memory Machines branding with Engramme
    // Uses case-insensitive regexes to catch all casing variants (e.g. MEMORIOUS, Memory machines, etc.)
    const _demoReplacements = [
        [/memory\s*machines?\.ai/gi, 'engramme.com'],
        [/memorious\.io/gi, 'engramme.com'],
        [/memory\s+machines?/gi, 'Engramme'],
        [/memorious/gi, 'Engramme'],
    ];

    function _demoSanitizeText(text) {
        if (!text || typeof text !== 'string') return text;
        for (const [pattern, replacement] of _demoReplacements) {
            text = text.replace(pattern, replacement);
        }
        return text;
    }

    function _demoSanitizeMemories(memories) {
        return memories.map(m => ({
            ...m,
            headline: _demoSanitizeText(m.headline),
            narrative: _demoSanitizeText(m.narrative),
            source: _demoSanitizeText(m.source),
            where: _demoSanitizeText(m.where),
            participants: m.participants ? m.participants.map(p => _demoSanitizeText(p)) : m.participants,
            tags: m.tags ? m.tags.map(t => _demoSanitizeText(t)) : m.tags,
        }));
    }

    // Track scroll position when navigating to detail view
    let savedScrollPosition = null;
    let currentMemoryListSignature = null;

    // Integration logos mapping (same as web app)
    memoryDisplay.integrationLogos = {
        gmail: 'https://www.gstatic.com/images/branding/product/1x/gmail_2020q4_48dp.png',
        email: 'https://www.gstatic.com/images/branding/product/1x/gmail_2020q4_48dp.png',
        contacts: 'https://www.gstatic.com/images/branding/product/1x/contacts_2022_48dp.png',
        calendar: 'https://www.gstatic.com/images/branding/product/1x/calendar_2020q4_48dp.png',
        tasks: 'https://play-lh.googleusercontent.com/pjUulZ-Vdo7qPKxk3IRhnk8SORPlgSydSyYEjm7fGcoXO8wDyYisWXwQqEjMryZ_sqK2=w240-h480-rw',
        drive: 'https://www.gstatic.com/images/branding/product/1x/drive_2020q4_48dp.png',
        gdocs: 'https://www.gstatic.com/images/branding/product/1x/docs_2020q4_48dp.png',
        youtube: 'https://www.gstatic.com/images/branding/product/1x/youtube_48dp.png',
        photos: 'https://www.gstatic.com/images/branding/product/1x/photos_48dp.png',
        books: 'https://www.gstatic.com/images/branding/product/1x/play_books_48dp.png',
        fit: 'https://www.gstatic.com/images/branding/product/1x/gfit_48dp.png',
        slack: 'https://a.slack-edge.com/80588/marketing/img/icons/icon_slack_hash_colored.png',
        github: 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png',
        microsoft: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/44/Microsoft_logo.svg/48px-Microsoft_logo.svg.png',
        zoom: 'https://upload.wikimedia.org/wikipedia/commons/7/7b/Zoom_Communications_Logo.svg',
        asana: chrome.runtime.getURL('assets/icons/asana.svg'),
        browser: chrome.runtime.getURL('assets/icons/app-window.svg'),
        text: chrome.runtime.getURL('assets/icons/file-text.svg'),
        pdf: chrome.runtime.getURL('assets/icons/file-text.svg'),
        stream: chrome.runtime.getURL('assets/icons/monitor.svg'),
        vscode: chrome.runtime.getURL('assets/icons/code-2.svg'),
        cursor: chrome.runtime.getURL('assets/icons/mouse-pointer-2.svg'),
        claude_code: chrome.runtime.getURL('assets/icons/claude-code.svg'),
        codex: chrome.runtime.getURL('assets/icons/codex.svg'),
        meet: 'https://www.gstatic.com/images/branding/product/1x/meet_2020q4_48dp.png'
    };

    // Display names for sources (maps internal names to user-friendly names)
    memoryDisplay.sourceDisplayNames = {
        gdocs: 'Google Docs',
        gmail: 'Gmail',
        email: 'Gmail',
        drive: 'Google Drive',
        calendar: 'Google Calendar',
        contacts: 'Google Contacts',
        photos: 'Google Photos',
        youtube: 'YouTube',
        fit: 'Google Fit',
        books: 'Google Books',
        tasks: 'Google Tasks',
        slack: 'Slack',
        github: 'GitHub',
        microsoft: 'Microsoft',
        zoom: 'Zoom',
        asana: 'Asana',
        browser: 'Browser',
        text: 'Text',
        pdf: 'PDF',
        vscode: 'VS Code',
        cursor: 'Cursor',
        claude_code: 'Claude Code',
        codex: 'Codex CLI',
        stream: 'Streaming',
        meet: 'Google Meet'
    };

    // Color palette for avatars (matching webapp)
    const avatarColors = [
        'rgb(59, 130, 246)',   // blue-500
        'rgb(168, 85, 247)',   // purple-500
        'rgb(34, 197, 94)',    // green-500
        'rgb(249, 115, 22)',   // orange-500
        'rgb(236, 72, 153)',   // pink-500
        'rgb(99, 102, 241)'    // indigo-500
    ];

    function getThreadIdFromMemoryId(memoryId) {
        if (!memoryId || typeof memoryId !== 'string') return null;
        const underscoreIndex = memoryId.indexOf('_');
        if (underscoreIndex <= 0) return null;
        return memoryId.slice(0, underscoreIndex);
    }

    function getCurrentGmailUserIndex() {
        const pathSegments = window.location.pathname.split('/').filter(Boolean);
        const userSegmentIndex = pathSegments.indexOf('u');
        if (userSegmentIndex >= 0 && pathSegments[userSegmentIndex + 1]) {
            return pathSegments[userSegmentIndex + 1];
        }
        return '0';
    }

    function isGmailSource(source) {
        if (!source) return false;
        const normalized = source.toLowerCase();
        return normalized === 'gmail' || normalized === 'email';
    }

    function getGmailThreadUrlFromMemoryId(memoryId) {
        const threadId = getThreadIdFromMemoryId(memoryId);
        if (!threadId) return null;
        const userIndex = encodeURIComponent(getCurrentGmailUserIndex());
        return `https://mail.google.com/mail/u/${userIndex}/#all/${threadId}`;
    }

    function escapeHtml(str) {
        return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function isBrowserSource(source) {
        if (!source) return false;
        return source.toLowerCase() === 'browser';
    }

    function getBrowserSourceUrl(memory) {
        const url = memory?.source_metadata?.url;
        if (!url) return null;
        try {
            const parsed = new URL(url);
            if (parsed.protocol !== 'https:') return null;
            return parsed.href;
        } catch {
            return null;
        }
    }

    function getDomainFromUrl(url) {
        if (!url) return null;
        try {
            const hostname = new URL(url).hostname;
            // Strip www. prefix, return the domain
            return hostname.replace(/^www\./, '');
        } catch {
            return null;
        }
    }

    function getBrowserFavicon(memory) {
        return memory?.source_metadata?.favicon_data_uri || null;
    }

    function getDefaultLogoUrl(source) {
        return memoryDisplay.integrationLogos[(source || 'unknown').toLowerCase()] || null;
    }

    function getSourceDisplayName(source) {
        const normalizedSource = (source || 'unknown').toLowerCase();
        return memoryDisplay.sourceDisplayNames[normalizedSource] || source || 'Unknown';
    }

    function getSourceLogoUrl(memory) {
        const source = memory?.source || 'unknown';
        // For browser sources, prefer the stored favicon
        if (isBrowserSource(source)) {
            const favicon = getBrowserFavicon(memory);
            if (favicon) return favicon;
        }
        return getDefaultLogoUrl(source);
    }

    function getSourceTooltip(memory) {
        const source = memory?.source || 'unknown';
        if (isBrowserSource(source)) {
            const domain = getDomainFromUrl(memory?.source_metadata?.url);
            if (domain) return domain;
        }
        return getSourceDisplayName(source);
    }

    function syncErrorCodeUI(container, memoryId) {
        const selectedCodes = state.selectedErrorCodes[memoryId] || [];
        const grid = container.querySelector(`.error-code-grid[data-memory-id="${memoryId}"]`) || container.querySelector('.error-code-grid');
        if (grid) {
            grid.querySelectorAll('.error-code-btn').forEach(btn => {
                btn.classList.toggle('active', selectedCodes.includes(btn.dataset.code));
            });
        }
        const selectedContainer = container.querySelector(`.error-code-selected[data-memory-id="${memoryId}"]`) || container.querySelector('.error-code-selected');
        if (selectedContainer) {
            selectedContainer.innerHTML = selectedCodes.map(code => `<span class="error-code-selected-pill">${code} /</span>`).join('');
            selectedContainer.classList.toggle('visible', selectedCodes.length > 0);
            selectedContainer.scrollLeft = selectedContainer.scrollWidth;
        }
    }

    function enableHorizontalWheelScroll(element) {
        if (!element) return;
        element.addEventListener('wheel', (e) => {
            if (element.scrollWidth <= element.clientWidth) return;
            if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
            element.scrollLeft += e.deltaY;
            e.preventDefault();
        }, { passive: false });
    }

    /**
     * Build a signature hash for a memory list
     * @param {Array} memories - Array of memory objects
     * @returns {string|null} Signature string or null
     */
    memoryDisplay.buildListSignature = function(memories) {
        if (!memories || memories.length === 0) return null;

        const ids = memories.map((memory, index) => memory.event_id || `temp_${index}`);
        const joined = ids.join('|');

        let hash = 2166136261;
        for (let i = 0; i < joined.length; i++) {
            hash ^= joined.charCodeAt(i);
            hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
        }

        return `${ids.length}:${(hash >>> 0).toString(16)}`;
    };

    // ================================================================
    // SHARED CARD BRIDGE
    // ================================================================
    // Loads the shared card HTML from chrome-extension:// URL in a
    // sandboxed iframe (allows inline script execution). The loader
    // inside the iframe signals loaderReady; the content script then
    // fetches memory-card.js from the webapp backend via the background
    // service worker and injects it into the sandbox via postMessage.
    // Card rendering logic always comes from the backend — single
    // source of truth.
    const _sharedCardUrl = chrome.runtime.getURL('assets/shared-card.html');
    const _sharedCardDeclaredOrigin = (() => {
        try {
            return new URL(_sharedCardUrl).origin;
        } catch {
            return null;
        }
    })();
    const _sharedCardBootTimeoutMs = 4000;
    const _sharedCardAllowedMessageTypes = new Set([
        'loaderReady',
        'ready',
        'resize',
        'rate',
        'comment',
        'unsavedCommentChange',
        'tap',
        'detailShown',
        'detailHidden',
        'errorCodeChange',
        'copy',
        'dismiss',
        'sourceClick'
    ]);
    let _sharedCardIframe = null;
    let _sharedCardReady = false;
    let _sharedCardEnabled = true;
    let _sharedCardBridgeNonce = null;
    let _sharedCardPinnedOrigin = null;
    let _sharedCardBootTimeout = null;
    let _pendingRender = null;
    let _lastDisplayMode = 'compose';

    // Cache the card JS fetched from the backend
    let _cardJsText = null;
    let _cardJsLoading = false;
    const _cardJsCallbacks = [];

    function _getCardJs(callback) {
        if (_cardJsText) { callback(_cardJsText); return; }
        _cardJsCallbacks.push(callback);
        if (_cardJsLoading) return;
        _cardJsLoading = true;

        chrome.runtime.sendMessage({ action: 'fetchSharedCard' }, (resp) => {
            if (resp && resp.success && resp.js) {
                _cardJsText = resp.js;
                _cardJsCallbacks.forEach(cb => cb(_cardJsText));
            } else {
                console.error('❌ Shared card: backend fetch failed:', resp?.error || 'no response');
                _cardJsCallbacks.forEach(cb => cb(null));
            }
            _cardJsCallbacks.length = 0;
            _cardJsLoading = false;
        });
    }

    function _createBridgeNonce() {
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    }

    function _clearSharedCardBootTimeout() {
        if (_sharedCardBootTimeout) {
            clearTimeout(_sharedCardBootTimeout);
            _sharedCardBootTimeout = null;
        }
    }

    function _isExpectedSharedCardFrame() {
        if (!_sharedCardIframe) return false;
        return _sharedCardIframe.getAttribute('src') === _sharedCardUrl;
    }

    function _resolveSharedCardTargetOrigin() {
        // Opaque origins (for sandboxed extension pages) report as "null" and
        // cannot be targeted directly; in that case we must use wildcard.
        if (_sharedCardPinnedOrigin && _sharedCardPinnedOrigin !== 'null') {
            return _sharedCardPinnedOrigin;
        }
        return '*';
    }

    function _postToSharedCard(message) {
        if (!_sharedCardIframe || !_sharedCardIframe.contentWindow) return false;
        if (!_isExpectedSharedCardFrame()) {
            _fallbackToNativeRenderer('unexpected shared-card iframe src');
            return false;
        }
        _sharedCardIframe.contentWindow.postMessage(message, _resolveSharedCardTargetOrigin());
        return true;
    }

    function _fallbackToNativeRenderer(reason) {
        if (_sharedCardEnabled) {
        }
        _sharedCardEnabled = false;
        _sharedCardReady = false;
        _sharedCardBridgeNonce = null;
        _sharedCardPinnedOrigin = null;
        _pendingRender = null;
        _clearSharedCardBootTimeout();
        if (_sharedCardIframe) {
            _sharedCardIframe.remove();
            _sharedCardIframe = null;
        }

        if (state.overlayElement) {
            memoryDisplay.display(
                state.currentMemories || [],
                _lastDisplayMode,
                state.lastQueryText,
                { forceDisplay: true, skipSelfRefFilter: true }
            );
        }
    }

    function _startSharedCardBootTimeout() {
        _clearSharedCardBootTimeout();
        _sharedCardBootTimeout = setTimeout(() => {
            if (!_sharedCardReady && _sharedCardEnabled) {
                _fallbackToNativeRenderer('bootstrap timeout');
            }
        }, _sharedCardBootTimeoutMs);
    }

    function _sendRenderToSharedCard(payload) {
        if (_sharedCardIframe && _sharedCardIframe.contentWindow && _sharedCardBridgeNonce) {
            _postToSharedCard({
                type: 'engramme:render',
                bridgeNonce: _sharedCardBridgeNonce,
                payload
            });
        }
    }

    function _buildRenderPayload(memories) {
        const annotations = memories.map((m, i) => {
            const memoryId = m.event_id || `temp_${i}`;
            return {
                event_id: memoryId,
                rating: state.memoryRatings[memoryId] || null,
                comment: state.memoryComments[memoryId] || null,
                selectedErrorCodes: state.selectedErrorCodes[memoryId] || [],
            };
        });

        return {
            memories: memories.map((m, i) => ({
                event_id: m.event_id || `temp_${i}`,
                headline: m.headline || null,
                narrative: m.narrative || '',
                participants: m.participants || [],
                when: typeof m.when === 'string' ? m.when : (m.when || null),
                source: m.source || null,
                similarity: m.similarity != null ? m.similarity : null,
                source_metadata: m.source_metadata || null,
            })),
            annotations,
            config: {
                mode: 'interactive',
                showDismiss: false,
                showCopy: true,
                showSimilarity: false,
                showErrorCodes: false,
                showFeedback: !state.demoMode,
                cardStyle: 'compact',
                enableDetail: true,
            }
        };
    }

    function _handleSharedCardMessage(e) {
        if (!e.data || !e.data.type || !e.data.type.startsWith('engramme:')) return;
        if (!_sharedCardIframe || e.source !== _sharedCardIframe.contentWindow) return;
        if (!_isExpectedSharedCardFrame()) {
            return;
        }

        if (_sharedCardPinnedOrigin && e.origin !== _sharedCardPinnedOrigin) {
            return;
        }

        if (!_sharedCardPinnedOrigin) {
            const allowedOrigins = new Set(['null']);
            if (_sharedCardDeclaredOrigin) {
                allowedOrigins.add(_sharedCardDeclaredOrigin);
            }
            if (!allowedOrigins.has(e.origin)) {
                return;
            }
            _sharedCardPinnedOrigin = e.origin;
        }

        const type = e.data.type.replace('engramme:', '');
        if (!_sharedCardAllowedMessageTypes.has(type)) return;
        if (!_sharedCardBridgeNonce || e.data.bridgeNonce !== _sharedCardBridgeNonce) {
            return;
        }

        const payload = e.data.payload || {};

        switch (type) {
            case 'loaderReady':
                // Sandboxed iframe is ready — fetch card JS from backend and inject it
                _getCardJs((js) => {
                    if (!js) {
                        _fallbackToNativeRenderer('shared card JS unavailable');
                        return;
                    }
                    if (_sharedCardIframe && _sharedCardIframe.contentWindow) {
                        _postToSharedCard({
                            type: 'engramme:injectScript',
                            bridgeNonce: _sharedCardBridgeNonce,
                            js: js
                        });
                    }
                });
                break;

            case 'ready':
                _sharedCardReady = true;
                _clearSharedCardBootTimeout();
                // Iframe is ready — clear native cards and reveal iframe
                if (_sharedCardIframe) {
                    const list = _sharedCardIframe.parentElement;
                    if (list) {
                        // Remove all children except the iframe
                        Array.from(list.children).forEach(child => {
                            if (child !== _sharedCardIframe) child.remove();
                        });
                    }
                    _sharedCardIframe.style.display = 'block';
                }
                if (_pendingRender) {
                    _sendRenderToSharedCard(_pendingRender);
                    _pendingRender = null;
                }
                break;

            case 'resize':
                if (_sharedCardIframe) {
                    _sharedCardIframe.style.height = payload.height + 'px';
                }
                break;

            case 'rate': {
                const memoryId = payload.event_id;
                const rating = payload.rating;
                const mems = state.currentMemories || [];
                const index = mems.findIndex(m => m.event_id === memoryId);

                // Sync all unsaved comments from shared card
                if (payload.all_unsaved_comments) {
                    Object.entries(payload.all_unsaved_comments).forEach(([id, text]) => {
                        state.memoryComments[id] = text;
                        delete state.submittedMemoryComments[id];
                    });
                }

                feedback.handleMemoryRating(memoryId, index >= 0 ? index : 0, rating);
                break;
            }

            case 'comment':
                state.memoryComments[payload.event_id] = payload.comment;
                delete state.submittedMemoryComments[payload.event_id];
                feedback.submit(null, false);
                break;

            case 'unsavedCommentChange':
                if (payload.text && payload.text.trim()) {
                    state.memoryComments[payload.event_id] = payload.text.trim();
                } else {
                    delete state.memoryComments[payload.event_id];
                }
                delete state.submittedMemoryComments[payload.event_id];
                feedback.updateSubmitButtonState();
                break;

            case 'tap': {
                // Only fires when enableDetail is false (fallback)
                const memoryId = payload.event_id;
                const mems = state.currentMemories || [];
                const index = mems.findIndex(m => m.event_id === memoryId);
                if (index >= 0) {
                    memoryDisplay.showDetail(mems[index], index, _lastDisplayMode);
                }
                break;
            }

            case 'detailShown':
                // Shared card is showing its built-in detail view
                break;

            case 'detailHidden':
                // Shared card returned to list view
                break;

            case 'errorCodeChange': {
                const memoryId = payload.event_id;
                const codes = payload.selectedErrorCodes || [];
                if (codes.length) {
                    state.selectedErrorCodes[memoryId] = codes;
                } else {
                    delete state.selectedErrorCodes[memoryId];
                }
                feedback.updateSubmitButtonState();
                break;
            }

            case 'copy':
                break;

            case 'dismiss':
                break;

            case 'sourceClick':
                if (payload.url) {
                    const safeUrl = getBrowserSourceUrl({ source_metadata: { url: payload.url } });
                    if (safeUrl) {
                        window.open(safeUrl, '_blank', 'noopener,noreferrer');
                    }
                }
                break;
        }
    }

    window.addEventListener('message', _handleSharedCardMessage);

    // ================================================================
    // END SHARED CARD BRIDGE
    // ================================================================

    /**
     * Display memory cards in the overlay
     * @param {Array} relevantMemories - Array of memory objects
     * @param {string} mode - 'compose' or 'view'
     * @param {string} queryText - Query text for feedback
     * @param {Object} options - Optional settings
     * @param {boolean} options.forceDisplay - If true, bypass the typed feedback check (for explicit navigation like back button)
     * @param {boolean} options.skipSelfRefFilter - If true in view mode, skip redundant self-reference filtering
     * @param {string|null} options.recallId - Recall context identifier tied to these displayed memories
     */
    memoryDisplay.display = function(relevantMemories, mode = 'compose', queryText = null, options = {}) {
        if (!state.overlayElement) {
            return;
        }

        // Skip refresh if there's typed feedback, unless forceDisplay is set (e.g., back button navigation)
        if (!options.forceDisplay && feedback.hasTypedFeedback()) {
            return;
        }

        const memoryList = state.overlayElement.querySelector('.memory-list');
        if (!memoryList) {
            return;
        }

        let memoriesToDisplay = relevantMemories;
        if (mode === 'view' && !options.skipSelfRefFilter && gmail?.getCurrentThreadId) {
            const currentThreadId = gmail.getCurrentThreadId();
            if (currentThreadId) {
                memoriesToDisplay = relevantMemories.filter((memory, index) => {
                    const memoryId = memory.event_id || `temp_${index}`;
                    return getThreadIdFromMemoryId(memoryId) !== currentThreadId;
                });
            }
        }

        // In demo mode, keep only the top ranked memory after all filtering,
        // and sanitize branding (Memorious/Memory Machines → Engramme).
        if (state.demoMode) {
            memoriesToDisplay = memoriesToDisplay.slice(0, 1);
            memoriesToDisplay = _demoSanitizeMemories(memoriesToDisplay);
        }


        state.currentMemories = memoriesToDisplay;
        currentMemoryListSignature = memoryDisplay.buildListSignature(memoriesToDisplay);
        if (Object.prototype.hasOwnProperty.call(options, 'recallId')) {
            state.currentRecallId = options.recallId || null;
        }
        state.memoriesTimestamp = new Date().toISOString();
        if (queryText !== null) {
            state.lastQueryText = queryText.trim();
        }

        if (memoriesToDisplay.length === 0) {
            if (state.demoMode) {
                memoryList.innerHTML = '';
            } else if (mode === 'compose') {
                memoryList.innerHTML = '<div class="no-memories">No relevant memories found.</div>';
            } else {
                memoryList.innerHTML = '<div class="no-memories">No relevant memories found for this email thread.</div>';
            }
            if (memoryDisplay.callbacks.showFeedbackButtons) {
                memoryDisplay.callbacks.showFeedbackButtons();
            }
            return;
        }

        if (memoryDisplay.callbacks.showFeedbackButtons) {
            memoryDisplay.callbacks.showFeedbackButtons();
        }

        _lastDisplayMode = mode;

        // === SHARED CARD RENDERING (iframe bridge) ===
        // Loads shared card from chrome-extension:// URL; the loader inside
        // dynamically fetches memory-card.js from the webapp backend.
        if (_sharedCardEnabled) {
            const renderPayload = _buildRenderPayload(memoriesToDisplay);

            // If iframe already exists and is in the DOM, just send the render
            if (_sharedCardIframe && memoryList.contains(_sharedCardIframe)) {
                if (_sharedCardReady) {
                    _sendRenderToSharedCard(renderPayload);
                } else {
                    _pendingRender = renderPayload;
                    _startSharedCardBootTimeout();
                }
                feedback.updateSubmitButtonState();
                feedback.updateThumbVisualStates();
                return;
            }

            // Need a new iframe — load from chrome-extension:// URL
            _pendingRender = renderPayload;
            if (_sharedCardIframe) _sharedCardIframe.remove();
            _sharedCardIframe = document.createElement('iframe');
            _sharedCardIframe.style.cssText = 'width: 100%; border: none; background: transparent; display: block; min-height: 100px;';
            _sharedCardBridgeNonce = _createBridgeNonce();
            _sharedCardPinnedOrigin = null;
            _sharedCardIframe.addEventListener('load', () => {
                if (_sharedCardIframe && _sharedCardIframe.contentWindow && _sharedCardBridgeNonce) {
                    _postToSharedCard({
                        type: 'engramme:init',
                        bridgeNonce: _sharedCardBridgeNonce,
                        demoMode: !!state.demoMode
                    });
                }
            }, { once: true });
            _sharedCardIframe.src = _sharedCardUrl;
            _sharedCardReady = false;
            _startSharedCardBootTimeout();
            // Keep existing native cards visible while iframe boots — hide iframe until ready
            _sharedCardIframe.style.display = 'none';
            memoryList.appendChild(_sharedCardIframe);

            feedback.updateSubmitButtonState();
            feedback.updateThumbVisualStates();
            return;
        }
        // === END SHARED CARD RENDERING ===

        // Native fallback rendering (when shared card server is unavailable)
        const memoriesHTML = memoriesToDisplay.map((memory, index) => {
            const headline = memory.headline || '';
            const narrative = memory.narrative || '';
            const memoryId = memory.event_id || `temp_${index}`;
            const rating = state.memoryRatings[memoryId] || 0;

            const participants = memory.participants || [];
            const participantCount = participants.length || 0;
            const displayCount = Math.min(participantCount, 3);
            const overflowCount = participantCount > 3 ? participantCount - 3 : 0;

            let avatarsHTML = '';
            if (participantCount > 0) {
                for (let i = 0; i < displayCount; i++) {
                    const participant = participants[i];
                    const participantName = typeof participant === 'string' ? participant : (participant.name || 'Unknown');
                    const initials = participantName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
                    const showInitials = initials && initials !== 'UN';
                    const color = avatarColors[i % avatarColors.length];
                    const safeParticipant = escapeHtml(participantName);
                    avatarsHTML += `<div class="avatar-item" style="background-color: ${color}; color: white;" data-tooltip="${safeParticipant}" aria-label="${safeParticipant}">${showInitials ? initials : '👤'}</div>`;
                }
                if (overflowCount > 0) {
                    avatarsHTML += `<div class="avatar-overflow">+${overflowCount}</div>`;
                }
            }

            const source = memory.source || 'unknown';
            const tooltip = escapeHtml(getSourceTooltip(memory));
            const sourceLogo = getSourceLogoUrl(memory);
            const fallbackLogo = getDefaultLogoUrl(source);
            const onerror = fallbackLogo ? `onerror="this.onerror=null;this.src='${escapeHtml(fallbackLogo)}'"` : '';
            const sourceIconHTML = sourceLogo
                ? `<span class="source-icon" data-tooltip="${tooltip}" aria-label="${tooltip}"><img src="${escapeHtml(sourceLogo)}" alt="${tooltip}" ${onerror} style="width: 24px; height: 24px; object-fit: contain; border-radius: 4px;" /></span>`
                : '';

            return `
                <div class="memory-card ${mode === 'view' ? 'view-mode' : ''}" data-index="${index}" data-memory-id="${memoryId}">
                    <div class="memory-card-header">
                        <div class="memory-card-left">
                            <div class="memory-icon">${sourceIconHTML}</div>
                            ${memory.when ? `<span class="memory-date">${memory.when}</span>` : ''}
                        </div>
                        <div class="memory-avatars">
                            ${avatarsHTML}
                        </div>
                    </div>
                    <div class="memory-content ${mode === 'compose' ? 'clickable' : ''}">
                        ${headline ? `<div class="memory-headline">${escapeHtml(headline)}</div>` : ''}
                        ${narrative ? `<div class="memory-narrative">${escapeHtml(narrative)}</div>` : ''}
                    </div>
                    <div class="memory-card-actions">
                        ${!state.demoMode ? `
                        <button class="memory-action-btn rating-btn thumbs-up ${rating === 1 ? 'active' : ''}" data-memory-id="${memoryId}" data-index="${index}" data-rating="1" aria-label="Relevant">
                            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.60L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" />
                            </svg>
                        </button>
                        <button class="memory-action-btn rating-btn thumbs-down ${rating === -1 ? 'active' : ''}" data-memory-id="${memoryId}" data-index="${index}" data-rating="-1" aria-label="Not relevant">
                            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14H5.236a2 2 0 01-1.789-2.894l3.5-7A2 2 0 018.736 3h4.018a2 2 0 01.485.06l3.76.94m-7 10v5a2 2 0 002 2h.096c.5 0 .905-.405.905-.904 0-.715.211-1.413.608-2.008L17 13V4m-7 10h2m5-10h2a2 2 0 012 2v6a2 2 0 01-2 2h-2.5" />
                            </svg>
                        </button>
                        <button class="memory-action-btn comment-toggle-btn" data-memory-id="${memoryId}" data-index="${index}" aria-label="Add comment">
                            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                            </svg>
                        </button>
                        ` : ''}
                        <button class="memory-action-btn copy-memory-btn" data-index="${index}" aria-label="Copy memory text">
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M6 6V4.13168C6 3.38309 6 3.00854 6.14532 2.72786C6.27315 2.47761 6.47761 2.27315 6.72786 2.14532C7.00854 2 7.38285 2 8.13144 2H11.8687C12.6173 2 12.9913 2 13.2719 2.14532C13.5222 2.27315 13.7269 2.47761 13.8548 2.72786C14.0001 3.00854 14.0001 3.38283 14.0001 4.13142V7.86868C14.0001 8.61727 14.0001 8.99148 13.8548 9.27216C13.7269 9.52241 13.5218 9.72705 13.2715 9.85488C12.9911 10 12.6177 10 11.8706 10H10M6 6H4.13168C3.38309 6 3.00854 6 2.72786 6.14532C2.47761 6.27315 2.27315 6.47761 2.14532 6.72786C2 7.00854 2 7.38285 2 8.13144V11.8687C2 12.6173 2 12.9913 2.14532 13.2719C2.27315 13.5222 2.47761 13.7269 2.72786 13.8548C3.00827 14 3.38237 14 4.13056 14H7.86944C8.61763 14 8.99145 14 9.27184 13.8548C9.52209 13.7269 9.72705 13.5218 9.85488 13.2715C10 12.9911 10 12.6177 10 11.8706V10M6 6H7.86832C8.61691 6 8.99146 6 9.27214 6.14532C9.52239 6.27315 9.72705 6.47761 9.85488 6.72786C10 7.00825 10 7.38242 10 8.13061L10 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </button>
                    </div>
                    <div class="memory-comment-panel" data-memory-id="${memoryId}" data-index="${index}">
                        ${!state.demoMode ? `<div class="error-code-grid" data-memory-id="${memoryId}">
                            ${window.Engramme.errorCodes.map(ec => `
                                <button class="error-code-btn${(state.selectedErrorCodes[memoryId] || []).includes(ec.code) ? ' active' : ''}" data-code="${ec.code}" data-memory-id="${memoryId}">${ec.label}</button>
                            `).join('')}
                        </div>
                        <div class="error-code-selected ${((state.selectedErrorCodes[memoryId] || []).length) ? 'visible' : ''}" data-memory-id="${memoryId}">
                            ${(state.selectedErrorCodes[memoryId] || []).map(code => `<span class="error-code-selected-pill">${code} /</span>`).join('')}
                        </div>` : ''}
                        <div class="memory-comment-input-wrapper">
                            <textarea class="memory-comment-input" data-memory-id="${memoryId}" data-index="${index}" placeholder="Add your comment..." rows="2" style="color: #000 !important;"></textarea>
                            <button class="memory-comment-submit-btn" data-memory-id="${memoryId}" data-index="${index}" aria-label="Submit feedback">
                                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                                    <path d="M15.854 7.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708-.708L14.293 8.5H.5a.5.5 0 0 1 0-1h13.793L8.146.354a.5.5 0 1 1 .708-.708l7 7z"/>
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        memoryList.innerHTML = memoriesHTML;

        // Sync global rating buttons
        const globalRatingButtons = state.overlayElement.querySelectorAll('.memory-header .global-rating-btn');
        globalRatingButtons.forEach(btn => {
            const btnRating = parseInt(btn.dataset.rating);
            if (btnRating === 1) {
                btn.classList.toggle('active', state.globalRating === 1);
            } else if (btnRating === -1) {
                btn.classList.toggle('active', state.globalRating === -1);
            }
        });

        // Rating buttons
        memoryList.querySelectorAll('.rating-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const memoryId = btn.dataset.memoryId;
                const index = parseInt(btn.dataset.index);
                const rating = parseInt(btn.dataset.rating);
                feedback.handleMemoryRating(memoryId, index, rating);
                if (!state.memoryCommentPanelsOpen[memoryId] && memoryDisplay.callbacks.toggleMemoryCommentPanel) {
                    memoryDisplay.callbacks.toggleMemoryCommentPanel(memoryId, index);
                }
            });
        });

        // Comment toggle buttons
        memoryList.querySelectorAll('.comment-toggle-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const memoryId = btn.dataset.memoryId;
                const index = parseInt(btn.dataset.index);
                if (memoryDisplay.callbacks.toggleMemoryCommentPanel) {
                    memoryDisplay.callbacks.toggleMemoryCommentPanel(memoryId, index);
                }
            });
        });

        // Comment inputs
        memoryList.querySelectorAll('.memory-comment-input').forEach(input => {
            const memoryId = input.dataset.memoryId;

            if (state.memoryComments[memoryId]) {
                input.value = state.memoryComments[memoryId];
                if (state.submittedMemoryComments[memoryId]) {
                    input.classList.add('submitted');
                }
            }

            input.addEventListener('input', (e) => {
                const trimmed = e.target.value.trim();
                if (trimmed) {
                    state.memoryComments[memoryId] = trimmed;
                } else {
                    delete state.memoryComments[memoryId];
                }
                delete state.submittedMemoryComments[memoryId];
                feedback.updateSubmitButtonState();
                // Remove submitted tint if text is cleared
                if (!trimmed) {
                    input.classList.remove('submitted');
                }
            });

            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    feedback.submit();
                }
            });
        });

        // Restore comment panel state (also show if comment or error codes exist)
        memoryList.querySelectorAll('.memory-comment-panel').forEach(panel => {
            const memoryId = panel.dataset.memoryId;
            const hasComment = Boolean(state.memoryComments[memoryId]);
            const hasErrorCodes = Array.isArray(state.selectedErrorCodes[memoryId]) && state.selectedErrorCodes[memoryId].length > 0;
            if (state.memoryCommentPanelsOpen[memoryId] || hasComment || hasErrorCodes) {
                panel.classList.add('show');
            }
        });

        // Comment submit buttons
        memoryList.querySelectorAll('.memory-comment-submit-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                feedback.submit();
            });
        });

        // Error code buttons
        memoryList.querySelectorAll('.error-code-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const memoryId = btn.dataset.memoryId;
                const code = btn.dataset.code;

                const selectedCodes = state.selectedErrorCodes[memoryId] || [];
                const codeIndex = selectedCodes.indexOf(code);
                if (codeIndex >= 0) {
                    selectedCodes.splice(codeIndex, 1);
                } else {
                    selectedCodes.push(code);
                }
                if (selectedCodes.length) {
                    state.selectedErrorCodes[memoryId] = selectedCodes;
                } else {
                    delete state.selectedErrorCodes[memoryId];
                }

                const card = btn.closest('.memory-card') || memoryList;
                syncErrorCodeUI(card, memoryId);
                feedback.updateSubmitButtonState();
            });
        });

        // Enable wheel-to-horizontal scrolling for error code grids and selected codes
        memoryList.querySelectorAll('.error-code-grid').forEach(enableHorizontalWheelScroll);
        memoryList.querySelectorAll('.error-code-selected').forEach(container => {
            enableHorizontalWheelScroll(container);
            container.scrollLeft = container.scrollWidth;
        });

        // Restore error code grid scroll positions for all memory cards
        memoryList.querySelectorAll('.error-code-grid').forEach(grid => {
            const gridMemoryId = grid.dataset.memoryId;
            if (gridMemoryId && state.errorCodeScrollPositions[gridMemoryId] !== undefined) {
                setTimeout(() => {
                    grid.scrollLeft = state.errorCodeScrollPositions[gridMemoryId];
                }, 0);
            }
        });

        // Copy buttons
        memoryList.querySelectorAll('.copy-memory-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const index = parseInt(btn.dataset.index);
                const narrative = memoriesToDisplay[index].narrative || '';

                try {
                    await navigator.clipboard.writeText(narrative);
                    const originalHTML = btn.innerHTML;
                    btn.innerHTML = `
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
                            <path d="M13.854 3.646L6 11.5l-3.5-3.5"/>
                        </svg>
                    `;
                    btn.style.color = '#10b981';

                    setTimeout(() => {
                        btn.innerHTML = originalHTML;
                        btn.style.color = '';
                    }, 2000);

                } catch (err) {
                    console.error('❌ Failed to copy:', err);
                    if (memoryDisplay.callbacks.showFeedback) {
                        memoryDisplay.callbacks.showFeedback('Failed to copy', 'error');
                    }
                }
            });
        });

        // Card click handlers
        memoryList.querySelectorAll('.memory-card').forEach((card, index) => {
            card.addEventListener('click', (e) => {
                if (e.target.closest('.memory-action-btn') || e.target.closest('.memory-comment-panel')) {
                    return;
                }

                const memoryId = card.dataset.memoryId;

                // Save error code grid scroll position before navigating to detail view
                const errorGrid = card.querySelector('.error-code-grid');
                if (errorGrid) {
                    state.errorCodeScrollPositions[memoryId] = errorGrid.scrollLeft;
                }
                const containerRect = memoryList.getBoundingClientRect();
                const cardRect = card.getBoundingClientRect();
                const listSignature = currentMemoryListSignature;

                if (!containerRect.height || containerRect.height <= 0) {
                    savedScrollPosition = null;
                } else if (!listSignature) {
                    savedScrollPosition = null;
                } else {
                    const fractionalY = (cardRect.top - containerRect.top) / containerRect.height;
                    savedScrollPosition = { memoryId, fractionalY, listSignature };
                }

                memoryDisplay.showDetail(memoriesToDisplay[index], index, mode);
            });
            card.style.cursor = 'pointer';
        });

        // Source icon click handlers (Gmail + Browser)
        memoryList.querySelectorAll('.source-icon').forEach((icon) => {
            icon.addEventListener('click', (e) => {
                const card = icon.closest('.memory-card');
                if (!card) return;
                const index = parseInt(card.dataset.index, 10);
                if (!Number.isInteger(index) || index < 0) return;
                const memory = memoriesToDisplay[index];
                if (!memory) return;

                // Gmail: open thread URL in new tab
                if (isGmailSource(memory?.source)) {
                    const memoryId = card.dataset.memoryId || memory.event_id || `temp_${index}`;
                    const threadUrl = getGmailThreadUrlFromMemoryId(memoryId);
                    if (threadUrl) {
                        e.stopPropagation();
                        window.open(threadUrl, '_blank', 'noopener,noreferrer');
                    }
                    return;
                }

                // Browser: open original page URL from source_metadata
                if (isBrowserSource(memory?.source)) {
                    const url = getBrowserSourceUrl(memory);
                    if (url) {
                        e.stopPropagation();
                        window.open(url, '_blank', 'noopener,noreferrer');
                    }
                }
            });
        });

        feedback.updateSubmitButtonState();
        feedback.updateThumbVisualStates();
    };

    /**
     * Show detailed view of a memory
     * @param {Object} memory - Memory object
     * @param {number} index - Memory index
     * @param {string} mode - 'compose' or 'view'
     */
    memoryDisplay.showDetail = function(memory, index, mode) {
        const memoryList = state.overlayElement?.querySelector('.memory-list');
        if (!memoryList) return;

        const headline = memory.headline || '';
        const narrative = memory.narrative || '';
        const memoryId = memory.event_id || `temp_${index}`;
        const rating = state.memoryRatings[memoryId] || 0;
        const participants = memory.participants || [];

        let participantsHTML = '';
        if (participants.length > 0) {
            participantsHTML = participants.map((p, i) => {
                const participantName = typeof p === 'string' ? p : (p.name || 'Unknown');
                const initials = participantName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
                const showInitials = initials && initials !== 'UN';
                const color = avatarColors[i % avatarColors.length];
                return `
                    <div class="participant-item">
                        <div class="participant-avatar" style="background-color: ${color}; color: white;">${showInitials ? initials : '👤'}</div>
                        <span class="participant-name">${escapeHtml(participantName)}</span>
                    </div>
                `;
            }).join('');
        }

        // Detail header label: browser uses domain; all other sources use canonical display name.
        const sourceLabel = isBrowserSource(memory.source)
            ? (getDomainFromUrl(memory?.source_metadata?.url) || 'Web Page')
            : getSourceDisplayName(memory.source);

        // Use actual headline for the title (no truncation needed)
        const memoryTitle = headline;

        const safeSourceLabel = escapeHtml(sourceLabel);
        const source = memory.source || 'unknown';
        const tooltip = escapeHtml(getSourceTooltip(memory));
        const sourceLogo = getSourceLogoUrl(memory);
        const fallbackLogo = getDefaultLogoUrl(source);
        const onerror = fallbackLogo ? `onerror="this.onerror=null;this.src='${escapeHtml(fallbackLogo)}'"` : '';
        const sourceIconHTML = sourceLogo
            ? `<span class="source-icon" data-tooltip="${tooltip}" aria-label="${tooltip}"><img src="${escapeHtml(sourceLogo)}" alt="${tooltip}" ${onerror} style="width: 28px; height: 28px; object-fit: contain; border-radius: 4px;" /></span>`
            : '';

        const detailHTML = `
            <div class="memory-detail-view" data-memory-id="${memoryId}">
                <div class="memory-detail-header-row">
                    <button class="back-btn">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M15 18l-6-6 6-6"/>
                        </svg>
                    </button>

                    <div class="memory-source-icon">${sourceIconHTML}</div>
                    <div class="memory-source-info">
                        <div class="memory-source-label">${safeSourceLabel}</div>
                        ${memory.when ? `<div class="memory-source-date">${memory.when}</div>` : ''}
                    </div>
                </div>

                <div class="memory-detail-content-wrapper">
                    <div class="memory-detail-title">${escapeHtml(memoryTitle)}</div>

                    <div class="memory-detail-content">
                        ${escapeHtml(narrative)}
                    </div>

                    ${participantsHTML ? `<div class="memory-detail-participants">
                        ${participantsHTML}
                    </div>` : ''}
                </div>

                <div class="memory-detail-actions">
                    ${!state.demoMode ? `
                    <button class="memory-detail-action-btn rating-btn thumbs-up ${rating === 1 ? 'active' : ''}" data-rating="1" aria-label="Relevant">
                        <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" />
                        </svg>
                    </button>
                    <button class="memory-detail-action-btn rating-btn thumbs-down ${rating === -1 ? 'active' : ''}" data-rating="-1" aria-label="Not relevant">
                        <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14H5.236a2 2 0 01-1.789-2.894l3.5-7A2 2 0 018.736 3h4.018a2 2 0 01.485.06l3.76.94m-7 10v5a2 2 0 002 2h.096c.5 0 .905-.405.905-.904 0-.715.211-1.413.608-2.008L17 13V4m-7 10h2m5-10h2a2 2 0 012 2v6a2 2 0 01-2 2h-2.5" />
                        </svg>
                    </button>
                    <button class="memory-detail-action-btn comment-btn" aria-label="Add comment">
                        <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                        </svg>
                    </button>
                    ` : ''}
                    <button class="memory-detail-action-btn copy-btn" aria-label="Copy memory text">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M6 6V4.13168C6 3.38309 6 3.00854 6.14532 2.72786C6.27315 2.47761 6.47761 2.27315 6.72786 2.14532C7.00854 2 7.38285 2 8.13144 2H11.8687C12.6173 2 12.9913 2 13.2719 2.14532C13.5222 2.27315 13.7269 2.47761 13.8548 2.72786C14.0001 3.00854 14.0001 3.38283 14.0001 4.13142V7.86868C14.0001 8.61727 14.0001 8.99148 13.8548 9.27216C13.7269 9.52241 13.5218 9.72705 13.2715 9.85488C12.9911 10 12.6177 10 11.8706 10H10M6 6H4.13168C3.38309 6 3.00854 6 2.72786 6.14532C2.47761 6.27315 2.27315 6.47761 2.14532 6.72786C2 7.00854 2 7.38285 2 8.13144V11.8687C2 12.6173 2 12.9913 2.14532 13.2719C2.27315 13.5222 2.47761 13.7269 2.72786 13.8548C3.00827 14 3.38237 14 4.13056 14H7.86944C8.61763 14 8.99145 14 9.27184 13.8548C9.52209 13.7269 9.72705 13.5218 9.85488 13.2715C10 12.9911 10 12.6177 10 11.8706V10M6 6H7.86832C8.61691 6 8.99146 6 9.27214 6.14532C9.52239 6.27315 9.72705 6.47761 9.85488 6.72786C10 7.00825 10 7.38242 10 8.13061L10 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </button>
                </div>

                <div class="memory-comment-panel" data-index="${index}" data-memory-id="${memoryId}">
                    ${!state.demoMode ? `<div class="error-code-grid" data-memory-id="${memoryId}">
                        ${window.Engramme.errorCodes.map(ec => `
                            <button class="error-code-btn${(state.selectedErrorCodes[memoryId] || []).includes(ec.code) ? ' active' : ''}" data-code="${ec.code}" data-memory-id="${memoryId}">${ec.label}</button>
                        `).join('')}
                    </div>
                    <div class="error-code-selected ${((state.selectedErrorCodes[memoryId] || []).length) ? 'visible' : ''}" data-memory-id="${memoryId}">
                        ${(state.selectedErrorCodes[memoryId] || []).map(code => `<span class="error-code-selected-pill">${code} /</span>`).join('')}
                    </div>` : ''}
                    <div class="memory-comment-input-wrapper">
                        <textarea class="memory-comment-input" data-index="${index}" data-memory-id="${memoryId}" placeholder="Add your comment..." rows="3" style="color: #000 !important;"></textarea>
                        <button class="memory-comment-submit-btn" data-index="${index}" data-memory-id="${memoryId}" aria-label="Submit feedback">
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                                <path d="M15.854 7.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708-.708L14.293 8.5H.5a.5.5 0 0 1 0-1h13.793L8.146.354a.5.5 0 1 1 .708-.708l7 7z"/>
                            </svg>
                        </button>
                    </div>
                </div>
            </div>
        `;

        memoryList.innerHTML = detailHTML;

        // Setup scroll indicator
        if (memoryDisplay.callbacks.setupDetailViewScrollIndicator) {
            setTimeout(() => {
                memoryDisplay.callbacks.setupDetailViewScrollIndicator();
            }, 100);
        }

        // Back button
        const backBtn = memoryList.querySelector('.back-btn');
        backBtn.addEventListener('click', () => {
            // Save error code grid scroll position before going back to list view
            const detailErrorGrid = memoryList.querySelector('.error-code-grid');
            if (detailErrorGrid) {
                state.errorCodeScrollPositions[memoryId] = detailErrorGrid.scrollLeft;
            }

            // Use forceDisplay to bypass typed feedback check, and skip self-ref filtering because list is already filtered
            memoryDisplay.display(state.currentMemories, mode, null, { forceDisplay: true, skipSelfRefFilter: true });

            if (savedScrollPosition) {
                setTimeout(() => {
                    const memoryListEl = state.overlayElement.querySelector('.memory-list');
                    if (!memoryListEl) return;

                    if (!currentMemoryListSignature || savedScrollPosition.listSignature !== currentMemoryListSignature) {
                        memoryListEl.scrollTop = 0;
                        savedScrollPosition = null;
                        return;
                    }

                    const targetCard = memoryListEl.querySelector(`.memory-card[data-memory-id="${savedScrollPosition.memoryId}"]`);
                    if (!targetCard) {
                        memoryListEl.scrollTop = 0;
                        savedScrollPosition = null;
                        return;
                    }

                    const containerRect = memoryListEl.getBoundingClientRect();
                    if (!containerRect.height || containerRect.height <= 0) {
                        savedScrollPosition = null;
                        return;
                    }

                    const targetY = savedScrollPosition.fractionalY * containerRect.height;
                    const cardRect = targetCard.getBoundingClientRect();
                    const cardPositionInContent = cardRect.top - containerRect.top + memoryListEl.scrollTop;
                    const newScrollTop = cardPositionInContent - targetY;

                    memoryListEl.scrollTop = Math.max(0, newScrollTop);
                    savedScrollPosition = null;
                }, 0);
            }
        });

        // Source icon click in detail view (Gmail + Browser)
        const detailSourceIcon = memoryList.querySelector('.memory-detail-view .source-icon');
        if (detailSourceIcon) {
            detailSourceIcon.addEventListener('click', (e) => {
                if (isGmailSource(memory?.source)) {
                    const threadUrl = getGmailThreadUrlFromMemoryId(memoryId);
                    if (threadUrl) {
                        e.stopPropagation();
                        window.open(threadUrl, '_blank', 'noopener,noreferrer');
                    }
                } else if (isBrowserSource(memory?.source)) {
                    const url = getBrowserSourceUrl(memory);
                    if (url) {
                        e.stopPropagation();
                        window.open(url, '_blank', 'noopener,noreferrer');
                    }
                }
            });
            if (isGmailSource(memory?.source) || getBrowserSourceUrl(memory)) {
                detailSourceIcon.style.cursor = 'pointer';
            }
        }

        // Rating buttons
        memoryList.querySelectorAll('.rating-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const rating = parseInt(btn.dataset.rating);
                feedback.handleMemoryRating(memoryId, index, rating);
                const detailCommentPanel = memoryList.querySelector('.memory-comment-panel');
                if (detailCommentPanel && !detailCommentPanel.classList.contains('show')) {
                    detailCommentPanel.classList.add('show');
                }
            });
        });

        // Comment button
        const commentBtn = memoryList.querySelector('.comment-btn');
        if (commentBtn) {
            commentBtn.addEventListener('click', () => {
                const commentPanel = memoryList.querySelector('.memory-comment-panel');
                if (commentPanel) {
                    commentPanel.classList.toggle('show');
                }
            });
        }

        // Comment input
        const commentInput = memoryList.querySelector('.memory-comment-input');
        if (commentInput) {
            commentInput.addEventListener('input', (e) => {
                const trimmed = e.target.value.trim();
                if (trimmed) {
                    state.memoryComments[memoryId] = trimmed;
                } else {
                    delete state.memoryComments[memoryId];
                }
                delete state.submittedMemoryComments[memoryId];
                feedback.updateSubmitButtonState();
                // Remove submitted tint if text is cleared
                if (!trimmed) {
                    commentInput.classList.remove('submitted');
                }
            });

            commentInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    feedback.submit();
                }
            });

            if (state.memoryComments[memoryId]) {
                commentInput.value = state.memoryComments[memoryId];
                if (state.submittedMemoryComments[memoryId]) {
                    commentInput.classList.add('submitted');
                }
            }
        }

        const detailCommentPanel = memoryList.querySelector('.memory-comment-panel');
        const hasComment = Boolean(state.memoryComments[memoryId]);
        const hasErrorCodes = Array.isArray(state.selectedErrorCodes[memoryId]) && state.selectedErrorCodes[memoryId].length > 0;
        if (detailCommentPanel && (hasComment || hasErrorCodes)) {
            detailCommentPanel.classList.add('show');
        }

        // Comment submit button
        const commentSubmitBtn = memoryList.querySelector('.memory-comment-submit-btn');
        if (commentSubmitBtn) {
            commentSubmitBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                feedback.submit();
            });
        }

        // Error code buttons (detail view)
        memoryList.querySelectorAll('.error-code-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const btnMemoryId = btn.dataset.memoryId;
                const code = btn.dataset.code;

                const selectedCodes = state.selectedErrorCodes[btnMemoryId] || [];
                const codeIndex = selectedCodes.indexOf(code);
                if (codeIndex >= 0) {
                    selectedCodes.splice(codeIndex, 1);
                } else {
                    selectedCodes.push(code);
                }
                if (selectedCodes.length) {
                    state.selectedErrorCodes[btnMemoryId] = selectedCodes;
                } else {
                    delete state.selectedErrorCodes[btnMemoryId];
                }

                syncErrorCodeUI(memoryList, btnMemoryId);
                feedback.updateSubmitButtonState();
            });
        });

        // Enable wheel-to-horizontal scrolling for error code grid and selected codes in detail view
        memoryList.querySelectorAll('.error-code-grid').forEach(enableHorizontalWheelScroll);
        memoryList.querySelectorAll('.error-code-selected').forEach(container => {
            enableHorizontalWheelScroll(container);
            container.scrollLeft = container.scrollWidth;
        });

        // Restore error code grid scroll position in detail view
        const detailErrorGrid = memoryList.querySelector('.error-code-grid');
        if (detailErrorGrid && state.errorCodeScrollPositions[memoryId] !== undefined) {
            setTimeout(() => {
                detailErrorGrid.scrollLeft = state.errorCodeScrollPositions[memoryId];
            }, 0);
        }

        // Copy button
        const copyBtn = memoryList.querySelector('.copy-btn');
        if (copyBtn) {
            copyBtn.addEventListener('click', async () => {
                try {
                    await navigator.clipboard.writeText(narrative);
                    const originalHTML = copyBtn.innerHTML;
                    copyBtn.innerHTML = `
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
                            <path d="M13.854 3.646L6 11.5l-3.5-3.5"/>
                        </svg>
                    `;
                    copyBtn.style.color = '#10b981';

                    setTimeout(() => {
                        copyBtn.innerHTML = originalHTML;
                        copyBtn.style.color = '';
                    }, 2000);
                } catch (err) {
                    console.error('❌ Failed to copy:', err);
                    if (memoryDisplay.callbacks.showFeedback) {
                        memoryDisplay.callbacks.showFeedback('Failed to copy', 'error');
                    }
                }
            });
        }

        // Use memory button
        const useMemoryBtn = memoryList.querySelector('.use-memory-btn');
        if (useMemoryBtn && memoryDisplay.callbacks.insertMemory) {
            useMemoryBtn.addEventListener('click', () => {
                memoryDisplay.callbacks.insertMemory(narrative);
                setTimeout(() => {
                    memoryDisplay.display(state.currentMemories, mode);
                }, 500);
            });
        }
    };

    // Export memoryDisplay to namespace
    window.Engramme.memoryDisplay = memoryDisplay;

})();
