import { createNewKeypair, parseSecretKey, isNip07Available, getNip07PublicKey } from '../crypto/nostr-crypto.js';
import { exportVaultJSON } from '../utils/exporter.js';

const STORAGE_KEYS = {
  NOTES: 'ff_notes_data',
  SECRET_KEY: 'ff_notes_nsec',
  SIGNER_TYPE: 'ff_notes_signer_type',
  IS_PAIRED: 'ff_notes_is_paired',
  PROFILE_PICTURE: 'ff_notes_profile_picture',
  RELAYS: 'ff_notes_relays',
  SETTINGS: 'ff_notes_settings',
  DELETED_IDS: 'ff_notes_deleted',
  AUTO_BACKUP_SNAPSHOT: 'ff_notes_auto_backup_snapshot'
};

export const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://relay.deepmarks.org',
  'wss://relay.snort.social'
];

export function deriveTitleFromContent(content) {
  if (!content || !content.trim()) return '';
  const firstLine = content.trim().split('\n')[0].trim();
  const clean = firstLine
    .replace(/^#+\s*/, '')
    .replace(/^[-*+]\s+\[[ xX]\]\s*/, '')
    .replace(/^[-*+]\s*/, '')
    .replace(/[`*_~>]/g, '')
    .trim();
  if (!clean) return '';
  return clean.length > 50 ? clean.substring(0, 50) + '...' : clean;
}

export function getDisplayTitle(note) {
  if (!note) return 'Untitled Note';
  if (note.isManualTitle && note.title && note.title.trim()) {
    return note.title.trim();
  }
  const derived = deriveTitleFromContent(note.content);
  if (derived) return derived;
  if (note.title && note.title.trim()) return note.title.trim();
  return 'Untitled Note';
}

const memoryStorage = new Map();

/**
 * Universal browser storage wrapper supporting webextension storage API or localStorage/in-memory fallback
 */
export const storage = {
  async get(key) {
    if (typeof browser !== 'undefined' && browser.storage?.local) {
      const res = await browser.storage.local.get(key);
      return res[key];
    }
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      return new Promise((resolve) => {
        chrome.storage.local.get(key, (res) => resolve(res[key]));
      });
    }
    if (typeof localStorage !== 'undefined') {
      const val = localStorage.getItem(key);
      return val ? JSON.parse(val) : undefined;
    }
    return memoryStorage.get(key);
  },

  async set(key, value) {
    if (typeof browser !== 'undefined' && browser.storage?.local) {
      await browser.storage.local.set({ [key]: value });
      return;
    }
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      return new Promise((resolve) => {
        chrome.storage.local.set({ [key]: value }, resolve);
      });
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, JSON.stringify(value));
      return;
    }
    memoryStorage.set(key, value);
  }
};

class NotesStore {
  constructor() {
    this.notes = [];
    this.deletedIds = new Set();
    this.pendingDeletions = new Map();
    this.keypair = null;
    this.signerType = 'vault'; // 'vault' or 'nip07' (nos2x-fox / Alby)
    this.nip07Pubkey = null;
    this.isPaired = false;
    this.profilePicture = null;
    this.relays = [...DEFAULT_RELAYS];
    this.settings = {
      theme: 'auto',
      autoSync: true,
      autoBackup: true,
      fontSize: 14,
      sidebarWidth: 320
    };
    this.activeNoteId = null;
    this.listeners = new Set();
  }

  async init() {
    // Load signer type ('vault' vs 'nip07')
    const savedSignerType = await storage.get(STORAGE_KEYS.SIGNER_TYPE);
    if (savedSignerType === 'nip07' || savedSignerType === 'vault') {
      this.signerType = savedSignerType;
    }

    // Load profilePicture
    const savedPicture = await storage.get(STORAGE_KEYS.PROFILE_PICTURE);
    if (savedPicture) {
      this.profilePicture = savedPicture;
    }

    // Load keypair or generate a new vault key
    let savedKey = await storage.get(STORAGE_KEYS.SECRET_KEY);
    if (!savedKey) {
      const newKey = createNewKeypair();
      savedKey = newKey.nsec;
      await storage.set(STORAGE_KEYS.SECRET_KEY, savedKey);
    }
    try {
      this.keypair = parseSecretKey(savedKey);
    } catch (err) {
      console.error('Failed to parse secret key, generating new one:', err);
      const newKey = createNewKeypair();
      this.keypair = newKey;
      await storage.set(STORAGE_KEYS.SECRET_KEY, newKey.nsec);
    }

    // Attempt to connect NIP-07 if in NIP-07 mode
    if (this.signerType === 'nip07' && isNip07Available()) {
      try {
        const nip07Res = await getNip07PublicKey();
        this.nip07Pubkey = nip07Res.pubkeyHex;
        this.isPaired = true;
      } catch (err) {
        console.warn('NIP-07 signer not ready on init, falling back to vault until connected:', err);
      }
    }

    // Load relays
    const savedRelays = await storage.get(STORAGE_KEYS.RELAYS);
    if (Array.isArray(savedRelays) && savedRelays.length > 0) {
      this.relays = savedRelays;
    }

    // Load settings
    const savedSettings = await storage.get(STORAGE_KEYS.SETTINGS);
    if (savedSettings) {
      this.settings = { ...this.settings, ...savedSettings };
    }

    // Load deleted IDs
    const savedDeleted = await storage.get(STORAGE_KEYS.DELETED_IDS);
    if (Array.isArray(savedDeleted)) {
      this.deletedIds = new Set(savedDeleted);
    }

    // Load pending deletions
    const savedPending = await storage.get('ff_notes_pending_deletions');
    if (Array.isArray(savedPending)) {
      this.pendingDeletions = new Map(savedPending);
    }

    // Load notes
    const savedNotes = await storage.get(STORAGE_KEYS.NOTES);
    if (Array.isArray(savedNotes)) {
      this.notes = savedNotes;
    } else {
      this.notes = [this.createWelcomeNote()];
      await this.saveNotes();
    }

    if (this.notes.length > 0) {
      this.activeNoteId = this.notes[0].id;
    }

    this.notify();
  }

  createWelcomeNote() {
    const now = Date.now();
    return {
      id: 'note_welcome_' + Math.random().toString(36).substring(2, 9),
      title: 'Welcome to Monstr Note (Encrypted)',
      content: `# Welcome to Monstr Note 👾🔒

Your notes are **end-to-end encrypted** and synchronized across your instances using the **Nostr protocol** (inspired by [deepmarks-public](https://github.com/ostermayer/deepmarks-public)).

### Key Features:
- [x] **End-to-End Encryption** (NIP-44 v2)
- [x] **Signer Options**: Use **Built-in Key Vault** or **External Extensions** like **nos2x-fox** / **Alby**!
- [x] **Real-time Cross-Instance Sync** over Nostr relays
- [ ] **Rich Formatting & Markdown**: **Bold**, *Italics*, \`Code\`, Blockquotes & Checklists!
- [ ] **Context Menu**: Right-click selected web text -> "Add Selection to Monstr Note"

> *Your privacy is fully preserved. No server reads your unencrypted notes!*`,
      tags: ['welcome', 'privacy'],
      pinned: true,
      color: 'fox-accent',
      created_at: now,
      updated_at: now,
      version: 1
    };
  }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  notify() {
    const state = this.getState();
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch (err) {
        console.error('Store listener error:', err);
      }
    }
  }

  getSignerConfig() {
    if (this.signerType === 'nip07' && this.nip07Pubkey) {
      return {
        type: 'nip07',
        pubkeyHex: this.nip07Pubkey
      };
    }
    return {
      type: 'vault',
      secretKeyHex: this.keypair?.secretKeyHex,
      pubkeyHex: this.keypair?.pubkeyHex,
      nsec: this.keypair?.nsec,
      npub: this.keypair?.npub
    };
  }

  getState() {
    return {
      notes: this.getSortedNotes(),
      activeNote: this.getActiveNote(),
      activeNoteId: this.activeNoteId,
      keypair: this.keypair,
      signerType: this.signerType,
      nip07Pubkey: this.nip07Pubkey,
      isPaired: this.isPaired,
      profilePicture: this.profilePicture,
      signerConfig: this.getSignerConfig(),
      relays: this.relays,
      settings: this.settings,
      pendingDeletions: this.pendingDeletions
    };
  }

  async updateProfilePicture(url) {
    this.profilePicture = url ? url.trim() : null;
    await storage.set(STORAGE_KEYS.PROFILE_PICTURE, this.profilePicture);
    this.notify();
  }

  getSortedNotes() {
    return [...this.notes].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.updated_at - a.updated_at;
    });
  }

  getActiveNote() {
    return this.notes.find((n) => n.id === this.activeNoteId) || null;
  }

  scheduleAutoBackupDownload() {
    if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'test') return;
    if (this.autoBackupTimer) clearTimeout(this.autoBackupTimer);
    this.autoBackupTimer = setTimeout(async () => {
      try {
        await exportVaultJSON(this.notes, this.settings, { isAuto: true });
      } catch (err) {
        console.warn('[NotesStore] Auto-backup download failed:', err);
      }
    }, 5000);
  }

  async saveNotes(immediate = false) {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    if (immediate || (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'test')) {
      return this._performDiskSave();
    }
    return new Promise((resolve) => {
      this.saveTimer = setTimeout(async () => {
        await this._performDiskSave();
        resolve();
      }, 300);
    });
  }

  async _performDiskSave() {
    await storage.set(STORAGE_KEYS.NOTES, this.notes);
    if (this.settings && this.settings.autoBackup) {
      await storage.set(STORAGE_KEYS.AUTO_BACKUP_SNAPSHOT, {
        timestamp: new Date().toISOString(),
        notes: this.notes,
        settings: this.settings
      });
      this.scheduleAutoBackupDownload();
    }
  }

  async importBackupNotes(importedNotes) {
    if (!Array.isArray(importedNotes)) return { importedCount: 0, total: 0 };
    let importedCount = 0;
    const now = Date.now();
    let timeOffset = 0;

    for (const rawNote of importedNotes) {
      if (!rawNote || typeof rawNote !== 'object') continue;
      const noteId = rawNote.id || ('note_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7));

      // Remove from deleted tracking so restored note syncs across devices
      this.deletedIds.delete(noteId);
      this.pendingDeletions.delete(noteId);

      const existingIndex = this.notes.findIndex((n) => n.id === noteId);
      const noteObj = {
        id: noteId,
        title: rawNote.title || deriveTitleFromContent(rawNote.content || ''),
        isManualTitle: Boolean(rawNote.isManualTitle),
        content: rawNote.content || '',
        tags: Array.isArray(rawNote.tags) ? rawNote.tags : [],
        pinned: Boolean(rawNote.pinned),
        color: rawNote.color || 'fox-accent',
        created_at: typeof rawNote.created_at === 'number' ? rawNote.created_at : now,
        updated_at: now + (timeOffset++),
        version: typeof rawNote.version === 'number' ? rawNote.version + 1 : 1
      };

      if (existingIndex === -1) {
        this.notes.unshift(noteObj);
        importedCount++;
      } else {
        const existing = this.notes[existingIndex];
        if (noteObj.updated_at >= (existing.updated_at || 0)) {
          this.notes[existingIndex] = noteObj;
          importedCount++;
        }
      }
    }

    if (importedCount > 0) {
      if (!this.activeNoteId && this.notes.length > 0) {
        this.activeNoteId = this.notes[0].id;
      }
      await this.saveDeletedIds();
      await this.saveNotes();
      this.notify();
    }

    return { importedCount, total: importedNotes.length };
  }

  async saveDeletedIds() {
    await storage.set(STORAGE_KEYS.DELETED_IDS, Array.from(this.deletedIds));
  }

  async createNote({ title = '', content = '', tags = [], pinned = false, color = 'fox-accent', isManualTitle = false } = {}) {
    const now = Date.now();
    const isManual = isManualTitle || (Boolean(title && title.trim() && title !== 'New Note'));
    const initialTitle = isManual ? title.trim() : deriveTitleFromContent(content);
    const note = {
      id: 'note_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      title: initialTitle,
      isManualTitle: isManual,
      content,
      tags,
      pinned,
      color,
      created_at: now,
      updated_at: now,
      version: 1
    };
    this.notes.unshift(note);
    this.activeNoteId = note.id;
    await this.saveNotes();
    this.notify();
    return note;
  }

  async updateNote(id, changes) {
    const index = this.notes.findIndex((n) => n.id === id);
    if (index === -1) return null;
    const existing = this.notes[index];
    let isManual = existing.isManualTitle;
    let newTitle = existing.title;

    if (changes.title !== undefined) {
      const trimmed = changes.title.trim();
      if (trimmed.length > 0) {
        isManual = true;
        newTitle = trimmed;
      } else {
        isManual = false;
        newTitle = deriveTitleFromContent(changes.content !== undefined ? changes.content : existing.content);
      }
    } else if (changes.content !== undefined && !isManual) {
      newTitle = deriveTitleFromContent(changes.content);
    }

    const now = Date.now();
    const newUpdatedAt = Math.max(now, (existing.updated_at || 0) + 1);

    const updated = {
      ...existing,
      ...changes,
      title: newTitle,
      isManualTitle: isManual,
      updated_at: newUpdatedAt,
      version: (existing.version || 1) + 1
    };
    this.notes[index] = updated;
    await this.saveNotes();
    this.notify();
    return updated;
  }

  async setNoteReminder(id, reminderAt) {
    const index = this.notes.findIndex((n) => n.id === id);
    if (index === -1) return null;
    const existing = this.notes[index];
    const updated = {
      ...existing,
      reminder_at: reminderAt,
      reminder_triggered: false,
      updated_at: Math.max(Date.now(), (existing.updated_at || 0) + 1)
    };
    this.notes[index] = updated;
    await this.saveNotes();
    this.notify();
    return updated;
  }

  async clearNoteReminder(id) {
    const index = this.notes.findIndex((n) => n.id === id);
    if (index === -1) return null;
    const existing = this.notes[index];
    const updated = {
      ...existing,
      reminder_at: null,
      reminder_triggered: false,
      updated_at: Math.max(Date.now(), (existing.updated_at || 0) + 1)
    };
    this.notes[index] = updated;
    await this.saveNotes();
    this.notify();
    return updated;
  }

  async checkReminders() {
    const now = Date.now();
    let triggeredAny = false;
    const triggeredNotes = [];

    const maxTimestamp = this.notes.reduce((max, n) => Math.max(max, n.updated_at || 0), 0);
    let timeOffset = 1;

    for (let i = 0; i < this.notes.length; i++) {
      const note = this.notes[i];
      if (note.reminder_at && !note.reminder_triggered && now >= note.reminder_at) {
        note.reminder_triggered = true;
        note.updated_at = Math.max(now, maxTimestamp + (timeOffset++));
        
        this.notes.splice(i, 1);
        this.notes.unshift(note);
        
        triggeredNotes.push(note);
        triggeredAny = true;
      }
    }

    if (triggeredAny) {
      await this.saveNotes();
      this.notify({ triggeredNotes });
    }

    return triggeredNotes;
  }

  async deleteNote(id) {
    const index = this.notes.findIndex((n) => n.id === id);
    if (index === -1) return false;
    const tombstone = {
      id,
      deleted: true,
      updated_at: Date.now()
    };
    this.notes.splice(index, 1);
    this.deletedIds.add(id);
    this.pendingDeletions.set(id, tombstone);
    await this.saveDeletedIds();
    await this.saveNotes();
    await storage.set('ff_notes_pending_deletions', Array.from(this.pendingDeletions.entries()));
    if (this.activeNoteId === id) {
      this.activeNoteId = this.notes.length > 0 ? this.notes[0].id : null;
    }
    this.notify();
    return true;
  }

  async clearPendingDeletion(id) {
    if (this.pendingDeletions.has(id)) {
      this.pendingDeletions.delete(id);
      await storage.set('ff_notes_pending_deletions', Array.from(this.pendingDeletions.entries()));
    }
  }

  async setSignerType(type) {
    if (type !== 'vault' && type !== 'nip07') return;
    this.signerType = type;
    await storage.set(STORAGE_KEYS.SIGNER_TYPE, type);
    if (type === 'nip07' && isNip07Available()) {
      await this.connectNip07Signer();
    }
    this.notify();
  }

  async connectNip07Signer() {
    const res = await getNip07PublicKey();
    this.nip07Pubkey = res.pubkeyHex;
    this.signerType = 'nip07';
    this.isPaired = true;
    await storage.set(STORAGE_KEYS.SIGNER_TYPE, 'nip07');
    await storage.set(STORAGE_KEYS.IS_PAIRED, true);
    this.notify();
    return res;
  }

  async setKeypair(nsecOrHex) {
    const parsed = parseSecretKey(nsecOrHex);
    this.keypair = parsed;
    this.signerType = 'vault';
    this.isPaired = true;
    await storage.set(STORAGE_KEYS.SECRET_KEY, parsed.nsec);
    await storage.set(STORAGE_KEYS.SIGNER_TYPE, 'vault');
    await storage.set(STORAGE_KEYS.IS_PAIRED, true);
    this.notify();
    return parsed;
  }

  async setRelays(relayList) {
    this.relays = [...new Set(relayList.map((r) => r.trim()).filter(Boolean))];
    await storage.set(STORAGE_KEYS.RELAYS, this.relays);
    this.notify();
  }

  async updateSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
    await storage.set(STORAGE_KEYS.SETTINGS, this.settings);
    if (this.settings.autoBackup) {
      await this.saveNotes();
    }
    this.notify();
  }

  async selectNote(id) {
    const index = this.notes.findIndex((n) => n.id === id);
    if (index !== -1) {
      this.activeNoteId = id;
      const [note] = this.notes.splice(index, 1);
      const maxTimestamp = this.notes.reduce((max, n) => Math.max(max, n.updated_at || 0), 0);
      note.updated_at = Math.max(Date.now(), maxTimestamp + 1);
      this.notes.unshift(note);
      await this.saveNotes();
      this.notify();
    }
  }

  async mergeRemoteNote(remoteNote) {
    if (!remoteNote || !remoteNote.id) return false;

    if (remoteNote.deleted) {
      this.deletedIds.add(remoteNote.id);
      await this.saveDeletedIds();
      const existingIndex = this.notes.findIndex((n) => n.id === remoteNote.id);
      if (existingIndex !== -1) {
        this.notes.splice(existingIndex, 1);
        await this.saveNotes();
        if (this.activeNoteId === remoteNote.id) {
          this.activeNoteId = this.notes.length > 0 ? this.notes[0].id : null;
        }
        this.notify();
        return true;
      }
      return false;
    }

    if (this.deletedIds.has(remoteNote.id)) {
      return false;
    }

    const existingIndex = this.notes.findIndex((n) => n.id === remoteNote.id);
    if (existingIndex === -1) {
      this.notes.unshift(remoteNote);
      await this.saveNotes();
      this.notify();
      return true;
    }

    const existing = this.notes[existingIndex];
    if (remoteNote.updated_at > existing.updated_at) {
      this.notes[existingIndex] = remoteNote;
      await this.saveNotes();
      this.notify();
      return true;
    }

    return false;
  }
}

export const notesStore = new NotesStore();
