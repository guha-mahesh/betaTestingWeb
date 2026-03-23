(function() {
  'use strict';

  const SHARED_CARD_VERSION = '0.3';

  // ============================================================
  // ERROR CODES (15 codes — toggled per-card, prepended to comment on submit)
  // ============================================================
  const ERROR_CODES = [
    { code: 'IR', label: 'Irrelevant' },
    { code: 'WP', label: 'Wrong People' },
    { code: 'VA', label: 'Vague' },
    { code: 'IN', label: 'Incorrect' },
    { code: 'IP', label: 'I Problem' },
    { code: 'RP', label: 'Repetitive' },
    { code: 'HL', label: 'Hallucination' },
    { code: 'WC', label: 'Wrong Company' },
    { code: 'NT', label: 'Not Timely' },
    { code: 'NM', label: 'No Memory' },
    { code: 'SR', label: 'Self-Reference' },
    { code: 'EE', label: 'Excessive Emotions' },
    { code: 'VB', label: 'Verbose' },
    { code: 'LK', label: 'Leaked Memory' },
    { code: 'TR', label: 'Trivial' },
  ];

  // ============================================================
  // DESIGN TOKENS
  // ============================================================
  const AVATAR_COLORS = [
    '#3b82f6', // blue-500
    '#a855f7', // purple-500
    '#22c55e', // green-500
    '#f97316', // orange-500
    '#ec4899', // pink-500
    '#6366f1', // indigo-500
  ];

  // Logo URLs — this bundled file is only used as a fallback when the backend
  // is unreachable; the authoritative copy is served from /embed/card/.
  // External CDN refs (unpkg, gstatic, etc.) degrade gracefully to the
  // fallback-icon SVG when blocked or offline.
  const INTEGRATION_LOGOS = {
    gmail: 'https://www.gstatic.com/images/branding/product/1x/gmail_2020q4_48dp.png',
    email: 'https://www.gstatic.com/images/branding/product/1x/gmail_2020q4_48dp.png',
    contacts: 'https://www.gstatic.com/images/branding/product/1x/contacts_2022_48dp.png',
    calendar: 'https://www.gstatic.com/images/branding/product/1x/calendar_2020q4_48dp.png',
    google_calendar: 'https://www.gstatic.com/images/branding/product/1x/calendar_2020q4_48dp.png',
    tasks: 'https://play-lh.googleusercontent.com/pjUulZ-Vdo7qPKxk3IRhnk8SORPlgSydSyYEjm7fGcoXO8wDyYisWXwQqEjMryZ_sqK2=w240-h480-rw',
    drive: 'https://www.gstatic.com/images/branding/product/1x/drive_2020q4_48dp.png',
    google_drive: 'https://www.gstatic.com/images/branding/product/1x/drive_2020q4_48dp.png',
    gdocs: 'https://www.gstatic.com/images/branding/product/1x/docs_2020q4_48dp.png',
    youtube: 'https://www.gstatic.com/images/branding/product/1x/youtube_48dp.png',
    photos: 'https://www.gstatic.com/images/branding/product/1x/photos_48dp.png',
    books: 'https://www.gstatic.com/images/branding/product/1x/play_books_48dp.png',
    fit: 'https://www.gstatic.com/images/branding/product/1x/gfit_48dp.png',
    slack: 'https://a.slack-edge.com/80588/marketing/img/icons/icon_slack_hash_colored.png',
    github: 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png',
    microsoft: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/44/Microsoft_logo.svg/48px-Microsoft_logo.svg.png',
    microsoft_outlook: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/df/Microsoft_Office_Outlook_%282018%E2%80%93present%29.svg/48px-Microsoft_Office_Outlook_%282018%E2%80%93present%29.svg.png',
    microsoft_calendar: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/df/Microsoft_Office_Outlook_%282018%E2%80%93present%29.svg/48px-Microsoft_Office_Outlook_%282018%E2%80%93present%29.svg.png',
    microsoft_onedrive: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3c/Microsoft_Office_OneDrive_%282019%E2%80%93present%29.svg/48px-Microsoft_Office_OneDrive_%282019%E2%80%93present%29.svg.png',
    zoom: 'https://upload.wikimedia.org/wikipedia/commons/7/7b/Zoom_Communications_Logo.svg',
    asana: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3b/Asana_logo.svg/48px-Asana_logo.svg.png',
    browser: 'https://unpkg.com/lucide-static@latest/icons/app-window.svg',
    text: 'https://unpkg.com/lucide-static@latest/icons/file-text.svg',
    pdf: 'https://unpkg.com/lucide-static@latest/icons/file-text.svg',
    stream: 'https://unpkg.com/lucide-static@latest/icons/monitor.svg',
    vscode: 'https://unpkg.com/lucide-static@latest/icons/code-2.svg',
    cursor: 'https://unpkg.com/lucide-static@latest/icons/mouse-pointer-2.svg',
    claude_code: "data:image/svg+xml," + encodeURIComponent('<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><g fill="#D97757" transform="translate(12,12)"><rect x="-1.2" y="-11" width="2.4" height="9" rx="1.2" transform="rotate(0)"/><rect x="-1.2" y="-11" width="2.4" height="9" rx="1.2" transform="rotate(30)"/><rect x="-1.2" y="-11" width="2.4" height="9" rx="1.2" transform="rotate(60)"/><rect x="-1.2" y="-11" width="2.4" height="9" rx="1.2" transform="rotate(90)"/><rect x="-1.2" y="-11" width="2.4" height="9" rx="1.2" transform="rotate(120)"/><rect x="-1.2" y="-11" width="2.4" height="9" rx="1.2" transform="rotate(150)"/><rect x="-1.2" y="-11" width="2.4" height="9" rx="1.2" transform="rotate(180)"/><rect x="-1.2" y="-11" width="2.4" height="9" rx="1.2" transform="rotate(210)"/><rect x="-1.2" y="-11" width="2.4" height="9" rx="1.2" transform="rotate(240)"/><rect x="-1.2" y="-11" width="2.4" height="9" rx="1.2" transform="rotate(270)"/><rect x="-1.2" y="-11" width="2.4" height="9" rx="1.2" transform="rotate(300)"/><rect x="-1.2" y="-11" width="2.4" height="9" rx="1.2" transform="rotate(330)"/><circle cx="0" cy="0" r="3.5"/></g></svg>'),
    codex: "data:image/svg+xml," + encodeURIComponent('<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect width="24" height="24" fill="#000"/><g fill="none" stroke="#fff" stroke-width="1.5" transform="translate(12,12)"><path d="M0,-6 C3,-6 6,-3 6,0 C6,3 3,6 0,6 C-3,6 -6,3 -6,0 C-6,-3 -3,-6 0,-6" transform="rotate(0)"/><path d="M0,-6 C3,-6 6,-3 6,0 C6,3 3,6 0,6 C-3,6 -6,3 -6,0 C-6,-3 -3,-6 0,-6" transform="rotate(60)"/><path d="M0,-6 C3,-6 6,-3 6,0 C6,3 3,6 0,6 C-3,6 -6,3 -6,0 C-6,-3 -3,-6 0,-6" transform="rotate(120)"/></g></svg>'),
    google_meets: 'https://www.gstatic.com/images/branding/product/1x/meet_2020q4_48dp.png',
    googlemeets: 'https://www.gstatic.com/images/branding/product/1x/meet_2020q4_48dp.png',
    meet: 'https://www.gstatic.com/images/branding/product/1x/meet_2020q4_48dp.png',
    notion: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e9/Notion-logo.svg/48px-Notion-logo.svg.png',
  };

  const SOURCE_DISPLAY_NAMES = {
    gdocs: 'Google Docs',
    gmail: 'Gmail',
    email: 'Gmail',
    drive: 'Google Drive',
    google_drive: 'Google Drive',
    calendar: 'Google Calendar',
    google_calendar: 'Google Calendar',
    contacts: 'Google Contacts',
    photos: 'Google Photos',
    youtube: 'YouTube',
    fit: 'Google Fit',
    books: 'Google Books',
    tasks: 'Google Tasks',
    vscode: 'VS Code',
    cursor: 'Cursor',
    claude_code: 'Claude Code',
    codex: 'Codex CLI',
    stream: 'Streaming',
    google_meets: 'Google Meet',
    googlemeets: 'Google Meet',
    meet: 'Google Meet',
    notion: 'Notion',
    browser: 'Browser',
    text: 'Text',
    pdf: 'PDF',
    microsoft: 'Microsoft',
    microsoft_outlook: 'Outlook',
    microsoft_calendar: 'Microsoft Calendar',
    microsoft_onedrive: 'OneDrive',
    asana: 'Asana',
  };

  // ============================================================
  // SVG ICONS (inline to avoid external deps)
  // ============================================================
  const ICONS = {
    thumbsUp: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5"/></svg>',
    thumbsDown: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14H5.236a2 2 0 01-1.789-2.894l3.5-7A2 2 0 018.736 3h4.018a2 2 0 01.485.06l3.76.94m-7 10v5a2 2 0 002 2h.096c.5 0 .905-.405.905-.904 0-.715.211-1.413.608-2.008L17 13V4m-7 10h2m5-10h2a2 2 0 012 2v6a2 2 0 01-2 2h-2.5"/></svg>',
    comment: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>',
    copy: '<svg viewBox="0 0 22 22" fill="none"><path d="M8.25 8.25V5.68351C8.25 4.65675 8.25 4.14299 8.44982 3.75081C8.62559 3.40585 8.90585 3.12559 9.25081 2.94982C9.64299 2.75 10.1567 2.75 11.1835 2.75H16.3168C17.3436 2.75 17.8567 2.75 18.2489 2.94982C18.5939 3.12559 18.8746 3.40585 19.0504 3.75081C19.2502 4.14299 19.2502 4.65637 19.2502 5.68313V10.8165C19.2502 11.8433 19.2502 12.3566 19.0504 12.7488C18.8746 13.0938 18.5936 13.3746 18.2486 13.5504C17.8568 13.75 17.3443 13.75 16.3195 13.75H13.75M8.25 8.25H5.68351C4.65675 8.25 4.14299 8.25 3.75081 8.44982C3.40585 8.62559 3.12559 8.90585 2.94982 9.25081C2.75 9.64299 2.75 10.1567 2.75 11.1835V16.3168C2.75 17.3436 2.75 17.8567 2.94982 18.2489C3.12559 18.5939 3.40585 18.8746 3.75081 19.0504C4.1426 19.25 4.65574 19.25 5.6805 19.25H10.8199C11.8447 19.25 12.3571 19.25 12.7489 19.0504C13.0939 18.8746 13.3746 18.5936 13.5504 18.2486C13.75 17.8568 13.75 17.3443 13.75 16.3195V13.75M8.25 8.25H10.8168C11.8436 8.25 12.3567 8.25 12.7489 8.44982C13.0939 8.62559 13.3746 8.90585 13.5504 9.25081C13.75 9.64261 13.75 10.1558 13.75 11.1805L13.75 13.75" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    check: '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 16 16"><path stroke-linecap="round" stroke-linejoin="round" d="M13.854 3.646L6 11.5l-3.5-3.5"/></svg>',
    dismiss: '<svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>',
    sendArrow: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M15.854 7.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708-.708L14.293 8.5H.5a.5.5 0 0 1 0-1h13.793L8.146.354a.5.5 0 1 1 .708-.708l7 7z"/></svg>',
    chevronLeft: '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 18l-6-6 6-6"/></svg>',
    fallbackDoc: '<svg fill="currentColor" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 2l5 5h-5V4zM6 20V4h5v7h7v9H6z"/></svg>',
  };

  // ============================================================
  // DATE FORMATTING (ported from iOS MemoryDateFormatter)
  // ============================================================
  const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function parseISODate(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const d = new Date(trimmed);
    return isNaN(d.getTime()) ? null : d;
  }

  function getWhenValue(when, primaryKey, legacySnakeKey, legacyCamelKey) {
    if (!when || typeof when !== 'object') return '';
    return when[primaryKey] || when[legacySnakeKey] || when[legacyCamelKey] || '';
  }

  function getWhenEndRaw(when) {
    return getWhenValue(when, 'end_time', 'event_end_time', 'eventEndTime');
  }

  function getWhenStartRaw(when) {
    return getWhenValue(when, 'start_time', 'event_start_time', 'eventStartTime') || getWhenEndRaw(when);
  }

  function formatMemoryCardDate(when) {
    if (!when) return '';
    const startRaw = getWhenStartRaw(when);
    if (!startRaw) return '';
    const date = parseISODate(startRaw);
    if (!date) return '';

    const now = new Date();
    const startDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayDelta = Math.round((today - startDay) / 86400000);

    if (dayDelta === 0) return 'Today';
    if (dayDelta === 1) return 'Yesterday';
    if (dayDelta >= 2 && dayDelta <= 14) return dayDelta + ' days ago';

    return MONTHS_SHORT[date.getMonth()] + ' ' + date.getDate() + ', ' + date.getFullYear();
  }

  // ============================================================
  // HELPERS
  // ============================================================
  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function getInitials(name) {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return name.substring(0, 2).toUpperCase();
  }

  function getParticipantName(participant) {
    if (typeof participant === 'string') return participant.trim();
    if (participant && typeof participant === 'object') {
      return String(
        participant.name
          || participant.full_name
          || participant.participant_name
          || ''
      ).trim();
    }
    return '';
  }

  function normalizeParticipantNames(participants) {
    if (!Array.isArray(participants)) return [];
    return participants.map(getParticipantName).filter(Boolean);
  }

  function getMemoryNarrative(memory) {
    if (!memory || typeof memory !== 'object') return '';
    return memory.body || memory.narrative || '';
  }

  function getSourceDisplayName(source) {
    if (!source) return 'Unknown';
    const key = source.toLowerCase();
    if (SOURCE_DISPLAY_NAMES[key]) return SOURCE_DISPLAY_NAMES[key];
    return source.charAt(0).toUpperCase() + source.slice(1);
  }

  function getSourceLogo(source) {
    if (!source) return null;
    return INTEGRATION_LOGOS[source] || INTEGRATION_LOGOS[source.toLowerCase()] || null;
  }

  function isBrowserSource(source) {
    return source && source.toLowerCase() === 'browser';
  }

  function getTldFromUrl(url) {
    if (!url) return null;
    try {
      const hostname = new URL(url).hostname;
      return hostname.replace(/^www\./, '');
    } catch { return null; }
  }

  /** Resolve the best logo for a memory, checking favicon_data_uri for browser sources. */
  function getSourceLogoUrl(memory) {
    const source = memory?.source || 'unknown';
    if (isBrowserSource(source)) {
      const favicon = memory?.source_metadata?.favicon_data_uri;
      if (favicon) return favicon;
    }
    return getSourceLogo(source);
  }

  /** Resolve tooltip text — TLD for browser sources, display name otherwise. */
  function getSourceTooltip(memory) {
    const source = memory?.source || 'unknown';
    if (isBrowserSource(source)) {
      const tld = getTldFromUrl(memory?.source_metadata?.url);
      if (tld) return tld;
    }
    return getSourceDisplayName(source);
  }

  // ============================================================
  // STATE
  // ============================================================
  let cardStates = {}; // { event_id: { rating, comment, showCommentBox, unsavedComment, selectedErrorCodes: [] } }
  let currentMemories = []; // Stored from last render() for detail view
  let currentConfig = { mode: 'interactive', showDismiss: false, showCopy: true, showSimilarity: false, showErrorCodes: false, showFeedback: true, cardStyle: 'full', enableDetail: false };

  // ============================================================
  // BRIDGE (auto-detects transport)
  // ============================================================
  const BRIDGE_NONCE = (typeof window.__engrammeBridgeNonce === 'string' && window.__engrammeBridgeNonce.length >= 16)
    ? window.__engrammeBridgeNonce
    : null;

  const EngrammeBridge = {
    transport: null,
    vscodeApi: null,

    init() {
      if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.engramme) {
        this.transport = 'wkwebview';
      } else if (typeof acquireVsCodeApi === 'function') {
        this.transport = 'vscode';
        this.vscodeApi = acquireVsCodeApi();
      } else {
        this.transport = 'postmessage';
      }

      // Listen for incoming messages
      if (this.transport === 'vscode') {
        window.addEventListener('message', (e) => this._onMessage(e.data));
      } else {
        window.addEventListener('message', (e) => this._onMessage(e.data));
      }
    },

    send(type, payload) {
      const msg = { type: 'engramme:' + type, payload };
      if (BRIDGE_NONCE) msg.bridgeNonce = BRIDGE_NONCE;
      if (this.transport === 'wkwebview') {
        window.webkit.messageHandlers.engramme.postMessage(msg);
      } else if (this.transport === 'vscode') {
        this.vscodeApi.postMessage(msg);
      } else {
        window.parent.postMessage(msg, '*');
      }
    },

    _onMessage(data) {
      if (!data || !data.type) return;
      if (BRIDGE_NONCE && data.bridgeNonce !== BRIDGE_NONCE) return;
      const type = data.type.replace('engramme:', '');
      if (type === 'render') {
        EngrammeCard.render(data.payload);
      } else if (type === 'update') {
        EngrammeCard.updateCard(data.payload.event_id, data.payload);
      } else if (type === 'closeAllCommentBoxes') {
        EngrammeCard.closeAllCommentBoxes();
      } else if (type === 'showDetail') {
        if (data.payload && data.payload.event_id) {
          EngrammeCard.showDetail(data.payload.event_id);
        }
      } else if (type === 'hideDetail') {
        EngrammeCard.hideDetail();
      } else if (type === 'getAllUnsavedComments') {
        // Host can request all unsaved comments on demand
        const unsaved = {};
        Object.keys(cardStates).forEach(id => {
          const s = cardStates[id];
          if (s.unsavedComment && s.unsavedComment.trim()) {
            unsaved[id] = s.unsavedComment.trim();
          }
        });
        EngrammeBridge.send('allUnsavedComments', unsaved);
      }
    }
  };

  // ============================================================
  // CARD RENDERER
  // ============================================================
  const EngrammeCard = {
    render(payload) {
      if (!payload) return;
      const { memories = [], annotations = [], config = {} } = payload;
      currentConfig = { ...currentConfig, ...config };
      currentMemories = memories;

      // Apply maxCardWidth to CSS variable so the card respects the config value
      if (currentConfig.maxCardWidth) {
        document.documentElement.style.setProperty('--card-max-width', currentConfig.maxCardWidth);
      }

      // Hide detail view if showing
      const detailContainer = document.getElementById('detail-container');
      if (detailContainer) { detailContainer.classList.remove('visible'); detailContainer.innerHTML = ''; }
      const cardCont = document.getElementById('card-container');
      if (cardCont) cardCont.style.display = '';

      // Initialize card states from annotations, preserving local edits
      const prevStates = cardStates;
      cardStates = {};
      memories.forEach(m => {
        const ann = annotations.find(a => a.event_id === m.event_id);
        const prev = prevStates[m.event_id];
        if (prev) {
          // Preserve locally-modified state; only update from annotation if not locally changed
          cardStates[m.event_id] = {
            rating: prev.rating,
            comment: prev.comment || (ann ? (ann.comment || '') : ''),
            showCommentBox: prev.showCommentBox,
            unsavedComment: prev.unsavedComment || prev.comment || (ann ? (ann.comment || '') : ''),
            selectedErrorCodes: prev.selectedErrorCodes.length > 0 ? prev.selectedErrorCodes : (ann ? (ann.selectedErrorCodes || []) : []),
          };
        } else {
          cardStates[m.event_id] = {
            rating: ann ? ann.rating : null,
            comment: ann ? (ann.comment || '') : '',
            showCommentBox: false,
            unsavedComment: ann ? (ann.comment || '') : '',
            selectedErrorCodes: ann ? (ann.selectedErrorCodes || []) : [],
          };
        }
      });

      const container = document.getElementById('card-container');
      if (!container) return;

      // Toggle compact container class for tighter layout
      container.classList.toggle('compact-container', currentConfig.cardStyle === 'compact');

      if (memories.length === 0) {
        container.innerHTML = '<div class="empty-state">No memories to display.</div>';
        this._reportSize();
        return;
      }

      container.innerHTML = memories.map(m => this._renderCard(m)).join('');
      this._attachListeners(container, memories);
      this._reportSize();
    },

    updateCard(eventId, updates) {
      if (!cardStates[eventId]) return;
      if (updates.rating !== undefined) cardStates[eventId].rating = updates.rating;
      if (updates.comment !== undefined) cardStates[eventId].comment = updates.comment;
      // Re-render just this card's dynamic parts
      const cardEl = document.querySelector(`.memory-card[data-event-id="${eventId}"]`);
      if (cardEl) {
        this._updateCardUI(cardEl, eventId);
      }
    },

    closeAllCommentBoxes() {
      const container = document.getElementById('card-container');
      if (!container) return;
      Object.keys(cardStates).forEach(id => {
        const st = cardStates[id];
        if (st.showCommentBox) {
          st.showCommentBox = false;
          const cardEl = container.querySelector(`.memory-card[data-event-id="${id}"]`);
          if (cardEl) this._updateCardUI(cardEl, id);
        }
      });
      this._reportSize();
    },

    _renderCard(memory) {
      const { event_id, headline, participants, when, source, similarity } = memory;
      const st = cardStates[event_id] || {};
      const mode = currentConfig.mode;
      const modeClass = mode === 'minimal' ? ' minimal' : '';
      const styleClass = currentConfig.cardStyle === 'compact' ? ' compact' : '';
      const narrative = getMemoryNarrative(memory);

      // Source icon (with favicon support for browser sources)
      const logo = getSourceLogoUrl(memory);
      const sourceDisplayName = getSourceTooltip(memory);
      const defaultLogo = getSourceLogo(source);
      const sourceIconInner = logo
        ? `<img src="${logo}" alt="${escapeHtml(sourceDisplayName)}" onerror="this.style.display='none';this.nextElementSibling.style.display=''"><div class="fallback-icon" style="display:none">${ICONS.fallbackDoc}</div>`
        : `<div class="fallback-icon">${ICONS.fallbackDoc}</div>`;
      const sourceClickUrl = isBrowserSource(source) ? (memory?.source_metadata?.url || '') : '';
      const clickUrlAttr = sourceClickUrl ? ` data-click-url="${escapeHtml(sourceClickUrl)}"` : '';

      // Date
      const dateStr = typeof when === 'string' ? when : formatMemoryCardDate(when);

      // Similarity badge
      let simBadge = '';
      if (currentConfig.showSimilarity && similarity != null) {
        simBadge = `<span class="similarity-badge">sim ${Number(similarity).toFixed(2)}</span>`;
      }

      // Avatars (filter out "i" / "I" — self-references)
      let avatarsHTML = '';
      const filteredParticipants = normalizeParticipantNames(participants).filter((name) => name.toLowerCase() !== 'i');
      if (filteredParticipants.length > 0) {
        const shown = filteredParticipants.slice(0, 3);
        const overflow = filteredParticipants.length > 3 ? filteredParticipants.length - 3 : 0;
        avatarsHTML = '<div class="avatars">';
        shown.forEach((name, i) => {
          const color = AVATAR_COLORS[i % AVATAR_COLORS.length];
          avatarsHTML += `<div class="avatar" style="background:${color};z-index:${3-i}" data-name="${escapeHtml(name)}">${escapeHtml(getInitials(name))}<div class="tooltip">${escapeHtml(name)}</div></div>`;
        });
        if (overflow > 0) avatarsHTML += `<span class="avatar-overflow">+${overflow}</span>`;
        avatarsHTML += '</div>';
      }

      // Dismiss button
      const dismissHTML = currentConfig.showDismiss
        ? `<button class="dismiss-btn" data-event-id="${escapeHtml(event_id)}">${ICONS.dismiss}</button>`
        : '';

      // Copy button
      const copyHTML = currentConfig.showCopy
        ? `<button class="copy-btn" data-event-id="${escapeHtml(event_id)}">${ICONS.copy}</button>`
        : '';

      // Actions row
      let actionsHTML = '';
      if (mode !== 'minimal' && currentConfig.showFeedback !== false) {
        const readonlyClass = mode === 'readonly' ? ' readonly' : '';
        const upActive = st.rating === 1 ? ' active' : '';
        const downActive = st.rating === -1 ? ' active' : '';
        const commentActive = '';
        actionsHTML = `
          <div class="card-actions${readonlyClass}">
            <button class="action-btn thumbs-up${upActive}" data-event-id="${escapeHtml(event_id)}" data-rating="1">${ICONS.thumbsUp}</button>
            <button class="action-btn thumbs-down${downActive}" data-event-id="${escapeHtml(event_id)}" data-rating="-1">${ICONS.thumbsDown}</button>
            <button class="action-btn comment-btn${commentActive}" data-event-id="${escapeHtml(event_id)}">${ICONS.comment}</button>
          </div>`;
      }

      // Comment panel: shows when open OR when there's a saved comment
      let commentBoxHTML = '';
      if (mode === 'interactive' && st.showCommentBox) {
        const isSubmitted = !!st.comment;
        commentBoxHTML = this._renderCommentBox(event_id, st.unsavedComment, isSubmitted);
      } else if (mode !== 'minimal' && st.comment) {
        // Show submitted comment in a visible-but-greyed textarea (panel stays open)
        commentBoxHTML = this._renderCommentBox(event_id, st.comment, true);
      }

      return `
        <div class="memory-card${modeClass}${styleClass}" data-event-id="${escapeHtml(event_id)}">
          <div class="card-content">
            ${dismissHTML}
            <div class="card-header">
              <div class="source-icon-circle${sourceClickUrl ? ' clickable' : ''}" data-source="${escapeHtml(source || '')}" data-tooltip-text="${escapeHtml(sourceDisplayName)}"${clickUrlAttr}>
                ${sourceIconInner}
                <div class="tooltip">${escapeHtml(sourceDisplayName)}</div>
              </div>
              <span class="card-date">${escapeHtml(dateStr)}</span>
              ${simBadge}
              <div class="header-spacer"></div>
              ${avatarsHTML}
            </div>
            ${headline ? `<div class="card-headline">${escapeHtml(headline)}</div>` : ''}
            <div class="card-narrative">${escapeHtml(narrative || '')}</div>
            ${actionsHTML}
            ${copyHTML}
          </div>
          ${commentBoxHTML}
        </div>`;
    },

    _renderCommentBox(eventId, text, isSubmitted) {
      const submittedClass = isSubmitted ? ' submitted' : '';
      const st = cardStates[eventId] || {};

      // Error code grid inside comment box (only when showErrorCodes is on)
      let errorCodeHTML = '';
      if (currentConfig.showErrorCodes) {
        const selectedCodes = st.selectedErrorCodes || [];
        errorCodeHTML = `
          <div class="error-code-grid" data-event-id="${escapeHtml(eventId)}">
            ${ERROR_CODES.map(ec => `<button class="error-code-btn${selectedCodes.includes(ec.code) ? ' active' : ''}" data-code="${escapeHtml(ec.code)}" data-event-id="${escapeHtml(eventId)}">${escapeHtml(ec.label)}</button>`).join('')}
          </div>
          <div class="error-code-selected${selectedCodes.length ? ' visible' : ''}" data-event-id="${escapeHtml(eventId)}">
            ${selectedCodes.map(code => `<span class="error-code-selected-pill">${escapeHtml(code)} /</span>`).join('')}
          </div>`;
      }

      return `
        <div class="comment-box" data-event-id="${escapeHtml(eventId)}">
          ${errorCodeHTML}
          <div class="comment-input-row">
            <textarea class="comment-textarea${submittedClass}" placeholder="Add your comment...">${escapeHtml(text || '')}</textarea>
            <button class="comment-submit-btn" data-event-id="${escapeHtml(eventId)}">${ICONS.sendArrow}</button>
          </div>
        </div>`;
    },

    _updateCardUI(cardEl, eventId) {
      const st = cardStates[eventId];
      if (!st) return;

      // Update action button states
      const upBtn = cardEl.querySelector('.thumbs-up');
      const downBtn = cardEl.querySelector('.thumbs-down');
      const commentBtn = cardEl.querySelector('.comment-btn');
      if (upBtn) upBtn.classList.toggle('active', st.rating === 1);
      if (downBtn) downBtn.classList.toggle('active', st.rating === -1);
      // Comment button highlight removed — only highlights on explicit click

      // Comment box (with error codes inside) lives after .card-content, at end of .memory-card
      const existingBox = cardEl.querySelector('.comment-box');

      if (existingBox) existingBox.remove();

      if (currentConfig.mode === 'interactive' && st.showCommentBox) {
        const isSubmitted = !!st.comment;
        const boxHtml = this._renderCommentBox(eventId, st.unsavedComment, isSubmitted);
        cardEl.insertAdjacentHTML('beforeend', boxHtml);
        this._attachCommentBoxListeners(cardEl, eventId);
      }

      this._reportSize();
    },

    _attachListeners(container, memories) {
      // Tooltip hover for avatars and source icons
      container.querySelectorAll('.avatar, .source-icon-circle').forEach(el => {
        const tip = el.querySelector('.tooltip');
        if (!tip) return;
        el.addEventListener('mouseenter', () => tip.classList.add('visible'));
        el.addEventListener('mouseleave', () => tip.classList.remove('visible'));
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          // Source icon click-to-open (browser source → open URL)
          const clickUrl = el.dataset.clickUrl;
          if (clickUrl) {
            EngrammeBridge.send('sourceClick', { url: clickUrl, event_id: el.closest('.memory-card')?.dataset.eventId });
            return;
          }
          tip.classList.toggle('visible');
        });
      });

      // Dismiss buttons
      container.querySelectorAll('.dismiss-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          EngrammeBridge.send('dismiss', { event_id: btn.dataset.eventId });
        });
      });

      // Copy buttons
      container.querySelectorAll('.copy-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const eventId = btn.dataset.eventId;
          const memory = memories.find(m => m.event_id === eventId);
          const text = memory ? getMemoryNarrative(memory) : '';

          // Try native clipboard first, fall back to bridge
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => {
              this._showCopySuccess(btn);
            }).catch(() => {
              EngrammeBridge.send('copy', { event_id: eventId, text });
              this._showCopySuccess(btn);
            });
          } else {
            EngrammeBridge.send('copy', { event_id: eventId, text });
            this._showCopySuccess(btn);
          }
        });
      });

      // Rating buttons (only in interactive mode)
      if (currentConfig.mode === 'interactive') {
        container.querySelectorAll('.action-btn.thumbs-up, .action-btn.thumbs-down').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const eventId = btn.dataset.eventId;
            const clickedRating = parseInt(btn.dataset.rating);
            const st = cardStates[eventId];
            if (!st) return;

            const newRating = st.rating === clickedRating ? null : clickedRating;

            // If comment box open and has text, save it first
            if (st.showCommentBox && st.unsavedComment.trim()) {
              st.comment = st.unsavedComment.trim();
              st.showCommentBox = false;
              EngrammeBridge.send('comment', { event_id: eventId, comment: st.comment });
            } else if (st.showCommentBox && !st.unsavedComment.trim()) {
              st.showCommentBox = false;
            }

            // Open comment box on new rating
            if (newRating !== null && !st.showCommentBox) {
              st.showCommentBox = true;
            }

            st.rating = newRating;

            // Capture ALL unsaved comments across every card (for captureAllUnsavedComments pattern)
            const allUnsaved = {};
            Object.keys(cardStates).forEach(id => {
              const s = cardStates[id];
              if (s.unsavedComment && s.unsavedComment.trim()) {
                allUnsaved[id] = s.unsavedComment.trim();
              }
            });

            EngrammeBridge.send('rate', {
              event_id: eventId,
              rating: newRating,
              all_unsaved_comments: allUnsaved,
            });

            const cardEl = container.querySelector(`.memory-card[data-event-id="${eventId}"]`);
            if (cardEl) this._updateCardUI(cardEl, eventId);
          });
        });

        // Comment toggle buttons
        container.querySelectorAll('.action-btn.comment-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const eventId = btn.dataset.eventId;
            const st = cardStates[eventId];
            if (!st) return;

            st.showCommentBox = !st.showCommentBox;
            if (st.showCommentBox) st.unsavedComment = st.comment || '';

            const cardEl = container.querySelector(`.memory-card[data-event-id="${eventId}"]`);
            if (cardEl) this._updateCardUI(cardEl, eventId);
          });
        });

        // Attach comment box listeners for initially open boxes
        container.querySelectorAll('.comment-box').forEach(box => {
          this._attachCommentBoxListeners(box.closest('.memory-card'), box.dataset.eventId);
        });
      }

      // Card tap
      container.querySelectorAll('.memory-card').forEach(card => {
        card.addEventListener('click', (e) => {
          if (e.target.closest('.action-btn, .dismiss-btn, .copy-btn, .comment-box, .error-code-btn, .error-code-grid')) return;
          const eid = card.dataset.eventId;
          if (currentConfig.enableDetail) {
            EngrammeCard.showDetail(eid);
          } else {
            EngrammeBridge.send('tap', { event_id: eid });
          }
        });
      });
    },

    _attachCommentBoxListeners(cardEl, eventId) {
      if (!cardEl) return;
      const box = cardEl.querySelector('.comment-box');
      if (!box) return;
      const textarea = box.querySelector('.comment-textarea');
      const submitBtn = box.querySelector('.comment-submit-btn');

      if (textarea) {
        textarea.addEventListener('input', () => {
          const st = cardStates[eventId];
          if (st) {
            st.unsavedComment = textarea.value;
            // Remove submitted tint if text changes
            textarea.classList.remove('submitted');
            // Notify host of unsaved comment changes (for real-time tracking)
            EngrammeBridge.send('unsavedCommentChange', {
              event_id: eventId,
              text: textarea.value,
            });
          }
        });
        // Enter submits, Cmd/Ctrl+Enter inserts newline
        textarea.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            if (submitBtn) submitBtn.click();
          } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            textarea.value = textarea.value.substring(0, start) + '\n' + textarea.value.substring(end);
            textarea.selectionStart = textarea.selectionEnd = start + 1;
            textarea.dispatchEvent(new Event('input'));
          }
        });

        // Focus the textarea (only if not already submitted)
        if (!textarea.classList.contains('submitted')) {
          setTimeout(() => textarea.focus(), 50);
        }
      }

      if (submitBtn) {
        submitBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const st = cardStates[eventId];
          if (!st) return;
          const text = (st.unsavedComment || '').trim();
          if (!text) return;
          st.comment = text;
          EngrammeBridge.send('comment', { event_id: eventId, comment: st.comment });
          // Grey out the textarea to show it's submitted
          if (textarea) textarea.classList.add('submitted');
        });
      }

      // Error code buttons (inside comment box, only when showErrorCodes + interactive)
      if (currentConfig.showErrorCodes && currentConfig.mode === 'interactive') {
        box.querySelectorAll('.error-code-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const code = btn.dataset.code;
            const st = cardStates[eventId];
            if (!st) return;

            const codes = st.selectedErrorCodes || [];
            const idx = codes.indexOf(code);
            if (idx >= 0) {
              codes.splice(idx, 1);
            } else {
              codes.push(code);
            }
            st.selectedErrorCodes = codes;

            this._syncErrorCodeUI(cardEl, eventId);

            EngrammeBridge.send('errorCodeChange', {
              event_id: eventId,
              selectedErrorCodes: [...codes],
            });
          });
        });

        // Enable horizontal wheel scroll on grids and selected pill containers
        box.querySelectorAll('.error-code-grid').forEach(el => this._enableHorizontalWheelScroll(el));
        box.querySelectorAll('.error-code-selected').forEach(el => {
          this._enableHorizontalWheelScroll(el);
          el.scrollLeft = el.scrollWidth;
        });
      }
    },

    _syncErrorCodeUI(cardEl, eventId) {
      const st = cardStates[eventId];
      const selectedCodes = st ? (st.selectedErrorCodes || []) : [];

      const grid = cardEl.querySelector(`.error-code-grid[data-event-id="${eventId}"]`);
      if (grid) {
        grid.querySelectorAll('.error-code-btn').forEach(btn => {
          btn.classList.toggle('active', selectedCodes.includes(btn.dataset.code));
        });
      }

      const selectedContainer = cardEl.querySelector(`.error-code-selected[data-event-id="${eventId}"]`);
      if (selectedContainer) {
        selectedContainer.innerHTML = selectedCodes.map(code => `<span class="error-code-selected-pill">${escapeHtml(code)} /</span>`).join('');
        selectedContainer.classList.toggle('visible', selectedCodes.length > 0);
        selectedContainer.scrollLeft = selectedContainer.scrollWidth;
      }
    },

    _enableHorizontalWheelScroll(el) {
      if (!el) return;
      el.addEventListener('wheel', (e) => {
        if (el.scrollWidth <= el.clientWidth) return;
        if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
        el.scrollLeft += e.deltaY;
        e.preventDefault();
      }, { passive: false });
    },

    _showCopySuccess(btn) {
      btn.innerHTML = ICONS.check;
      btn.classList.add('copied');
      setTimeout(() => {
        btn.innerHTML = ICONS.copy;
        btn.classList.remove('copied');
      }, 2000);
    },

    _reportSize() {
      requestAnimationFrame(() => {
        const detail = document.getElementById('detail-container');
        const cards = document.getElementById('card-container');
        let height = 0;
        if (detail && detail.classList.contains('visible')) {
          height = Math.ceil(detail.scrollHeight);
        } else if (cards) {
          height = Math.ceil(cards.scrollHeight);
        }
        if (height > 0) EngrammeBridge.send('resize', { height });
      });
    },

    // ============================================================
    // DETAIL VIEW
    // ============================================================

    showDetail(eventId) {
      const memory = currentMemories.find(m => m.event_id === eventId);
      if (!memory) return;

      // Auto-open comment box if feedback already exists
      const st = cardStates[eventId];
      if (st) {
        const hasExisting = st.rating != null || st.comment || (st.selectedErrorCodes && st.selectedErrorCodes.length > 0);
        if (hasExisting) st.showCommentBox = true;
      }

      const cardContainer = document.getElementById('card-container');
      const detailContainer = document.getElementById('detail-container');
      if (!detailContainer) return;

      if (cardContainer) cardContainer.style.display = 'none';
      detailContainer.classList.add('visible');
      detailContainer.innerHTML = this._renderDetail(memory);
      this._attachDetailListeners(detailContainer, memory, eventId);

      EngrammeBridge.send('detailShown', { event_id: eventId });
      this._reportSize();
    },

    hideDetail() {
      const detailContainer = document.getElementById('detail-container');
      if (detailContainer) { detailContainer.classList.remove('visible'); detailContainer.innerHTML = ''; }

      // Re-render list cards to reflect any state changes made in detail view
      const cardContainer = document.getElementById('card-container');
      if (cardContainer) {
        cardContainer.style.display = '';
        cardContainer.innerHTML = currentMemories.map(m => this._renderCard(m)).join('');
        this._attachListeners(cardContainer, currentMemories);
      }

      EngrammeBridge.send('detailHidden', {});
      this._reportSize();
    },

    _renderDetail(memory) {
      const { event_id, headline, participants, when, source, similarity } = memory;
      const st = cardStates[event_id] || {};
      const narrative = getMemoryNarrative(memory);

      // Source icon
      const logo = getSourceLogoUrl(memory);
      const sourceDisplayName = getSourceTooltip(memory);
      const sourceIconInner = logo
        ? `<img src="${logo}" alt="${escapeHtml(sourceDisplayName)}" onerror="this.style.display='none';this.nextElementSibling.style.display=''"><div class="fallback-icon" style="display:none">${ICONS.fallbackDoc}</div>`
        : `<div class="fallback-icon">${ICONS.fallbackDoc}</div>`;

      const dateStr = typeof when === 'string' ? when : formatMemoryCardDate(when);
      const sourceClickUrl = isBrowserSource(source) ? (memory?.source_metadata?.url || '') : '';
      const clickAttr = sourceClickUrl ? ` data-click-url="${escapeHtml(sourceClickUrl)}"` : '';

      // Participants
      const filtered = normalizeParticipantNames(participants).filter((name) => name.toLowerCase() !== 'i');
      let participantsHTML = '';
      if (filtered.length > 0) {
        participantsHTML = '<div class="detail-participants">' + filtered.map((name, i) => {
          const color = AVATAR_COLORS[i % AVATAR_COLORS.length];
          return `<div class="detail-participant"><div class="avatar" style="background:${color}">${escapeHtml(getInitials(name))}</div><span class="detail-participant-name">${escapeHtml(name)}</span></div>`;
        }).join('') + '</div>';
      }

      const upActive = st.rating === 1 ? ' active' : '';
      const downActive = st.rating === -1 ? ' active' : '';

      let simBadge = '';
      if (currentConfig.showSimilarity && similarity != null) {
        simBadge = `<span class="similarity-badge">sim ${Number(similarity).toFixed(2)}</span>`;
      }

      // Comment panel — solely controlled by showCommentBox in detail view
      let commentBoxHTML = '';
      if (currentConfig.mode === 'interactive' && st.showCommentBox) {
        commentBoxHTML = this._renderCommentBox(event_id, st.unsavedComment || st.comment || '', !!st.comment);
      }

      return `
        <div class="detail-header-row">
          <button class="detail-back-btn">${ICONS.chevronLeft}</button>
          <div class="detail-source-icon${sourceClickUrl ? ' clickable' : ''}"${clickAttr}>${sourceIconInner}</div>
          <div class="detail-source-info">
            <div class="detail-source-label">${escapeHtml(sourceDisplayName)}</div>
            ${dateStr ? `<div class="detail-source-date">${escapeHtml(dateStr)}</div>` : ''}
          </div>
        </div>
        <div class="detail-content-wrapper">
          ${headline ? `<div class="detail-title">${escapeHtml(headline)}</div>` : ''}
          <div class="detail-narrative">${escapeHtml(narrative || '')}</div>
          ${participantsHTML}
        </div>
        <div class="detail-actions${currentConfig.mode === 'readonly' ? ' readonly' : ''}">
          ${currentConfig.showFeedback !== false ? `
          <button class="action-btn thumbs-up${upActive}" data-event-id="${escapeHtml(event_id)}" data-rating="1">${ICONS.thumbsUp}</button>
          <button class="action-btn thumbs-down${downActive}" data-event-id="${escapeHtml(event_id)}" data-rating="-1">${ICONS.thumbsDown}</button>
          <button class="action-btn comment-btn" data-event-id="${escapeHtml(event_id)}">${ICONS.comment}</button>
          ` : ''}
          <button class="action-btn copy-detail" data-event-id="${escapeHtml(event_id)}">${ICONS.copy}</button>
          ${simBadge}
        </div>
        ${currentConfig.showFeedback !== false ? `<div class="detail-comment-area" data-event-id="${escapeHtml(event_id)}">${commentBoxHTML}</div>` : ''}`;
    },

    _attachDetailListeners(container, memory, eventId) {
      // Back button
      const backBtn = container.querySelector('.detail-back-btn');
      if (backBtn) backBtn.addEventListener('click', () => this.hideDetail());

      // Source icon click (browser URL)
      const srcIcon = container.querySelector('.detail-source-icon');
      if (srcIcon && srcIcon.dataset.clickUrl) {
        srcIcon.addEventListener('click', () => {
          EngrammeBridge.send('sourceClick', { url: srcIcon.dataset.clickUrl, event_id: eventId });
        });
      }

      // Rating + comment buttons (interactive mode)
      if (currentConfig.mode === 'interactive') {
        container.querySelectorAll('.action-btn.thumbs-up, .action-btn.thumbs-down').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const st = cardStates[eventId];
            if (!st) return;
            const clicked = parseInt(btn.dataset.rating);
            const newRating = st.rating === clicked ? null : clicked;
            st.rating = newRating;
            if (newRating !== null) st.showCommentBox = true;

            const allUnsaved = {};
            Object.keys(cardStates).forEach(id => {
              const s = cardStates[id];
              if (s.unsavedComment && s.unsavedComment.trim()) allUnsaved[id] = s.unsavedComment.trim();
            });

            EngrammeBridge.send('rate', { event_id: eventId, rating: newRating, all_unsaved_comments: allUnsaved });
            this._refreshDetail(container, memory, eventId);
          });
        });

        const commentBtn = container.querySelector('.action-btn.comment-btn');
        if (commentBtn) {
          commentBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const st = cardStates[eventId];
            if (!st) return;
            st.showCommentBox = !st.showCommentBox;
            if (st.showCommentBox) st.unsavedComment = st.comment || '';
            this._refreshDetail(container, memory, eventId);
          });
        }
      }

      // Copy button
      const copyBtn = container.querySelector('.copy-detail');
      if (copyBtn) {
        copyBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const text = getMemoryNarrative(memory);
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => this._showCopySuccess(copyBtn)).catch(() => {
              EngrammeBridge.send('copy', { event_id: eventId, text });
              this._showCopySuccess(copyBtn);
            });
          } else {
            EngrammeBridge.send('copy', { event_id: eventId, text });
            this._showCopySuccess(copyBtn);
          }
        });
      }

      // Comment box listeners (error codes + textarea)
      const commentArea = container.querySelector('.detail-comment-area');
      if (commentArea && commentArea.querySelector('.comment-box')) {
        this._attachCommentBoxListeners(commentArea, eventId);
      }
    },

    _refreshDetail(container, memory, eventId) {
      // Preserve unsaved comment text before re-render
      const ta = container.querySelector('.comment-textarea');
      if (ta) { const st = cardStates[eventId]; if (st) st.unsavedComment = ta.value; }
      container.innerHTML = this._renderDetail(memory);
      this._attachDetailListeners(container, memory, eventId);
      this._reportSize();
    }
  };

  // ============================================================
  // RESIZE OBSERVER
  // ============================================================
  const container = document.getElementById('card-container');
  const detailEl = document.getElementById('detail-container');
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => EngrammeCard._reportSize());
    if (container) ro.observe(container);
    if (detailEl) ro.observe(detailEl);
  }

  // ============================================================
  // INIT
  // ============================================================
  EngrammeBridge.init();
  console.log(`🃏 Shared memory card v${SHARED_CARD_VERSION} loaded (transport: ${EngrammeBridge.transport})`);

  // Signal readiness immediately so the host can send render data.
  EngrammeBridge.send('ready', { version: SHARED_CARD_VERSION });

  // Expose for WKWebView evaluateJavaScript calls
  window.EngrammeBridge = {
    receive(data) {
      EngrammeBridge._onMessage(data);
    }
  };

  window.EngrammeCard = EngrammeCard;

})();
