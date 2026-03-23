// shared-card-loader.js — Dynamic loader for shared memory card JS
// This page runs in a sandboxed iframe (no Chrome API access) so it
// communicates with the content script via postMessage. The content
// script fetches memory-card.js from the webapp backend and sends it
// here for execution. Card rendering logic always comes from the
// backend — single source of truth. This loader is just infrastructure.

let bridgeNonce = null;
let loaderReadySent = false;
let scriptInjected = false;
let parentOrigin = null;

function isValidNonce(value) {
  return typeof value === 'string' && value.length >= 16;
}

function postToParent(type, payload = {}) {
  if (!bridgeNonce) return;
  const targetOrigin = (parentOrigin && parentOrigin !== 'null') ? parentOrigin : '*';
  window.parent.postMessage({
    type: `engramme:${type}`,
    bridgeNonce,
    payload
  }, targetOrigin);
}

window.addEventListener('message', (e) => {
  if (e.source !== window.parent) return;
  if (parentOrigin && e.origin !== parentOrigin) return;

  const data = e.data;
  if (!data || typeof data !== 'object') return;

  if (data.type === 'engramme:init') {
    if (!isValidNonce(data.bridgeNonce)) return;
    if (bridgeNonce && bridgeNonce !== data.bridgeNonce) return;
    if (!parentOrigin) parentOrigin = e.origin;

    bridgeNonce = data.bridgeNonce;
    window.__engrammeBridgeNonce = bridgeNonce;

    // In demo mode, inject CSS to hide per-card feedback buttons
    // before the backend card JS renders anything.
    if (data.demoMode && !document.getElementById('engramme-demo-style')) {
      const style = document.createElement('style');
      style.id = 'engramme-demo-style';
      style.textContent = [
        '.action-btn.thumbs-up,',
        '.action-btn.thumbs-down,',
        '.action-btn.comment-btn,',
        '.comment-box { display: none !important; }'
      ].join('\n');
      document.head.appendChild(style);
    }

    if (!loaderReadySent) {
      loaderReadySent = true;
      postToParent('loaderReady', {});
    }
    return;
  }

  if (!parentOrigin || e.origin !== parentOrigin) return;
  if (!bridgeNonce || data.bridgeNonce !== bridgeNonce) return;
  if (data.type !== 'engramme:injectScript' || scriptInjected || !data.js) return;

  scriptInjected = true;
  const script = document.createElement('script');
  script.textContent = data.js;
  document.body.appendChild(script);
});
