import { notesStore } from '../lib/storage/notes-store.js';
import { syncEngine } from '../lib/sync/sync-engine.js';

const extensionApi = typeof browser !== 'undefined' ? browser : (typeof chrome !== 'undefined' ? chrome : null);

// Initialize context menu on extension install
extensionApi.runtime.onInstalled.addListener(() => {
  extensionApi.contextMenus.create({
    id: 'add-selection-to-monstr-note',
    title: 'Add selection to Monstr Note 👾🔒',
    contexts: ['selection', 'link', 'page']
  });
});

// Handle Context Menu click
extensionApi.contextMenus.onClicked.addListener(async (info, tab) => {
  await notesStore.init();
  await syncEngine.init();

  let noteTitle = tab?.title ? `Snippet from ${tab.title}` : 'Web Snippet';
  let noteContent = '';

  if (info.selectionText) {
    noteContent = `> ${info.selectionText.trim()}\n\nSource: [${tab?.title || 'Link'}](${info.pageUrl || tab?.url})`;
  } else if (info.linkUrl) {
    noteContent = `[${info.linkUrl}](${info.linkUrl})`;
  } else if (info.pageUrl) {
    noteContent = `[${tab?.title || info.pageUrl}](${info.pageUrl})`;
  }

  if (noteContent) {
    const newNote = await notesStore.createNote({
      title: noteTitle,
      content: noteContent,
      tags: ['web-clip']
    });

    if (extensionApi.notifications) {
      extensionApi.notifications.create({
        type: 'basic',
        iconUrl: extensionApi.runtime.getURL('icons/icon-48.png'),
        title: 'Monstr Note (Encrypted)',
        message: `Saved "${newNote.title}" to your encrypted notes.`
      });
    }
  }
});

// NIP-07 Request Forwarder (sidebar/popup -> active web tab content script -> window.nostr)
extensionApi.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request && request.type === 'NIP07_REQUEST') {
    (async () => {
      try {
        const tabs = await new Promise((resolve) => {
          extensionApi.tabs.query({ currentWindow: true }, (res) => resolve(res || []));
        });

        // Find active tab or web tab
        const activeTab = tabs.find((t) => t.active && t.url && (t.url.startsWith('http://') || t.url.startsWith('https://'))) ||
                          tabs.find((t) => t.url && (t.url.startsWith('http://') || t.url.startsWith('https://'))) ||
                          tabs.find((t) => t.active) || tabs[0];

        if (!activeTab || !activeTab.id) {
          sendResponse({ ok: false, error: 'No active web page tab found. Open a website tab (e.g. Deepmarks or https://example.com).' });
          return;
        }

        // Send request to tab's content script
        const tabResponse = await new Promise((resolve) => {
          extensionApi.tabs.sendMessage(activeTab.id, {
            type: 'EXEC_NIP07_ON_PAGE',
            method: request.method,
            args: request.args
          }, (res) => resolve(res || { ok: false, error: 'nos2x extension not detected on active tab. Reload the webpage and try again.' }));
        });

        sendResponse(tabResponse);
      } catch (err) {
        sendResponse({ ok: false, error: err.message || String(err) });
      }
    })();
    return true; // async response
  }
});

// Initialize background sync on startup
async function startBackgroundSync() {
  await notesStore.init();
  await syncEngine.init();
}

startBackgroundSync();
