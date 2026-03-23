// chat.js - Chat mode for conversational memory queries
// Provides chat UI and message handling
// Depends on: core/state.js

(function() {
    'use strict';

    const chat = {};
    const state = window.Engramme.state;

    // Callbacks for functions defined in content.js
    chat.callbacks = {
        getEffectiveMode: null,
        updateMemorySuggestions: null,
        updateMemorySuggestionsForView: null,
        showEmptyState: null
    };

    /**
     * Register callbacks from content.js
     * @param {Object} callbacks - Object with callback functions
     */
    chat.registerCallbacks = function(callbacks) {
        Object.assign(chat.callbacks, callbacks);
    };

    /**
     * Toggle between chat mode and memory mode
     */
    chat.toggle = function() {
        state.isChatMode = !state.isChatMode;
        const chatToggleBtn = state.overlayElement?.querySelector('.chat-mode-toggle');

        if (state.isChatMode) {
            state.overlayElement?.classList.add('chat-mode');
            if (chatToggleBtn) chatToggleBtn.style.display = 'none';
            chat.render();
        } else {
            state.overlayElement?.classList.remove('chat-mode');
            if (chatToggleBtn) chatToggleBtn.style.display = 'flex';
            
            // Directly re-display current memories if available (avoids "query unchanged" skip)
            const memoryDisplay = window.Engramme.memoryDisplay;
            if (state.currentMemories && state.currentMemories.length > 0 && memoryDisplay) {
                const effectiveMode = chat.callbacks.getEffectiveMode ? chat.callbacks.getEffectiveMode() : state.currentMode;
                memoryDisplay.display(state.currentMemories, effectiveMode, null);
            } else if (chat.callbacks.showEmptyState) {
                chat.callbacks.showEmptyState();
            }
        }
    };

    /**
     * Render chat mode UI
     */
    chat.render = function() {
        if (!state.overlayElement) return;

        const memoryList = state.overlayElement.querySelector('.memory-list');
        if (!memoryList) return;

        let messagesHTML = '';
        if (state.chatMessages.length === 0) {
            messagesHTML = '<div class="chat-empty-state">Start a conversation about your memories...</div>';
        } else {
            messagesHTML = state.chatMessages.map((msg, index) => {
                const isUser = msg.role === 'user';
                const loadingClass = msg.isLoading ? ' loading' : '';
                return `
                    <div class="chat-message ${isUser ? 'user' : 'assistant'}${loadingClass}" data-index="${index}">
                        <div class="chat-message-content">${msg.content}</div>
                    </div>
                `;
            }).join('');
        }

        const chatHTML = `
            <div class="chat-container">
                <div class="chat-header">
                    <button class="chat-back-btn" aria-label="Back to memories">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M15 18l-6-6 6-6"/>
                        </svg>
                    </button>
                    <span class="chat-title">Chat</span>
                </div>
                <div class="chat-messages">
                    ${messagesHTML}
                </div>
                <div class="chat-input-container">
                    <input type="text" class="chat-input" placeholder="What's on your mind?" />
                    <button class="chat-submit-btn" aria-label="Send message">
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M2 10l16-8-8 16-2-8-6-0z"/>
                        </svg>
                    </button>
                </div>
            </div>
        `;

        memoryList.innerHTML = chatHTML;

        const chatBackBtn = memoryList.querySelector('.chat-back-btn');
        const chatInput = memoryList.querySelector('.chat-input');
        const chatSubmitBtn = memoryList.querySelector('.chat-submit-btn');

        if (chatBackBtn) {
            chatBackBtn.addEventListener('click', () => {
                chat.toggle();
            });
        }

        if (chatInput && chatSubmitBtn) {
            chatInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    chat.send(chatInput.value.trim());
                }
            });

            chatSubmitBtn.addEventListener('click', () => {
                chat.send(chatInput.value.trim());
            });

            chatInput.focus();
        }

        const chatMessagesContainer = memoryList.querySelector('.chat-messages');
        if (chatMessagesContainer) {
            chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
        }
    };

    /**
     * Send chat message and get response
     * @param {string} message - Message to send
     */
    chat.send = function(message) {
        if (!message) return;

        const memoryList = state.overlayElement?.querySelector('.memory-list');
        const chatInput = memoryList?.querySelector('.chat-input');

        state.chatMessages.push({
            role: 'user',
            content: message
        });

        if (chatInput) chatInput.value = '';

        chat.render();

        state.chatMessages.push({
            role: 'assistant',
            content: '<span class="typing-indicator"><span></span><span></span><span></span></span>',
            isLoading: true
        });
        chat.render();

        chrome.runtime.sendMessage({
            action: 'chatMemories',
            text: message
        }, (response) => {
            if (chrome.runtime.lastError) {
                console.error('❌ Chrome runtime error:', chrome.runtime.lastError);
                state.chatMessages[state.chatMessages.length - 1] = {
                    role: 'assistant',
                    content: '⚠️ Error connecting to chat service'
                };
            } else if (response && response.success) {
                state.chatMessages[state.chatMessages.length - 1] = {
                    role: 'assistant',
                    content: response.response || 'No response received.'
                };
            } else {
                state.chatMessages[state.chatMessages.length - 1] = {
                    role: 'assistant',
                    content: '⚠️ Error: ' + (response && response.error ? response.error : 'Unknown error')
                };
            }

            chat.render();
        });
    };

    // Export chat to namespace
    window.Engramme.chat = chat;

})();
