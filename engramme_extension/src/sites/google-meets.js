// google-meets.js - Google Meet audio capture and transcription
// Captures microphone (user) and tab audio (other participants) via ElevenLabs proxy
// Depends on: core/state.js

(function() {
    'use strict';

    const googleMeets = {};

    const TARGET_SAMPLE_RATE = 16000;

    // Get environment config from chrome.storage (matches environments.js)
    async function getEnvConfig() {
        return new Promise((resolve) => {
            chrome.storage.sync.get(['devModeEnabled', 'selectedEnvironment'], (result) => {
                const envName = (result.devModeEnabled && result.selectedEnvironment) || 'prod';
                const configs = {
                    dev: {
                        backendUrl: 'https://memory-machines-backend-dev-4ocorayf6a-uc.a.run.app',
                        websocketUrl: 'https://memory-machines-websocket-dev-795455024362.us-central1.run.app'
                    },
                    staging: {
                        backendUrl: 'https://memory-machines-backend-staging-409038480462.us-central1.run.app',
                        websocketUrl: 'https://memory-machines-websocket-staging-409038480462.us-central1.run.app'
                    },
                    prod: {
                        backendUrl: 'https://memory-machines-backend-prod-42us6ic5ya-uc.a.run.app',
                        websocketUrl: 'https://memory-machines-websocket-prod-42us6ic5ya-uc.a.run.app'
                    }
                };
                resolve(configs[envName] || configs.prod);
            });
        });
    }

    // Fetch short-lived WebSocket token via background script (avoids CORS)
    async function getWebSocketToken() {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({ action: 'getWebSocketToken' }, (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                if (!response?.success) {
                    reject(new Error(response?.error || 'Token request failed'));
                    return;
                }
                resolve(response.token);
            });
        });
    }

    // State
    let isCapturing = false;
    let micStream = null;
    let micAudioContext = null;
    let micProcessor = null;
    let micWebSocket = null;
    let micSessionReady = false;
    let tabCaptureActive = false;
    let transcriptBuffer = [];
    let memoryRefreshInterval = null;

    // Transcript accumulator for memory fetch
    // Finals go into accumulatedTranscript; interims are held separately
    // so interleaved mic/tab don't corrupt each other
    let accumulatedTranscript = '';
    let currentMicInterim = '';
    let currentTabInterim = '';
    let pendingTranscriptStartAt = null;
    let pendingTranscriptEndAt = null;
    let memoryFetchIntervalMs = 30000; // default 30s, configurable 15-120s

    /**
     * Check if we're on Google Meet
     * @returns {boolean}
     */
    googleMeets.isGoogleMeet = function() {
        return window.location.hostname === 'meet.google.com';
    };

    /**
     * Check if we're in an active meeting (not lobby/home)
     * Meeting URLs look like: meet.google.com/xxx-xxxx-xxx
     * @returns {boolean}
     */
    googleMeets.isInMeeting = function() {
        if (!googleMeets.isGoogleMeet()) return false;

        // Check URL pattern - meeting codes are like abc-defg-hij
        const pathname = window.location.pathname;
        const meetingCodePattern = /\/[a-z]{3}-[a-z]{4}-[a-z]{3}(?:$|\/)/i;

        if (meetingCodePattern.test(pathname)) {
            return true;
        }

        // Fallback: check for in-call UI (helps when URL pattern is nonstandard)
        const leaveCallButton = document.querySelector(
            'button[aria-label*="Leave call"], button[aria-label*="Leave meeting"], button[data-tooltip*="Leave call"], button[data-tooltip*="Leave meeting"]'
        );
        if (leaveCallButton) {
            return true;
        }

        return false;
    };

    /**
     * Convert Float32Array audio data to Int16Array for ElevenLabs
     * @param {Float32Array} float32Data
     * @returns {Int16Array}
     */
    function float32ToInt16(float32Data) {
        const int16Data = new Int16Array(float32Data.length);
        for (let i = 0; i < float32Data.length; i++) {
            const s = Math.max(-1, Math.min(1, float32Data[i]));
            int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        return int16Data;
    }

    /**
     * Resample audio to target sample rate
     * @param {Float32Array} input
     * @param {number} inputSampleRate
     * @param {number} targetSampleRate
     * @returns {Float32Array}
     */
    function resampleToTargetRate(input, inputSampleRate, targetSampleRate) {
        if (inputSampleRate === targetSampleRate) {
            return input;
        }

        const ratio = inputSampleRate / targetSampleRate;
        const outputLength = Math.round(input.length / ratio);
        const output = new Float32Array(outputLength);
        let offset = 0;

        for (let i = 0; i < outputLength; i += 1) {
            const nextOffset = Math.round((i + 1) * ratio);
            let sum = 0;
            let count = 0;
            for (let j = offset; j < nextOffset && j < input.length; j += 1) {
                sum += input[j];
                count += 1;
            }
            output[i] = count ? sum / count : 0;
            offset = nextOffset;
        }

        return output;
    }

    function arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    /**
     * Strip parenthetical actions like (laughs), (music), (applause) from text
     */
    function stripParentheticals(text) {
        return text.replace(/\([^)]*\)/g, '').replace(/\s{2,}/g, ' ').trim();
    }

    function normalizeIsoTimestamp(value) {
        if (typeof value !== 'string') return null;
        const parsedMs = new Date(value).getTime();
        if (!Number.isFinite(parsedMs)) return null;
        return new Date(parsedMs).toISOString();
    }

    function markTranscriptActivity(timestamp = null) {
        const isoTimestamp = normalizeIsoTimestamp(timestamp) || new Date().toISOString();
        if (!pendingTranscriptStartAt) {
            pendingTranscriptStartAt = isoTimestamp;
        }
        pendingTranscriptEndAt = isoTimestamp;
    }

    function clearPendingTranscriptWindow() {
        pendingTranscriptStartAt = null;
        pendingTranscriptEndAt = null;
    }

    /**
     * Connect to ElevenLabs WebSocket via Memory Machines proxy
     * Matches webapp auth flow: get token → connect → send token → wait for authenticated
     * @param {string} label - Label for logging (e.g., 'mic' or 'tab')
     * @returns {Promise<WebSocket>}
     */
    async function connectToElevenLabs(label) {
        // 1. Get short-lived token from REST API
        const token = await getWebSocketToken();

        // 2. Build WS URL from websocket service (NOT backend)
        const env = await getEnvConfig();
        const wsUrl = `${env.websocketUrl.replace(/^http/i, 'ws')}/api/elevenlabs/ws`;

        return new Promise((resolve, reject) => {
            try {
                const ws = new WebSocket(wsUrl);

                ws.onopen = () => {
                    // 3. Send token as first message
                    ws.send(JSON.stringify({ token }));
                };

                ws.onmessage = (event) => {
                    if (typeof event.data !== 'string') return;
                    try {
                        const data = JSON.parse(event.data);

                        // 4. Handle auth response
                        if (data.status === 'authenticated') {
                            resolve(ws);
                            return;
                        }

                        if (data.error) {
                            console.error(`🎤 [${label}] Proxy error:`, data.error);
                            reject(new Error(data.error));
                            return;
                        }

                        // Handle ElevenLabs session started
                        const messageType = data.message_type || data.type || 'unknown';
                        if (messageType === 'session_started') {
                            if (label === 'mic') {
                                micSessionReady = true;
                            }
                            return;
                        }

                        // Handle transcription results
                        const transcript = data.text || '';
                        const isFinal = data.is_final ?? true;
                        const isCommitted = messageType === 'committed_transcript' ||
                            messageType === 'committed_transcript_with_timestamps' ||
                            messageType === 'final_transcript';
                        const isTranscript = messageType === 'transcript' || messageType === 'final_transcript';

                        if (transcript && transcript.trim()) {
                            const isFinalOrCommitted = isCommitted || (isTranscript && isFinal);
                            const speaker = label === 'mic' ? 'You' : 'Other';
                            const trimmed = transcript.trim();
                            const cleaned = stripParentheticals(trimmed);
                            if (cleaned) {
                                markTranscriptActivity();
                            }

                            if (isFinalOrCommitted) {
                                // Final: clear interim, append final to main accumulator
                                currentMicInterim = '';
                                if (cleaned) {
                                    accumulatedTranscript += cleaned + '\n';
                                }

                                const entry = { speaker, text: trimmed, timestamp: new Date().toISOString() };
                                transcriptBuffer.push(entry);
                                window.dispatchEvent(new CustomEvent('engramme-transcript', { detail: entry }));
                            } else if (isTranscript && !isFinal) {
                                // Interim: hold in separate variable (not in main string)
                                currentMicInterim = cleaned ? cleaned + '\n' : '';
                            }
                        }
                    } catch (error) {
                        console.error(`🎤 [${label}] Error parsing message:`, error);
                    }
                };

                ws.onerror = (error) => {
                    console.error(`🎤 [${label}] WebSocket error:`, error);
                    reject(error);
                };

                ws.onclose = (event) => {
                };

            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Set up audio processor for a stream
     * @param {MediaStream} stream
     * @param {Function} getWebSocket
     * @param {Function} getSessionReady
     * @param {string} label
     * @returns {{audioContext: AudioContext, processor: ScriptProcessorNode}}
     */
    function setupAudioProcessor(stream, getWebSocket, getSessionReady, label) {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)({
            sampleRate: TARGET_SAMPLE_RATE
        });

        const source = audioContext.createMediaStreamSource(stream);
        const bufferSize = 4096;
        const processor = audioContext.createScriptProcessor(bufferSize, 1, 1);
        const inputSampleRate = audioContext.sampleRate;

        processor.onaudioprocess = (e) => {
            const ws = getWebSocket();
            if (!isCapturing || !getSessionReady() || !ws || ws.readyState !== WebSocket.OPEN) {
                return;
            }

            const inputData = e.inputBuffer.getChannelData(0);
            const resampled = resampleToTargetRate(inputData, inputSampleRate, TARGET_SAMPLE_RATE);
            const int16Data = float32ToInt16(resampled);
            const base64Audio = arrayBufferToBase64(int16Data.buffer);

            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    message_type: 'input_audio_chunk',
                    audio_base_64: base64Audio,
                    sample_rate: TARGET_SAMPLE_RATE
                }));
            }
        };

        source.connect(processor);
        processor.connect(audioContext.destination);


        return { audioContext, processor };
    }

    /**
     * Start capturing microphone audio (user's voice)
     */
    async function startMicCapture() {
        try {

            micStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    sampleRate: TARGET_SAMPLE_RATE,
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });

            micSessionReady = false;
            micWebSocket = await connectToElevenLabs('mic');
            const { audioContext, processor } = setupAudioProcessor(
                micStream,
                () => micWebSocket,
                () => micSessionReady,
                'mic'
            );
            micAudioContext = audioContext;
            micProcessor = processor;

            return true;
        } catch (error) {
            console.error('🎤 Error starting microphone capture:', error);
            return false;
        }
    }

    /**
     * Start capturing tab audio (other participants' voices)
     * Uses offscreen document via background script
     */
    async function startTabCapture() {
        try {
            const streamId = pendingTabStreamId;
            pendingTabStreamId = null;

            const response = await new Promise((resolve, reject) => {
                const timeoutId = setTimeout(() => {
                    reject(new Error('Tab capture timed out'));
                }, 15000);
                chrome.runtime.sendMessage({
                    action: 'startTabCapture',
                    streamId: streamId || null
                }, (result) => {
                    clearTimeout(timeoutId);
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                        return;
                    }
                    resolve(result);
                });
            });

            if (!response?.success) {
                console.error('🎤 Tab capture failed:', response?.error || 'Unknown error');
                return false;
            }

            tabCaptureActive = true;
            return true;
        } catch (error) {
            console.error('🎤 Error starting tab audio capture:', error);
            return false;
        }
    }

    /**
     * Trigger memory fetch with accumulated transcript
     */
    async function triggerMemoryFetch() {
        const combined = (accumulatedTranscript + currentMicInterim + currentTabInterim).trim();
        if (!combined) {
            return;
        }


        const memoryRefresh = window.Engramme?.memoryRefresh;
        if (memoryRefresh && memoryRefresh.updateWithCustomText) {
            const transcriptStartAt = pendingTranscriptStartAt;
            const transcriptEndAt = pendingTranscriptEndAt || pendingTranscriptStartAt || null;
            await memoryRefresh.updateWithCustomText(combined.slice(-1000), {
                transcriptStartAt: transcriptStartAt,
                transcriptEndAt: transcriptEndAt,
                voiceRecallIntervalS: Math.round(memoryFetchIntervalMs / 1000),
            });
        } else if (memoryRefresh && memoryRefresh.updateForGenericPage) {
            memoryRefresh.updateForGenericPage();
        }

        // Clear everything after fetch
        accumulatedTranscript = '';
        currentMicInterim = '';
        currentTabInterim = '';
        clearPendingTranscriptWindow();
    }

    /**
     * Start memory fetch interval (every 1 minute)
     */
    async function loadMemoryFetchInterval() {
        return new Promise((resolve) => {
            chrome.storage.sync.get(['memoryFetchIntervalSec'], (result) => {
                const sec = result.memoryFetchIntervalSec;
                if (sec && sec >= 15 && sec <= 120) {
                    memoryFetchIntervalMs = sec * 1000;
                }
                resolve();
            });
        });
    }

    async function startMemoryFetchInterval() {
        if (memoryRefreshInterval) {
            clearInterval(memoryRefreshInterval);
        }

        await loadMemoryFetchInterval();

        memoryRefreshInterval = setInterval(() => {
            if (isCapturing && (accumulatedTranscript + currentMicInterim + currentTabInterim).trim()) {
                triggerMemoryFetch();
            }
        }, memoryFetchIntervalMs);

    }

    /**
     * Stop memory fetch interval
     */
    function stopMemoryFetchInterval() {
        if (memoryRefreshInterval) {
            clearInterval(memoryRefreshInterval);
            memoryRefreshInterval = null;
        }
    }

    /**
     * Start capturing both audio sources and transcribing
     * @returns {Promise<{micStarted: boolean, tabStarted: boolean}>}
     */
    googleMeets.startCapture = async function() {
        if (isCapturing) {
            return { micStarted: false, tabStarted: false };
        }

        isCapturing = true;
        transcriptBuffer = [];
        accumulatedTranscript = '';
        currentMicInterim = '';
        currentTabInterim = '';
        clearPendingTranscriptWindow();

        // Start both captures in parallel
        const [micStarted, tabStarted] = await Promise.all([
            startMicCapture(),
            startTabCapture()
        ]);

        if (!micStarted && !tabStarted) {
            console.error('🎤 Failed to start any audio capture');
            isCapturing = false;
            return { micStarted: false, tabStarted: false };
        }

        // Start memory fetch interval
        startMemoryFetchInterval();

        return { micStarted, tabStarted };
    };

    /**
     * Stop all audio capture
     */
    googleMeets.stopCapture = async function() {
        if (!isCapturing) {
            return;
        }

        isCapturing = false;

        // Stop memory fetch interval
        stopMemoryFetchInterval();

        // Final memory fetch with remaining transcript (including any pending interims)
        if ((accumulatedTranscript + currentMicInterim + currentTabInterim).trim()) {
            triggerMemoryFetch();
        }

        // Close mic WebSocket
        if (micWebSocket && micWebSocket.readyState === WebSocket.OPEN) {
            try {
                micWebSocket.close();
            } catch (e) {}
        }
        micWebSocket = null;
        micSessionReady = false;

        // Stop mic audio processing
        if (micProcessor) {
            micProcessor.disconnect();
            micProcessor = null;
        }
        if (micAudioContext) {
            micAudioContext.close();
            micAudioContext = null;
        }
        if (micStream) {
            micStream.getTracks().forEach(track => track.stop());
            micStream = null;
        }

        // Stop tab capture and wait for it to fully release the stream
        if (tabCaptureActive) {
            await new Promise((resolve) => {
                chrome.runtime.sendMessage({ action: 'stopTabCapture' }, () => {
                    void chrome.runtime.lastError;
                    resolve();
                });
            });
            tabCaptureActive = false;
        }

    };

    /**
     * Get current transcript buffer
     * @returns {Array<{speaker: string, text: string, timestamp: string}>}
     */
    googleMeets.getTranscript = function() {
        return [...transcriptBuffer];
    };

    /**
     * Get accumulated transcript as string
     * @returns {string}
     */
    googleMeets.getAccumulatedTranscript = function() {
        return accumulatedTranscript + currentMicInterim + currentTabInterim;
    };

    /**
     * Clear transcript buffer
     */
    googleMeets.clearTranscript = function() {
        transcriptBuffer = [];
        accumulatedTranscript = '';
        currentMicInterim = '';
        currentTabInterim = '';
        clearPendingTranscriptWindow();
    };

    /**
     * Check if currently capturing
     * @returns {boolean}
     */
    googleMeets.isCapturing = function() {
        return isCapturing;
    };

    /**
     * Get content for memory recall (formatted transcript)
     * @returns {string}
     */
    googleMeets.getContent = function() {
        if (transcriptBuffer.length === 0) {
            return '';
        }

        // Format recent transcript for memory recall
        const recentEntries = transcriptBuffer.slice(-20); // Last 20 entries
        return recentEntries
            .map(entry => `${entry.speaker}: ${entry.text}`)
            .join('\n')
            .slice(0, 1000); // Max 1000 chars
    };

    /**
     * Check if we should extract from this page
     * @returns {boolean}
     */
    googleMeets.shouldExtract = function() {
        return googleMeets.isGoogleMeet() && isCapturing && transcriptBuffer.length > 0;
    };

    // ========== MESSAGE HANDLERS ==========

    let pendingTabStreamId = null;

    if (chrome?.runtime?.onMessage) {
        chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
            if (request?.action === 'startMeetCapture') {
                // Accept streamId from popup (obtained with user gesture)
                if (request.streamId) {
                    pendingTabStreamId = request.streamId;
                }
                googleMeets.startCapture().then(result => {
                    sendResponse({ success: result.micStarted || result.tabStarted, ...result });
                });
                return true; // async response
            }
            if (request?.action === 'stopMeetCapture') {
                googleMeets.stopCapture().then(() => {
                    sendResponse({ success: true });
                });
                return true; // async response
            }
            if (request?.action === 'getMeetCaptureState') {
                sendResponse({ capturing: isCapturing, inMeeting: googleMeets.isInMeeting() });
            }
            if (request?.action === 'getAccumulatedTranscript') {
                sendResponse({ transcript: accumulatedTranscript + currentMicInterim + currentTabInterim });
            }
            if (request?.action === 'meetTabCaptureStream' && request.streamId) {
                pendingTabStreamId = request.streamId;
                googleMeets.startCapture().then(result => {
                    sendResponse({ success: result.micStarted || result.tabStarted, ...result });
                });
                return true; // async response
            }
            if (request?.action === 'meetTabTranscript' && request.entry) {
                const isFinal = request.entry.isFinal !== false;
                const cleaned = stripParentheticals(request.entry.text);
                if (cleaned) {
                    markTranscriptActivity(request.entry.timestamp || null);
                }

                if (isFinal) {
                    // Final: clear interim, append final to main accumulator
                    currentTabInterim = '';
                    if (cleaned) {
                        accumulatedTranscript += cleaned + '\n';
                    }
                    transcriptBuffer.push(request.entry);
                    window.dispatchEvent(new CustomEvent('engramme-transcript', {
                        detail: request.entry
                    }));
                } else {
                    // Interim: hold in separate variable (not in main string)
                    currentTabInterim = cleaned ? cleaned + '\n' : '';
                }
            }
            if (request?.action === 'meetTabCaptureError' && request.error) {
                console.error('🎤 Tab capture error:', request.error);
                tabCaptureActive = false;
            }
        });
    }

    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
        googleMeets.stopCapture();
    });

    // Export to namespace
    window.Engramme = window.Engramme || {};
    window.Engramme.googleMeets = googleMeets;

})();
