// feedback-tracker.js - Feedback count tracker via backend API
// Fetches likes/dislikes from /api/user/feedback-count
// Depends on: core/state.js

(function() {
    'use strict';

    const feedbackTracker = {};

    let _likes = 0;
    let _dislikes = 0;
    let _total = 0;
    let _loaded = false;

    feedbackTracker.load = function() {
        return new Promise((resolve) => {
            try {
                chrome.runtime.sendMessage({ action: 'getFeedbackCount' }, (response) => {
                    if (chrome.runtime.lastError) {
                        _loaded = true;
                        resolve();
                        return;
                    }
                    if (response && response.success) {
                        _likes = response.likes || 0;
                        _dislikes = response.dislikes || 0;
                        _total = response.total || 0;
                    }
                    _loaded = true;
                    resolve();
                });
            } catch (e) {
                _loaded = true;
                resolve();
            }
        });
    };

    // After a local rating, optimistically bump the count and update UI immediately
    feedbackTracker.recordFeedback = async function(memoryId, queryText, rating) {
        if (rating === 1) _likes++;
        else if (rating === -1) _dislikes++;
        _total++;

        // Update UI immediately with optimistic counts
        if (window.Engramme.overlay && window.Engramme.overlay.updateFeedbackStats) {
            window.Engramme.overlay.updateFeedbackStats();
        }

        // Re-sync from backend after a delay to let the submission land
        setTimeout(() => {
            try {
                chrome.runtime.sendMessage({ action: 'getFeedbackCount' }, (response) => {
                    if (chrome.runtime.lastError) return;
                    if (response && response.success) {
                        _likes = response.likes || 0;
                        _dislikes = response.dislikes || 0;
                        _total = response.total || 0;
                        if (window.Engramme.overlay && window.Engramme.overlay.updateFeedbackStats) {
                            window.Engramme.overlay.updateFeedbackStats();
                        }
                    }
                });
            } catch (e) {
                // ignore
            }
        }, 3000);
    };

    Object.defineProperty(feedbackTracker, 'totalLikes', { get: () => _likes });
    Object.defineProperty(feedbackTracker, 'totalDislikes', { get: () => _dislikes });
    Object.defineProperty(feedbackTracker, 'totalFeedbackCount', { get: () => _total });
    Object.defineProperty(feedbackTracker, 'isLoaded', { get: () => _loaded });

    feedbackTracker.load();

    window.Engramme.feedbackTracker = feedbackTracker;
})();
