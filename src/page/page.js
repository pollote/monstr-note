import { notesStore, getDisplayTitle } from '../lib/storage/notes-store.js';
import { syncEngine } from '../lib/sync/sync-engine.js';
import { renderMarkdown, toggleChecklistItem } from '../lib/utils/markdown.js';
import { exportNoteAsMarkdown, exportVaultJSON, parseBackupJSON } from '../lib/utils/exporter.js';
import { isNip07Available } from '../lib/crypto/nostr-crypto.js';

let state = null;
let currentViewMode = 'edit';
let searchQuery = '';

const notesListEl = document.getElementById('notes-list');
const titleInput = document.getElementById('note-title-input');
const contentInput = document.getElementById('note-content-input');
const markdownPreviewEl = document.getElementById('note-markdown-preview');
const searchInput = document.getElementById('search-input');
const wordCountEl = document.getElementById('word-count');
const syncStatusBadge = document.getElementById('sync-status-badge');
const syncStatusText = document.getElementById('sync-status-text');

const syncModal = document.getElementById('sync-modal');
const btnSyncSettings = document.getElementById('btn-sync-settings');
const btnCloseModal = document.getElementById('btn-close-modal');
const keyDisplay = document.getElementById('key-display');
const btnCopyKey = document.getElementById('btn-copy-key');
const inputImportKey = document.getElementById('input-import-key');
const btnImportKey = document.getElementById('btn-import-key');

const radioVault = document.getElementById('signer-mode-vault');
const radioNip07 = document.getElementById('signer-mode-nip07');
const sectionVaultDetails = document.getElementById('section-vault-details');
const sectionNip07Status = document.getElementById('section-nip07-status');
const nip07InfoText = document.getElementById('nip07-info-text');
const nip07PubkeyDisplay = document.getElementById('nip07-pubkey-display');
const btnConnectNip07 = document.getElementById('btn-connect-nip07');

async function initFullPage() {
  await notesStore.init();
  await syncEngine.init();

  notesStore.subscribe((newState) => {
    state = newState;
    renderNotesList();
    renderActiveNote();
    updateSignerModalUI();
    updatePairingUI();
  });

  syncEngine.onSyncStateChange((status) => {
    updateSyncBadge(status);
  });

  setupEventListeners();
}

function setupEventListeners() {
  document.getElementById('btn-new-note')?.addEventListener('click', async () => {
    setViewMode('edit');
    await notesStore.createNote({ title: '', content: '' });
    renderActiveNote();
    requestAnimationFrame(() => {
      if (contentInput) contentInput.focus();
    });
  });

  searchInput?.addEventListener('input', (e) => {
    searchQuery = e.target.value.toLowerCase().trim();
    renderNotesList();
  });

  const debouncedUpdateNote = debounce((id, updates) => {
    notesStore.updateNote(id, updates);
  }, 250);

  titleInput?.addEventListener('input', (e) => {
    if (!state?.activeNote) return;
    debouncedUpdateNote(state.activeNote.id, { title: e.target.value });
  });

  contentInput?.addEventListener('input', (e) => {
    if (!state?.activeNote) return;
    updateWordCount(e.target.value);
    debouncedUpdateNote(state.activeNote.id, { content: e.target.value });
  });

  document.getElementById('tab-edit')?.addEventListener('click', () => setViewMode('edit'));
  document.getElementById('tab-preview')?.addEventListener('click', () => setViewMode('preview'));

  document.getElementById('btn-pin')?.addEventListener('click', () => {
    if (!state?.activeNote) return;
    notesStore.updateNote(state.activeNote.id, { pinned: !state.activeNote.pinned });
  });

  document.getElementById('btn-delete')?.addEventListener('click', () => {
    if (!state?.activeNote) return;
    if (confirm(`Delete "${state.activeNote.title}"?`)) {
      notesStore.deleteNote(state.activeNote.id);
    }
  });

  document.getElementById('btn-export')?.addEventListener('click', () => {
    if (!state?.activeNote) return;
    exportNoteAsMarkdown(state.activeNote);
  });

  document.querySelectorAll('.tool-btn[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.getAttribute('data-action');
      applyFormatting(action);
    });
  });

  document.getElementById('btn-user-avatar')?.addEventListener('click', () => {
    updateSignerModalUI();
    syncModal?.classList.add('open');
  });

  btnSyncSettings?.addEventListener('click', () => {
    updateSignerModalUI();
    syncModal?.classList.add('open');
  });

  btnCloseModal?.addEventListener('click', () => {
    syncModal?.classList.remove('open');
  });

  radioVault?.addEventListener('change', async () => {
    if (radioVault?.checked) {
      await notesStore.setSignerType('vault');
    }
  });

  radioNip07?.addEventListener('change', async () => {
    if (radioNip07?.checked) {
      await notesStore.setSignerType('nip07');
      if (isNip07Available()) {
        try {
          await notesStore.connectNip07Signer();
        } catch (err) {
          alert('Failed to connect to NIP-07 extension: ' + err.message);
        }
      }
    }
  });

  btnConnectNip07?.addEventListener('click', async () => {
    try {
      const res = await notesStore.connectNip07Signer();
      alert(`Connected to NIP-07 extension (nos2x-fox / Alby)!\nPubkey: ${res.npub}`);
    } catch (err) {
      alert('Error connecting extension: ' + err.message);
    }
  });

  btnCopyKey?.addEventListener('click', () => {
    if (state?.keypair) {
      navigator.clipboard.writeText(state.keypair.nsec);
      if (btnCopyKey) btnCopyKey.textContent = '✅ Copied!';
      setTimeout(() => {
        if (btnCopyKey) btnCopyKey.textContent = '📋 Copy Sync Key';
      }, 2000);
    }
  });

  btnImportKey?.addEventListener('click', async () => {
    const keyInput = inputImportKey?.value.trim();
    if (!keyInput) return;
    try {
      await notesStore.setKeypair(keyInput);
      alert('Successfully paired device / instance!');
      if (inputImportKey) inputImportKey.value = '';
      syncModal?.classList.remove('open');
    } catch (err) {
      alert('Invalid Sync Key: ' + err.message);
    }
  });

  document.getElementById('btn-save-avatar')?.addEventListener('click', async () => {
    const url = document.getElementById('input-avatar-url')?.value;
    await notesStore.updateProfilePicture(url);
    alert('Profile avatar picture saved!');
  });

  // Backup & Restore Handlers
  document.getElementById('btn-export-backup')?.addEventListener('click', () => {
    if (!state?.notes) return;
    exportVaultJSON(state.notes, state.settings);
  });

  const inputImportBackup = document.getElementById('input-import-backup');
  const btnTriggerImportBackup = document.getElementById('btn-trigger-import-backup');

  btnTriggerImportBackup?.addEventListener('click', () => inputImportBackup?.click());

  inputImportBackup?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      const parsed = parseBackupJSON(evt.target.result);
      if (!parsed.success) {
        alert('Error importing backup: ' + parsed.error);
        return;
      }
      const res = await notesStore.importBackupNotes(parsed.notes);
      alert(`Backup Restore Complete!\nSuccessfully restored ${res.importedCount} notes out of ${res.total} notes in file.`);
      inputImportBackup.value = '';
    };
    reader.readAsText(file);
  });

  document.getElementById('chk-auto-backup')?.addEventListener('change', async (e) => {
    await notesStore.updateSettings({ autoBackup: e.target.checked });
  });

  markdownPreviewEl?.addEventListener('change', (e) => {
    if (e.target.classList.contains('task-checkbox') && state?.activeNote) {
      const index = parseInt(e.target.getAttribute('data-index'), 10);
      const updatedContent = toggleChecklistItem(state.activeNote.content, index);
      notesStore.updateNote(state.activeNote.id, { content: updatedContent });
    }
  });

  document.getElementById('editor-color-picker')?.addEventListener('click', (e) => {
    const swatch = e.target.closest('.color-swatch');
    if (swatch && state?.activeNote) {
      const color = swatch.getAttribute('data-color');
      notesStore.updateNote(state.activeNote.id, { color });
    }
  });

  // Reminder & Timer Modal Handlers
  const reminderModal = document.getElementById('reminder-modal');
  const btnReminderPicker = document.getElementById('btn-reminder-picker');
  const btnCloseReminderModal = document.getElementById('btn-close-reminder-modal');
  const inputReminderDatetime = document.getElementById('input-reminder-datetime');
  const btnSetCustomReminder = document.getElementById('btn-set-custom-reminder');
  const btnClearReminder = document.getElementById('btn-clear-reminder');
  const sectionActiveReminder = document.getElementById('section-active-reminder');
  const textActiveReminder = document.getElementById('text-active-reminder');

  btnReminderPicker?.addEventListener('click', () => {
    if (!state?.activeNote) return;
    const note = state.activeNote;
    if (note.reminder_at) {
      if (sectionActiveReminder) sectionActiveReminder.style.display = 'block';
      if (textActiveReminder) {
        const formatted = formatShortReminder(note.reminder_at);
        textActiveReminder.textContent = note.reminder_triggered ? `⏰ Timer Expired (${formatted})` : `Active Reminder: ${formatted}`;
      }
    } else {
      if (sectionActiveReminder) sectionActiveReminder.style.display = 'none';
    }
    reminderModal?.classList.add('open');
  });

  btnCloseReminderModal?.addEventListener('click', () => {
    reminderModal?.classList.remove('open');
  });

  document.querySelectorAll('.btn-timer-preset').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!state?.activeNote) return;
      const mins = parseInt(btn.getAttribute('data-minutes'), 10);
      if (isNaN(mins)) return;
      const reminderAt = Date.now() + (mins * 60 * 1000);
      notesStore.setNoteReminder(state.activeNote.id, reminderAt);
      reminderModal?.classList.remove('open');
    });
  });

  btnSetCustomReminder?.addEventListener('click', () => {
    if (!state?.activeNote || !inputReminderDatetime?.value) return;
    const dt = new Date(inputReminderDatetime.value).getTime();
    if (!isNaN(dt) && dt > Date.now()) {
      notesStore.setNoteReminder(state.activeNote.id, dt);
      inputReminderDatetime.value = '';
      reminderModal?.classList.remove('open');
    } else {
      alert('Please select a valid future date & time.');
    }
  });

  btnClearReminder?.addEventListener('click', () => {
    if (!state?.activeNote) return;
    notesStore.clearNoteReminder(state.activeNote.id);
    reminderModal?.classList.remove('open');
  });

  startReminderCheckLoop();
}

function startReminderCheckLoop() {
  setInterval(async () => {
    const triggered = await notesStore.checkReminders();
    if (triggered && triggered.length > 0) {
      showVisualReminderAlert(triggered[0]);
    }
  }, 5000);
}

function showVisualReminderAlert(note) {
  if (!note) return;
  const alertToast = document.getElementById('reminder-alert-toast');
  const toastNoteTitle = document.getElementById('toast-note-title');
  const btnToastView = document.getElementById('btn-toast-view');
  const btnToastDismiss = document.getElementById('btn-toast-dismiss');

  if (toastNoteTitle) toastNoteTitle.textContent = note.title || 'Untitled Note';
  if (alertToast) alertToast.style.display = 'flex';

  const extensionApi = typeof browser !== 'undefined' && browser.notifications ? browser : (typeof chrome !== 'undefined' && chrome.notifications ? chrome : null);
  if (extensionApi && extensionApi.notifications) {
    try {
      extensionApi.notifications.create({
        type: 'basic',
        iconUrl: extensionApi.runtime.getURL('icons/icon-48.png'),
        title: '⏰ Reminder Alert!',
        message: `Timer reached for "${note.title || 'Untitled Note'}"`
      });
    } catch (e) {}
  }

  if (btnToastView) {
    btnToastView.onclick = () => {
      notesStore.selectNote(note.id);
      if (alertToast) alertToast.style.display = 'none';
    };
  }
  if (btnToastDismiss) {
    btnToastDismiss.onclick = () => {
      if (alertToast) alertToast.style.display = 'none';
    };
  }
}

function updateSignerModalUI() {
  if (!state) return;

  const isNip07 = state.signerType === 'nip07';
  radioVault.checked = !isNip07;
  radioNip07.checked = isNip07;

  if (state.keypair) {
    keyDisplay.textContent = state.keypair.nsec;
  }

  const inputAvatarUrl = document.getElementById('input-avatar-url');
  if (inputAvatarUrl && document.activeElement !== inputAvatarUrl) {
    inputAvatarUrl.value = state.profilePicture || '';
  }

  const chkAutoBackup = document.getElementById('chk-auto-backup');
  if (chkAutoBackup) {
    chkAutoBackup.checked = Boolean(state.settings?.autoBackup !== false);
  }

  if (isNip07) {
    sectionVaultDetails.style.display = 'none';
    sectionNip07Status.style.display = 'block';

    if (isNip07Available()) {
      nip07InfoText.textContent = '🦊 NIP-07 Extension Available (nos2x-fox / Alby)';
      if (state.nip07Pubkey) {
        nip07PubkeyDisplay.textContent = `Connected Pubkey: ${state.nip07Pubkey.slice(0, 12)}...`;
      } else {
        nip07PubkeyDisplay.textContent = 'Click below to connect extension';
      }
    } else {
      nip07InfoText.textContent = '⚠️ NIP-07 Extension not detected in this browser window.';
      nip07PubkeyDisplay.textContent = 'Please install nos2x-fox or Alby, or switch to Built-in Key Vault.';
    }
  } else {
    sectionVaultDetails.style.display = 'block';
    sectionNip07Status.style.display = 'none';
  }
}

function generateIdenticonSvg(pubkeyHex, isNip07, pictureUrl) {
  const seed = pubkeyHex || '0000000000000000000000000000000000000000000000000000000000000000';
  const h1 = parseInt(seed.slice(0, 6), 16) % 360;
  const h2 = (h1 + 135) % 360;
  const badge = isNip07 ? '<span class="user-avatar-badge" title="nos2x-fox">🦊</span>' : '<span class="user-avatar-badge" title="Vault">🔒</span>';

  const svgFallback = `
    <svg width="24" height="24" viewBox="0 0 24 24">
      <defs>
        <linearGradient id="avatar-grad-${seed.slice(0, 4)}" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="hsl(${h1}, 80%, 55%)" />
          <stop offset="100%" stop-color="hsl(${h2}, 85%, 45%)" />
        </linearGradient>
      </defs>
      <circle cx="12" cy="12" r="12" fill="url(#avatar-grad-${seed.slice(0, 4)})" />
      <circle cx="12" cy="10" r="4.2" fill="#ffffff" opacity="0.92" />
      <path d="M 5 20 C 5 15.5, 19 15.5, 19 20 Z" fill="#ffffff" opacity="0.92" />
    </svg>
  `;

  if (pictureUrl && pictureUrl.trim()) {
    const cleanUrl = escapeHtml(pictureUrl.trim());
    return `
      <img src="${cleanUrl}" class="user-avatar-img" alt="Avatar" onerror="this.style.display='none'; if (this.nextElementSibling) this.nextElementSibling.style.display='block';">
      <div style="display: none;">${svgFallback}</div>
      ${badge}
    `;
  }

  return `
    ${svgFallback}
    ${badge}
  `;
}

function updatePairingUI() {
  if (!state) return;

  const btnMenuLogin = document.getElementById('btn-menu-login');
  const btnUserAvatar = document.getElementById('btn-user-avatar');
  const isPaired = !!state.isPaired;

  if (btnMenuLogin) {
    btnMenuLogin.style.display = isPaired ? 'none' : 'flex';
  }

  if (btnUserAvatar) {
    const isNip07 = state.signerType === 'nip07';
    const pubkey = isNip07 ? state.nip07Pubkey : state.keypair?.pubkeyHex;
    
    btnUserAvatar.style.display = 'inline-flex';
    setSafeHTML(btnUserAvatar, generateIdenticonSvg(pubkey, isNip07, state.profilePicture));

    const pubDisplay = pubkey ? `${pubkey.slice(0, 10)}...` : 'Account Vault';
    const signerTitle = isNip07 ? 'nos2x-fox / Alby' : 'Key Vault';
    btnUserAvatar.title = `Paired Account: ${signerTitle}\nPubkey: ${pubDisplay}\nClick for Settings & Device Pairing`;
  }
}

function renderNotesList() {
  if (!state || !state.notes || !notesListEl) return;

  const activeTagFilterEl = document.getElementById('active-tag-filter');
  const activeTagFilterTextEl = document.getElementById('active-tag-filter-text');
  if (activeTagFilterEl && activeTagFilterTextEl) {
    if (activeTagFilter) {
      activeTagFilterEl.style.display = 'flex';
      activeTagFilterTextEl.textContent = `Filter: #${activeTagFilter}`;
    } else {
      activeTagFilterEl.style.display = 'none';
    }
  }

  let filtered = state.notes;
  if (searchQuery) {
    filtered = filtered.filter(
      (n) => n.title.toLowerCase().includes(searchQuery) ||
             n.content.toLowerCase().includes(searchQuery) ||
             (Array.isArray(n.tags) && n.tags.some(t => t.toLowerCase().includes(searchQuery)))
    );
  }

  if (activeTagFilter) {
    filtered = filtered.filter((n) => Array.isArray(n.tags) && n.tags.includes(activeTagFilter.toLowerCase()));
  }

  notesListEl.replaceChildren();
  if (filtered.length === 0) {
    setSafeHTML(notesListEl, '<div style="padding: 16px; text-align: center; color: var(--text-muted); font-size: 12px;">No notes found</div>');
    return;
  }

  if (groupByMode === 'tag') {
    renderGroupedByTag(filtered);
  } else if (groupByMode === 'color') {
    renderGroupedByColor(filtered);
  } else if (groupByMode === 'date') {
    renderGroupedByDate(filtered);
  } else {
    filtered.forEach((note) => {
      notesListEl.appendChild(createNoteItemCard(note));
    });
  }
}

function createNoteItemCard(note) {
  const itemEl = document.createElement('div');
  const colorClass = note.color || 'default';
  itemEl.className = `note-item color-${colorClass} ${note.id === state.activeNoteId ? 'active' : ''}`;
  
  const displayTitle = getDisplayTitle(note);
  const formattedDate = formatFullDate(note.updated_at || note.created_at);
  const snippetText = extractSnippet(note.content);
  const tagsHtml = Array.isArray(note.tags) && note.tags.length > 0
    ? `<div class="tags-list-inline">${note.tags.map(t => `<span class="tag-chip" data-tag="${escapeHtml(t)}">#${escapeHtml(t)}</span>`).join('')}</div>`
    : '';

  let reminderHtml = '';
  if (note.reminder_at) {
    const isTriggered = note.reminder_triggered || Date.now() >= note.reminder_at;
    const label = isTriggered ? '⏰ EXPIRED' : `⏰ ${formatShortReminder(note.reminder_at)}`;
    reminderHtml = `<span class="reminder-badge ${isTriggered ? 'triggered' : ''}">${escapeHtml(label)}</span>`;
  }

  setSafeHTML(itemEl, `
    <div class="note-item-header">
      <span class="note-title">${note.pinned ? '📌 ' : ''}${escapeHtml(displayTitle)}</span>
      ${reminderHtml}
    </div>
    <div class="drawer-item-sub">
      ${formattedDate ? `<span class="drawer-item-date">${escapeHtml(formattedDate)}</span>` : ''}
      <span class="drawer-item-snippet">${escapeHtml(snippetText)}</span>
    </div>
    ${tagsHtml}
  `);

  itemEl.querySelectorAll('.tag-chip').forEach((chip) => {
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      const tag = chip.getAttribute('data-tag');
      if (tag) {
        activeTagFilter = tag;
        renderNotesList();
      }
    });
  });

  itemEl.addEventListener('click', () => notesStore.selectNote(note.id));
  return itemEl;
}

function renderGroupedByTag(notesList) {
  const groups = new Map();
  const untagged = [];

  notesList.forEach((note) => {
    if (Array.isArray(note.tags) && note.tags.length > 0) {
      note.tags.forEach((t) => {
        const normTag = t.toLowerCase();
        if (!groups.has(normTag)) groups.set(normTag, []);
        groups.get(normTag).push(note);
      });
    } else {
      untagged.push(note);
    }
  });

  for (const [tag, notes] of groups.entries()) {
    const header = document.createElement('div');
    header.className = 'note-group-header';
    setSafeHTML(header, `<span>🏷️ #${escapeHtml(tag)}</span> <span class="group-count">(${notes.length})</span>`);
    notesListEl.appendChild(header);
    notes.forEach((note) => notesListEl.appendChild(createNoteItemCard(note)));
  }

  if (untagged.length > 0) {
    const header = document.createElement('div');
    header.className = 'note-group-header';
    setSafeHTML(header, `<span>🏷️ Untagged</span> <span class="group-count">(${untagged.length})</span>`);
    notesListEl.appendChild(header);
    untagged.forEach((note) => notesListEl.appendChild(createNoteItemCard(note)));
  }
}

function renderGroupedByColor(notesList) {
  const groups = new Map();

  notesList.forEach((note) => {
    const colorKey = note.color || 'fox-accent';
    if (!groups.has(colorKey)) groups.set(colorKey, []);
    groups.get(colorKey).push(note);
  });

  for (const [colorKey, notes] of groups.entries()) {
    const header = document.createElement('div');
    header.className = 'note-group-header';
    const colorLabel = COLOR_NAMES[colorKey] || `🎨 ${colorKey}`;
    setSafeHTML(header, `<span>${colorLabel}</span> <span class="group-count">(${notes.length})</span>`);
    notesListEl.appendChild(header);
    notes.forEach((note) => notesListEl.appendChild(createNoteItemCard(note)));
  }
}

function renderGroupedByDate(notesList) {
  const groups = new Map();

  notesList.forEach((note) => {
    const dateGroup = getDateGroupName(note.updated_at || note.created_at);
    if (!groups.has(dateGroup)) groups.set(dateGroup, []);
    groups.get(dateGroup).push(note);
  });

  for (const [dateGroup, notes] of groups.entries()) {
    const header = document.createElement('div');
    header.className = 'note-group-header';
    setSafeHTML(header, `<span>${dateGroup}</span> <span class="group-count">(${notes.length})</span>`);
    notesListEl.appendChild(header);
    notes.forEach((note) => notesListEl.appendChild(createNoteItemCard(note)));
  }
}

function getDateGroupName(ts) {
  if (!ts) return 'Older 📅';
  const date = new Date(typeof ts === 'number' && ts < 10000000000 ? ts * 1000 : ts);
  if (isNaN(date.getTime())) return 'Older 📅';
  
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86400000;
  const weekStart = todayStart - (6 * 86400000);

  const noteTime = date.getTime();
  if (noteTime >= todayStart) return 'Today 📅';
  if (noteTime >= yesterdayStart) return 'Yesterday 📅';
  if (noteTime >= weekStart) return 'This Week 📅';
  return 'Older 📅';
}

function renderActiveNote() {
  if (!state || !state.activeNote) return;
  const note = state.activeNote;
  if (document.activeElement !== titleInput) titleInput.value = note.title || '';
  if (document.activeElement !== contentInput) contentInput.value = note.content || '';

  const activeColor = note.color || 'fox-accent';
  document.getElementById('editor-color-picker')?.querySelectorAll('.color-swatch').forEach((swatch) => {
    const swatchColor = swatch.getAttribute('data-color');
    swatch.classList.toggle('active', swatchColor === activeColor || (swatchColor === 'fox-accent' && activeColor === 'default'));
  });

  const workspaceEl = document.querySelector('.editor-workspace') || document.querySelector('.note-content-container');
  if (workspaceEl) {
    workspaceEl.className = workspaceEl.className.replace(/\bcolor-\S+/g, '').trim() + ` color-${activeColor}`;
  }

  const noteTagsInput = document.getElementById('note-tags-input');
  const noteTagsChips = document.getElementById('note-tags-chips');
  if (noteTagsInput && document.activeElement !== noteTagsInput) {
    noteTagsInput.value = Array.isArray(note.tags) ? note.tags.join(', ') : '';
  }
  if (noteTagsChips) {
    setSafeHTML(noteTagsChips, Array.isArray(note.tags) && note.tags.length > 0
      ? note.tags.map(t => `<span class="tag-chip" data-tag="${escapeHtml(t)}">#${escapeHtml(t)}</span>`).join('')
      : '');
  }

  const btnReminderPicker = document.getElementById('btn-reminder-picker');
  if (btnReminderPicker) {
    if (note.reminder_at) {
      btnReminderPicker.classList.add('has-reminder');
      const isTriggered = note.reminder_triggered || Date.now() >= note.reminder_at;
      btnReminderPicker.title = isTriggered ? '⏰ Timer Expired!' : `⏰ Reminder: ${formatShortReminder(note.reminder_at)}`;
    } else {
      btnReminderPicker.classList.remove('has-reminder');
      btnReminderPicker.title = 'Set Reminder / Timer';
    }
  }

  updateWordCount(note.content || '');
  if (currentViewMode === 'preview') {
    setSafeHTML(markdownPreviewEl, renderMarkdown(note.content || ''));
  }
}

function setViewMode(mode) {
  currentViewMode = mode;
  document.getElementById('tab-edit').classList.toggle('active', mode === 'edit');
  document.getElementById('tab-preview').classList.toggle('active', mode === 'preview');

  if (mode === 'edit') {
    contentInput.style.display = 'block';
    markdownPreviewEl.style.display = 'none';
  } else {
    contentInput.style.display = 'none';
    markdownPreviewEl.style.display = 'block';
    setSafeHTML(markdownPreviewEl, renderMarkdown(contentInput.value));
  }
}

function applyFormatting(action) {
  if (currentViewMode !== 'edit') return;

  const start = contentInput.selectionStart;
  const end = contentInput.selectionEnd;
  const text = contentInput.value;
  const selectedText = text.substring(start, end) || 'text';

  let replacement = '';
  switch (action) {
    case 'bold': replacement = `**${selectedText}**`; break;
    case 'italic': replacement = `*${selectedText}*`; break;
    case 'strike': replacement = `~~${selectedText}~~`; break;
    case 'h1': replacement = `# ${selectedText}`; break;
    case 'h2': replacement = `## ${selectedText}`; break;
    case 'h3': replacement = `### ${selectedText}`; break;
    case 'list': replacement = `- ${selectedText}`; break;
    case 'checklist': replacement = `- [ ] ${selectedText}`; break;
    case 'code': replacement = `\`${selectedText}\``; break;
    case 'quote': replacement = `> ${selectedText}`; break;
  }

  contentInput.value = text.substring(0, start) + replacement + text.substring(end);
  contentInput.focus();

  if (state.activeNote) {
    notesStore.updateNote(state.activeNote.id, { content: contentInput.value });
  }
}

function updateWordCount(text) {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const chars = text.length;
  wordCountEl.textContent = `${words} words • ${chars} chars`;
}

function updateSyncBadge(status) {
  const dot = syncStatusBadge.querySelector('.sync-dot');
  const signerName = state?.signerType === 'nip07' ? 'nos2x-fox / Alby' : 'Vault';
  if (status.syncState === 'synced') {
    dot.className = 'sync-dot';
    syncStatusText.textContent = `🔒 Encrypted (${signerName}) & Synced (${status.connectedCount}/${status.totalRelays} relays)`;
  } else if (status.syncState === 'syncing') {
    dot.className = 'sync-dot syncing';
    syncStatusText.textContent = `🔄 Syncing (${signerName})...`;
  } else {
    dot.className = 'sync-dot error';
    syncStatusText.textContent = '⚠️ Relay Disconnected';
  }
}

function formatFullDate(ts) {
  if (!ts) return '';
  const date = new Date(typeof ts === 'number' && ts < 10000000000 ? ts * 1000 : ts);
  if (isNaN(date.getTime())) return '';
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  return `${monthNames[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

function extractSnippet(content) {
  if (!content) return '';
  const clean = content
    .replace(/^#+\s+/gm, '')
    .replace(/^[-*+]\s+\[[ xX]\]\s+/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/[`*_~>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length > 70 ? clean.substring(0, 70) + '...' : clean;
}

function formatShortReminder(ts) {
  if (!ts) return '';
  const date = new Date(ts);
  if (isNaN(date.getTime())) return '';
  const now = Date.now();
  const diff = ts - now;
  if (diff <= 0) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  const mins = Math.ceil(diff / 60000);
  if (mins < 60) {
    return `in ${mins}m`;
  }
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    const remMins = mins % 60;
    return `in ${hours}h ${remMins}m`;
  }
  const days = Math.floor(hours / 24);
  return `in ${days}d`;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function setSafeHTML(element, htmlString) {
  if (!element) return;
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString || '', 'text/html');
  element.replaceChildren(...Array.from(doc.body.childNodes));
}

function debounce(fn, delay = 250) {
  let timer = null;
  return (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

document.addEventListener('DOMContentLoaded', initFullPage);
