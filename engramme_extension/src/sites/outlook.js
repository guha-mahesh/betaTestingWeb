// outlook.js - Outlook site-specific behavior
// Detects compose windows, email views, and extracts content
// Mirrors gmail.js logic for outlook.office.com / outlook.live.com
// Depends on: core/state.js

(function() {
    'use strict';

    const outlook = {};
    const state = window.Engramme.state;
    const utils = window.Engramme.utils;

    // Callbacks registered by content.js for UI functions
    outlook.callbacks = {
        createOverlay: null,
        showEmptyState: null,
        clearAllFeedback: null,
        updateMemorySuggestionsForView: null,
        setActiveContext: null,
        adjustOverlayPosition: null,
        debouncedUpdateMemorySuggestions: null
    };

    outlook.registerCallbacks = function(callbacks) {
        Object.assign(outlook.callbacks, callbacks);
    };

    // --- Detection helpers ---

    outlook.isOutlookPage = function() {
        return utils.isOutlookHost(window.location.hostname);
    };

    outlook.isEmailViewUrl = function() {
        return window.location.pathname.includes('/id/');
    };

    outlook.isComposeUrl = function() {
        return window.location.pathname.includes('/compose/');
    };

    outlook.getReadingPane = function() {
        return document.querySelector('[role="main"][aria-label="Reading Pane"]');
    };

    // --- Observer ---

    outlook.startObserver = function() {
        if (state.observer) {
            state.observer.disconnect();
        }


        state.observer = new MutationObserver((mutations) => {
            let shouldCheckCompose = false;
            let shouldCheckView = false;

            mutations.forEach((mutation) => {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            const hasCompose = node.querySelector && (
                                node.querySelector('input[aria-label="Subject"]') ||
                                node.querySelector('[contenteditable="true"][aria-label="Message body"]') ||
                                (node.matches && node.matches('input[aria-label="Subject"]'))
                            );

                            const hasView = node.querySelector && (
                                node.querySelector('[role="document"]') ||
                                node.querySelector('[id$="_FROM"]') ||
                                (node.matches && node.matches('[role="document"]'))
                            );

                            if (hasCompose) shouldCheckCompose = true;
                            if (hasView) shouldCheckView = true;

                            if (shouldCheckCompose || shouldCheckView) break;
                        }
                    }
                }
            });

            if (shouldCheckCompose) {
                setTimeout(outlook.checkForComposeWindow, 100);
            }
            if (shouldCheckView) {
                setTimeout(outlook.checkForEmailView, 100);
            }
        });

        state.observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Initial checks
        setTimeout(() => {
            outlook.checkForComposeWindow();
            outlook.checkForEmailView();
        }, 1000);
    };

    // --- Compose detection ---

    outlook.checkForComposeWindow = function() {
        if (!utils.isExtensionValid()) return;

        try {
            const subjectInput = document.querySelector('input[aria-label="Subject"]');
            const bodyEditor = document.querySelector('[contenteditable="true"][aria-label="Message body"]');
            const composeContainer = bodyEditor
                ? (bodyEditor.closest('#docking_InitVisiblePart_0') || bodyEditor.closest('[id^="docking_"]') || bodyEditor.parentElement?.parentElement?.parentElement)
                : null;

            if (composeContainer && composeContainer !== state.currentComposeElement) {
                state.currentComposeElement = composeContainer;
                state.currentMode = 'compose';

                if (outlook.callbacks.setActiveContext) {
                    outlook.callbacks.setActiveContext('compose', 'compose-open');
                }

                outlook.setupComposeListeners();

                if (!state.overlayElement && outlook.callbacks.createOverlay) {
                    outlook.callbacks.createOverlay();
                }

                if (outlook.callbacks.adjustOverlayPosition) {
                    outlook.callbacks.adjustOverlayPosition();
                }

                // Trigger initial compose search
                if (outlook.callbacks.debouncedUpdateMemorySuggestions) {
                    outlook.callbacks.debouncedUpdateMemorySuggestions();
                }

            } else if (!composeContainer && state.currentComposeElement) {
                state.currentComposeElement = null;
                if (state.currentMode === 'compose') {
                    state.currentMode = null;
                    // Clear stale view query so next email view triggers a fresh recall
                    state.lastDisplayedQueryByMode.view = '';

                    const rp = outlook.getReadingPane();
                    const hasEmailView = !!state.currentViewElement ||
                                        !!(rp && rp.querySelector('[role="document"]'));

                    if (hasEmailView) {
                        state.activeContext = null;
                        if (outlook.callbacks.setActiveContext) {
                            outlook.callbacks.setActiveContext('view', 'compose-closed');
                        }
                        setTimeout(() => outlook.checkForEmailView(), 100);
                    } else if (outlook.callbacks.showEmptyState) {
                        outlook.callbacks.showEmptyState();
                    }
                }
            }
        } catch (e) {
            console.error('💥 Outlook: Error checking compose window:', e);
        }
    };

    // --- Email view detection ---

    outlook.checkForEmailView = function() {
        if (!utils.isExtensionValid()) return;

        try {
            const rp = outlook.getReadingPane();
            const bodyDoc = rp ? rp.querySelector('[role="document"]') : null;
            const subjectEl = rp ? rp.querySelector('[id*="CONV_"][id$="_SUBJECT"] span[title]') : null;

            const isInEmailView = bodyDoc || !!subjectEl;
            if (isInEmailView) {
                const newViewElement = bodyDoc || subjectEl;

                const isNewEmail = newViewElement !== state.previousViewElement;
                if (isNewEmail && state.previousViewElement !== null) {
                    if (outlook.callbacks.clearAllFeedback) {
                        outlook.callbacks.clearAllFeedback();
                    }
                }

                state.previousViewElement = newViewElement;
                state.currentViewElement = newViewElement;
                state.currentMode = 'view';

                if (!state.overlayElement && outlook.callbacks.createOverlay) {
                    outlook.callbacks.createOverlay();
                }

                if (outlook.callbacks.adjustOverlayPosition) {
                    outlook.callbacks.adjustOverlayPosition();
                }

                if (state.activeContext && state.activeContext !== 'view') {
                } else if (outlook.callbacks.updateMemorySuggestionsForView) {
                    outlook.callbacks.updateMemorySuggestionsForView();
                }

            } else if (state.currentMode === 'view' && !bodyDoc) {
                state.currentViewElement = null;
                state.previousViewElement = null;
                state.lastDisplayedQueryByMode.view = '';
                if (state.currentMode === 'view') {
                    state.currentMode = null;
                    if (outlook.callbacks.showEmptyState) {
                        outlook.callbacks.showEmptyState();
                    }
                }
            }
        } catch (e) {
            console.error('💥 Outlook: Error checking email view:', e);
        }
    };

    // --- Compose listeners ---

    outlook.setupComposeListeners = function() {
        if (!state.currentComposeElement) return;

        // Clear old listeners
        state.inputListeners.forEach(({ element, type, listener }) => {
            element.removeEventListener(type, listener);
        });
        state.inputListeners = [];

        const subjectInput = document.querySelector('input[aria-label="Subject"]');
        const bodyDiv = document.querySelector('[contenteditable="true"][aria-label="Message body"]');

        if (subjectInput && outlook.callbacks.debouncedUpdateMemorySuggestions) {
            const inputListener = () => outlook.callbacks.debouncedUpdateMemorySuggestions();
            subjectInput.addEventListener('input', inputListener);
            subjectInput.addEventListener('keyup', inputListener);
            state.inputListeners.push({ element: subjectInput, type: 'input', listener: inputListener });
            state.inputListeners.push({ element: subjectInput, type: 'keyup', listener: inputListener });
        }

        if (bodyDiv && outlook.callbacks.debouncedUpdateMemorySuggestions) {
            const bodyListener = () => outlook.callbacks.debouncedUpdateMemorySuggestions();
            bodyDiv.addEventListener('input', bodyListener);
            bodyDiv.addEventListener('keyup', bodyListener);
            bodyDiv.addEventListener('paste', () => setTimeout(outlook.callbacks.debouncedUpdateMemorySuggestions, 100));
            state.inputListeners.push({ element: bodyDiv, type: 'input', listener: bodyListener });
            state.inputListeners.push({ element: bodyDiv, type: 'keyup', listener: bodyListener });
        }
    };

    // --- Layout adjustment ---

    outlook.adjustLayout = function(sidebarVisible) {
        let sidebarWidth = 400;
        const overlayWidth = state.overlayElement ? state.overlayElement.offsetWidth : 0;
        if (overlayWidth > 0) {
            sidebarWidth = overlayWidth;
        }
        const margin = sidebarVisible ? `${sidebarWidth + 16}px` : '0px';

        const mainArea = document.querySelector('[role="main"][aria-label="Reading Pane"]') ||
                         document.querySelector('.Mq3cC') ||
                         document.querySelector('body');

        if (mainArea) {
            mainArea.style.marginRight = margin;
            mainArea.style.transition = 'margin-right 0.3s ease';
        }
    };

    // --- Content extraction helpers ---

    const addPersonToken = (nameSet, token) => {
        if (!token) return;
        const cleaned = token.replace(/\s+/g, ' ').trim();
        if (!cleaned) return;
        if (cleaned.includes('<') && cleaned.includes('>')) {
            const match = cleaned.match(/^(.*?)<([^>]+)>/);
            if (match) {
                addPersonToken(nameSet, match[1]);
                addPersonToken(nameSet, match[2]);
                return;
            }
        }
        if (cleaned.includes('@')) {
            const localPart = cleaned.split('@')[0]?.trim();
            if (localPart) nameSet.add(localPart);
            return;
        }
        nameSet.add(cleaned);
    };

    const addPeopleFromValue = (nameSet, value) => {
        if (!value) return;
        const parts = value.includes(',') || value.includes(';')
            ? value.split(/[;,]+/)
            : [value];
        parts.forEach(part => addPersonToken(nameSet, part));
    };

    /** Extract people names from an Outlook header element (To/CC/BCC) */
    const collectPeopleFromHeader = (headerEl) => {
        const nameSet = new Set();
        if (!headerEl) return [];
        // View mode: person buttons inside the header
        const personButtons = headerEl.querySelectorAll('span[role="button"]');
        personButtons.forEach(btn => {
            const ariaLabel = btn.getAttribute('aria-label') || '';
            // aria-label is like "Name" or "Name <email>"
            if (ariaLabel) addPeopleFromValue(nameSet, ariaLabel);
        });
        // Compose mode: recipient pills are span._EType_RECIPIENT_ENTITY
        const recipientPills = headerEl.querySelectorAll('span._EType_RECIPIENT_ENTITY');
        recipientPills.forEach(pill => {
            // Display name is in a child span with class containing "textContainer"
            const textEl = pill.querySelector('[class*="textContainer"]');
            const displayName = textEl?.textContent?.trim();
            if (displayName) {
                addPeopleFromValue(nameSet, displayName);
            } else {
                // Fallback: aria-label is "statusName" (e.g. "unknownHousing")
                // Strip known presence prefixes
                const ariaLabel = pill.getAttribute('aria-label') || '';
                const cleaned = ariaLabel.replace(/^(unknown|offline|online|away|busy|donotdisturb|berightback|appearoffline)/i, '');
                if (cleaned) addPeopleFromValue(nameSet, cleaned);
            }
        });
        // Fallback: aria-label on the container div e.g. "To: Name1; Name2"
        if (nameSet.size === 0) {
            const containerLabel = headerEl.querySelector('[aria-label]')?.getAttribute('aria-label') || '';
            const stripped = containerLabel.replace(/^(To|Cc|Bcc):\s*/i, '');
            if (stripped) addPeopleFromValue(nameSet, stripped);
        }
        return Array.from(nameSet);
    };

    /** Extract raw email addresses from an Outlook header element */
    const collectRawEmails = (headerEl) => {
        const emailSet = new Set();
        if (!headerEl) return [];
        // Check aria-labels and text for "Name <email>" patterns
        const allText = [];
        // View mode: span[role="button"]
        const personButtons = headerEl.querySelectorAll('span[role="button"]');
        personButtons.forEach(btn => {
            allText.push(btn.getAttribute('aria-label') || '');
            allText.push(btn.textContent || '');
        });
        // Compose mode: span._EType_RECIPIENT_ENTITY
        const recipientPills = headerEl.querySelectorAll('span._EType_RECIPIENT_ENTITY');
        recipientPills.forEach(pill => {
            allText.push(pill.getAttribute('aria-label') || '');
            allText.push(pill.textContent || '');
        });
        // Also check the container aria-label
        const containerDiv = headerEl.querySelector('[aria-label]');
        if (containerDiv) allText.push(containerDiv.getAttribute('aria-label') || '');
        // Also check plain text content for email patterns
        allText.push(headerEl.textContent || '');

        allText.forEach(text => {
            // Match "Name <email>" patterns
            const angleMatches = text.matchAll(/<([^>]+@[^>]+)>/g);
            for (const m of angleMatches) {
                emailSet.add(m[1].toLowerCase().trim());
            }
            // Match standalone email patterns
            const emailRegex = /[\w.+-]+@[\w.-]+\.\w{2,}/g;
            const emailMatches = text.matchAll(emailRegex);
            for (const m of emailMatches) {
                emailSet.add(m[0].toLowerCase().trim());
            }
        });
        return Array.from(emailSet);
    };

    // --- Get email subject ---

    outlook.getEmailSubject = function(effectiveMode) {
        if (effectiveMode === 'view') {
            const rp = outlook.getReadingPane();
            const subjectSpan = rp?.querySelector('[id*="CONV_"][id$="_SUBJECT"] span[title]');
            if (subjectSpan) return subjectSpan.getAttribute('title') || subjectSpan.textContent || 'Email';
        }

        if (effectiveMode === 'compose') {
            const subjectInput = document.querySelector('input[aria-label="Subject"]');
            if (subjectInput && subjectInput.value) return subjectInput.value;
        }

        return 'Email';
    };

    // --- Get viewed email content ---

    outlook.getViewedEmailContent = function() {
        const rp = outlook.getReadingPane();
        if (!rp) return { subject: '', body: '', recipients: [], participant_emails: [] };

        // Subject
        const subjectSpan = rp.querySelector('[id*="CONV_"][id$="_SUBJECT"] span[title]');
        const subject = subjectSpan?.getAttribute('title') || subjectSpan?.textContent || '';

        // Collect all messages in the conversation thread
        // Each message has MSG_xxx_FROM, MSG_xxx_TO, MSG_xxx_CC, MSG_xxx_DATETIME
        const fromEls = rp.querySelectorAll('[id$="_FROM"]');
        const msgIds = new Set();
        fromEls.forEach(el => {
            // Extract MSG_xxx from MSG_xxx_FROM
            const match = el.id.match(/^(MSG_[^_]+)/);
            if (match) msgIds.add(match[1]);
        });

        const messages = [];
        const allRecipientNames = new Set();
        const allEmails = new Set();
        const bodyDocs = rp.querySelectorAll('[role="document"]');
        const msgIdArray = Array.from(msgIds);

        msgIdArray.forEach((msgId, idx) => {
            const fromEl = rp.querySelector(`#${CSS.escape(msgId + '_FROM')}`);
            const toEl = rp.querySelector(`#${CSS.escape(msgId + '_TO')}`);
            const ccEl = rp.querySelector(`#${CSS.escape(msgId + '_CC')}`);
            const dtEl = rp.querySelector(`#${CSS.escape(msgId + '_DATETIME')}`);
            const bodyDoc = bodyDocs[idx];

            // Sender
            const senderButton = fromEl?.querySelector('[role="button"]');
            const senderLabel = senderButton?.getAttribute('aria-label')?.replace(/^From:\s*/i, '') || '';
            const senderText = fromEl?.textContent?.trim() || '';

            // Timestamp
            const timestampText = dtEl?.textContent?.trim() || '';

            // Body text
            let bodyText = bodyDoc?.innerText?.trim() || '';

            // Recipients
            collectPeopleFromHeader(toEl).forEach(n => allRecipientNames.add(n));
            collectPeopleFromHeader(ccEl).forEach(n => allRecipientNames.add(n));
            if (senderLabel) addPeopleFromValue(allRecipientNames, senderLabel);

            // Emails
            collectRawEmails(fromEl).forEach(e => allEmails.add(e));
            collectRawEmails(toEl).forEach(e => allEmails.add(e));
            collectRawEmails(ccEl).forEach(e => allEmails.add(e));

            // Build message with 2-char codes (same as Gmail)
            const metaParts = [];
            if (timestampText) metaParts.push(`dt: ${timestampText}`);
            if (bodyText) metaParts.push(`ct: ${bodyText}`);
            if (metaParts.length > 0) {
                messages.push(metaParts.join('\n'));
            }
        });

        // Format with message numbers
        let body = messages.map((msg, i) => `m${i + 1}:\n${msg}`).join('\n\n');

        // Include active reply draft if present
        const draftBody = document.querySelector('[contenteditable="true"][aria-label="Message body"]');
        const draftText = draftBody?.innerText?.trim();
        if (draftText) {
            body += `\n\ndr:\n${draftText}`;
        }

        return {
            subject: subject.trim(),
            body: body.trim(),
            recipients: Array.from(allRecipientNames),
            participant_emails: Array.from(allEmails)
        };
    };

    // --- Get compose email content ---

    outlook.getEmailContent = function() {
        const subjectInput = document.querySelector('input[aria-label="Subject"]');
        const bodyDiv = document.querySelector('[contenteditable="true"][aria-label="Message body"]');
        const toField = document.querySelector('[contenteditable="true"][aria-label="To"]');
        const ccField = document.querySelector('[contenteditable="true"][aria-label="Cc"]');
        const bccField = document.querySelector('[contenteditable="true"][aria-label="Bcc"]');

        if (!subjectInput && !bodyDiv) {
            return { subject: '', body: '', recipients: [], time: '', participant_emails: [] };
        }

        const toList = collectPeopleFromHeader(toField);
        const ccList = collectPeopleFromHeader(ccField);
        const bccList = collectPeopleFromHeader(bccField);

        const allEmails = new Set();
        collectRawEmails(toField).forEach(e => allEmails.add(e));
        collectRawEmails(ccField).forEach(e => allEmails.add(e));
        collectRawEmails(bccField).forEach(e => allEmails.add(e));

        const allRecipients = [...toList, ...ccList, ...bccList];

        return {
            subject: subjectInput ? subjectInput.value || '' : '',
            body: bodyDiv ? bodyDiv.innerText || '' : '',
            recipients: allRecipients,
            to: toList,
            cc: ccList,
            bcc: bccList,
            time: new Date().toLocaleString(),
            participant_emails: allEmails.size > 0 ? Array.from(allEmails) : allRecipients
        };
    };

    // Export
    window.Engramme.outlook = outlook;

})();
