// gmail.js - Gmail site-specific behavior
// Detects compose windows, email views, and extracts content
// Depends on: core/state.js

(function() {
    'use strict';

    const gmail = {};
    const state = window.Engramme.state;
    const utils = window.Engramme.utils;

    /**
     * Extract raw email addresses from a DOM root element.
     * Looks for email attributes and parses "Name <email>" patterns.
     * @param {Element} root - DOM element to search within
     * @param {string} selector - CSS selector for elements with email info
     * @returns {string[]} Array of lowercase email addresses
     */
    const collectRawEmails = (root, selector) => {
        const emailSet = new Set();
        if (!root) return [];
        const nodes = root.querySelectorAll(selector);
        nodes.forEach(node => {
            // Check email attribute directly
            const emailAttr = node.getAttribute('email');
            if (emailAttr && emailAttr.includes('@')) {
                emailSet.add(emailAttr.toLowerCase().trim());
            }
            // Check data-email (Gmail uses this in some recipient chips)
            const dataEmailAttr = node.getAttribute('data-email');
            if (dataEmailAttr && dataEmailAttr.includes('@')) {
                emailSet.add(dataEmailAttr.toLowerCase().trim());
            }
            // Check data-hovercard-id (often contains email)
            const hoverId = node.getAttribute('data-hovercard-id');
            if (hoverId && hoverId.includes('@')) {
                emailSet.add(hoverId.toLowerCase().trim());
            }
            // Parse "Name <email>" patterns from text content
            const text = node.textContent?.trim();
            if (text) {
                const match = text.match(/<([^>]+@[^>]+)>/);
                if (match) {
                    emailSet.add(match[1].toLowerCase().trim());
                }
            }
        });
        return Array.from(emailSet);
    };

    // Callbacks registered by content.js for UI functions
    gmail.callbacks = {
        createOverlay: null,
        showEmptyState: null,
        clearAllFeedback: null,
        updateMemorySuggestionsForView: null,
        setActiveContext: null,
        adjustOverlayPosition: null,
        debouncedUpdateMemorySuggestions: null
    };

    /**
     * Register callbacks from content.js
     * @param {Object} callbacks - Object with callback functions
     */
    gmail.registerCallbacks = function(callbacks) {
        Object.assign(gmail.callbacks, callbacks);
    };

    const threadSubjectSelector = [
        '.nH .aHU [data-url]',
        '.nH .aHU [data-legacy-thread-id]',
        '.nH .aHU .hP',
        '.nH .aHU [aria-label*="Subject"]',
        'h2[data-url]',
        'h2[data-legacy-thread-id]',
        'h2.hP'
    ].join(', ');

    const threadIdSourceSelector = [
        '.nH .aHU [data-url]',
        '.nH .aHU [data-legacy-thread-id]',
        'h2[data-url]',
        'h2[data-legacy-thread-id]'
    ].join(', ');

    gmail.getThreadSubjectElement = function() {
        if (!gmail.isThreadViewUrl || !gmail.isThreadViewUrl()) return null;
        return document.querySelector(threadSubjectSelector);
    };

    function getThreadIdSourceElement() {
        return document.querySelector(threadIdSourceSelector);
    }

    /**
     * Start the Gmail MutationObserver to detect compose windows and email views
     */
    gmail.startObserver = function() {
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
                                node.querySelector('div[role="dialog"]') ||
                                node.querySelector('div[role="textbox"]') ||
                                node.querySelector('.dw') ||
                                node.matches && node.matches('div[role="dialog"]')
                            );
                            
                            const hasView = node.querySelector && (
                                node.querySelector('.ii.gt') ||
                                node.querySelector('.adn.ads') ||
                                node.querySelector('[role="listitem"]') ||
                                node.matches && (node.matches('.ii.gt') || node.matches('.adn.ads'))
                            );
                            
                            if (hasCompose) shouldCheckCompose = true;
                            if (hasView) shouldCheckView = true;
                            
                            if (shouldCheckCompose || shouldCheckView) break;
                        }
                    }
                }
            });
            
            if (shouldCheckCompose) {
                setTimeout(gmail.checkForComposeWindow, 100);
            }
            if (shouldCheckView) {
                setTimeout(gmail.checkForEmailView, 100);
            }
        });
        
        state.observer.observe(document.body, {
            childList: true,
            subtree: true
        });
        
        // Initial checks
        setTimeout(() => {
            gmail.checkForComposeWindow();
            gmail.checkForEmailView();
        }, 1000);
    };

    /**
     * Check for compose window and set up listeners
     */
    gmail.checkForComposeWindow = function() {
        if (!utils.isExtensionValid()) return;

        try {
            const composeSelectors = [
                'div[role="dialog"] div[role="textbox"]',
                'div[role="region"][aria-label*="New message"] div[role="textbox"]',
                'div[role="region"][aria-label*="New Message"] div[role="textbox"]',
                '.dw div[role="textbox"]',
                '.Am.Al.editable',
                'div[contenteditable="true"][role="textbox"]',
                '.Am .Al',
                'div[g_editable="true"]',
                '[contenteditable="true"][aria-label*="Message"]',
                '[contenteditable="true"][aria-label*="message"]'
            ];

            let composeElement = null;
            let composeContainer = null;

            for (const selector of composeSelectors) {
                const elements = document.querySelectorAll(selector);
                if (elements.length > 0) {
                    composeElement = elements[elements.length - 1];
                    composeContainer = composeElement.closest('div[role="dialog"]') ||
                                     composeElement.closest('div[role="region"][aria-label*="New message"]') ||
                                     composeElement.closest('div[role="region"][aria-label*="New Message"]') ||
                                     composeElement.closest('.dw') ||
                                     composeElement.closest('.AD') ||
                                     composeElement.closest('.Ar');
                    if (composeContainer) {
                        break;
                    }
                }
            }

            if (composeContainer && composeContainer !== state.currentComposeElement) {
                state.currentComposeElement = composeContainer;
                state.currentMode = 'compose';
                
                if (gmail.callbacks.setActiveContext) {
                    gmail.callbacks.setActiveContext('compose', 'compose-open');
                }

                gmail.setupComposeListeners();

                if (!state.overlayElement && gmail.callbacks.createOverlay) {
                    gmail.callbacks.createOverlay();
                }

                if (gmail.callbacks.adjustOverlayPosition) {
                    gmail.callbacks.adjustOverlayPosition();
                }

            } else if (!composeContainer && state.currentComposeElement) {
                state.currentComposeElement = null;
                if (state.currentMode === 'compose') {
                    state.currentMode = null;

                    // Check if there's an email view to switch back to
                    const hasThreadHeader = !!gmail.getThreadSubjectElement();
                    const hasEmailView = !!state.currentViewElement ||
                                       !!document.querySelector('.ii.gt') ||
                                       hasThreadHeader;

                    if (hasEmailView) {
                        // Clear active context so it can be set to view
                        state.activeContext = null;
                        if (gmail.callbacks.setActiveContext) {
                            gmail.callbacks.setActiveContext('view', 'compose-closed');
                        }
                        // Trigger email view check to update memories
                        setTimeout(() => {
                            gmail.checkForEmailView();
                        }, 100);
                    } else if (gmail.callbacks.showEmptyState) {
                        gmail.callbacks.showEmptyState();
                    }
                }
            }
        } catch (e) {
            console.error('💥 Error checking compose window:', e);
        }
    };

    /**
     * Check for email view and update suggestions
     */
    gmail.checkForEmailView = function() {
        if (!utils.isExtensionValid()) return;
        
        try {
            let emailContent = null;
            let subjectElement = null;
            
            const allEmails = document.querySelectorAll('.ii.gt');
            if (allEmails.length > 0) {
                emailContent = allEmails[allEmails.length - 1];
            }
            
            subjectElement = gmail.getThreadSubjectElement();
            
            const isInEmailView = emailContent || !!subjectElement;
            if (isInEmailView) {
                const newViewElement = emailContent || subjectElement;

                const isNewEmail = newViewElement !== state.previousViewElement;
                if (isNewEmail && state.previousViewElement !== null) {
                    if (gmail.callbacks.clearAllFeedback) {
                        gmail.callbacks.clearAllFeedback();
                    }
                }

                state.previousViewElement = newViewElement;
                state.currentViewElement = newViewElement;
                state.currentMode = 'view';

                if (!state.overlayElement && gmail.callbacks.createOverlay) {
                    gmail.callbacks.createOverlay();
                }

                if (gmail.callbacks.adjustOverlayPosition) {
                    gmail.callbacks.adjustOverlayPosition();
                }

                if (state.activeContext && state.activeContext !== 'view') {
                } else if (gmail.callbacks.updateMemorySuggestionsForView) {
                    gmail.callbacks.updateMemorySuggestionsForView();
                }
                
            } else if (state.currentMode === 'view' && !emailContent) {
                state.currentViewElement = null;
                state.previousViewElement = null;
                // Clear cached query so reopening same email triggers fresh fetch
                state.lastDisplayedQueryByMode.view = '';
                if (state.currentMode === 'view') {
                    state.currentMode = null;
                    if (gmail.callbacks.showEmptyState) {
                        gmail.callbacks.showEmptyState();
                    }
                }
            }
        } catch (e) {
            console.error('💥 Error checking email view:', e);
        }
    };

    function extractThreadIdFromUrl(rawUrl) {
        if (!rawUrl) return null;
        const hashIndex = rawUrl.indexOf('#');
        const fragment = hashIndex >= 0 ? rawUrl.slice(hashIndex + 1) : rawUrl;
        const fragmentNoQuery = fragment.split('?')[0];
        const segments = fragmentNoQuery.split('/').filter(Boolean);
        if (segments.length === 0) return null;
        const lastSegment = segments[segments.length - 1];
        if (!/^[A-Za-z0-9_-]+$/.test(lastSegment)) return null;
        return lastSegment;
    }

    gmail.isThreadViewUrl = function() {
        const hash = window.location.hash.replace(/^#/, '');
        const segments = hash.split('/').filter(Boolean);
        if (segments.length < 2) return false;
        const lastSegment = segments[segments.length - 1];
        return lastSegment.length >= 15 && /^[A-Za-z0-9_-]+$/.test(lastSegment);
    };

    gmail.getCurrentThreadId = function() {
        if (!gmail.isThreadViewUrl()) return null;
        const subjectElement = getThreadIdSourceElement();
        const dataUrl = subjectElement ? subjectElement.getAttribute('data-url') : '';
        const fromDataUrl = extractThreadIdFromUrl(dataUrl);
        if (fromDataUrl) return fromDataUrl;
        const legacyThreadId = subjectElement ? subjectElement.getAttribute('data-legacy-thread-id') : '';
        if (legacyThreadId) return legacyThreadId;
        return extractThreadIdFromUrl(window.location.href) || null;
    };

    /**
     * Set up input listeners for compose window
     */
    gmail.setupComposeListeners = function() {
        if (!state.currentComposeElement) return;
        
        // Clear old listeners
        state.inputListeners.forEach(({ element, type, listener }) => {
            element.removeEventListener(type, listener);
        });
        state.inputListeners = [];
        
        const subjectSelectors = [
            'input[name="subjectbox"]',
            'input[aria-label*="Subject"]',
            'input[aria-label*="subject"]',
            '.aoT input',
            'input[placeholder*="Subject"]'
        ];
        
        const bodySelectors = [
            'div[role="textbox"]',
            '.Am.Al.editable',
            'div[contenteditable="true"]',
            '[g_editable="true"]',
            '[contenteditable="true"][aria-label*="Message"]'
        ];
        
        let subjectInput = null;
        let bodyDiv = null;
        
        for (const selector of subjectSelectors) {
            subjectInput = state.currentComposeElement.querySelector(selector);
            if (subjectInput) {
                break;
            }
        }
        
        for (const selector of bodySelectors) {
            bodyDiv = state.currentComposeElement.querySelector(selector);
            if (bodyDiv && bodyDiv.isContentEditable) {
                break;
            }
        }
        
        if (subjectInput && gmail.callbacks.debouncedUpdateMemorySuggestions) {
            const inputListener = () => gmail.callbacks.debouncedUpdateMemorySuggestions();
            subjectInput.addEventListener('input', inputListener);
            subjectInput.addEventListener('keyup', inputListener);
            state.inputListeners.push({ element: subjectInput, type: 'input', listener: inputListener });
            state.inputListeners.push({ element: subjectInput, type: 'keyup', listener: inputListener });
        }
        
        if (bodyDiv && gmail.callbacks.debouncedUpdateMemorySuggestions) {
            const bodyListener = () => gmail.callbacks.debouncedUpdateMemorySuggestions();
            bodyDiv.addEventListener('input', bodyListener);
            bodyDiv.addEventListener('keyup', bodyListener);
            bodyDiv.addEventListener('paste', () => setTimeout(gmail.callbacks.debouncedUpdateMemorySuggestions, 100));
            state.inputListeners.push({ element: bodyDiv, type: 'input', listener: bodyListener });
            state.inputListeners.push({ element: bodyDiv, type: 'keyup', listener: bodyListener });
        }
    };

    /**
     * Adjust Gmail's layout to accommodate the sidebar
     * @param {boolean} sidebarVisible - Whether sidebar is visible
     */
    gmail.adjustLayout = function(sidebarVisible) {
        // Use CSS-specified width (400px) as default until measured width is available.
        let sidebarWidth = 400;
        const overlayWidth = state.overlayElement ? state.overlayElement.offsetWidth : 0;
        if (overlayWidth > 0) {
            sidebarWidth = overlayWidth;
        }
        const margin = sidebarVisible ? `${sidebarWidth + 16}px` : '0px';

        const gmailMain = document.querySelector('.AO') ||
                          document.querySelector('.nH') ||
                          document.querySelector('body');

        if (gmailMain) {
            gmailMain.style.marginRight = margin;
            gmailMain.style.transition = 'margin-right 0.3s ease';
        }

        // Adjust compose windows
        const composeSelectors = ['div[role="dialog"]', '.AD', '.dw', '.Ar'];

        composeSelectors.forEach(selector => {
            const composeWindows = document.querySelectorAll(selector);
            composeWindows.forEach(composeWindow => {
                if (composeWindow.querySelector('[role="textbox"]') ||
                    composeWindow.querySelector('[contenteditable="true"]')) {

                    if (!composeWindow.dataset.originalRight) {
                        const computedStyle = window.getComputedStyle(composeWindow);
                        composeWindow.dataset.originalRight = computedStyle.right;
                    }

                    const originalRight = parseInt(composeWindow.dataset.originalRight) || 0;

                    if (sidebarVisible) {
                        const newRight = originalRight + (sidebarWidth + 16);
                        composeWindow.style.right = `${newRight}px`;
                        composeWindow.style.transition = 'right 0.3s ease';
                    } else {
                        composeWindow.style.right = composeWindow.dataset.originalRight || '';
                    }
                }
            });
        });
    };

    /**
     * Get email subject from current view or compose
     * @param {string} effectiveMode - 'compose' or 'view'
     * @returns {string} Email subject
     */
    gmail.getEmailSubject = function(effectiveMode) {
        if (effectiveMode === 'view') {
            const subjectElement = gmail.getThreadSubjectElement();
            if (subjectElement) {
                return subjectElement.textContent || 'Email';
            }
        }

        if (effectiveMode === 'compose' && state.currentComposeElement) {
            const subjectSelectors = [
                'input[name="subjectbox"]',
                'input[aria-label*="Subject"]',
                '.aoT input'
            ];

            for (const selector of subjectSelectors) {
                const subjectInput = state.currentComposeElement.querySelector(selector);
                if (subjectInput && subjectInput.value) {
                    return subjectInput.value;
                }
            }
        }

        return 'Email';
    };

    /**
     * Get viewed email content (subject and body)
     * Scrapes all currently expanded/visible messages in the thread
     * @returns {{subject: string, body: string}} Email content
     */
    gmail.getViewedEmailContent = function() {
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
                if (localPart) {
                    nameSet.add(localPart);
                }
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

        const collectPeopleFromRoots = (roots, selector) => {
            const nameSet = new Set();
            roots.forEach(root => {
                if (!root) return;
                const nodes = root.querySelectorAll(selector);
                nodes.forEach(node => {
                    const dataName = node.getAttribute('data-name');
                    const nameAttr = node.getAttribute('name');
                    const emailAttr = node.getAttribute('email');
                    const hoverId = node.getAttribute('data-hovercard-id');
                    if (dataName) addPeopleFromValue(nameSet, dataName);
                    if (nameAttr && !nameAttr.includes('@')) addPeopleFromValue(nameSet, nameAttr);
                    if (emailAttr) addPeopleFromValue(nameSet, emailAttr);
                    if (hoverId) addPeopleFromValue(nameSet, hoverId);
                    if (!dataName && !nameAttr && !emailAttr && !hoverId) {
                        const text = node.textContent?.trim();
                        if (text && text.length <= 80) {
                            addPeopleFromValue(nameSet, text);
                        }
                    }
                });
            });
            return Array.from(nameSet);
        };

        const collectPeopleFromRoot = (root, selector) => collectPeopleFromRoots([root], selector);

        const extractThreadMessages = () => {
            const messages = [];
            const processedContainers = new Set();

            // Helper to extract message data from a container
            const extractMessageFromContainer = (container, bodyText, isCollapsed = false) => {
                let senderName = '';
                let senderEmail = '';
                let timestampText = '';
                let toList = [];
                let ccList = [];
                let bccList = [];

                const senderEl = container.querySelector('.gD') || container.querySelector('.g2[email]') || container.querySelector('[email]');
                if (senderEl) {
                    senderName = senderEl.getAttribute('name') || senderEl.textContent?.trim() || '';
                    senderEmail = senderEl.getAttribute('email') || senderEl.getAttribute('data-hovercard-id') || '';
                }
                const timeEl = container.querySelector('span.g3') || container.querySelector('span[title][aria-label]');
                if (timeEl) {
                    timestampText = timeEl.getAttribute('aria-label') || timeEl.getAttribute('title') || timeEl.textContent?.trim() || '';
                }

                // Helper to format recipient as "Name <email>"
                const formatRecipient = (el) => {
                    const email = el.getAttribute('email');
                    if (!email) return null;
                    // Try to get full name - prefer data-name or name attribute
                    let name = el.getAttribute('name') || el.getAttribute('data-name') || '';
                    // Get display text as fallback
                    if (!name || name === 'me') {
                        name = el.textContent?.trim() || '';
                    }
                    // Last resort: use email username
                    if (!name || name === 'me' || name === email) {
                        name = email.split('@')[0];
                    }
                    // Raw emails are sent separately via participant_emails/ambience_metadata;
                    // keep only the display name in the query text.
                    return name;
                };

                // Track seen emails to avoid duplicates
                const seenEmails = new Set();
                const addUnique = (list, formatted, email) => {
                    if (!seenEmails.has(email)) {
                        seenEmails.add(email);
                        list.push(formatted);
                    }
                };

                // Gmail's collapsed header shows: "to Mahesh, me, bcc: Rajeswari"
                // Parse the .hb span text to extract To/CC/BCC
                const hbSpan = container.querySelector('.hb');
                if (hbSpan) {
                    const headerText = hbSpan.textContent || '';
                    // Find all email elements within .hb
                    const recipientEls = hbSpan.querySelectorAll('[email]');

                    // Check if "bcc:" appears in the text - find position
                    const bccIndex = headerText.toLowerCase().indexOf('bcc:');

                    recipientEls.forEach(el => {
                        const email = el.getAttribute('email');
                        if (!email) return;
                        // Skip sender element (class gD)
                        if (el.classList.contains('gD')) return;

                        const formatted = formatRecipient(el);
                        if (!formatted) return;

                        const elText = el.textContent?.trim() || '';
                        const elName = el.getAttribute('name') || '';

                        // Check if this recipient appears after "bcc:" in the header text
                        if (bccIndex !== -1) {
                            // Find where this recipient's name appears
                            const textAfterBcc = headerText.substring(bccIndex);
                            if (textAfterBcc.includes(elText) || textAfterBcc.includes(elName)) {
                                addUnique(bccList, formatted, email);
                                return;
                            }
                        }

                        // Check if "cc:" appears before this recipient
                        const ccIndex = headerText.toLowerCase().indexOf('cc:');
                        if (ccIndex !== -1 && ccIndex < bccIndex) {
                            const textBetweenCcAndBcc = headerText.substring(ccIndex, bccIndex !== -1 ? bccIndex : undefined);
                            if (textBetweenCcAndBcc.includes(elText) || textBetweenCcAndBcc.includes(elName)) {
                                addUnique(ccList, formatted, email);
                                return;
                            }
                        }

                        // If name is "me" and it's the sender's email, it's CC (self)
                        if ((elName === 'me' || elText === 'me') && email === senderEmail) {
                            addUnique(ccList, formatted, email);
                            return;
                        }

                        // Otherwise it's a To recipient (skip if it's the sender)
                        if (email !== senderEmail) {
                            addUnique(toList, formatted, email);
                        }
                    });
                }

                // Fallback: Look for expanded header with [data-header-name] attributes
                if (toList.length === 0 && ccList.length === 0 && bccList.length === 0) {
                    const headerNameRows = container.querySelectorAll('[data-header-name]');
                    headerNameRows.forEach(row => {
                        const headerName = (row.getAttribute('data-header-name') || '').toLowerCase();
                        const emailEls = row.querySelectorAll('[email]');

                        emailEls.forEach(el => {
                            const email = el.getAttribute('email');
                            if (!email) return;
                            const formatted = formatRecipient(el);
                            if (!formatted) return;

                            if (headerName === 'bcc') {
                                addUnique(bccList, formatted, email);
                            } else if (headerName === 'cc') {
                                addUnique(ccList, formatted, email);
                            } else if (headerName === 'to') {
                                if (email !== senderEmail) addUnique(toList, formatted, email);
                            }
                        });
                    });
                }

                // Fallback: Look for .g2[email] elements
                if (toList.length === 0 && ccList.length === 0 && bccList.length === 0) {
                    const recipientEls = container.querySelectorAll('.g2[email], [email]:not(.gD)');
                    recipientEls.forEach(el => {
                        const email = el.getAttribute('email');
                        if (!email || email === senderEmail || el.classList.contains('gD')) return;
                        const formatted = formatRecipient(el);
                        if (formatted) addUnique(toList, formatted, email);
                    });
                }

                // Build message with 2-char codes.
                // Keep participant identities out of recall text; those go in participant_emails metadata.
                const metaParts = [];
                if (timestampText) metaParts.push(`dt: ${timestampText}`);
                if (isCollapsed) metaParts.push('[collapsed]');
                if (bodyText) metaParts.push(`ct: ${bodyText}`);
                return metaParts.join('\n');
            };

            // Get all expanded/visible email bodies in the thread
            const emailBodies = document.querySelectorAll('.ii.gt');
            const numExpanded = emailBodies.length;

            emailBodies.forEach((bodyEl, idx) => {
                // Clone the body element to manipulate without affecting the DOM
                const bodyClone = bodyEl.cloneNode(true);

                // Only strip quoted content if multiple messages are expanded
                // (otherwise we'd lose content from collapsed messages)
                if (numExpanded > 1) {
                    const quotedParts = bodyClone.querySelectorAll('.gmail_quote, blockquote');
                    quotedParts.forEach(q => q.remove());
                }

                let bodyText = bodyClone.textContent?.trim() || '';

                // Only strip "On [date] wrote:" pattern if multiple messages expanded
                if (numExpanded > 1) {
                    bodyText = bodyText.replace(/On\s+\w{3},\s+\d{1,2}\s+\w{3}\s+\d{4}\s+at\s+[\d:]+,\s+[^<]+<[^>]+>\s+wrote:\s*/gi, '').trim();
                }

                if (!bodyText) return;

                // Find the specific message container for this body
                // Try increasingly specific containers to avoid skipping messages
                let container = bodyEl.closest('.h7') || // Individual message wrapper
                               bodyEl.closest('.kv') || // Message container
                               bodyEl.closest('.gs') ||
                               bodyEl.closest('.adn') ||
                               bodyEl.parentElement;

                // If container already processed, try parent to get a unique one
                if (container && processedContainers.has(container)) {
                    container = bodyEl.parentElement;
                }

                if (container && !processedContainers.has(container)) {
                    processedContainers.add(container);
                    messages.push(extractMessageFromContainer(container, bodyText, false));
                }
            });

            return messages;
        };

        let subject = '';
        const subjectElement = gmail.getThreadSubjectElement();
        if (subjectElement) {
            subject = subjectElement.textContent || '';
        }

        const threadMessages = extractThreadMessages();
        // Format with message numbers: m1, m2, etc. (DOM order is already chronological)
        let body = threadMessages.map((msg, i) => `m${i + 1}:\n${msg}`).join('\n\n');

        // Include active reply draft text if present
        const draftBox = document.querySelector('.Am.Al.editable[contenteditable="true"], div[role="textbox"][contenteditable="true"]');
        const draftText = draftBox?.innerText?.trim();
        if (draftText) {
            body += `\n\ndr:\n${draftText}`;
        }

        const threadContainers = Array.from(document.querySelectorAll('.adn, .gs'));
        const peopleSelector = [
            'span[email]',
            'span[data-hovercard-id]',
            'span[data-name]',
            'span[name]',
            'span.gD',
            'span.g2'
        ].join(', ');
        const recipients = collectPeopleFromRoots(
            threadContainers.length > 0 ? threadContainers : [document],
            peopleSelector
        );

        // Collect raw email addresses for ambience_metadata
        // Narrow selector to attributes collectRawEmails actually reads
        const emailAttrSelector = '[email], [data-email], [data-hovercard-id]';
        const emailSet = new Set();
        (threadContainers.length > 0 ? threadContainers : [document]).forEach(root => {
            collectRawEmails(root, emailAttrSelector).forEach(e => emailSet.add(e));
        });
        const participantEmails = Array.from(emailSet);

        return {
            subject: subject.trim(),
            body: body.trim(),
            recipients: recipients,
            participant_emails: participantEmails
        };
    };

    /**
     * Get compose email content (subject and body)
     * @returns {{subject: string, body: string}} Email content
     */
    gmail.getEmailContent = function() {
        if (!state.currentComposeElement) {
            return { subject: '', body: '', recipients: [], time: '', participant_emails: [] };
        }
        
        const subjectSelectors = [
            'input[name="subjectbox"]',
            'input[aria-label*="Subject"]',
            '.aoT input'
        ];
        
        const bodySelectors = [
            'div[role="textbox"]',
            '.Am.Al.editable',
            'div[contenteditable="true"]'
        ];
        
        let subjectInput = null;
        let bodyDiv = null;
        
        for (const selector of subjectSelectors) {
            subjectInput = state.currentComposeElement.querySelector(selector);
            if (subjectInput) break;
        }
        
        for (const selector of bodySelectors) {
            bodyDiv = state.currentComposeElement.querySelector(selector);
            if (bodyDiv) break;
        }

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
                if (localPart) {
                    nameSet.add(localPart);
                }
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

        const collectPeopleFromRoot = (root, selector) => {
            const nameSet = new Set();
            if (!root) return [];
            const nodes = root.querySelectorAll(selector);
            nodes.forEach(node => {
                const dataName = node.getAttribute('data-name');
                const nameAttr = node.getAttribute('name');
                const emailAttr = node.getAttribute('email');
                const hoverId = node.getAttribute('data-hovercard-id');
                if (dataName) addPeopleFromValue(nameSet, dataName);
                if (nameAttr && !nameAttr.includes('@')) addPeopleFromValue(nameSet, nameAttr);
            if (emailAttr) addPeopleFromValue(nameSet, emailAttr);
            if (hoverId) addPeopleFromValue(nameSet, hoverId);
            if (!dataName && !nameAttr && !emailAttr && !hoverId) {
                const text = node.textContent?.trim();
                if (text && text.length <= 80) {
                    addPeopleFromValue(nameSet, text);
                }
            }
            });
            return Array.from(nameSet);
        };

        const composeContainer = state.currentComposeElement.closest('div[role="dialog"]') ||
            state.currentComposeElement.closest('.AD') ||
            state.currentComposeElement;

        const composeRecipientSelector = [
            '[data-name]',
            '[email]',
            '[data-email]',
            '[data-hovercard-id]',
            '[name]',
            'div.vR span'
        ].join(', ');

        const getComposeHeaderList = (fieldName) => {
            const label = fieldName === 'to' ? 'To' : fieldName === 'cc' ? 'Cc' : 'Bcc';
            const input = composeContainer.querySelector(
                `textarea[name="${fieldName}"], input[name="${fieldName}"], textarea[aria-label*="${label}" i], input[aria-label*="${label}" i]`
            );
            const root = (input?.closest('td') || input?.closest('div')) ||
                composeContainer.querySelector(`[role="combobox"][aria-label*="${label}" i]`) ||
                composeContainer.querySelector(`[aria-label*="${label}" i]`) ||
                composeContainer;
            const nameSet = new Set(collectPeopleFromRoot(root, composeRecipientSelector));
            const inputValue = input?.value?.trim();
            if (inputValue) {
                inputValue.split(/[;,]+/).forEach(part => addPersonToken(nameSet, part));
            }
            return Array.from(nameSet);
        };

        const getComposeFromValue = () => {
            const fromSelect = composeContainer.querySelector('select[name="from"]');
            if (fromSelect && fromSelect.selectedIndex >= 0) {
                const optionText = fromSelect.options[fromSelect.selectedIndex]?.textContent?.trim();
                if (optionText) return optionText;
            }
            const fromRow = composeContainer.querySelector('[aria-label^="From"], [aria-label*="From"]');
            if (!fromRow) return '';
            const fromPeople = collectPeopleFromRoot(
                fromRow,
                [
                    '[data-name]',
                    'span[email]',
                    'span[data-hovercard-id]',
                    'span[name]'
                ].join(', ')
            );
            return fromPeople[0] || '';
        };

        let toList = getComposeHeaderList('to');
        let ccList = getComposeHeaderList('cc');
        let bccList = getComposeHeaderList('bcc');
        if (toList.length === 0 && ccList.length === 0 && bccList.length === 0) {
            toList = collectPeopleFromRoot(composeContainer, composeRecipientSelector);
        }
        const fromValue = getComposeFromValue();

        // Collect raw email addresses for ambience_metadata
        // Narrow selector to attributes collectRawEmails actually reads
        const participantEmails = collectRawEmails(composeContainer, '[email], [data-email], [data-hovercard-id]');

        return {
            subject: subjectInput ? subjectInput.value || '' : '',
            body: bodyDiv ? bodyDiv.innerText || '' : '',
            recipients: collectPeopleFromRoot(composeContainer, composeRecipientSelector),
            from: fromValue,
            to: toList,
            cc: ccList,
            bcc: bccList,
            time: new Date().toLocaleString(),
            participant_emails: participantEmails
        };
    };

    // Export gmail to namespace
    window.Engramme.gmail = gmail;

})();
