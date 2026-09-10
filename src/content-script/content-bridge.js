// Content script injected into web pages to bridge window.nostr (nos2x / Alby) with Monstr Note
(function initNip07Bridge() {
  if (window.__ff_notes_bridge_injected) return;
  window.__ff_notes_bridge_injected = true;

  // Inject script into page MAIN world to communicate directly with window.nostr (nos2x)
  try {
    const scriptEl = document.createElement('script');
    scriptEl.textContent = `
      (function() {
        window.addEventListener('message', async (event) => {
          if (event.source !== window || !event.data || event.data.source !== 'ff-notes-to-page') return;
          const { id, method, args } = event.data;

          if (!window.nostr) {
            window.postMessage({ source: 'ff-notes-from-page', id, error: 'nos2x / NIP-07 extension is not active on this webpage.' }, '*');
            return;
          }

          try {
            let result;
            if (method === 'getPublicKey') {
              result = await window.nostr.getPublicKey();
            } else if (method === 'signEvent') {
              result = await window.nostr.signEvent(args[0]);
            } else if (method === 'nip44.encrypt') {
              result = await window.nostr.nip44.encrypt(args[0], args[1]);
            } else if (method === 'nip44.decrypt') {
              result = await window.nostr.nip44.decrypt(args[0], args[1]);
            } else {
              throw new Error('Unsupported NIP-07 method: ' + method);
            }
            window.postMessage({ source: 'ff-notes-from-page', id, result }, '*');
          } catch (err) {
            window.postMessage({ source: 'ff-notes-from-page', id, error: err.message || String(err) }, '*');
          }
        });
      })();
    `;
    (document.head || document.documentElement).appendChild(scriptEl);
    scriptEl.remove();
  } catch (e) {
    console.warn('[Monstr Note Bridge] Main script injection fallback:', e);
  }

  const pendingRequests = new Map();

  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.source !== 'ff-notes-from-page') return;
    const { id, result, error } = event.data;
    if (pendingRequests.has(id)) {
      const { resolve, reject } = pendingRequests.get(id);
      pendingRequests.delete(id);
      if (error) reject(new Error(error));
      else resolve(result);
    }
  });

  const extensionApi = typeof browser !== 'undefined' ? browser : (typeof chrome !== 'undefined' ? chrome : null);
  if (extensionApi && extensionApi.runtime && extensionApi.runtime.onMessage) {
    extensionApi.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request && request.type === 'EXEC_NIP07_ON_PAGE') {
        const id = 'req_' + Math.random().toString(36).substring(2, 9);
        const promise = new Promise((resolve, reject) => {
          pendingRequests.set(id, { resolve, reject });
          window.postMessage({ source: 'ff-notes-to-page', id, method: request.method, args: request.args }, '*');
          setTimeout(() => {
            if (pendingRequests.has(id)) {
              pendingRequests.delete(id);
              reject(new Error('NIP-07 request timed out. Check if nos2x is prompting for approval.'));
            }
          }, 15000);
        });

        promise
          .then((result) => sendResponse({ ok: true, result }))
          .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));

        return true;
      }
    });
  }
})();
