// options.js - Handle extension configuration with Google Sign-In

document.addEventListener('DOMContentLoaded', () => {
  // Initialize Firebase
  let firebaseApp;
  let firebaseAuth;

  try {
    firebaseApp = firebase.initializeApp(firebaseConfig);
    firebaseAuth = firebase.auth();
  } catch (error) {
    console.error('Firebase initialization error:', error);
  }

  // DOM Elements
  const googleSignInBtn = document.getElementById('googleSignInBtn');
  const signInView = document.getElementById('signInView');
  const userProfile = document.getElementById('userProfile');
  const signOutBtn = document.getElementById('signOutBtn');
  const userAvatar = document.getElementById('userAvatar');
  const userName = document.getElementById('userName');
  const userEmail = document.getElementById('userEmail');
  const titleEl = document.getElementById('title');
  const apiKeySection = document.getElementById('apiKeySection');
  const form = document.getElementById('settingsForm');
  const apiKeyInput = document.getElementById('apiKey');
  const openaiApiKeyInput = document.getElementById('openaiApiKey');
  const debugModeCheckbox = document.getElementById('debugMode');
  const demoModeCheckbox = document.getElementById('demoMode');
  const statusDiv = document.getElementById('status');
  const refreshBtn = document.getElementById('refreshBtn');

  // Secret click counter for revealing API key section
  let titleClickCount = 0;
  let titleClickTimer = null;

  // Meet capture elements
  const meetSection = document.getElementById('meetSection');
  const meetCaptureBtn = document.getElementById('meetCaptureBtn');
  const memoryIntervalSlider = document.getElementById('memoryInterval');
  const intervalValueLabel = document.getElementById('intervalValue');
  let meetTabId = null;
  let meetCapturing = false;

  // Load saved interval
  chrome.storage.sync.get(['memoryFetchIntervalSec'], (result) => {
    const sec = result.memoryFetchIntervalSec || 30;
    memoryIntervalSlider.value = sec;
    intervalValueLabel.textContent = sec;
  });

  memoryIntervalSlider.addEventListener('input', () => {
    intervalValueLabel.textContent = memoryIntervalSlider.value;
  });

  memoryIntervalSlider.addEventListener('change', () => {
    const sec = parseInt(memoryIntervalSlider.value, 10);
    chrome.storage.sync.set({ memoryFetchIntervalSec: sec });
  });

  // Load current state
  loadAuthState();
  loadSettings();
  updateStatus();
  initMeetSection();

  function initMeetSection() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab?.id) return;

      meetTabId = tab.id;
      meetSection.classList.add('visible');

      // Query current capture state from content script
      chrome.tabs.sendMessage(tab.id, { action: 'getMeetCaptureState' }, (response) => {
        if (chrome.runtime.lastError) return;
        if (response?.capturing) {
          setMeetButtonCapturing();
        }
      });
    });
  }

  function setMeetButtonCapturing() {
    meetCapturing = true;
    meetCaptureBtn.textContent = 'Stop Audio Capture';
    meetCaptureBtn.classList.add('capturing');
    meetCaptureBtn.disabled = false;
  }

  function setMeetButtonIdle() {
    meetCapturing = false;
    meetCaptureBtn.textContent = 'Start Audio Capture';
    meetCaptureBtn.classList.remove('capturing');
    meetCaptureBtn.disabled = false;
  }

  meetCaptureBtn.addEventListener('click', async () => {
    if (!meetTabId) return;

    meetCaptureBtn.disabled = true;
    meetCaptureBtn.textContent = meetCapturing ? 'Stopping...' : 'Starting...';

    if (meetCapturing) {
      // Stop capture
      chrome.tabs.sendMessage(meetTabId, { action: 'stopMeetCapture' }, (response) => {
        if (chrome.runtime.lastError) {
          showStatus('Failed: ' + chrome.runtime.lastError.message, 'error');
          meetCaptureBtn.disabled = false;
          meetCaptureBtn.textContent = 'Stop Audio Capture';
          return;
        }
        setMeetButtonIdle();
        showStatus('Capture stopped', 'success');
      });
    } else {
      // Stop any existing tab capture first (prevents "active stream" error)
      await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'stopTabCapture' }, () => {
          void chrome.runtime.lastError;
          resolve();
        });
      });

      // Get tab capture stream ID here in popup (has user gesture context)
      let streamId = null;
      try {
        streamId = await new Promise((resolve, reject) => {
          chrome.tabCapture.getMediaStreamId({ targetTabId: meetTabId }, (id) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            resolve(id);
          });
        });
      } catch (err) {
      }

      // Send start with streamId to content script
      chrome.tabs.sendMessage(meetTabId, { action: 'startMeetCapture', streamId }, (response) => {
        if (chrome.runtime.lastError) {
          showStatus('Failed: ' + chrome.runtime.lastError.message, 'error');
          meetCaptureBtn.disabled = false;
          meetCaptureBtn.textContent = 'Start Audio Capture';
          return;
        }
        if (response?.success) {
          setMeetButtonCapturing();
          const parts = [];
          if (response.micStarted) parts.push('mic');
          if (response.tabStarted) parts.push('tab audio');
          showStatus('Capturing: ' + (parts.join(' + ') || 'started'), 'success');
        } else {
          setMeetButtonIdle();
          showStatus('Capture failed to start', 'error');
        }
      });
    }
  });

  function setSignInButtonLoading() {
    googleSignInBtn.disabled = true;
    googleSignInBtn.textContent = 'Signing in...';
  }

  function setSignInButtonIdle() {
    googleSignInBtn.disabled = false;
    googleSignInBtn.innerHTML = `
      <svg class="google-icon" viewBox="0 0 24 24">
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
      </svg>
      Sign in with Google
    `;
  }

  function isAuthCancelError(error) {
    if (!error || !error.message) return false;
    const message = error.message.toLowerCase();
    return message.includes('did not approve access')
      || message.includes('canceled')
      || message.includes('cancelled');
  }

  // Google Sign-In button click handler
  googleSignInBtn.addEventListener('click', async () => {
    setSignInButtonLoading();

    try {
      const tabId = await new Promise((resolve) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          resolve(tabs && tabs[0] ? tabs[0].id : null);
        });
      });
      await signInWithGoogle(tabId);
    } catch (error) {
      if (!isAuthCancelError(error)) {
        console.error('Sign-in error:', error);
        showStatus('Sign-in failed: ' + error.message, 'error');
      }
      setSignInButtonIdle();
    }
  });

  // Sign Out button click handler
  signOutBtn.addEventListener('click', async () => {
    try {
      await signOut();
      showStatus('Signed out successfully', 'success');
    } catch (error) {
      console.error('Sign-out error:', error);
      showStatus('Sign-out failed: ' + error.message, 'error');
    }
  });

  // Secret trigger: click title 5 times to reveal API key section
  titleEl.addEventListener('click', () => {
    titleClickCount++;

    if (titleClickTimer) {
      clearTimeout(titleClickTimer);
    }

    if (titleClickCount >= 5) {
      apiKeySection.classList.toggle('visible');
      titleClickCount = 0;
    }

    titleClickTimer = setTimeout(() => {
      titleClickCount = 0;
    }, 2000);
  });

  // Manual API key form submission
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const apiKey = apiKeyInput.value.trim();
    const openaiApiKey = openaiApiKeyInput.value.trim();

    if (!apiKey) {
      showStatus('Please enter your Engramme API key', 'error');
      return;
    }

    showStatus('Saving settings and fetching user ID...', 'success');

    try {
      // Fetch user_id from API key via backend (use current environment)
      const currentEnv = await getCurrentEnvironment();
      const response = await fetch(`${currentEnv.backendUrl}/api/auth/user-id`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey })
      });

      if (!response.ok) {
        throw new Error('Invalid API key or backend error');
      }

      const data = await response.json();
      const userId = data.user_id;

      // Save to storage
      chrome.storage.sync.set({
        apiKey: apiKey,
        openaiApiKey: openaiApiKey,
        userId: userId,
        debugMode: debugModeCheckbox.checked,
        isGoogleAuth: false
      }, () => {
        if (chrome.runtime.lastError) {
          showStatus('Error saving settings: ' + chrome.runtime.lastError.message, 'error');
        } else {
          showStatus('Settings saved! User ID: ' + userId, 'success');
          chrome.runtime.sendMessage({ action: 'refreshMemories' });
          setTimeout(updateStatus, 1000);
        }
      });
    } catch (error) {
      showStatus('Error: ' + error.message, 'error');
    }
  });

  // Refresh button
  refreshBtn.addEventListener('click', () => {
    showStatus('Refreshing memories...', 'success');
    chrome.runtime.sendMessage({ action: 'refreshMemories' }, (response) => {
      if (response && response.success) {
        showStatus('Memories refreshed!', 'success');
        setTimeout(updateStatus, 1000);
      } else {
        showStatus('Error refreshing memories', 'error');
      }
    });
  });

  // Debug mode checkbox
  debugModeCheckbox.addEventListener('change', () => {
    chrome.storage.sync.set({ debugMode: debugModeCheckbox.checked });
  });

  // Demo mode checkbox
  demoModeCheckbox.addEventListener('change', () => {
    chrome.storage.sync.set({ demoMode: demoModeCheckbox.checked });
    // Notify active tab so the overlay updates immediately.
    // NOTE: Only the focused tab is notified. Other Gmail tabs won't update
    // until their next recall cycle or a page reload.
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0] && tabs[0].id) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'demoModeChanged', enabled: demoModeCheckbox.checked });
      }
    });
  });

  // Google Sign-In flow using chrome.identity
  async function signInWithGoogle(activeTabId) {
    const authResult = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'startGoogleAuth', tabId: activeTabId }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (!response || !response.success) {
          reject(new Error(response && response.error ? response.error : 'Auth failed'));
        } else {
          resolve(response);
        }
      });
    });

    showUserProfile(authResult.userName, authResult.userEmail);
    showStatus('Signed in successfully!', 'success');
    setTimeout(updateStatus, 1000);
  }

  // Sign out
  async function signOut() {

    // Sign out of Firebase
    if (firebaseAuth) {
      await firebaseAuth.signOut();
    }

    // Revoke the Chrome identity token
    await new Promise((resolve) => {
      chrome.identity.getAuthToken({ interactive: false }, (token) => {
        if (token) {
          chrome.identity.removeCachedAuthToken({ token }, () => {
            // Also revoke the token on Google's servers
            fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`)
              .finally(resolve);
          });
        } else {
          resolve();
        }
      });
    });

    // Clear any remaining cached tokens so the next login is clean.
    if (chrome.identity?.clearAllCachedAuthTokens) {
      await new Promise((resolve) => chrome.identity.clearAllCachedAuthTokens(resolve));
    }

    // Clear storage
    await new Promise((resolve) => {
      chrome.storage.sync.remove(['apiKey', 'userId', 'userName', 'userEmail', 'isGoogleAuth'], resolve);
    });

    chrome.storage.local.set({ apiConfigured: false });
    chrome.storage.local.set({ needsTokenRefresh: true });

    // Send signOut message to background
    chrome.runtime.sendMessage({ action: 'signOut' });

    // Update UI
    showSignInView();
    updateStatus();

    // Refresh the active tab so overlays pick up the signed-out state.
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0] && tabs[0].id) {
        chrome.tabs.reload(tabs[0].id);
      }
    });
  }

  // Load auth state from storage
  function loadAuthState() {
    chrome.storage.sync.get(['apiKey', 'userId', 'userName', 'userEmail', 'isGoogleAuth'], (result) => {

      if (result.apiKey && result.isGoogleAuth) {
        showUserProfile(result.userName, result.userEmail);
      } else if (result.apiKey) {
        // API key auth - show sign in view but API key section might be used
        showSignInView();
      } else {
        showSignInView();
      }
    });
  }

  // Load settings
  function loadSettings() {
    chrome.storage.sync.get(['apiKey', 'openaiApiKey', 'debugMode', 'demoMode'], (result) => {
      apiKeyInput.value = result.apiKey || '';
      openaiApiKeyInput.value = result.openaiApiKey || '';
      debugModeCheckbox.checked = result.debugMode || false;
      demoModeCheckbox.checked = result.demoMode ?? false;
    });
  }

  // Update status display
  function updateStatus() {
    chrome.storage.local.get(['lastUpdated', 'apiConfigured'], (result) => {
      const connectionStatus = document.getElementById('connectionStatus');
      const lastUpdatedEl = document.getElementById('lastUpdated');
      const memoryCountEl = document.getElementById('memoryCount');

      if (result.lastUpdated && result.apiConfigured) {
        const date = new Date(result.lastUpdated);
        const timeAgo = getTimeAgo(date);

        connectionStatus.textContent = 'Connected';
        connectionStatus.style.color = '#28a745';
        lastUpdatedEl.textContent = timeAgo;
        memoryCountEl.textContent = 'Real-time memory recall';
      } else {
        connectionStatus.textContent = 'Not configured';
        connectionStatus.style.color = '#dc3545';
        lastUpdatedEl.textContent = 'Never';
        memoryCountEl.textContent = 'Sign in to activate';
      }
    });
  }

  // Show user profile (signed in state)
  function showUserProfile(name, email) {
    signInView.style.display = 'none';
    userProfile.classList.add('visible');

    userName.textContent = name || 'User';
    userEmail.textContent = email || '';
    userAvatar.textContent = (name || 'U').charAt(0).toUpperCase();
  }

  // Show sign in view (signed out state)
  function showSignInView() {
    signInView.style.display = 'block';
    userProfile.classList.remove('visible');
  }

  // Helper: Get time ago string
  function getTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);

    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return Math.floor(seconds / 60) + ' minutes ago';
    if (seconds < 86400) return Math.floor(seconds / 3600) + ' hours ago';
    return Math.floor(seconds / 86400) + ' days ago';
  }

  // Helper: Show status message
  function showStatus(message, type) {
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;
    statusDiv.style.display = 'block';

    setTimeout(() => {
      statusDiv.style.display = 'none';
    }, 5000);
  }

  // ===== DEVELOPER MODE FUNCTIONALITY =====
  const devModeTrigger = document.getElementById('devModeTrigger');
  const devModeSection = document.getElementById('devModeSection');
  const devPassword = document.getElementById('devPassword');
  const unlockDevModeBtn = document.getElementById('unlockDevModeBtn');
  const environmentSelect = document.getElementById('environmentSelect');
  const applyEnvironmentBtn = document.getElementById('applyEnvironmentBtn');
  const resetDevModeBtn = document.getElementById('resetDevModeBtn');
  const currentEnvIndicator = document.getElementById('currentEnvIndicator');
  const localFeedbackCheckbox = document.getElementById('localFeedbackBackend');
  const llmProxyFilterCheckbox = document.getElementById('llmProxyFilter');
  const llmProxyFilterIsSoftCheckbox = document.getElementById('llmProxyFilterIsSoft');
  const alphaSlider = document.getElementById('alphaSlider');
  const alphaValueLabel = document.getElementById('alphaValue');
  const sourceFilterSelect = document.getElementById('sourceFilter');
  const participantMatchSelect = document.getElementById('participantMatchMode');
  const diversityMatchSelect = document.getElementById('diversityMatchMode');
  const simThresholdSlider = document.getElementById('simThresholdSlider');
  const simThresholdLabel = document.getElementById('simThresholdValue');
  const minAgeSlider = document.getElementById('minAgeSlider');
  const minAgeLabel = document.getElementById('minAgeValue');
  const maxAgeSlider = document.getElementById('maxAgeSlider');
  const maxAgeLabel = document.getElementById('maxAgeValue');

  // Log-scale helpers for maxAge slider (maps 0–1000 linear to 1–18250 days)
  const MAX_AGE_MIN = 1, MAX_AGE_MAX = 18250;
  const SNAP_DAYS = [1, 7, 14, 31, 180, 365, 3650];
  function sliderToMaxAge(pos) {
    const t = pos / 1000;
    const raw = Math.round(MAX_AGE_MIN * Math.pow(MAX_AGE_MAX / MAX_AGE_MIN, t));
    for (const snap of SNAP_DAYS) {
      if (Math.abs(raw - snap) <= snap * 0.02) return snap;
    }
    return raw;
  }
  function maxAgeToSlider(days) {
    return Math.round(1000 * Math.log(days / MAX_AGE_MIN) / Math.log(MAX_AGE_MAX / MAX_AGE_MIN));
  }
  const enableTraceCheckbox = document.getElementById('enableTrace');
  const enableEntityResolutionCheckbox = document.getElementById('enableEntityResolution');

  // Load dev settings
  chrome.storage.sync.get([
    'localFeedbackBackend', 'llmProxyFilter', 'llmProxyFilterIsSoft', 'alpha',
    'sourceFilter', 'participantMatchMode', 'diversityMatchMode',
    'simThreshold', 'minAge', 'maxAge', 'enableTrace', 'enableEntityResolution'
  ], (result) => {
    localFeedbackCheckbox.checked = result.localFeedbackBackend ?? false;
    llmProxyFilterCheckbox.checked = result.llmProxyFilter ?? false;
    llmProxyFilterIsSoftCheckbox.checked = result.llmProxyFilterIsSoft ?? false;
    llmProxyFilterIsSoftCheckbox.disabled = !llmProxyFilterCheckbox.checked;
    const alpha = result.alpha ?? 1.0;
    alphaSlider.value = alpha;
    alphaValueLabel.textContent = alpha.toFixed(1);
    sourceFilterSelect.value = result.sourceFilter ?? '';
    participantMatchSelect.value = result.participantMatchMode ?? 'symbolic';
    diversityMatchSelect.value = result.diversityMatchMode ?? 'bow';
    const simThreshold = result.simThreshold ?? 0.3;
    simThresholdSlider.value = simThreshold;
    simThresholdLabel.textContent = simThreshold.toFixed(2);
    const minAge = result.minAge ?? 0;
    minAgeSlider.value = minAge;
    minAgeLabel.textContent = minAge;
    const maxAge = result.maxAge ?? 365;
    maxAgeSlider.value = maxAgeToSlider(maxAge);
    maxAgeLabel.textContent = maxAge;
    enableTraceCheckbox.checked = result.enableTrace ?? true;
    enableEntityResolutionCheckbox.checked = result.enableEntityResolution ?? false;
  });

  // Save local feedback backend on change
  localFeedbackCheckbox.addEventListener('change', () => {
    chrome.storage.sync.set({ localFeedbackBackend: localFeedbackCheckbox.checked });
  });

  // Save LLM proxy filter on change; disable soft filter when main filter is off
  llmProxyFilterCheckbox.addEventListener('change', () => {
    const enabled = llmProxyFilterCheckbox.checked;
    chrome.storage.sync.set({ llmProxyFilter: enabled });
    llmProxyFilterIsSoftCheckbox.disabled = !enabled;
  });

  // Save soft filter on change
  llmProxyFilterIsSoftCheckbox.addEventListener('change', () => {
    chrome.storage.sync.set({ llmProxyFilterIsSoft: llmProxyFilterIsSoftCheckbox.checked });
  });

  // Save alpha on slider change
  alphaSlider.addEventListener('input', () => {
    const val = parseFloat(alphaSlider.value);
    alphaValueLabel.textContent = val.toFixed(1);
    chrome.storage.sync.set({ alpha: val });
  });

  // Save source filter
  sourceFilterSelect.addEventListener('change', () => {
    chrome.storage.sync.set({ sourceFilter: sourceFilterSelect.value });
  });

  // Save participant match mode
  participantMatchSelect.addEventListener('change', () => {
    chrome.storage.sync.set({ participantMatchMode: participantMatchSelect.value });
  });

  // Save diversity match mode
  diversityMatchSelect.addEventListener('change', () => {
    chrome.storage.sync.set({ diversityMatchMode: diversityMatchSelect.value });
  });

  // Save similarity threshold
  simThresholdSlider.addEventListener('input', () => {
    const val = parseFloat(simThresholdSlider.value);
    simThresholdLabel.textContent = val.toFixed(2);
    chrome.storage.sync.set({ simThreshold: val });
  });

  // Save min age
  minAgeSlider.addEventListener('input', () => {
    const val = parseInt(minAgeSlider.value);
    minAgeLabel.textContent = val;
    chrome.storage.sync.set({ minAge: val });
  });

  // Save max age (log-scaled slider)
  maxAgeSlider.addEventListener('input', () => {
    const val = sliderToMaxAge(parseInt(maxAgeSlider.value));
    maxAgeLabel.textContent = val;
    chrome.storage.sync.set({ maxAge: val });
  });

  // Save enable trace
  enableTraceCheckbox.addEventListener('change', () => {
    chrome.storage.sync.set({ enableTrace: enableTraceCheckbox.checked });
  });

  // Save entity resolution flag
  enableEntityResolutionCheckbox.addEventListener('change', () => {
    chrome.storage.sync.set({ enableEntityResolution: enableEntityResolutionCheckbox.checked });
  });

  // Click hidden trigger to reveal dev mode section
  devModeTrigger.addEventListener('click', () => {
    devModeSection.classList.toggle('visible');
    loadDevModeState();
  });

  // Load dev mode state
  async function loadDevModeState() {
    const devModeEnabled = await isDevModeEnabled();
    const envName = await getEnvironmentName();

    if (devModeEnabled) {
      devModeSection.classList.add('unlocked');
      environmentSelect.value = envName;
      currentEnvIndicator.textContent = envName;
      currentEnvIndicator.className = `env-indicator ${envName}`;
    } else {
      devModeSection.classList.remove('unlocked');
      devPassword.value = '';
    }
  }

  // Unlock dev mode with password
  unlockDevModeBtn.addEventListener('click', async () => {
    const password = devPassword.value.trim();

    if (validateDevModePassword(password)) {
      await enableDevMode('prod');
      devModeSection.classList.add('unlocked');
      environmentSelect.value = 'prod';
      currentEnvIndicator.textContent = 'prod';
      currentEnvIndicator.className = 'env-indicator prod';
      showStatus('Developer Mode unlocked! You can now switch environments.', 'success');
    } else {
      showStatus('Incorrect password. Access denied.', 'error');
      devPassword.value = '';
    }
  });

  // Apply environment change
  applyEnvironmentBtn.addEventListener('click', async () => {
    const selectedEnv = environmentSelect.value;

    try {
      await setEnvironment(selectedEnv);
      currentEnvIndicator.textContent = selectedEnv;
      currentEnvIndicator.className = `env-indicator ${selectedEnv}`;

      showStatus(`Environment switched to ${selectedEnv}. Reloading extension...`, 'success');

      // Reload the extension by reloading the background service worker
      setTimeout(() => {
        chrome.runtime.reload();
      }, 1500);
    } catch (error) {
      showStatus('Error switching environment: ' + error.message, 'error');
    }
  });

  // Reset dev mode
  resetDevModeBtn.addEventListener('click', async () => {
    await disableDevMode();
    devModeSection.classList.remove('unlocked');
    environmentSelect.value = 'prod';
    devPassword.value = '';
    showStatus('Developer Mode disabled. Reset to Production.', 'success');

    // Reload the extension
    setTimeout(() => {
      chrome.runtime.reload();
    }, 1500);
  });

  // Enter key support for password input
  devPassword.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      unlockDevModeBtn.click();
    }
  });

  // Load initial dev mode state
  loadDevModeState();
});
