// background.js - API-based memory loading

// Wrap everything in try-catch to prevent service worker crashes
try {

// Environment configuration - inline since we can't use importScripts with type: "module"
const ENVIRONMENTS = {
  dev: {
    apiGateway: 'https://memorymachines-gateway-dev-a5fddsyy.uc.gateway.dev',
    authApiBase: 'https://memorymachines-gateway-dev-a5fddsyy.uc.gateway.dev',
    backendUrl: 'https://memory-machines-backend-dev-4ocorayf6a-uc.a.run.app',
    webappUrl: 'https://memorymachinesdev.web.app',
    websocketUrl: 'https://memory-machines-websocket-dev-795455024362.us-central1.run.app',
    firebase: { apiKey: 'AIzaSyApDlbf3kensbIpgkjzH5X-ehHDqJohp5M' }
  },
  staging: {
    apiGateway: 'https://memorymachines-gateway-staging-57wqy7gu.uc.gateway.dev',
    authApiBase: 'https://memorymachines-gateway-staging-57wqy7gu.uc.gateway.dev',
    backendUrl: 'https://memory-machines-backend-staging-409038480462.us-central1.run.app',
    webappUrl: 'https://memorymachines-staging.web.app',
    websocketUrl: 'https://memory-machines-websocket-staging-409038480462.us-central1.run.app',
    firebase: { apiKey: 'AIzaSyAOPF6EQ_oSDUhFbRMqKlezxm7C8-d7i_s' }
  },
  prod: {
    apiGateway: 'https://memorymachines-gateway-prod-btf57kda.uc.gateway.dev',
    authApiBase: 'https://memorymachines-gateway-prod-btf57kda.uc.gateway.dev',
    backendUrl: 'https://memory-machines-backend-prod-42us6ic5ya-uc.a.run.app',
    webappUrl: 'https://memorymachines-prod.web.app',
    websocketUrl: 'https://memory-machines-websocket-prod-42us6ic5ya-uc.a.run.app',
    firebase: { apiKey: 'AIzaSyB7DIVqzT72Pg9KAhJQCxNgBw7ZeTyLkzc' }
  }
};

async function getCurrentEnvironment() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['devModeEnabled', 'selectedEnvironment'], (result) => {
      const env = result.devModeEnabled && result.selectedEnvironment
        ? result.selectedEnvironment
        : 'prod';
      resolve(ENVIRONMENTS[env] || ENVIRONMENTS['prod']);
    });
  });
}

async function getEnvironmentName() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['devModeEnabled', 'selectedEnvironment'], (result) => {
      const env = result.devModeEnabled && result.selectedEnvironment
        ? result.selectedEnvironment
        : 'prod';
      resolve(env);
    });
  });
}

const RECALL_CONTEXT_PREFIX = 'recallContext:';
const RECALL_CONTEXT_INDEX_KEY = 'recallContextIndex';
const RECALL_CONTEXT_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_RECALL_CONTEXTS = 10;

// Developer settings defaults
const DEFAULT_LLM_PROXY_FILTER = false;
const DEFAULT_LLM_PROXY_FILTER_IS_SOFT = false;
const DEFAULT_ALPHA = 1.0;

// Fast in-memory cache; storage.session is used to survive service worker restarts.
const recallContextCache = new Map();

// API configuration - will be set dynamically based on environment
let API_BASE_URL;
let AUTH_API_BASE;
let FIREBASE_API_KEY;
let BACKEND_URL;

function getLocalFeedbackEnabled() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['localFeedbackBackend'], (result) => {
      resolve(result.localFeedbackBackend || false);
    });
  });
}

function getSessionStorageArea() {
  return chrome.storage?.session || null;
}

function sessionStorageGet(keys) {
  const area = getSessionStorageArea();
  if (!area) return Promise.resolve({});
  return new Promise((resolve) => {
    area.get(keys, (result) => {
      if (chrome.runtime.lastError) {
        resolve({});
        return;
      }
      resolve(result || {});
    });
  });
}

function sessionStorageSet(items) {
  const area = getSessionStorageArea();
  if (!area) return Promise.resolve(false);
  return new Promise((resolve) => {
    area.set(items, () => {
      if (chrome.runtime.lastError) {
        resolve(false);
        return;
      }
      resolve(true);
    });
  });
}

function sessionStorageRemove(keys) {
  const area = getSessionStorageArea();
  if (!area || !keys || keys.length === 0) return Promise.resolve(false);
  return new Promise((resolve) => {
    area.remove(keys, () => {
      if (chrome.runtime.lastError) {
        resolve(false);
        return;
      }
      resolve(true);
    });
  });
}

function generateRecallId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `recall_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeIsoTimestamp(value) {
  if (typeof value !== 'string') return null;
  const parsedMs = new Date(value).getTime();
  if (!Number.isFinite(parsedMs)) return null;
  return new Date(parsedMs).toISOString();
}

function upsertRecallContextCache(recallId, context) {
  recallContextCache.set(recallId, context);
  if (recallContextCache.size <= MAX_RECALL_CONTEXTS) return;
  const entriesByTime = Array.from(recallContextCache.entries())
    .sort((a, b) => new Date(a[1]?.displayedAt || 0) - new Date(b[1]?.displayedAt || 0));
  while (entriesByTime.length > MAX_RECALL_CONTEXTS) {
    const [oldestId] = entriesByTime.shift();
    recallContextCache.delete(oldestId);
  }
}

async function saveRecallContext(recallId, responseData, displayedAt, queryText = null, queryRequestedAt = null, resultReceivedAt = null, senderTabUrl = null, ambienceTimeRange = null, inputMode = 'text', voiceRecallIntervalS = null) {
  const context = { recallId, displayedAt, responseData, queryText, queryRequestedAt, resultReceivedAt, senderTabUrl, ambienceTimeRange, inputMode, voiceRecallIntervalS };
  upsertRecallContextCache(recallId, context);

  const area = getSessionStorageArea();
  if (!area) return;

  const nowMs = Date.now();
  const indexResult = await sessionStorageGet([RECALL_CONTEXT_INDEX_KEY]);
  const existingIndex = Array.isArray(indexResult[RECALL_CONTEXT_INDEX_KEY])
    ? indexResult[RECALL_CONTEXT_INDEX_KEY]
    : [];

  const retained = [];
  const idsToDelete = [];
  const seen = new Set();

  // Cleanup pass: filter existing index entries, applying both TTL-based and dedup eviction
  existingIndex.forEach((entry) => {
    if (!entry || typeof entry.id !== 'string') return;
    // Dedup: mark duplicate entries for deletion
    if (seen.has(entry.id)) {
      idsToDelete.push(entry.id);
      return;
    }
    seen.add(entry.id);

    // Skip current recallId (will be re-added below)
    if (entry.id === recallId) return;

    // TTL eviction: delete entries older than RECALL_CONTEXT_TTL_MS
    if (nowMs - (entry.createdAtMs || 0) > RECALL_CONTEXT_TTL_MS) {
      idsToDelete.push(entry.id);
      return;
    }

    retained.push(entry);
  });

  // Add current recall context
  retained.push({ id: recallId, createdAtMs: nowMs });
  // Count-based eviction: keep only MAX_RECALL_CONTEXTS most recent entries (FIFO)
  while (retained.length > MAX_RECALL_CONTEXTS) {
    const dropped = retained.shift();
    if (dropped?.id) idsToDelete.push(dropped.id);
  }

  await sessionStorageSet({
    [`${RECALL_CONTEXT_PREFIX}${recallId}`]: context,
    [RECALL_CONTEXT_INDEX_KEY]: retained
  });

  const removeKeys = Array.from(new Set(idsToDelete.filter((id) => id !== recallId)))
    .map((id) => `${RECALL_CONTEXT_PREFIX}${id}`);
  if (removeKeys.length > 0) {
    await sessionStorageRemove(removeKeys);
  }
}

async function getRecallContext(recallId) {
  if (!recallId) return null;
  const nowMs = Date.now();
  const cached = recallContextCache.get(recallId);
  if (cached) {
    const cachedAgeMs = nowMs - new Date(cached.displayedAt || 0).getTime();
    if (!Number.isFinite(cachedAgeMs) || cachedAgeMs > RECALL_CONTEXT_TTL_MS) {
      recallContextCache.delete(recallId);
    } else {
      return cached;
    }
  }

  const sessionKey = `${RECALL_CONTEXT_PREFIX}${recallId}`;
  const stored = await sessionStorageGet([sessionKey]);
  const context = stored[sessionKey] || null;
  if (!context) {
    return null;
  }

  const contextAgeMs = nowMs - new Date(context.displayedAt || 0).getTime();
  if (!Number.isFinite(contextAgeMs) || contextAgeMs > RECALL_CONTEXT_TTL_MS) {
    await sessionStorageRemove([sessionKey]);
    return null;
  }

  upsertRecallContextCache(recallId, context);
  return context;
}

async function getFeedbackBackendUrl() {
  const env = await getCurrentEnvironment();
  const localFeedbackEnabled = await getLocalFeedbackEnabled();
  return localFeedbackEnabled ? 'http://localhost:5002' : env.backendUrl;
}

function dedupeUrls(urls) {
  const seen = new Set();
  const result = [];
  for (const url of urls) {
    if (!url || typeof url !== 'string') continue;
    const normalized = url.replace(/\/+$/, '');
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function looksLikeHtmlDocument(text) {
  const trimmed = String(text || '').trim().toLowerCase();
  return trimmed.startsWith('<!doctype html') || trimmed.startsWith('<html');
}

async function getSharedCardBaseUrls() {
  const env = await getCurrentEnvironment();
  const localFeedbackEnabled = await getLocalFeedbackEnabled();
  if (localFeedbackEnabled) {
    return ['http://localhost:5002'];
  }
  return dedupeUrls([env.backendUrl, env.webappUrl]);
}

async function fetchSharedCardFromBase(baseUrl, sourceLabel) {
  const base = `${baseUrl}/embed/card/`;
  const [htmlResp, jsResp] = await Promise.all([
    fetch(base),
    fetch(`${base}memory-card.js`)
  ]);

  if (!htmlResp.ok || !jsResp.ok) {
    return { success: false, error: `${sourceLabel} HTTP ${htmlResp.status}/${jsResp.status}` };
  }

  const html = await htmlResp.text();
  const js = await jsResp.text();
  if (looksLikeHtmlDocument(js)) {
    return { success: false, error: `${sourceLabel} returned HTML for memory-card.js` };
  }

  return { success: true, html, js, source: sourceLabel };
}

async function fetchBundledSharedCardAssets() {
  const htmlUrl = chrome.runtime.getURL('assets/shared-card.html');
  const jsUrl = chrome.runtime.getURL('assets/shared-card.js');
  const [htmlResp, jsResp] = await Promise.all([fetch(htmlUrl), fetch(jsUrl)]);
  if (!htmlResp.ok || !jsResp.ok) {
    return { success: false, error: `bundled assets HTTP ${htmlResp.status}/${jsResp.status}` };
  }

  const html = await htmlResp.text();
  const js = await jsResp.text();
  if (looksLikeHtmlDocument(js)) {
    return { success: false, error: 'bundled memory-card.js payload is invalid' };
  }

  return { success: true, html, js, source: 'bundled' };
}

// Initialize environment configuration
async function initializeEnvironmentConfig() {
  const env = await getCurrentEnvironment();
  API_BASE_URL = env.apiGateway;
  AUTH_API_BASE = env.authApiBase;
  FIREBASE_API_KEY = env.firebase.apiKey;
  BACKEND_URL = env.backendUrl;

  const envName = await getEnvironmentName();
}

// Call initialization immediately
initializeEnvironmentConfig();

const OFFSCREEN_DOCUMENT_PATH = 'src/offscreen/meet-tab-capture.html';
let activeTabCaptureTabId = null;

function sendOffscreenMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response);
    });
  });
}

async function ensureOffscreenDocument() {
  if (!chrome.offscreen) {
    throw new Error('Offscreen API not available');
  }
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl]
  });
  if (contexts.length > 0) {
    return;
  }
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: ['USER_MEDIA', 'AUDIO_PLAYBACK'],
    justification: 'Capture tab audio for transcription and play audio back'
  });
}

// Format date for display: "X days ago" (1-14 days) or "MM/DD/YYYY"
function getWhenStartRaw(whenObj) {
  if (!whenObj || typeof whenObj !== 'object') return '';
  return whenObj.start_time
    || whenObj.event_start_time
    || whenObj.eventStartTime
    || whenObj.end_time
    || whenObj.event_end_time
    || whenObj.eventEndTime
    || '';
}

function formatWhen(whenObj) {
  if (!whenObj) return '';

  let dtstr;
  if (typeof whenObj === 'string') {
    dtstr = whenObj;
  } else {
    dtstr = getWhenStartRaw(whenObj);
  }

  if (!dtstr) return '';
  const lowered = dtstr.toLowerCase();
  if (['unknown', 'n/a', 'na', ''].includes(lowered)) return '';

  // Year only (e.g., "2025")
  if (/^\d{4}$/.test(dtstr)) {
    return dtstr;
  }

  // Year-month only (e.g., "2025-12")
  if (/^\d{4}-(\d{2})$/.test(dtstr)) {
    const match = dtstr.match(/^(\d{4})-(\d{2})$/);
    const month = parseInt(match[2], 10);
    const year = match[1];
    return `${month.toString().padStart(2, '0')}/${year}`;
  }

  // Try to parse as date
  let dt;
  try {
    dt = new Date(dtstr);
    if (isNaN(dt.getTime())) return dtstr;
  } catch {
    return dtstr;
  }

  // Calculate days ago
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dateOnly = new Date(dt);
  dateOnly.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((today - dateOnly) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return 'Today';
  }
  if (diffDays === 1) {
    return 'Yesterday';
  }
  if (diffDays >= 2 && diffDays <= 14) {
    return `${diffDays} days ago`;
  }

  // Show "Mon D, YYYY"
  const monthsShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthName = monthsShort[dt.getMonth()];
  const day = dt.getDate();
  const year = dt.getFullYear();
  return `${monthName} ${day}, ${year}`;
}

function normalizeParticipantNames(participants) {
  if (!Array.isArray(participants)) return [];

  return participants
    .map((participant) => {
      if (typeof participant === 'string') {
        return participant.trim();
      }
      if (participant && typeof participant === 'object') {
        return String(
          participant.name
            || participant.full_name
            || participant.participant_name
            || ''
        ).trim();
      }
      return '';
    })
    .filter(Boolean);
}

// Get user_id from API key via backend
async function getUserIdFromApiKey(apiKey) {
  try {
    const response = await fetch(`${BACKEND_URL}/api/auth/user-id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey })
    });

    if (!response.ok) {
      throw new Error(`Failed to get user_id: ${response.status}`);
    }

    const data = await response.json();
    return data.user_id;
  } catch (error) {
    console.error('❌ Error getting user_id from API key:', error);
    return null;
  }
}

// Submit batch feedback to Cloud Run backend
async function submitBatchFeedback(userId, queryText, sourceApp, globalFeedback, memoryFeedback, recallResponse, frontendMeta, timing) {
  try {
    // Get version from manifest.json (single source of truth)
    const manifest = chrome.runtime.getManifest();
    const appVersion = manifest.version;

    const requestBody = {
      user_id: userId,
      timestamp: new Date().toISOString(),
      source_app: sourceApp, // Dynamic: 'chrome_gmail' or 'chrome_web'
      source_app_version: appVersion,
      timing: timing || null,
      global_feedback: globalFeedback,
      memory_feedback: memoryFeedback,
      recall_response: recallResponse || null,
      frontend_meta: frontendMeta || null,
    };
    if (queryText !== null) {
      requestBody.query_text = queryText;
    }

    // Resolve at submit time so toggles apply immediately without stale worker state.
    const feedbackUrl = await getFeedbackBackendUrl();


    const response = await fetch(`${feedbackUrl}/api/feedback/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Backend error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    return { success: true, data: result };

  } catch (error) {
    console.error('❌ Error submitting batch feedback:', error);
    return { success: false, error: error.message };
  }
}

// Get API configuration
async function getApiConfig() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['apiKey'], (result) => {
      resolve({
        apiKey: result.apiKey || ''
      });
    });
  });
}

// Store API configuration status
let isApiConfigured = false;

// Check if API is configured
async function checkApiConfiguration() {
  const config = await getApiConfig();
  isApiConfigured = !!config.apiKey;
  return isApiConfigured;
}

// Load memories - now this just signals content scripts that API is ready
async function loadMemoriesFromSheets() {

  try {
    // Ensure environment config is loaded
    await initializeEnvironmentConfig();

    const isConfigured = await checkApiConfiguration();

    if (!isConfigured) {

      const storageData = {
        apiConfigured: false,
        lastUpdated: Date.now(),
        updateSource: 'api'
      };

      chrome.storage.local.set(storageData, async () => {
        await notifyGmailTabs();
      });
      return;
    }

    // API is configured, let content scripts know
    const storageData = {
      apiConfigured: true,
      lastUpdated: Date.now(),
      updateSource: 'api'
    };

    chrome.storage.local.set(storageData, async () => {
      if (chrome.runtime.lastError) {
        console.error('❌ Failed to store status:', chrome.runtime.lastError);
      } else {
        await notifyGmailTabs();
      }
    });

  } catch (error) {
    console.error('❌ Failed to initialize memory service:', error);
  }
}

async function fetchFaviconAsDataUri(favIconUrl) {
  if (!favIconUrl) return null;
  try {
    const iconResponse = await fetch(favIconUrl);
    if (!iconResponse.ok) return null;
    const iconBlob = await iconResponse.blob();
    if (iconBlob.size >= 32 * 1024) return null;
    const mime = iconBlob.type || 'image/x-icon';
    if (!mime.startsWith('image/')) return null;
    const buf = await iconBlob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    return `data:${mime};base64,${base64}`;
  } catch (e) {
    return null;
  }
}

function isHttpsUrl(url) {
  if (!url) return false;
  try { return new URL(url).protocol === 'https:'; }
  catch { return false; }
}

async function buildSourceMetadata(url, favIconUrl) {
  const metadata = {};
  if (isHttpsUrl(url)) {
    metadata.url = url;
  }
  const faviconUri = await fetchFaviconAsDataUri(favIconUrl);
  if (faviconUri) {
    metadata.favicon_data_uri = faviconUri;
  }
  return Object.keys(metadata).length > 0 ? metadata : null;
}

async function notifyGmailTabs() {
  try {
    const allTabs = await chrome.tabs.query({});

    // Filter out chrome:// and other internal URLs
    const relevantTabs = allTabs.filter(tab => {
      if (!tab.url ||
          tab.url.startsWith('chrome://') ||
          tab.url.startsWith('chrome-extension://') ||
          tab.url.startsWith('about:')) {
        return false;
      }
      return true;
    });


    for (const tab of relevantTabs) {
      try {
        await chrome.tabs.sendMessage(tab.id, {
          action: 'apiConfigured'
        });
      } catch (err) {
      }
    }
  } catch (err) {
    console.error('❌ Error querying/notifying tabs:', err);
  }
}

// Keepalive alarm — wakes service worker periodically to stay responsive
chrome.alarms.create('keepalive', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepalive') {
    // No-op — just keeps the service worker process warm
  }
});

// Event listeners
chrome.runtime.onInstalled.addListener((details) => {
  loadMemoriesFromSheets();
});

chrome.runtime.onStartup.addListener(() => {
  loadMemoriesFromSheets();
});

// Message handler
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  if (request.action === 'heartbeat') {
    sendResponse({ alive: true });
    return;
  }

  if (request.action === 'getFeedbackCount') {
    (async () => {
      try {
        const config = await getApiConfig();
        if (!config.apiKey) {
          sendResponse({ success: false });
          return;
        }
        const resp = await fetch(`${BACKEND_URL}/api/user/feedback-count`, {
          method: 'GET',
          headers: { 'x-api-key': config.apiKey, 'Content-Type': 'application/json' }
        });
        if (!resp.ok) {
          sendResponse({ success: false });
          return;
        }
        const data = await resp.json();
        sendResponse({ success: true, likes: data.likes || 0, dislikes: data.dislikes || 0, total: data.total || 0 });
      } catch (e) {
        sendResponse({ success: false });
      }
    })();
    return true;
  }

  if (request.action === 'refreshMemories') {
    loadMemoriesFromSheets();
    sendResponse({ success: true });
    return true;
  }

  // Handle sign out - clear cached credentials
  if (request.action === 'signOut') {
    isApiConfigured = false;
    chrome.storage.local.set({ apiConfigured: false });
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'startGoogleAuth') {
    (async () => {
      try {
        // Ensure environment config is loaded
        await initializeEnvironmentConfig();

        const senderTabId = sender && sender.tab && Number.isInteger(sender.tab.id) ? sender.tab.id : null;
        const targetTabId = Number.isInteger(request.tabId) ? request.tabId : senderTabId;
        const accessToken = await new Promise((resolve, reject) => {
          chrome.identity.getAuthToken({ interactive: true }, (token) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(token);
            }
          });
        });

        const idpResponse = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${FIREBASE_API_KEY}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            postBody: `access_token=${encodeURIComponent(accessToken)}&providerId=google.com`,
            requestUri: 'http://localhost',
            returnIdpCredential: true,
            returnSecureToken: true
          })
        });

        if (!idpResponse.ok) {
          const errorText = await idpResponse.text();
          throw new Error(`Firebase auth failed: ${errorText}`);
        }

        const idpData = await idpResponse.json();
        const idToken = idpData.idToken;

        const authResponse = await fetch(`${AUTH_API_BASE}/v1/auth/login`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${idToken}`,
            'Content-Type': 'application/json'
          }
        });

        if (!authResponse.ok) {
          const errorText = await authResponse.text();
          throw new Error(`Backend auth failed: ${errorText}`);
        }

        const authData = await authResponse.json();

        await new Promise((resolve, reject) => {
          chrome.storage.sync.set({
            apiKey: authData.api_key,
            userId: authData.user_id,
            userName: authData.user_name || idpData.displayName,
            userEmail: idpData.email,
            isGoogleAuth: true
          }, () => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve();
            }
          });
        });

        chrome.storage.local.set({
          apiConfigured: true,
          lastUpdated: new Date().toISOString()
        });

        loadMemoriesFromSheets();

        if (targetTabId !== null) {
          chrome.tabs.reload(targetTabId);
        } else {
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs && tabs[0] && tabs[0].id) {
              chrome.tabs.reload(tabs[0].id);
            }
          });
        }

        chrome.tabs.query({}, (tabs) => {
          tabs.forEach((tab) => {
            if (tab.id) {
              chrome.tabs.sendMessage(tab.id, { action: 'apiConfigured' });
            }
          });
        });

        sendResponse({
          success: true,
          userName: authData.user_name || idpData.displayName,
          userEmail: idpData.email
        });
      } catch (error) {
        console.error('❌ Google auth failed:', error);
        sendResponse({ success: false, error: error.message || 'Google auth failed' });
      }
    })();
    return true;
  }

  if (request.action === 'getStorageData') {
    chrome.storage.local.get(null, (result) => {
      sendResponse({ success: true, data: result });
    });
    return true;
  }

  // Handle memory recall requests from content scripts
  if (request.action === 'recallMemories') {
    (async () => {
      let confirmedPayload = null;
      try {
        // Ensure environment config is loaded
        await initializeEnvironmentConfig();

        const config = await getApiConfig();
        if (!config.apiKey) {
          sendResponse({ success: false, error: 'API key not configured' });
          return;
        }

        // Get participant emails for ambience_metadata
        const participantEmails = request.participantEmails || [];

        // Truncate to 1000 characters (use last 1000 - prioritize recent messages in threads)
        const normalizedText = (request.text || '').replace(/\s+/g, ' ').trim();
        const wasTruncated = normalizedText.length > 1000;
        const truncatedText = wasTruncated
          ? normalizedText.slice(-1000)
          : normalizedText;

        const requestUrl = `${API_BASE_URL}/v1/memories/recall`;

        // Check if debug mode is enabled
        const debugMode = await new Promise((resolve) => {
          chrome.storage.sync.get(['debugMode'], (result) => {
            resolve(result.debugMode || false);
          });
        });

        // Read dev settings for recall parameters
        const devSettings = await new Promise((resolve) => {
          chrome.storage.sync.get([
            'llmProxyFilter', 'llmProxyFilterIsSoft', 'alpha',
            'sourceFilter', 'participantMatchMode', 'diversityMatchMode',
            'simThreshold', 'minAge', 'maxAge', 'enableTrace',
            'enableEntityResolution', 'demoMode'
          ], (result) => {
            const isDemoMode = result.demoMode ?? false;
            resolve({
              // Demo mode forces proxy OFF
              llmProxyFilter: isDemoMode ? false : (result.llmProxyFilter ?? DEFAULT_LLM_PROXY_FILTER),
              llmProxyFilterIsSoft: isDemoMode ? false : (result.llmProxyFilterIsSoft ?? DEFAULT_LLM_PROXY_FILTER_IS_SOFT),
              alpha: result.alpha ?? DEFAULT_ALPHA,
              sourceFilter: result.sourceFilter || '',
              participantMatchMode: result.participantMatchMode || 'symbolic',
              diversityMatchMode: result.diversityMatchMode || 'bow',
              simThreshold: result.simThreshold ?? 0.3,
              minAge: result.minAge ?? 0,
              maxAge: result.maxAge ?? 365,
              enableTrace: result.enableTrace ?? true,
              enableEntityResolution: result.enableEntityResolution ?? false
            });
          });
        });

        const formData = new FormData();
        formData.append('text', truncatedText);
        formData.append('top_k', '3');  // Limit to 3 memories for extension
        formData.append('enable_llm_proxy_filter', devSettings.llmProxyFilter.toString());
        formData.append('llm_proxy_filter_is_soft', devSettings.llmProxyFilterIsSoft.toString());
        formData.append('alpha', devSettings.alpha.toString());
        formData.append('enable_trace', devSettings.enableTrace.toString());
        formData.append('participant_match_mode', devSettings.participantMatchMode);
        formData.append('diversity_match_mode', devSettings.diversityMatchMode);
        if (devSettings.sourceFilter) {
          formData.append('source', devSettings.sourceFilter);
        }

        // Build ambience_metadata with recall-scoped filtering and dev parameters.
        let ambienceObj = {
          enable_entity_resolution: devSettings.enableEntityResolution
        };
        if (participantEmails.length > 0) {
          ambienceObj.participant_emails = participantEmails;
        }
        if (devSettings.simThreshold > 0) {
          ambienceObj.similarity_score_threshold = devSettings.simThreshold;
        }
        if (devSettings.minAge > 0 || devSettings.maxAge !== 365) {
          ambienceObj.allowed_time_window = {
            min_age: devSettings.minAge,
            max_age: devSettings.maxAge
          };
        }
        let ambienceMetadata = null;
        if (Object.keys(ambienceObj).length > 0) {
          ambienceMetadata = JSON.stringify(ambienceObj);
          formData.append('ambience_metadata', ambienceMetadata);
        }

        // Build confirmed payload object for debugging (what we actually send)
        confirmedPayload = {
          url: requestUrl,
          method: 'POST',
          text: truncatedText,
          textLength: truncatedText.length,
          pretruncationTextLength: normalizedText.length,
          wasTruncated,
          truncationMode: wasTruncated ? 'last_1000_chars' : 'none',
          top_k: '3',
          enable_llm_proxy_filter: devSettings.llmProxyFilter,
          llm_proxy_filter_is_soft: devSettings.llmProxyFilterIsSoft,
          alpha: devSettings.alpha,
          enable_trace: devSettings.enableTrace,
          participant_match_mode: devSettings.participantMatchMode,
          diversity_match_mode: devSettings.diversityMatchMode,
          source_filter: devSettings.sourceFilter || undefined,
          sim_threshold: devSettings.simThreshold || undefined,
          min_age: devSettings.minAge || undefined,
          max_age: devSettings.maxAge !== 365 ? devSettings.maxAge : undefined,
          enable_entity_resolution: devSettings.enableEntityResolution,
          ambience_metadata: ambienceMetadata,
          participant_emails: participantEmails,
          timestamp: new Date().toISOString()
        };

        // DEBUG MODE: Log exact payload being sent to recall route
        if (debugMode) {
        } else {
        }

        const queryRequestedAt = new Date().toISOString();
        const response = await fetch(requestUrl, {
          method: 'POST',
          headers: {
            'x-api-key': config.apiKey
          },
          body: formData
        });
        const resultReceivedAt = new Date().toISOString();

        if (!response.ok) {
          let errorText;
          try {
            errorText = await response.text();
          } catch (e) {
            errorText = 'Could not read error response';
          }
          console.error('❌ API error details:', {
            status: response.status,
            statusText: response.statusText,
            errorBody: errorText
          });
          throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
        }

        const data = await response.json();
        const recallId = generateRecallId();
        const displayedAt = new Date().toISOString();
        const recallQueryText = request.originalText || request.text || null;

        // Build ambience time range for feedback (transcript span, if available)
        const transcriptTiming = request.transcriptTiming || null;
        const transcriptStartAt = normalizeIsoTimestamp(transcriptTiming?.transcriptStartAt);
        const transcriptEndAt = normalizeIsoTimestamp(transcriptTiming?.transcriptEndAt);
        const parsedVoiceRecallIntervalS = Number(transcriptTiming?.voiceRecallIntervalS);
        const voiceRecallIntervalS = Number.isFinite(parsedVoiceRecallIntervalS)
          ? parsedVoiceRecallIntervalS
          : null;
        const ambienceTimeRange = {
          transcript_start_at: transcriptStartAt,
          transcript_end_at: transcriptEndAt,
          min_age_days: devSettings.minAge,
          max_age_days: devSettings.maxAge
        };

        // Persist recall context so feedback enrichment can survive service worker restarts.
        const senderTabUrl = sender.tab?.url || null;
        const inputMode = (transcriptStartAt || transcriptEndAt) ? 'voice' : 'text';
        await saveRecallContext(
          recallId,
          data,
          displayedAt,
          recallQueryText,
          queryRequestedAt,
          resultReceivedAt,
          senderTabUrl,
          ambienceTimeRange,
          inputMode,
          voiceRecallIntervalS
        );

        // Log full API response for debugging

        // Log first memory in detail if available
        if (data.memories && data.memories.length > 0) {
        }
        if (data.qa && data.qa.length > 0) {
        }
        if (data.chunks && data.chunks.length > 0) {
        }

        // Transform memories to match Gmail extension expectations
        const transformedMemories = (data.memories || []).map(memory => {
          const formattedWhen = formatWhen(memory.content?.when);

          // Extract entities (people/orgs) from content
          const entities = memory.content?.entities || {};
          const entityNames = Object.keys(entities).filter(name =>
            entities[name] === 'Person' || entities[name] === 'Organization'
          );

          // Get participants from email metadata
          const participants = normalizeParticipantNames(memory.content?.participants || []);

          // Combine both and deduplicate (prefer participants list as it's more accurate)
          const allPeople = [...new Set([...participants, ...entityNames])];

          // Map backend source names to frontend icon names (same as web app)
          const sourceMapping = {
            'email': 'gmail',
            'gmail': 'gmail',
            'calendar': 'calendar',
            'drive': 'drive',
            'slack': 'slack',
            'contacts': 'contacts',
            'photos': 'photos',
            'youtube': 'youtube',
            'tasks': 'tasks',
            'books': 'books',
            'fit': 'fit',
            'github': 'github',
            'microsoft': 'microsoft',
            'zoom': 'zoom',
            'asana': 'asana',
            'browser': 'browser',
            'text': 'text',
            'pdf': 'pdf',
            'vscode': 'vscode',
            'cursor': 'cursor',
            'claude_code': 'claude_code',
            'claude code': 'claude_code',
            'codex': 'codex',
            'codex_cli': 'codex',
            'codex cli': 'codex',
            'gdocs': 'gdocs',
            'google docs': 'gdocs',
            'google_meets': 'meet',
            'googlemeets': 'meet',
            'google meet': 'meet',
            'meet': 'meet',
            'stream': 'stream'
          };

          // Get the actual source from the API (check multiple possible fields)
          const rawSource = memory.source || memory.content?.where || memory.content?.source || '';
          const normalizedSource = String(rawSource).trim().toLowerCase();
          const mappedSource = sourceMapping[normalizedSource] || normalizedSource;

          return {
            event_id: memory.custom_id,  // Use custom_id as unique identifier
            headline: memory.content?.headline || '',
            narrative: memory.content?.body || memory.content?.narrative || '',
            participants: allPeople,  // Combined unique list of people
            entities: entityNames,  // Just entities for reference
            entitiesWithTypes: entities,  // Full entities object with types
            when: formattedWhen,
            where: memory.content?.where || '',
            what_and_why: memory.content?.what_and_why || '',
            tags: memory.content?.tags || [],
            similarity: memory.score || 0,
            source: mappedSource,  // Add source field for icon rendering
            source_metadata: memory.content?.source_metadata || null,
          };
        });

        // Log first 10 transformed memories to inspect structure
        const memoriesToLog = transformedMemories.slice(0, 10);
        memoriesToLog.forEach((memory, index) => {
        });

        sendResponse({ success: true, memories: transformedMemories, recallId, trace: data.trace || null, confirmedPayload });
      } catch (error) {
        console.error('❌ Error recalling memories:', error);
        sendResponse({ success: false, error: error.message, confirmedPayload });
      }
    })();
    return true; // Keep channel open for async response
  }

  // Handle chat message requests from content scripts
  if (request.action === 'chatMemories') {
    (async () => {
      try {
        // Ensure environment config is loaded
        await initializeEnvironmentConfig();

        const config = await getApiConfig();
        if (!config.apiKey) {
          sendResponse({ success: false, error: 'API key not configured' });
          return;
        }

        const requestUrl = `${API_BASE_URL}/v1/memories/ask`;

        const formData = new FormData();
        formData.append('text', request.text);

        const response = await fetch(requestUrl, {
          method: 'POST',
          headers: {
            'x-api-key': config.apiKey
          },
          body: formData
        });

        if (!response.ok) {
          let errorText;
          try {
            errorText = await response.text();
          } catch (e) {
            errorText = 'Could not read error response';
          }
          console.error('❌ Chat API error:', {
            status: response.status,
            statusText: response.statusText,
            errorBody: errorText
          });
          throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
        }

        const data = await response.json();

        sendResponse({ success: true, response: data.response || '' });
      } catch (error) {
        console.error('❌ Error in chat request:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true; // Keep channel open for async response
  }

  // Handle memory creation (memorize) requests from content scripts
  if (request.action === 'memorizeContent') {
    (async () => {
      try {
        // Ensure environment config is loaded
        await initializeEnvironmentConfig();

        const config = await getApiConfig();
        if (!config.apiKey) {
          sendResponse({ success: false, error: 'API key not configured' });
          return;
        }

        // Get user_id from API key
        const storage = await chrome.storage.sync.get(['userId', 'apiKey']);
        let userId = storage.userId;

        if (!userId && storage.apiKey) {
          userId = await getUserIdFromApiKey(storage.apiKey);
          if (userId) {
            await chrome.storage.sync.set({ userId });
          }
        }

        // Use user_id as user_name if available, otherwise use "Browser User"
        const userName = userId || 'Browser User';


        // Create a text file blob from the content
        const blob = new Blob([request.text], { type: 'text/plain' });
        const fileName = `browser_${Date.now()}.txt`;


        const formData = new FormData();
        formData.append('file', blob, fileName);
        formData.append('user_name', userName);
        formData.append('source_type', 'browser');

        // Optional: Add item_id with URL for tracking
        // item_id must contain only alphanumeric characters, underscores, and hyphens
        if (request.url) {
          // Create a safe item_id by replacing invalid characters with underscores
          const safeUrl = request.url
            .replace(/[^a-zA-Z0-9_-]/g, '_')  // Replace non-alphanumeric (except _ and -) with _
            .replace(/_+/g, '_')  // Replace multiple underscores with single underscore
            .substring(0, 100);  // Limit length to avoid too-long IDs
          const itemId = `browser_${safeUrl}_${Date.now()}`;
          formData.append('item_id', itemId);
        }

        // Build source_metadata with exact URL and favicon as durable base64 data URI
        const sourceMetadata = await buildSourceMetadata(request.url, sender?.tab?.favIconUrl);
        if (sourceMetadata) {
          formData.append('source_metadata', JSON.stringify(sourceMetadata));
        }


        const response = await fetch(`${API_BASE_URL}/v1/memorize`, {
          method: 'POST',
          headers: {
            'x-api-key': config.apiKey
          },
          body: formData
        });


        if (!response.ok) {
          const errorText = await response.text();
          console.error('❌ API error response:', errorText);
          throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
        }

        const data = await response.json();

        sendResponse({ success: true, data: data });
      } catch (error) {
        console.error('❌ Error memorizing content:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true; // Keep channel open for async response
  }

  // Handle debug memorize bypass (skip_extraction) from recall inspector
  if (request.action === 'memorizePageBypass') {
    (async () => {
      try {
        await initializeEnvironmentConfig();

        const config = await getApiConfig();
        if (!config.apiKey) {
          sendResponse({ success: false, error: 'API key not configured' });
          return;
        }

        const storage = await chrome.storage.sync.get(['userId', 'apiKey']);
        let userId = storage.userId;
        if (!userId && storage.apiKey) {
          userId = await getUserIdFromApiKey(storage.apiKey);
          if (userId) await chrome.storage.sync.set({ userId });
        }
        const userName = userId || 'Browser User';

        const pageUrl = request.url || 'unknown';
        const pageTitle = request.title || 'Untitled Page';
        const now = new Date().toISOString();

        const sourceMetadata = await buildSourceMetadata(
          pageUrl !== 'unknown' ? pageUrl : null,
          isHttpsUrl(request.favIconUrl) ? request.favIconUrl : null
        );

        // Build a valid test memory matching the extraction schema
        const testMemory = {
          headline: `[Debug bypass] Visited: ${pageTitle}`,
          body: `• Test memory created via debug bypass button\n• User was browsing "${pageTitle}" at ${pageUrl}\n• Created to test skip_extraction pipeline and source linking`,
          participants: [{ name: userName, ID: 'unknown' }],
          when: {
            start_time: now,
            end_time: 'unknown'
          },
          where: pageUrl,
          other_entities: [],
          personal_or_work: 'unknown',
          project: 'unknown',
          additional_anchors: ['debug test', 'browser bypass', pageTitle]
        };

        // Build item_id
        const safeUrl = pageUrl
          .replace(/[^a-zA-Z0-9_-]/g, '_')
          .replace(/_+/g, '_')
          .substring(0, 100);
        const itemId = `browser_bypass_${safeUrl}_${Date.now()}`;

        const formData = new FormData();
        formData.append('user_name', userName);
        formData.append('source_type', 'browser');
        formData.append('item_id', itemId);
        formData.append('skip_extraction', 'true');
        formData.append('memory_json', JSON.stringify({ memories: [testMemory] }));
        if (sourceMetadata) {
          formData.append('source_metadata', JSON.stringify(sourceMetadata));
        }


        const response = await fetch(`${API_BASE_URL}/v1/memorize`, {
          method: 'POST',
          headers: { 'x-api-key': config.apiKey },
          body: formData
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error('❌ Bypass memorize error:', errorText);
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        sendResponse({ success: true, data });
      } catch (error) {
        console.error('❌ Error in bypass memorize:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  // Handle feedback submission
  if (request.action === 'submitFeedback') {
    (async () => {
      try {

        // Get user ID from storage, or fetch it from API key
        const storage = await chrome.storage.sync.get(['userId', 'apiKey']);
        let userId = storage.userId;

        // If no userId cached, get it from API key
        if (!userId && storage.apiKey) {
          userId = await getUserIdFromApiKey(storage.apiKey);

          if (userId) {
            // Cache the user_id for future use
            await chrome.storage.sync.set({ userId });
          }
        }

        if (!userId) {
          console.error('❌ Could not get user ID');
          sendResponse({
            success: false,
            error: 'Could not determine user ID. Please check your API key in settings.'
          });
          return;
        }

        // Prepare global feedback
        const globalFeedback = {
          rating: request.globalRating || null,
          comment: request.globalFeedbackText || ''
        };

        const recallId = request.recallId || null;
        const recallContext = await getRecallContext(recallId);
        const recallResponseData = recallContext?.responseData || null;
        const recallDisplayedAt = recallContext?.displayedAt || null;
        const uiMemoriesDisplayedAt = normalizeIsoTimestamp(request.memoriesTimestamp);
        const effectiveDisplayedAt = uiMemoriesDisplayedAt || recallDisplayedAt || null;
        const recallQueryText = recallContext?.queryText || null;
        const recallQueryRequestedAt = recallContext?.queryRequestedAt || null;
        const recallResultReceivedAt = recallContext?.resultReceivedAt || null;
        const recallSenderTabUrl = recallContext?.senderTabUrl || null;
        const recallAmbienceTimeRange = recallContext?.ambienceTimeRange || null;
        const parsedRecallVoiceIntervalS = Number(recallContext?.voiceRecallIntervalS);
        const recallVoiceRecallIntervalS = Number.isFinite(parsedRecallVoiceIntervalS)
          ? parsedRecallVoiceIntervalS
          : null;
        // In normal flow, every recall_id should map to a persisted non-empty query text because
        // the current recall path always sends text/originalText and saveRecallContext stores it.
        // A missing value here indicates abnormal state such as legacy pre-fix session data,
        // a mixed-version extension reload, or malformed/corrupted session storage.
        const feedbackQueryText = recallId
          ? recallQueryText
          : (request.emailText || null);

        if (recallId && !recallContext) {
        }
        if (recallId && !recallQueryText) {
        }

        // Build raw content lookup from matching recall response for 1:1 snapshot pass-through
        const rawMemoryMap = {};
        if (recallResponseData && recallResponseData.memories) {
          recallResponseData.memories.forEach(m => {
            const id = m.custom_id || m.event_id;
            if (id) rawMemoryMap[id] = m;
          });
        }

        // Prepare memory feedback array with raw content pass-through
        const memoryFeedback = request.memories.map((memory, index) => {
          const raw = rawMemoryMap[memory.event_id];
          const entry = {
            memory_id: memory.event_id || `memory_${index}`,
            rank: index + 1,
            rating: memory.rating || null,
            comment: memory.comment || '',
            snapshot: {
              ...(raw?.content || {}),         // 1:1 pass-through of ALL content fields
              similarity: raw?.score || memory.similarity,
              source: raw?.source || memory.source,
            }
          };
          if (memory.selected_error_codes && memory.selected_error_codes.length) {
            entry.selected_error_codes = memory.selected_error_codes;
          }
          return entry;
        });

        // Build redacted recall_response
        let recallResponse = null;
        if (recallResponseData) {
          const displayedIds = new Set(request.memories.map(m => m.event_id));
          const redacted = JSON.parse(JSON.stringify(recallResponseData));
          if (redacted.memories) {
            redacted.memories.forEach(m => {
              const id = m.custom_id || m.event_id;
              if (!displayedIds.has(id)) {
                m.content = '[REDACTED]';
              }
            });
          }
          if (redacted.trace?.pinecone_recall?.results?.memories) {
            redacted.trace.pinecone_recall.results.memories.forEach(m => {
              const id = m.custom_id || m.event_id;
              if (!displayedIds.has(id)) {
                m.content = '[REDACTED]';
              }
            });
          }
          recallResponse = JSON.stringify(redacted);
        }

        // Build frontend_meta
        const manifest = chrome.runtime.getManifest();
        const envName = await getEnvironmentName();
        const devSettingsFb = await new Promise((resolve) => {
          chrome.storage.sync.get(['llmProxyFilter', 'llmProxyFilterIsSoft', 'alpha'], (result) => {
            resolve({
              llmProxyFilter: result.llmProxyFilter ?? DEFAULT_LLM_PROXY_FILTER,
              llmProxyFilterIsSoft: result.llmProxyFilterIsSoft ?? DEFAULT_LLM_PROXY_FILTER_IS_SOFT,
              alpha: result.alpha ?? DEFAULT_ALPHA
            });
          });
        });
        // Parse URL provenance from the tab that triggered the recall
        let pageOrigin = null;
        if (recallSenderTabUrl) {
          try {
            const parsed = new URL(recallSenderTabUrl);
            pageOrigin = parsed.origin;
          } catch (_) { /* invalid URL, leave null */ }
        }

        const frontendMeta = {
          app_version: manifest.version,
          platform: 'chrome_extension',
          endpoint_mode: envName,
          voice_recall_interval_s: recallVoiceRecallIntervalS,
          input_mode: recallContext?.inputMode || 'text',
          recall_id: recallId,
          result_query_text: recallQueryText || null,
          enable_llm_proxy_filter: devSettingsFb.llmProxyFilter,
          llm_proxy_filter_is_soft: devSettingsFb.llmProxyFilterIsSoft,
          alpha: devSettingsFb.alpha,
          page_origin: pageOrigin,
          transcript_start_at: recallAmbienceTimeRange?.transcript_start_at || null,
          transcript_end_at: recallAmbienceTimeRange?.transcript_end_at || null,
        };

        // Determine source_app based on sender tab URL
        const sourceApp = sender.tab && sender.tab.url && sender.tab.url.includes('mail.google.com')
          ? 'chrome_gmail'
          : 'chrome_web';


        // Build timing data
        const feedbackClickedAt = new Date().toISOString();
        let reactionTimeMs = null;
        if (effectiveDisplayedAt) {
          reactionTimeMs = Math.round(new Date(feedbackClickedAt) - new Date(effectiveDisplayedAt));
        }
        const timing = {
          displayed_at: effectiveDisplayedAt,
          feedback_clicked_at: feedbackClickedAt,
          reaction_time_ms: reactionTimeMs,
          query_requested_at: recallQueryRequestedAt,
          result_received_at: recallResultReceivedAt,
        };

        // Submit to Cloud Run backend
        const result = await submitBatchFeedback(
          userId,
          feedbackQueryText,
          sourceApp,
          globalFeedback,
          memoryFeedback,
          recallResponse,
          frontendMeta,
          timing
        );

        if (result.success) {
          sendResponse({ success: true, data: result.data });
        } else {
          sendResponse({ success: false, error: result.error });
        }
      } catch (error) {
        console.error('❌ Error in feedback submission handler:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true; // Keep channel open for async response
  }

  // Proxy WebSocket token fetch for content scripts (avoids CORS)
  if (request.action === 'getWebSocketToken') {
    (async () => {
      try {
        const env = await getCurrentEnvironment();
        const apiKey = await new Promise((resolve) => {
          chrome.storage.sync.get(['apiKey'], (r) => resolve(r.apiKey || ''));
        });
        if (!apiKey) {
          sendResponse({ success: false, error: 'No API key configured' });
          return;
        }
        const response = await fetch(`${env.backendUrl}/api/auth/websocket-token`, {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'Content-Type': 'application/json'
          }
        });
        if (!response.ok) {
          sendResponse({ success: false, error: `Token request failed: ${response.status}` });
          return;
        }
        const data = await response.json();
        if (!data.token) {
          sendResponse({ success: false, error: 'No token in response' });
          return;
        }
        sendResponse({ success: true, token: data.token, websocketUrl: env.websocketUrl });
      } catch (error) {
        console.error('🎤 Error fetching WebSocket token:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  // Relay messages from offscreen document to content scripts
  // (offscreen docs can't use chrome.tabs)
  if (request.targetTabId && (request.action === 'meetTabTranscript' || request.action === 'meetTabCaptureError')) {
    chrome.tabs.sendMessage(request.targetTabId, request, () => {
      void chrome.runtime.lastError;
    });
    return;
  }

  // Handle tab audio capture for Google Meet (offscreen document)
  if (request.action === 'startTabCapture') {
    (async () => {
      try {

        const tabId = sender.tab?.id || request.tabId;
        if (!tabId) {
          sendResponse({ success: false, error: 'No tab ID' });
          return;
        }

        // Always stop existing capture before starting a new one
        if (activeTabCaptureTabId) {
          await ensureOffscreenDocument();
          await sendOffscreenMessage({ action: 'offscreenStopTabCapture' });
          activeTabCaptureTabId = null;
        }

        let streamId = request.streamId || null;
        if (!streamId) {
          streamId = await new Promise((resolve, reject) => {
            chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (id) => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
              }
              if (!id) {
                reject(new Error('No stream ID returned'));
                return;
              }
              resolve(id);
            });
          });
        }

        await ensureOffscreenDocument();
        const response = await sendOffscreenMessage({
          action: 'offscreenStartTabCapture',
          tabId,
          streamId
        });

        if (!response?.success) {
          sendResponse({ success: false, error: response?.error || 'Offscreen start failed' });
          return;
        }

        activeTabCaptureTabId = tabId;
        sendResponse({ success: true });
      } catch (error) {
        console.error('🎤 Error in tab capture:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true; // Keep channel open for async response
  }

  if (request.action === 'stopTabCapture') {
    (async () => {
      try {
        await ensureOffscreenDocument();
        const response = await sendOffscreenMessage({
          action: 'offscreenStopTabCapture'
        });
        if (!response?.success) {
          sendResponse({ success: false, error: response?.error || 'Offscreen stop failed' });
          return;
        }
        activeTabCaptureTabId = null;
        sendResponse({ success: true });
      } catch (error) {
        console.error('🎤 Error stopping tab capture:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  // Fetch shared card HTML+JS from environment endpoints, with bundled fallback
  if (request.action === 'fetchSharedCard') {
    (async () => {
      try {
        const errors = [];
        const baseUrls = await getSharedCardBaseUrls();

        for (const baseUrl of baseUrls) {
          const sourceLabel = `${baseUrl}/embed/card/`;
          try {
            const remote = await fetchSharedCardFromBase(baseUrl, sourceLabel);
            if (remote.success) {
              sendResponse(remote);
              return;
            }
            errors.push(remote.error);
          } catch (error) {
            errors.push(`${sourceLabel} ${error?.message || 'unknown fetch error'}`);
          }
        }

        const bundled = await fetchBundledSharedCardAssets();
        if (bundled.success) {
          sendResponse(bundled);
          return;
        }

        sendResponse({ success: false, error: errors.concat(bundled.error).join(' | ') });
      } catch (error) {
        console.error('❌ fetchSharedCard error:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }
});

// Set up periodic refresh only if alarms API is available
if (chrome.alarms) {
  chrome.alarms.create('refreshMemories', { periodInMinutes: 30 });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'refreshMemories') {
      loadMemoriesFromSheets();
    }
  });
} else {
}

// Handle keyboard commands (Ctrl+Shift+X for debug toggle)
if (chrome.commands) {
  chrome.commands.onCommand.addListener(async (command) => {
    if (command === 'toggle-debug') {
      // Send message to active tab to toggle debug modal
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, { action: 'toggleDebug' }).catch(() => {
          // Tab might not have content script loaded
        });
      }
    }
  });
}

// Action click: start Meet capture on the active tab (grants activeTab)
if (chrome.action) {
  chrome.action.onClicked.addListener(async (tab) => {
    try {
      if (!tab?.id) return;
      await chrome.tabs.sendMessage(tab.id, { action: 'startMeetCapture' });
    } catch (error) {
    }
  });
}

// Initial load
loadMemoriesFromSheets();

} catch (error) {
  console.error('💥 Fatal error in service worker:', error);
}
