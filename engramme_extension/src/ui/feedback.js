// feedback.js - Feedback system for memory ratings and comments
// Handles thumbs up/down, comments, and submission to backend
// Depends on: core/state.js, extraction/gmail.js

(function() {
    'use strict';

    const feedback = {};
    const state = window.Engramme.state;
    const gmail = window.Engramme.gmail;
    const extractors = window.Engramme.extractors;

    // Callbacks for functions defined in content.js
    feedback.callbacks = {
        getEffectiveMode: null,
        showFeedback: null,
        dismissFeedback: null,
        isEmailPage: false,
        emailModule: null
    };

    /**
     * Register callbacks and config from content.js
     * @param {Object} callbacks - Object with callback functions
     */
    feedback.registerCallbacks = function(callbacks) {
        Object.assign(feedback.callbacks, callbacks);
    };

    function getErrorCodeSignature(codes) {
        if (!Array.isArray(codes) || codes.length === 0) return '';
        return [...codes].sort().join('|');
    }

    function hasSelectedErrorCodes() {
        return Object.values(state.selectedErrorCodes).some(codes => Array.isArray(codes) && codes.length > 0);
    }

    function hasPendingErrorCodeSelections() {
        return Object.entries(state.selectedErrorCodes).some(([memoryId, codes]) => {
            const currentSignature = getErrorCodeSignature(codes);
            if (!currentSignature) return false;
            return currentSignature !== getErrorCodeSignature(state.submittedMemoryErrorCodes[memoryId]);
        });
    }

    /**
     * Check if there's any feedback to submit
     * @returns {boolean} True if feedback exists
     */
    feedback.hasFeedback = function() {
        if (state.globalRating !== null) return true;

        const globalFeedbackTextarea = state.overlayElement?.querySelector('.global-feedback-text');
        if (globalFeedbackTextarea && globalFeedbackTextarea.value.trim()) return true;

        if (Object.keys(state.memoryRatings).some(key => state.memoryRatings[key] !== 0)) return true;

        if (Object.keys(state.memoryComments).some(key => state.memoryComments[key])) return true;

        if (hasSelectedErrorCodes()) return true;

        return false;
    };

    /**
     * Check if there's unsaved feedback that would be lost on refresh
     * @returns {boolean} True if typed feedback exists
     */
    feedback.hasTypedFeedback = function() {
        const globalFeedbackTextarea = state.overlayElement?.querySelector('.global-feedback-text');
        if (globalFeedbackTextarea &&
            globalFeedbackTextarea.value.trim() &&
            !globalFeedbackTextarea.classList.contains('submitted')) {
            return true;
        }

        // Check native DOM comment inputs (fallback rendering)
        const commentInputs = state.overlayElement?.querySelectorAll('.memory-comment-input');
        if (commentInputs) {
            for (const input of commentInputs) {
                if (input.value.trim() && !input.classList.contains('submitted')) return true;
            }
        }

        // Shared-card drafts are tracked in state because the inputs live inside an iframe.
        // Submitted comments should not block later recall refreshes.
        if (Object.entries(state.memoryComments).some(([memoryId, comment]) => {
            return comment && comment.trim() && !state.submittedMemoryComments[memoryId];
        })) {
            return true;
        }

        if (hasPendingErrorCodeSelections()) return true;

        return false;
    };

    /**
     * Update submit button visual state
     */
    feedback.updateSubmitButtonState = function() {
        const submitBtn = state.overlayElement?.querySelector('.submit-feedback-btn');
        const submitContainer = state.overlayElement?.querySelector('.submit-feedback-container');

        if (submitBtn && submitContainer) {
            if (feedback.hasFeedback()) {
                submitBtn.classList.add('has-feedback');
                submitContainer.classList.add('visible');
            } else {
                submitBtn.classList.remove('has-feedback');
                submitContainer.classList.remove('visible');
            }
        }
    };

    /**
     * Update thumb visual states - show ALL clicked thumbs as active
     */
    feedback.updateThumbVisualStates = function() {
        const allThumbButtons = state.overlayElement?.querySelectorAll('.thumbs-up, .thumbs-down, .global-rating-btn');
        if (allThumbButtons) {
            allThumbButtons.forEach(btn => btn.classList.remove('active'));
        }

        if (state.globalRating !== null) {
            const globalButtons = state.overlayElement?.querySelectorAll('.memory-header .global-rating-btn');
            if (globalButtons) {
                globalButtons.forEach(btn => {
                    const btnRating = parseInt(btn.dataset.rating);
                    if (btnRating === state.globalRating) {
                        btn.classList.add('active');
                    }
                });
            }
        }

        const allMemoryCards = state.overlayElement?.querySelectorAll('.memory-card');
        if (allMemoryCards) {
            allMemoryCards.forEach(card => {
                const index = parseInt(card.dataset.index);
                const memory = state.currentMemories[index];
                if (memory) {
                    const memoryId = memory.event_id || `temp_${index}`;
                    const rating = state.memoryRatings[memoryId];

                    if (rating === 1) {
                        const thumbBtn = card.querySelector('.thumbs-up');
                        if (thumbBtn) thumbBtn.classList.add('active');
                    } else if (rating === -1) {
                        const thumbBtn = card.querySelector('.thumbs-down');
                        if (thumbBtn) thumbBtn.classList.add('active');
                    }
                }
            });
        }

        const detailView = state.overlayElement?.querySelector('.memory-detail-view');
        if (detailView && detailView.dataset.memoryId) {
            const memoryId = detailView.dataset.memoryId;
            const rating = state.memoryRatings[memoryId];

            if (rating === 1) {
                const thumbBtn = detailView.querySelector('.thumbs-up');
                if (thumbBtn) thumbBtn.classList.add('active');
            } else if (rating === -1) {
                const thumbBtn = detailView.querySelector('.thumbs-down');
                if (thumbBtn) thumbBtn.classList.add('active');
            }
        }
    };

    /**
     * Handle global rating
     * @param {number} rating - 1 for thumbs up, -1 for thumbs down
     */
    feedback.handleGlobalRating = async function(rating) {
        // If clicking the same rating again, unrate (clear selection)
        if (state.globalRating === rating) {
            state.globalRating = null;
            state.mostRecentThumb = null;
            feedback.updateThumbVisualStates();
            feedback.updateSubmitButtonState();
            // Don't submit when unrating
            return;
        }

        state.globalRating = rating;
        state.mostRecentThumb = { type: 'global', memoryId: null, rating: rating };

        feedback.updateThumbVisualStates();
        feedback.updateSubmitButtonState();

        await feedback.submit({ type: 'global', memoryId: null, rating: rating }, true);
    };

    /**
     * Handle memory rating
     * @param {string} memoryId - Memory ID
     * @param {number} index - Memory index
     * @param {number} rating - 1 for thumbs up, -1 for thumbs down
     */
    feedback.handleMemoryRating = async function(memoryId, index, rating) {
        // If clicking the same rating again, unrate (clear selection)
        if (state.memoryRatings[memoryId] === rating) {
            delete state.memoryRatings[memoryId];
            state.mostRecentThumb = null;
            feedback.updateThumbVisualStates();
            feedback.updateSubmitButtonState();
            // Don't submit when unrating
            return;
        }

        state.memoryRatings[memoryId] = rating;
        state.mostRecentThumb = { type: 'memory', memoryId: memoryId, rating: rating };

        feedback.updateThumbVisualStates();
        feedback.updateSubmitButtonState();

        await feedback.submit({ type: 'memory', memoryId: memoryId, rating: rating }, false);
    };

    /**
     * Submit feedback to Cloud Run backend
     * @param {Object} ratingClicked - { type: 'global' | 'memory', memoryId: string | null, rating: 1 | -1 } or null
     * @param {boolean} showIndicator - Whether to show loading indicator
     */
    feedback.submit = async function(ratingClicked = null, showIndicator = false) {

        const globalFeedbackTextarea = state.overlayElement?.querySelector('.feedback-panel .global-feedback-text');
        const globalFeedbackText = globalFeedbackTextarea ? globalFeedbackTextarea.value.trim() : '';

        let loadingIndicator = null;
        if (showIndicator && feedback.callbacks.showFeedback) {
            loadingIndicator = feedback.callbacks.showFeedback('Submitting feedback...', 'loading');
        }

        try {
            let emailContent;
            if (feedback.callbacks.isEmailPage) {
                const mod = feedback.callbacks.emailModule || gmail;
                const effectiveMode = feedback.callbacks.getEffectiveMode ? feedback.callbacks.getEffectiveMode() : state.currentMode;
                emailContent = effectiveMode === 'compose' ? mod.getEmailContent() : mod.getViewedEmailContent();
                state.currentEmailSubject = emailContent.subject;
                if (effectiveMode === 'compose') {
                    const baseText = [
                        emailContent.subject ? `sb: ${emailContent.subject}` : '',
                        emailContent.body
                    ].filter(Boolean).join('\n').trim();
                    const extraParts = [];
                    if (emailContent.from) extraParts.push(`fr: ${emailContent.from}`);
                    if (emailContent.to && emailContent.to.length > 0) {
                        extraParts.push(`to: ${emailContent.to.join(', ')}`);
                    }
                    if (emailContent.cc && emailContent.cc.length > 0) {
                        extraParts.push(`cc: ${emailContent.cc.join(', ')}`);
                    }
                    if (emailContent.bcc && emailContent.bcc.length > 0) {
                        extraParts.push(`bc: ${emailContent.bcc.join(', ')}`);
                    }
                    if (emailContent.time) extraParts.push(`dt: ${emailContent.time}`);
                    state.currentEmailText = [...extraParts, baseText].filter(Boolean).join('\n').trim();
                } else {
                    state.currentEmailText = `sb: ${emailContent.subject}\n${emailContent.body}`;
                }
            } else {
                const pageContent = extractors.getGenericPageContent();
                state.currentEmailSubject = document.title || '';
                state.currentEmailText = pageContent;
            }

            // Include ALL accumulated ratings, not just the clicked one
            // Schema matches webapp: memory_id, rank, rating, comment, selected_error_codes, snapshot
            const memoriesWithFeedback = state.currentMemories.map((memory, index) => {
                const memoryId = memory.event_id || `temp_${index}`;
                // Demo mode hides error-code controls; do not submit hidden selections.
                const errorCodes = state.demoMode ? [] : (state.selectedErrorCodes[memoryId] || []);
                const rawComment = state.memoryComments[memoryId] || '';

                // Prepend all selected error codes to comment, separated by " / "
                const comment = errorCodes.length
                    ? `${errorCodes.join(' / ')}${rawComment ? ' / ' + rawComment : ''}`
                    : rawComment || null;

                // Build snapshot from memory content (excluding feedback/UI fields)
                const { event_id, rating: _r, comment: _c, selected_error_codes: _s, _isCanary, ...contentFields } = memory;

                return {
                    memory_id: memoryId,
                    rank: index + 1,
                    rating: state.memoryRatings[memoryId] ?? null,
                    comment: comment,
                    selected_error_codes: errorCodes.length ? errorCodes : undefined,
                    snapshot: {
                        ...contentFields,
                        similarity: memory.similarity || null,
                        source: memory.source || null,
                    }
                };
            });

            // Always include current global rating state
            const submittedGlobalRating = state.globalRating;

            const resolvedQueryText = state.lastQueryText.trim() ? state.lastQueryText : state.currentEmailText.trim();

            const feedbackMessage = {
                action: 'submitFeedback',
                emailText: resolvedQueryText,
                memories: memoriesWithFeedback,
                recallId: state.currentRecallId || null,
                globalRating: submittedGlobalRating,
                globalFeedbackText: globalFeedbackText,
                memoriesTimestamp: state.memoriesTimestamp || new Date().toISOString()
            };


            const response = await chrome.runtime.sendMessage(feedbackMessage);

            if (loadingIndicator && feedback.callbacks.dismissFeedback) {
                feedback.callbacks.dismissFeedback(loadingIndicator);
            }

            if (response.success) {
                if (feedback.callbacks.showFeedback) {
                    feedback.callbacks.showFeedback('✓ Feedback submitted', 'success');
                }
                // Update feedback tracker stats
                if (ratingClicked && window.Engramme.feedbackTracker) {
                    const queryText = state.lastQueryText || state.currentEmailText || '';
                    window.Engramme.feedbackTracker.recordFeedback(
                        ratingClicked.memoryId || 'global',
                        queryText,
                        ratingClicked.rating
                    );
                }
                // Don't clear comments - they persist until new memories are shown
                // Mark submitted comments and error-code selections so refresh protection
                // only applies to new unsaved changes.
                feedback.markSubmittedFeedback();
            } else {
                console.error('❌ Feedback submission failed:', response.error);
                if (feedback.callbacks.showFeedback) {
                    feedback.callbacks.showFeedback('⚠️ Failed to submit', 'error');
                }
            }

        } catch (error) {
            console.error('❌ Error submitting feedback:', error);

            if (loadingIndicator && feedback.callbacks.dismissFeedback) {
                feedback.callbacks.dismissFeedback(loadingIndicator);
            }

            if (feedback.callbacks.showFeedback) {
                feedback.callbacks.showFeedback('⚠️ Submission error', 'error');
            }
        }
    };

    /**
     * Mark persisted feedback state as submitted.
     */
    feedback.markSubmittedFeedback = function() {
        // Mark global feedback textarea if it has content
        const globalFeedbackTextarea = state.overlayElement?.querySelector('.global-feedback-text');
        if (globalFeedbackTextarea && globalFeedbackTextarea.value.trim()) {
            globalFeedbackTextarea.classList.add('submitted');
        }

        Object.entries(state.memoryComments).forEach(([memoryId, comment]) => {
            if (comment && comment.trim()) {
                state.submittedMemoryComments[memoryId] = true;
            } else {
                delete state.submittedMemoryComments[memoryId];
            }
        });

        // Mark memory comment inputs that have content
        const memoryCommentInputs = state.overlayElement?.querySelectorAll('.memory-comment-input');
        if (memoryCommentInputs) {
            memoryCommentInputs.forEach(input => {
                if (input.value.trim()) {
                    input.classList.add('submitted');
                }
            });
        }

        Object.entries(state.selectedErrorCodes).forEach(([memoryId, codes]) => {
            if (Array.isArray(codes) && codes.length > 0) {
                state.submittedMemoryErrorCodes[memoryId] = [...codes];
            }
        });
        Object.keys(state.submittedMemoryErrorCodes).forEach((memoryId) => {
            const currentCodes = state.selectedErrorCodes[memoryId];
            if (!Array.isArray(currentCodes) || currentCodes.length === 0) {
                delete state.submittedMemoryErrorCodes[memoryId];
            }
        });

    };

    /**
     * Clear all comment text (but keep thumb visual states)
     */
    feedback.clearAllComments = function() {
        state.memoryComments = {};
        state.submittedMemoryComments = {};

        const globalFeedbackTextarea = state.overlayElement?.querySelector('.feedback-panel .global-feedback-text');
        if (globalFeedbackTextarea) {
            globalFeedbackTextarea.value = '';
        }

        const memoryCommentInputs = state.overlayElement?.querySelectorAll('.memory-comment-input');
        if (memoryCommentInputs) {
            memoryCommentInputs.forEach(input => {
                input.value = '';
            });
        }

    };

    /**
     * Clear all feedback state
     */
    feedback.clearAll = function() {
        state.memoryRatings = {};
        state.memoryComments = {};
        state.submittedMemoryComments = {};
        state.submittedMemoryErrorCodes = {};
        state.memoryCommentPanelsOpen = {};
        state.globalRating = null;
        state.mostRecentThumb = null;
        state.selectedErrorCodes = {};
        state.errorCodeScrollPositions = {};

        const globalFeedbackTextarea = state.overlayElement?.querySelector('.global-feedback-text');
        if (globalFeedbackTextarea) {
            globalFeedbackTextarea.value = '';
            globalFeedbackTextarea.classList.remove('submitted');
        }

        const allRatingBtns = state.overlayElement?.querySelectorAll('.rating-btn');
        if (allRatingBtns) {
            allRatingBtns.forEach(btn => btn.classList.remove('active'));
        }

        const globalRatingBtns = state.overlayElement?.querySelectorAll('.global-rating-btn');
        if (globalRatingBtns) {
            globalRatingBtns.forEach(btn => btn.classList.remove('active'));
        }

        // Clear submitted class from all comment inputs
        const allCommentInputs = state.overlayElement?.querySelectorAll('.memory-comment-input');
        if (allCommentInputs) {
            allCommentInputs.forEach(input => input.classList.remove('submitted'));
        }

        // Clear error code button active states
        const allErrorCodeBtns = state.overlayElement?.querySelectorAll('.error-code-btn');
        if (allErrorCodeBtns) {
            allErrorCodeBtns.forEach(btn => btn.classList.remove('active'));
        }

        const errorCodeSelected = state.overlayElement?.querySelectorAll('.error-code-selected');
        if (errorCodeSelected) {
            errorCodeSelected.forEach(container => {
                container.innerHTML = '';
                container.classList.remove('visible');
            });
        }

        feedback.updateSubmitButtonState();

    };

    // Export feedback to namespace
    window.Engramme.feedback = feedback;

})();
