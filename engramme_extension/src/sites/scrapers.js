// scrapers.js - Site-specific content extraction
// Provides specialized scrapers for Google Docs, Search, Reddit, Amazon, etc.
// Depends on: core/state.js

(function() {
    'use strict';

    const extractors = {};

    /**
     * Extract content from Google Search results
     * @returns {string} Extracted text content
     */
    extractors.getGoogleSearchContent = function() {
        try {
            let content = '';

            // Get search query
            const searchInput = document.querySelector('input[name="q"]');
            if (searchInput && searchInput.value) {
                content += `Search query: ${searchInput.value}\n\n`;
            }

            // Get search results
            const searchResults = document.querySelectorAll('.g, .MjjYud');
            searchResults.forEach((result, index) => {
                const title = result.querySelector('h3');
                const snippet = result.querySelector('.VwiC3b, .yXK7lf');
                const link = result.querySelector('a');

                if (title) {
                    content += `Result ${index + 1}: ${title.textContent}\n`;
                }
                if (snippet) {
                    content += `${snippet.textContent}\n`;
                }
                if (link && link.href) {
                    content += `${link.href}\n`;
                }
                content += '\n';
            });

            if (content.length > 10) {
                return content;
            }

            return '';
        } catch (e) {
            console.error('❌ Error extracting Google Search content:', e);
            return '';
        }
    };

    /**
     * Extract content from Instagram
     * @returns {string} Extracted text content
     */
    extractors.getInstagramContent = function() {
        try {
            let content = '';

            // Get page title/username
            if (document.title) {
                content += `${document.title}\n\n`;
            }

            // Profile bio
            const bio = document.querySelector('._aa_c span, ._aacl._aaco._aacw._aad6._aade');
            if (bio) {
                content += `Bio: ${bio.textContent}\n\n`;
            }

            // Post captions - try multiple selectors for different Instagram layouts
            const captions = document.querySelectorAll('._a9zs span, ._a9zr span, .C4VMK span, article span');
            captions.forEach(caption => {
                const text = caption.textContent?.trim();
                if (text && text.length > 20 && !content.includes(text)) {
                    content += `${text}\n\n`;
                }
            });

            // Comments
            const comments = document.querySelectorAll('.C4VMK > span, ._a9zs span');
            comments.forEach(comment => {
                const text = comment.textContent?.trim();
                if (text && text.length > 10 && !content.includes(text)) {
                    content += `Comment: ${text}\n`;
                }
            });

            if (content.length > 10) {
                return content;
            }

            return '';
        } catch (e) {
            console.error('❌ Error extracting Instagram content:', e);
            return '';
        }
    };

    /**
     * Extract content from ChatGPT conversations
     * @returns {string} Extracted text content
     */
    extractors.getChatGPTContent = function() {
        try {
            let content = '';

            // Get conversation title
            const title = document.querySelector('h1, .text-xl');
            if (title) {
                content += `Conversation: ${title.textContent}\n\n`;
            }

            // Get all messages in the conversation
            const messages = document.querySelectorAll('[data-message-author-role], .group\\/conversation-turn');
            messages.forEach((msg, index) => {
                // Determine if it's user or assistant
                const role = msg.getAttribute('data-message-author-role') ||
                            (msg.querySelector('.font-semibold')?.textContent) ||
                            'Unknown';

                const messageText = msg.querySelector('.markdown, .whitespace-pre-wrap')?.textContent?.trim() ||
                                  msg.textContent?.trim();

                if (messageText && messageText.length > 0) {
                    content += `${role}: ${messageText}\n\n`;
                }
            });

            if (content.length > 10) {
                return content;
            }

            return '';
        } catch (e) {
            console.error('❌ Error extracting ChatGPT content:', e);
            return '';
        }
    };

    /**
     * Extract content from Wikipedia articles
     * @returns {string} Extracted text content
     */
    extractors.getWikipediaContent = function() {
        try {
            let content = '';

            // Get article title
            const title = document.querySelector('h1.firstHeading, #firstHeading');
            if (title) {
                content += `${title.textContent}\n\n`;
            }

            // Get intro/lead section (before table of contents)
            const intro = document.querySelector('.mw-parser-output > p:first-of-type');
            if (intro) {
                content += `${intro.textContent}\n\n`;
            }

            // Get main content paragraphs
            const paragraphs = document.querySelectorAll('.mw-parser-output > p, .mw-parser-output > h2, .mw-parser-output > h3');
            paragraphs.forEach(p => {
                const text = p.textContent?.trim();
                if (text && text.length > 20) {
                    content += `${text}\n\n`;
                }
            });

            // Get infobox data
            const infobox = document.querySelector('.infobox');
            if (infobox) {
                const rows = infobox.querySelectorAll('tr');
                rows.forEach(row => {
                    const label = row.querySelector('th')?.textContent?.trim();
                    const value = row.querySelector('td')?.textContent?.trim();
                    if (label && value) {
                        content += `${label}: ${value}\n`;
                    }
                });
            }

            if (content.length > 10) {
                return content;
            }

            return '';
        } catch (e) {
            console.error('❌ Error extracting Wikipedia content:', e);
            return '';
        }
    };

    /**
     * Extract content from Reddit posts and comments
     * @returns {string} Extracted text content
     */
    extractors.getRedditContent = function() {
        try {
            let content = '';

            // Get post title
            const postTitle = document.querySelector('h1, [data-test-id="post-content"] h1, .PostHeader__post-title-line');
            if (postTitle) {
                content += `Post: ${postTitle.textContent}\n\n`;
            }

            // Get post content/selftext
            const postContent = document.querySelector('[data-test-id="post-content"] div[data-click-id="text"], .RichTextJSON-root, ._3xX726aBn29LDbsDtzr_6E');
            if (postContent) {
                content += `${postContent.textContent}\n\n`;
            }

            // Get comments
            const comments = document.querySelectorAll('[data-testid="comment"], .Comment, ._1qeIAgB0cPwnLhDF9XSiJM');
            comments.forEach((comment, index) => {
                const commentText = comment.querySelector('[data-testid="comment-content"], .RichTextJSON-root, ._292iotee39Lmt0MkQZ2hPV')?.textContent?.trim();
                if (commentText && commentText.length > 10) {
                    content += `Comment ${index + 1}: ${commentText}\n\n`;
                }
            });

            // Fallback: Get all visible text in main content area
            if (content.length < 100) {
                const mainContent = document.querySelector('main, #AppRouter-main-content, shreddit-app');
                if (mainContent) {
                    const paragraphs = mainContent.querySelectorAll('p, h1, h2, h3');
                    paragraphs.forEach(p => {
                        const text = p.textContent?.trim();
                        if (text && text.length > 20) {
                            content += `${text}\n\n`;
                        }
                    });
                }
            }

            if (content.length > 10) {
                return content;
            }

            return '';
        } catch (e) {
            console.error('❌ Error extracting Reddit content:', e);
            return '';
        }
    };

    /**
     * Extract content from Amazon product pages
     * @returns {string} Extracted text content
     */
    extractors.getAmazonContent = function() {
        try {
            let content = '';

            // Get product title
            const title = document.querySelector('#productTitle, #title');
            if (title) {
                content += `Product: ${title.textContent.trim()}\n\n`;
            }

            // Get price
            const price = document.querySelector('.a-price-whole, #priceblock_ourprice, #priceblock_dealprice, .a-price .a-offscreen');
            if (price) {
                content += `Price: ${price.textContent.trim()}\n\n`;
            }

            // Get rating
            const rating = document.querySelector('[data-hook="rating-out-of-text"], .a-icon-alt');
            if (rating) {
                content += `Rating: ${rating.textContent.trim()}\n\n`;
            }

            // Get product description/features
            const features = document.querySelectorAll('#feature-bullets li, #featurebullets_feature_div li');
            if (features.length > 0) {
                content += 'Features:\n';
                features.forEach(feature => {
                    const text = feature.textContent?.trim();
                    if (text && text.length > 5) {
                        content += `- ${text}\n`;
                    }
                });
                content += '\n';
            }

            // Get product description
            const description = document.querySelector('#productDescription, #aplus');
            if (description) {
                content += `Description: ${description.textContent.trim()}\n\n`;
            }

            // Get reviews
            const reviews = document.querySelectorAll('[data-hook="review-body"], .review-text-content');
            reviews.forEach((review, index) => {
                const reviewText = review.textContent?.trim();
                if (reviewText && reviewText.length > 20) {
                    content += `Review ${index + 1}: ${reviewText}\n\n`;
                }
            });

            if (content.length > 10) {
                return content;
            }

            return '';
        } catch (e) {
            console.error('❌ Error extracting Amazon content:', e);
            return '';
        }
    };

    /**
     * Extract content from any page using generic strategies
     * Routes to site-specific extractors when applicable
     * @returns {string} Extracted text content
     */
    extractors.getGenericPageContent = function() {
        try {
            const hostname = window.location.hostname;
            const pathname = window.location.pathname;

            if (hostname === 'app.engramme.com') {
                return '';
            }

            // Route to custom scrapers based on domain
            // SF Chronicle
            if (hostname.includes('sfchronicle.com')) {
                const sfchronicle = window.Engramme?.sfchronicle;
                if (sfchronicle && sfchronicle.shouldExtract()) {
                    const sfcContent = sfchronicle.getContent(true); // viewport only
                    if (sfcContent && sfcContent.length > 0) {
                        return sfcContent;
                    }
                }
            }

            // Google Docs - use dedicated google-docs.js extractor
            if (hostname.includes('docs.google.com') && pathname.includes('/document/')) {
                const googleDocs = window.Engramme?.googleDocs;
                if (googleDocs && googleDocs.shouldExtract()) {
                    const docsContent = googleDocs.getContent();
                    if (docsContent && docsContent.length > 0) {
                        return docsContent;
                    }
                }
                return '';
            }

            // Google Sheets - use dedicated google-sheets.js extractor
            if (hostname.includes('docs.google.com') && pathname.includes('/spreadsheets/')) {
                const googleSheets = window.Engramme?.googleSheets;
                if (googleSheets && googleSheets.shouldExtract()) {
                    const sheetsContent = googleSheets.getContent();
                    if (sheetsContent && sheetsContent.length > 0) {
                        return sheetsContent;
                    }
                }
                return '';
            }

            // Outlook Calendar - use dedicated outlook-calendar.js extractor
            if (window.Engramme.utils.isOutlookHost(hostname) &&
                pathname.includes('/calendar')) {
                const outlookCalendar = window.Engramme?.outlookCalendar;
                if (outlookCalendar && outlookCalendar.isEventOpen()) {
                    const calContent = outlookCalendar.getContent();
                    if (calContent && calContent.length > 0) {
                        return calContent;
                    }
                }
                return '';
            }

            // Google Calendar - use dedicated google-calendar.js extractor
            if (hostname === 'calendar.google.com') {
                const googleCalendar = window.Engramme?.googleCalendar;
                if (googleCalendar && googleCalendar.isEventOpen()) {
                    const calContent = googleCalendar.getContent();
                    if (calContent && calContent.length > 0) {
                        return calContent;
                    }
                }
                return '';
            }

            // Google Search - use dedicated google-search.js extractor
            if (hostname.includes('google.com') && (pathname.startsWith('/search') || document.querySelector('input[name="q"]'))) {
                const googleSearch = window.Engramme?.googleSearch;
                if (googleSearch && googleSearch.shouldExtract()) {
                    const searchContent = googleSearch.getContent();
                    if (searchContent && searchContent.length > 0) {
                        return searchContent;
                    }
                }
            }

            // Instagram
            if (hostname.includes('instagram.com')) {
                const instagramContent = extractors.getInstagramContent();
                if (instagramContent && instagramContent.length > 0) {
                    return instagramContent;
                }
            }

            // ChatGPT - use dedicated chatgpt.js extractor
            if (hostname.includes('chat.openai.com') || hostname.includes('chatgpt.com')) {
                const chatgptModule = window.Engramme?.chatgpt;
                if (chatgptModule && chatgptModule.shouldExtract()) {
                    const chatContent = chatgptModule.getContent();
                    if (chatContent && chatContent.length > 0) {
                        return chatContent;
                    }
                }
                return '';
            }

            // Wikipedia
            if (hostname.includes('wikipedia.org')) {
                const wikiContent = extractors.getWikipediaContent();
                if (wikiContent && wikiContent.length > 0) {
                    return wikiContent;
                }
            }

            // Reddit - use dedicated reddit.js extractor
            if (hostname.includes('reddit.com')) {
                const reddit = window.Engramme?.reddit;
                if (reddit && reddit.shouldExtract()) {
                    const redditContent = reddit.getContent();
                    if (redditContent && redditContent.length > 0) {
                        return redditContent;
                    }
                }
            }

            // Google Meet - use dedicated google-meets.js for audio capture
            // Don't do text scraping on Meet pages - audio capture handles memory fetch
            if (hostname === 'meet.google.com') {
                const googleMeets = window.Engramme?.googleMeets;
                if (googleMeets && googleMeets.isInMeeting()) {
                    // Return transcript if capturing, otherwise empty (audio capture will handle memory fetch)
                    if (googleMeets.isCapturing()) {
                        const meetContent = googleMeets.getContent();
                        if (meetContent && meetContent.length > 0) {
                            return meetContent;
                        }
                    }
                    return ''; // Don't do generic scraping on Meet
                }
                return '';
            }

            // Amazon - use dedicated amazon.js extractor for product/search/homepage pages
            if (hostname.includes('amazon.com') || hostname.includes('amazon.')) {
                const amazonModule = window.Engramme?.amazon;
                if (amazonModule && amazonModule.shouldExtract()) {
                    const amazonContent = amazonModule.getContent(true); // viewport only
                    if (amazonContent && amazonContent.length > 0) {
                        return amazonContent;
                    }
                }
                // Fallback to old extractor for non-product pages
                const amazonContent = extractors.getAmazonContent();
                if (amazonContent && amazonContent.length > 0) {
                    return amazonContent;
                }
            }

            // Microsoft Office Online (Word, Excel, PowerPoint)
            if (hostname.includes('officeapps.live.com')) {
                const msOffice = window.Engramme?.msOffice;
                if (msOffice && msOffice.shouldExtract()) {
                    const officeContent = msOffice.getContent();
                    if (officeContent && officeContent.length > 0) {
                        return officeContent;
                    }
                }
                return '';
            }

            // Microsoft host pages that embed Office iframes - use content relayed from iframe
            const isMicrosoftOfficeHost = hostname.includes('sharepoint.com') ||
                hostname.includes('cloud.microsoft') ||
                hostname.includes('onedrive.live.com') ||
                hostname.includes('onedrive.com') ||
                (hostname.includes('office.com') && !hostname.includes('officeapps.live.com'));
            if (isMicrosoftOfficeHost) {
                if (_officeIframeContent) {
                    return _officeIframeContent.substring(0, 2000);
                }
                // Don't fall through to generic scraping — wait for iframe content
                return '';
            }

            // Generic fallback scraping for all other sites
            let fullText = '';

            // Get page title
            if (document.title) {
                fullText += document.title + ' ';
            }

            // Get meta description
            const metaDesc = document.querySelector('meta[name="description"]');
            if (metaDesc && metaDesc.content) {
                fullText += metaDesc.content + ' ';
            }

            // Main content extraction strategies
            // 1. Look for main content areas
            const mainSelectors = [
                'main',
                'article',
                '[role="main"]',
                '#content',
                '.content',
                '#main',
                '.main',
                '.post',
                '.entry-content',
                '.article-body',
                '.story-body'
            ];

            for (const selector of mainSelectors) {
                const elements = document.querySelectorAll(selector);
                elements.forEach(el => {
                    if (el && el.textContent) {
                        fullText += el.textContent + ' ';
                    }
                });
            }

            // 2. If no main content found, get all meaningful text
            if (fullText.length < 100) {
                // Get headings
                const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
                headings.forEach(h => {
                    if (h.textContent) fullText += h.textContent + ' ';
                });

                // Get paragraphs
                const paragraphs = document.querySelectorAll('p');
                paragraphs.forEach(p => {
                    if (p.textContent && p.textContent.length > 20) {
                        fullText += p.textContent + ' ';
                    }
                });

                // Get list items
                const listItems = document.querySelectorAll('li');
                listItems.forEach(li => {
                    if (li.textContent && li.textContent.length > 20) {
                        fullText += li.textContent + ' ';
                    }
                });
            }

            // Clean up the text
            fullText = fullText
                .replace(/\s+/g, ' ')  // Replace multiple spaces with single space
                .replace(/\n+/g, ' ')  // Replace newlines with space
                .trim();

            // Limit to 2000 characters for extraction (API will handle 1000 char limit)
            // We collect more here so we have better context, backend will use last 1000
            if (fullText.length > 2000) {
                fullText = fullText.substring(0, 2000);
            }

            return fullText;
        } catch (e) {
            console.error('❌ Error getting generic page content:', e);
            return '';
        }
    };

    // --- Office iframe content relay ---
    // Office Online docs live in cross-origin iframes. The iframe content script
    // extracts text and posts it to the parent via postMessage. We store it here
    // so the parent page's generic scraper can return it for recall.
    let _officeIframeContent = '';

    window.addEventListener('message', (event) => {
        if (!event.origin.includes('officeapps.live.com')) return;
        if (event.data?.type === 'engramme-office-content' && event.data.content) {
            _officeIframeContent = event.data.content;

            // Trigger a memory refresh on the parent page
            const memoryRefresh = window.Engramme?.memoryRefresh;
            if (memoryRefresh && memoryRefresh.updateForGenericPage) {
                memoryRefresh.updateForGenericPage();
            }

            // Also memorize
            const genericPage = window.Engramme?.genericPage;
            if (genericPage && genericPage.memorize) {
                genericPage.memorize();
            }
        }
    });

    extractors.getOfficeIframeContent = function() {
        return _officeIframeContent;
    };

    // Export extractors to namespace
    window.Engramme.extractors = extractors;

})();
