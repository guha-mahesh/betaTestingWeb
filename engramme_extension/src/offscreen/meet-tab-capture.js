// meet-tab-capture.js - Offscreen tab audio capture for Google Meet
// Runs in an offscreen document to access Media APIs in MV3.

(() => {
  'use strict';

  const TARGET_SAMPLE_RATE = 16000;

  // Get WebSocket token + URL from background (offscreen docs can't use chrome.storage)
  async function getWebSocketTokenAndUrl() {
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
        resolve({ token: response.token, websocketUrl: response.websocketUrl });
      });
    });
  }

  let isCapturing = false;
  let currentTabId = null;
  let tabStream = null;
  let tabAudioContext = null;
  let tabProcessor = null;
  let tabWebSocket = null;
  let tabSessionReady = false;
  let captureInstanceId = 0;

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

  function float32ToInt16(float32Data) {
    const int16Data = new Int16Array(float32Data.length);
    for (let i = 0; i < float32Data.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Data[i]));
      int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return int16Data;
  }

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  function sendToTab(tabId, payload) {
    if (!tabId) return;
    // Offscreen documents can't use chrome.tabs — relay through background
    chrome.runtime.sendMessage({ ...payload, targetTabId: tabId }, () => {
      void chrome.runtime.lastError;
    });
  }

  function isCurrentCapture(captureId, tabId) {
    return isCapturing && captureId === captureInstanceId && currentTabId === tabId;
  }

  /**
   * Connect to ElevenLabs WebSocket via Memory Machines proxy
   * Matches webapp auth flow: get token → connect → send token → wait for authenticated
   */
  async function connectToElevenLabs(targetTabId, captureId) {
    // 1. Get token + websocket URL from background service worker
    const { token, websocketUrl } = await getWebSocketTokenAndUrl();

    // 2. Build WS URL
    const wsUrl = `${websocketUrl.replace(/^http/i, 'ws')}/api/elevenlabs/ws`;

    return new Promise((resolve, reject) => {
      let settled = false;
      const resolveOnce = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const rejectOnce = (error) => {
        if (settled) return;
        settled = true;
        reject(error instanceof Error ? error : new Error(String(error)));
      };

      try {
        const ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          if (!isCurrentCapture(captureId, targetTabId)) {
            try {
              ws.close();
            } catch (e) {}
            rejectOnce(new Error('Capture superseded before authentication'));
            return;
          }
          // 3. Send token as first message
          ws.send(JSON.stringify({ token }));
        };

        ws.onmessage = (event) => {
          if (typeof event.data !== 'string') return;
          if (!isCurrentCapture(captureId, targetTabId)) return;
          try {
            const data = JSON.parse(event.data);

            // 4. Handle auth response
            if (data.status === 'authenticated') {
              resolveOnce(ws);
              return;
            }

            if (data.error) {
              console.error('🎤 [tab] Proxy error:', data.error);
              rejectOnce(new Error(data.error));
              return;
            }

            // Handle ElevenLabs session started
            const messageType = data.message_type || data.type || 'unknown';
            if (messageType === 'session_started') {
              tabSessionReady = true;
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
              const entry = {
                speaker: 'Other',
                text: transcript.trim(),
                timestamp: new Date().toISOString(),
                isFinal: isFinalOrCommitted
              };
              sendToTab(targetTabId, { action: 'meetTabTranscript', entry });
            }
          } catch (error) {
            sendToTab(targetTabId, {
              action: 'meetTabCaptureError',
              error: 'ElevenLabs parse error'
            });
          }
        };

        ws.onerror = () => {
          console.error('🎤 [tab] WebSocket error');
          rejectOnce(new Error('WebSocket error'));
        };

        ws.onclose = (event) => {
          if (!settled) {
            rejectOnce(new Error(`WebSocket closed before authentication (${event.code})`));
          }
        };

      } catch (error) {
        rejectOnce(error);
      }
    });
  }

  async function setupAudioProcessor(stream, getWebSocket, getSessionReady) {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    // Ensure AudioContext is running (may be suspended due to autoplay policy)
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }
    const source = audioContext.createMediaStreamSource(stream);
    const bufferSize = 4096;
    const processor = audioContext.createScriptProcessor(bufferSize, 1, 1);
    const inputSampleRate = audioContext.sampleRate;

    processor.onaudioprocess = (e) => {
      const inputBuffer = e.inputBuffer;
      const outputBuffer = e.outputBuffer;
      const channelCount = inputBuffer.numberOfChannels;
      const length = inputBuffer.length;

      // Always copy input → output so the user can still hear the tab audio
      for (let ch = 0; ch < outputBuffer.numberOfChannels; ch++) {
        if (ch < channelCount) {
          outputBuffer.getChannelData(ch).set(inputBuffer.getChannelData(ch));
        }
      }

      const ws = getWebSocket();
      if (!isCapturing || !getSessionReady() || !ws || ws.readyState !== WebSocket.OPEN) {
        return;
      }

      // Mix to mono for transcription
      const mixed = new Float32Array(length);
      if (channelCount === 1) {
        mixed.set(inputBuffer.getChannelData(0));
      } else {
        for (let ch = 0; ch < channelCount; ch++) {
          const channelData = inputBuffer.getChannelData(ch);
          for (let i = 0; i < length; i++) {
            mixed[i] += channelData[i];
          }
        }
        const inv = 1 / channelCount;
        for (let i = 0; i < length; i++) {
          mixed[i] *= inv;
        }
      }

      const resampled = resampleToTargetRate(mixed, inputSampleRate, TARGET_SAMPLE_RATE);
      const int16Data = float32ToInt16(resampled);
      const base64Audio = arrayBufferToBase64(int16Data.buffer);

      ws.send(JSON.stringify({
        message_type: 'input_audio_chunk',
        audio_base_64: base64Audio,
        sample_rate: TARGET_SAMPLE_RATE
      }));
    };

    source.connect(processor);
    processor.connect(audioContext.destination);

    return { audioContext, processor };
  }

  async function startTabCapture(streamId, tabId) {
    if (!streamId) {
      throw new Error('Missing stream ID');
    }

    if (isCapturing) {
      stopTabCapture();
    }

    const targetTabId = tabId;
    const captureId = ++captureInstanceId;
    currentTabId = tabId;
    isCapturing = true;
    tabSessionReady = false;

    tabStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId
        }
      },
      video: false
    });

    const audioTracks = tabStream.getAudioTracks();
    if (!audioTracks.length) {
      throw new Error('No audio track in tab capture');
    }

    const { audioContext, processor } = await setupAudioProcessor(
      tabStream,
      () => tabWebSocket,
      () => tabSessionReady
    );
    tabAudioContext = audioContext;
    tabProcessor = processor;

    // Connect WebSocket in background — don't block the response.
    // Audio plays back immediately; transcription starts when WS is ready.
    connectToElevenLabs(targetTabId, captureId)
      .then((ws) => {
        if (!isCurrentCapture(captureId, targetTabId)) {
          try {
            ws.close();
          } catch (e) {}
          return;
        }
        tabWebSocket = ws;
      })
      .catch((error) => {
        if (!isCurrentCapture(captureId, targetTabId)) return;
        console.error('🎤 [tab] WebSocket connection failed:', error.message);
        sendToTab(targetTabId, {
          action: 'meetTabCaptureError',
          error: 'Tab transcription failed: ' + error.message
        });
      });
  }

  function stopTabCapture() {
    isCapturing = false;
    captureInstanceId += 1; // Invalidate any in-flight WebSocket setup.

    if (tabWebSocket && tabWebSocket.readyState === WebSocket.OPEN) {
      try {
        tabWebSocket.close();
      } catch (e) {}
    }
    tabWebSocket = null;
    tabSessionReady = false;

    if (tabProcessor) {
      tabProcessor.disconnect();
      tabProcessor = null;
    }
    if (tabAudioContext) {
      tabAudioContext.close();
      tabAudioContext = null;
    }
    if (tabStream) {
      tabStream.getTracks().forEach((track) => track.stop());
      tabStream = null;
    }
    currentTabId = null;
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request?.action === 'offscreenStartTabCapture') {
      startTabCapture(request.streamId, request.tabId)
        .then(() => sendResponse({ success: true }))
        .catch((error) => {
          sendToTab(request.tabId, {
            action: 'meetTabCaptureError',
            error: error.message || 'Tab capture failed'
          });
          sendResponse({ success: false, error: error.message });
        });
      return true;
    }

    if (request?.action === 'offscreenStopTabCapture') {
      stopTabCapture();
      sendResponse({ success: true });
    }
  });
})();
