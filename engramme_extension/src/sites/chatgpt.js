// chatgpt.js - ChatGPT content extraction and MTE monitoring
// Sends only the most recent Q&A pair for memory recall

(function() {
    'use strict';

    const chatgpt = {};

    // MTE tracking state
    let lastProcessedPairCount = 0;
    let isMonitoring = false;
    let checkInterval = null;
    let pendingPairCheck = null;
    let lastAssistantLength = 0;

    /**
     * Check if we're on ChatGPT
     */
    chatgpt.shouldExtract = function() {
        const hostname = window.location.hostname;
        return hostname.includes('chat.openai.com') || hostname.includes('chatgpt.com');
    };

    /**
     * Get all message elements from the conversation
     */
    function getMessageElements() {
        // ChatGPT uses different selectors - try multiple
        const selectors = [
            '[data-message-author-role]',
            '.group\\/conversation-turn',
            '[class*="agent-turn"]',
            '[class*="user-turn"]'
        ];

        for (const selector of selectors) {
            const elements = document.querySelectorAll(selector);
            if (elements.length > 0) {
                return Array.from(elements);
            }
        }

        // Fallback: look for the flex container you mentioned
        const flexContainers = document.querySelectorAll('.flex.max-w-full.flex-col.grow');
        if (flexContainers.length > 0) {
            return Array.from(flexContainers);
        }

        return [];
    }

    /**
     * Extract text from a message element
     */
    function getMessageText(element) {
        // Try to get the markdown content
        const markdown = element.querySelector('.markdown, .prose, [class*="markdown"]');
        if (markdown) {
            return markdown.innerText.trim();
        }
        return element.innerText.trim();
    }

    /**
     * Get message role (user or assistant)
     */
    function getMessageRole(element) {
        const role = element.getAttribute('data-message-author-role');
        if (role) return role;

        // Check class names
        const className = element.className || '';
        if (className.includes('user') || element.querySelector('[data-message-author-role="user"]')) {
            return 'user';
        }
        if (className.includes('assistant') || className.includes('agent') || element.querySelector('[data-message-author-role="assistant"]')) {
            return 'assistant';
        }

        return 'unknown';
    }

    /**
     * Get Q&A pairs from the conversation
     */
    function getQAPairs() {
        const messages = getMessageElements();
        const pairs = [];
        let currentPair = { user: null, assistant: null };

        for (const msg of messages) {
            const role = getMessageRole(msg);
            const text = getMessageText(msg);

            if (!text || text.length < 5) continue;

            if (role === 'user') {
                // Start a new pair
                if (currentPair.user && currentPair.assistant) {
                    pairs.push({ ...currentPair });
                }
                currentPair = { user: text, assistant: null };
            } else if (role === 'assistant' && currentPair.user) {
                currentPair.assistant = text;
            }
        }

        // Add last pair if complete
        if (currentPair.user && currentPair.assistant) {
            pairs.push(currentPair);
        }

        return pairs;
    }

    /**
     * Get the most recent complete Q&A pair for memory recall
     */
    chatgpt.getContent = function() {
        const pairs = getQAPairs();

        if (pairs.length === 0) {
            return '';
        }

        // Get the last (most recent) pair with labels and separators
        const lastPair = pairs[pairs.length - 1];
        const content = `QA: US: ${lastPair.user} | AS: ${lastPair.assistant}`;

        return content;
    };

    /**
     * Get all content (for debugging)
     */
    chatgpt.getAllContent = function() {
        const pairs = getQAPairs();
        return pairs.map((p, i) => `[Pair ${i + 1}]\nUser: ${p.user}\nAssistant: ${p.assistant}`).join('\n\n---\n\n');
    };

    /**
     * Check if response is still streaming (content changing)
     */
    function isResponseStreaming() {
        const pairs = getQAPairs();
        if (pairs.length === 0) return false;

        const lastPair = pairs[pairs.length - 1];
        const currentLength = lastPair.assistant?.length || 0;

        if (currentLength !== lastAssistantLength) {
            lastAssistantLength = currentLength;
            return true;
        }
        return false;
    }

    /**
     * Check if there's a new complete Q&A pair (after streaming finished)
     */
    function checkForNewPair() {
        const pairs = getQAPairs();
        const currentPairCount = pairs.length;

        // New pair detected
        if (currentPairCount > lastProcessedPairCount) {
            // Wait for streaming to finish
            if (pendingPairCheck) clearTimeout(pendingPairCheck);

            pendingPairCheck = setTimeout(() => {
                // Check if still streaming
                if (isResponseStreaming()) {
                    checkForNewPair();
                    return;
                }

                // Double-check streaming stopped (wait 1 more second)
                setTimeout(() => {
                    if (isResponseStreaming()) {
                        checkForNewPair();
                        return;
                    }

                    lastProcessedPairCount = currentPairCount;
                    triggerMTE('new Q&A pair');
                }, 1000);
            }, 500);
        }
    }

    /**
     * Trigger memory recall with current content
     */
    function triggerMTE(reason) {
        const content = chatgpt.getContent();
        if (!content || content.length < 10) {
            return;
        }


        // Trigger memory refresh
        const memoryRefresh = window.Engramme?.memoryRefresh;
        if (memoryRefresh && memoryRefresh.updateForGenericPage) {
            memoryRefresh.updateForGenericPage();
        }
    }

    /**
     * Start monitoring for new Q&A pairs
     */
    chatgpt.startMonitoring = function() {
        if (isMonitoring) return;
        if (!chatgpt.shouldExtract()) return;

        isMonitoring = true;

        // Initialize state
        const pairs = getQAPairs();
        lastProcessedPairCount = pairs.length;

        // Set up MutationObserver to detect new messages
        const container = document.querySelector('main') || document.body;
        const observer = new MutationObserver(() => {
            // Debounce the check
            clearTimeout(chatgpt._checkTimeout);
            chatgpt._checkTimeout = setTimeout(checkForNewPair, 500);
        });

        observer.observe(container, {
            childList: true,
            subtree: true,
            characterData: true
        });

        chatgpt._observer = observer;

        // Also poll periodically as backup
        checkInterval = setInterval(checkForNewPair, 3000);

        // Initial MTE if there's content
        if (pairs.length > 0) {
            triggerMTE('initial load');
        }
    };

    /**
     * Stop monitoring
     */
    chatgpt.stopMonitoring = function() {
        if (!isMonitoring) return;

        isMonitoring = false;

        if (chatgpt._observer) {
            chatgpt._observer.disconnect();
            chatgpt._observer = null;
        }

        if (checkInterval) {
            clearInterval(checkInterval);
            checkInterval = null;
        }
    };

    /**
     * Check if monitoring is active
     */
    chatgpt.isMonitoring = function() {
        return isMonitoring;
    };

    /**
     * Get current pair count
     */
    chatgpt.getPairCount = function() {
        return getQAPairs().length;
    };

    // Export to namespace
    window.Engramme.chatgpt = chatgpt;

    // Auto-start monitoring if on ChatGPT
    if (chatgpt.shouldExtract()) {
        if (document.readyState === 'complete') {
            setTimeout(() => chatgpt.startMonitoring(), 1000);
        } else {
            window.addEventListener('load', () => {
                setTimeout(() => chatgpt.startMonitoring(), 1000);
            });
        }
    }

})();
