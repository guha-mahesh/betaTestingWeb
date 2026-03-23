// openai.js - OpenAI integration for AI-powered email improvement
// Handles API key management, email improvement, and memory insertion

(function() {
    'use strict';

    const state = window.Engramme.state;
    const overlay = window.Engramme.overlay;

    // API key loaded from storage
    const HARDCODED_KEY = '';

    // Get OpenAI API key from storage or use hardcoded fallback
    async function getKey() {
        return new Promise((resolve) => {
            chrome.storage.sync.get(['openaiApiKey'], (result) => {
                // Use stored key if available, otherwise use hardcoded key
                resolve(result.openaiApiKey || HARDCODED_KEY);
            });
        });
    }

    // Show inline spinner in email body while processing
    function showInlineSpinner(bodyDiv) {
        const spinner = document.createElement('div');
        spinner.className = 'engramme-inline-spinner';
        spinner.innerHTML = `
            <style>
                .engramme-inline-spinner {
                    display: inline-flex;
                    align-items: center;
                    gap: 8px;
                    padding: 8px 12px;
                    background: #f0f0f0;
                    border-radius: 6px;
                    font-size: 13px;
                    color: #666;
                    margin: 8px 0;
                }
                .engramme-spinner-dot {
                    width: 6px;
                    height: 6px;
                    background: #666;
                    border-radius: 50%;
                    animation: engramme-bounce 1.4s infinite ease-in-out both;
                }
                .engramme-spinner-dot:nth-child(1) {
                    animation-delay: -0.32s;
                }
                .engramme-spinner-dot:nth-child(2) {
                    animation-delay: -0.16s;
                }
                @keyframes engramme-bounce {
                    0%, 80%, 100% {
                        transform: scale(0);
                        opacity: 0.5;
                    }
                    40% {
                        transform: scale(1);
                        opacity: 1;
                    }
                }
            </style>
            <div class="engramme-spinner-dot"></div>
            <div class="engramme-spinner-dot"></div>
            <div class="engramme-spinner-dot"></div>
            <span>Recalling memories...</span>
        `;

        bodyDiv.appendChild(spinner);
        return spinner;
    }

    // Call OpenAI to improve email text with memory content
    async function improveEmail(currentEmailText, memoryContent) {

        const apiKey = await getKey();
        if (!apiKey) {
            console.error('❌ No OpenAI API key found. Please set it in extension settings.');
            overlay.showToast('⚠️ OpenAI API key not configured', 'error');
            return null;
        }

        // ====== PROMPT CONFIGURATION ======
        const systemPrompt = `You are an AI assistant helping to improve email composition based on memories I am providing to you.

Your task is to modify the email to add relevant details from the memories I am providing. 
Maintaining the original intent and tone of the email, and if you are unsure how to use the memory, do not make a change and just return the original email content.
Be very concise.

CRITICAL: Return ONLY the plain email text. Do NOT wrap it in quotes ("""), markdown code blocks, or any other formatting. Just the raw email text.`;

        const userPrompt = `Here is the current version of my email draft:
${currentEmailText}

And I would like include the following memories into the email I have given above:
${memoryContent}

Rewrite the email to naturally incorporate this memory. Return only the plain email text with no quotes, formatting, or markdown.`;
        // ====== END PROMPT CONFIGURATION ======

        try {
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: 'gpt-4',
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt }
                    ],
                    temperature: 0.7,
                    max_tokens: 1000
                })
            });

            if (!response.ok) {
                const error = await response.json();
                console.error('❌ OpenAI API error:', error);
                overlay.showToast('⚠️ OpenAI API error: ' + (error.error?.message || 'Unknown error'), 'error');
                return null;
            }

            const data = await response.json();
            const improvedText = data.choices[0].message.content.trim();

            return improvedText;

        } catch (error) {
            console.error('❌ Error calling OpenAI:', error);
            overlay.showToast('⚠️ Error connecting to OpenAI', 'error');
            return null;
        }
    }

    // Insert memory content into email compose, using AI to integrate it
    async function insertMemory(content) {
        if (!state.currentComposeElement) {
            return;
        }

        const bodySelectors = [
            'div[role="textbox"]',
            '.Am.Al.editable',
            'div[contenteditable="true"]'
        ];

        let bodyDiv = null;
        for (const selector of bodySelectors) {
            bodyDiv = state.currentComposeElement.querySelector(selector);
            if (bodyDiv && bodyDiv.isContentEditable) break;
        }

        if (!bodyDiv) {
            return;
        }


        // Get current email text
        const currentEmailText = bodyDiv.innerText || bodyDiv.textContent || '';

        // Show inline spinner in the email body
        const spinner = showInlineSpinner(bodyDiv);

        // Call OpenAI to improve the email
        const improvedText = await improveEmail(currentEmailText, content);

        // Remove spinner
        if (spinner && spinner.parentNode) {
            spinner.parentNode.removeChild(spinner);
        }

        if (!improvedText) {
            // If OpenAI fails, fall back to simple insertion
            const separator = currentEmailText.trim() ? '\n\n' : '';
            bodyDiv.innerHTML = bodyDiv.innerHTML + separator + content;
            overlay.showToast('⚠️ AI unavailable', 'warning');
        } else {
            // Replace email content with improved version
            bodyDiv.innerHTML = improvedText.replace(/\n/g, '<br>');
            overlay.showToast('✓ Done', 'success');
        }

        bodyDiv.focus();

        const inputEvent = new Event('input', { bubbles: true });
        bodyDiv.dispatchEvent(inputEvent);

    }

    // Expose to namespace
    window.Engramme.openai = {
        getKey,
        improveEmail,
        insertMemory,
        showInlineSpinner
    };

})();

