import { notesStore } from '../lib/storage/notes-store.js';
import { syncEngine } from '../lib/sync/sync-engine.js';

let activeNote = null;

async function initPopup() {
  await notesStore.init();
  await syncEngine.init();

  const titleInput = document.getElementById('popup-title');
  const contentInput = document.getElementById('popup-content');
  const btnNew = document.getElementById('btn-popup-new');
  const btnOpenFull = document.getElementById('btn-open-full');
  const btnOpenSidebar = document.getElementById('btn-open-sidebar');

  notesStore.subscribe((state) => {
    activeNote = state.activeNote;
    if (activeNote) {
      if (document.activeElement !== titleInput) titleInput.value = activeNote.title || '';
      if (document.activeElement !== contentInput) contentInput.value = activeNote.content || '';
    }
  });

  titleInput?.addEventListener('input', (e) => {
    if (activeNote) {
      notesStore.updateNote(activeNote.id, { title: e.target.value });
    }
  });

  contentInput?.addEventListener('input', (e) => {
    if (activeNote) {
      notesStore.updateNote(activeNote.id, { content: e.target.value });
    }
  });

  btnNew?.addEventListener('click', async () => {
    await notesStore.createNote({ title: '', content: '' });
    requestAnimationFrame(() => {
      if (contentInput) contentInput.focus();
    });
  });

  btnOpenFull?.addEventListener('click', () => {
    if (typeof browser !== 'undefined' && browser.tabs) {
      browser.tabs.create({ url: browser.runtime.getURL('src/page/index.html') });
    } else if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.create({ url: chrome.runtime.getURL('src/page/index.html') });
    }
  });

  btnOpenSidebar?.addEventListener('click', () => {
    if (typeof browser !== 'undefined' && browser.sidebarAction) {
      browser.sidebarAction.open();
    }
  });
}

document.addEventListener('DOMContentLoaded', initPopup);
