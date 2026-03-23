// Firestore service for submitting feedback
// Uses Firestore REST API since we can't use Firebase SDK in service workers

// Note: This file is loaded by background.js which imports environments.js
// We'll use dynamic values from the current environment

async function getFirestoreConfig() {
  const env = await getCurrentEnvironment();
  return {
    projectId: env.firebase.projectId,
    apiKey: env.firebase.apiKey,
    baseUrl: `https://firestore.googleapis.com/v1/projects/${env.firebase.projectId}/databases/(default)/documents`
  };
}

/**
 * Submit feedback to Firestore
 * @param {string} userId - User ID (email or extension user ID)
 * @param {string} contextId - Email/context ID (subject line hash or unique ID)
 * @param {string} contextText - The email text that was searched
 * @param {Array} memories - Array of memory objects with ratings
 * @param {string} globalRating - Overall rating: 'thumbs_up', 'thumbs_down', or 'neutral'
 * @param {string} feedbackText - Optional text feedback
 * @returns {Promise<Object>} Response from Firestore
 */
async function submitFeedbackToFirestore(userId, contextId, contextText, memories, globalRating = 'neutral', feedbackText = '') {
  try {
    // Get Firestore config based on current environment
    const config = await getFirestoreConfig();

    // Prepare the document data
    const documentData = {
      fields: {
        userId: { stringValue: userId },
        contextId: { stringValue: contextId },
        contextText: { stringValue: contextText.substring(0, 500) }, // Limit to 500 chars
        globalRating: { stringValue: globalRating },
        feedbackText: { stringValue: feedbackText || '' },
        source: { stringValue: 'gmail_extension' },
        createdAt: { timestampValue: new Date().toISOString() },
        updatedAt: { timestampValue: new Date().toISOString() },
        memories: {
          arrayValue: {
            values: memories.map(memory => ({
              mapValue: {
                fields: {
                  narrative: { stringValue: memory.narrative || '' },
                  rating: { integerValue: memory.rating || 0 }, // 1, -1, or 0
                  similarity: { doubleValue: memory.similarity || 0 },
                  when: { stringValue: memory.when || '' },
                  where: { stringValue: memory.where || '' },
                  participants: {
                    arrayValue: {
                      values: (memory.participants || []).map(p => ({ stringValue: p }))
                    }
                  },
                  tags: {
                    arrayValue: {
                      values: (memory.tags || []).map(t => ({ stringValue: t }))
                    }
                  }
                }
              }
            }))
          }
        }
      }
    };

    // Make POST request to Firestore REST API
    const url = `${config.baseUrl}/gmail_feedback?key=${config.apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(documentData)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Firestore error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    console.log('✅ Feedback submitted to Firestore:', result.name);

    return {
      success: true,
      documentId: result.name.split('/').pop()
    };

  } catch (error) {
    console.error('❌ Error submitting feedback to Firestore:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Generate a unique context ID from email content
 * @param {string} subject - Email subject
 * @param {string} body - Email body preview
 * @returns {string} Hash-based context ID
 */
function generateContextId(subject, body) {
  // Simple hash function for generating consistent IDs
  const text = `${subject}_${body.substring(0, 100)}`;
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return `gmail_${Date.now()}_${Math.abs(hash).toString(36)}`;
}

// Export for use in background script
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    submitFeedbackToFirestore,
    generateContextId
  };
}
