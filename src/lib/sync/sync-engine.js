import { createSignedEvent, encryptPayload, decryptPayload } from '../crypto/nostr-crypto.js';
import { RelayPool } from './relay-pool.js';
import { notesStore } from '../storage/notes-store.js';

export class SyncEngine {
  constructor() {
    this.pool = new RelayPool();
    this.signerConfig = null;
    this.subId = 'ff_notes_sync_' + Math.random().toString(36).substring(2, 7);
    this.syncState = 'idle';
    this.lastSyncedAt = null;
    this.listeners = new Set();
    this.publishedEventsMap = new Map();
    this.currentPubkey = null;
    this.currentRelaysStr = '';
    this.storeChangeTimer = null;
    this.publishingNotes = new Set();
  }

  async init() {
    this.pool.onStatusChange(({ connectedCount, totalRelays }) => {
      this.notify();
    });

    notesStore.subscribe((state) => {
      this.signerConfig = state.signerConfig;

      const newRelaysStr = Array.isArray(state.relays) ? state.relays.join(',') : '';
      if (newRelaysStr !== this.currentRelaysStr) {
        this.currentRelaysStr = newRelaysStr;
        this.pool.updateRelays(state.relays || []);
      }

      const newPubkey = state.signerConfig?.pubkeyHex || null;
      if (newPubkey && newPubkey !== this.currentPubkey) {
        this.currentPubkey = newPubkey;
        this.startSubscription();
      }

      this.scheduleStoreChangeCheck(state);
    });

    const initialState = notesStore.getState();
    if (initialState) {
      this.signerConfig = initialState.signerConfig;
      this.currentPubkey = initialState.signerConfig?.pubkeyHex || null;
      this.currentRelaysStr = Array.isArray(initialState.relays) ? initialState.relays.join(',') : '';
      this.pool.updateRelays(initialState.relays || []);
      if (this.currentPubkey) {
        this.startSubscription();
      }
    }
  }

  startSubscription() {
    if (!this.signerConfig?.pubkeyHex) return;

    const filterNotes = {
      kinds: [30078],
      authors: [this.signerConfig.pubkeyHex],
      '#t': ['monstr-notes', 'firefox-notes']
    };

    const filterProfile = {
      kinds: [0],
      authors: [this.signerConfig.pubkeyHex],
      limit: 1
    };

    this.syncState = 'syncing';
    this.notify();

    this.pool.subscribe(
      this.subId,
      filterNotes,
      (event) => this.handleIncomingEvent(event),
      (relayUrl) => {
        this.syncState = 'synced';
        this.lastSyncedAt = Date.now();
        this.notify();
      }
    );

    this.pool.subscribe(
      this.subId + '_profile',
      filterProfile,
      (event) => this.handleProfileMetadataEvent(event)
    );
  }

  async handleProfileMetadataEvent(event) {
    if (event.kind !== 0) return;
    try {
      const profile = JSON.parse(event.content);
      if (profile && profile.picture) {
        const currentState = notesStore.getState();
        if (currentState && currentState.profilePicture !== profile.picture) {
          await notesStore.updateProfilePicture(profile.picture);
        }
      }
    } catch (err) {
      console.warn('[SyncEngine] Failed to parse Nostr profile metadata:', err);
    }
  }

  async handleIncomingEvent(event) {
    if (!this.signerConfig || event.kind !== 30078) return;

    try {
      const dTag = event.tags.find((t) => t[0] === 'd');
      if (!dTag || !dTag[1] || (!dTag[1].startsWith('monstr-note:') && !dTag[1].startsWith('firefox-note:'))) return;

      const decryptedJson = await decryptPayload(event.content, this.signerConfig);
      const remoteNote = JSON.parse(decryptedJson);

      if (remoteNote && remoteNote.id) {
        const merged = await notesStore.mergeRemoteNote(remoteNote);
        if (merged) {
          console.log(`[SyncEngine] Merged remote note: ${remoteNote.title} (${remoteNote.id})`);
        }
      }
    } catch (err) {
      console.error('[SyncEngine] Failed to decrypt/parse incoming Nostr event:', err);
    }
  }

  scheduleStoreChangeCheck(state) {
    if (this.storeChangeTimer) clearTimeout(this.storeChangeTimer);
    this.storeChangeTimer = setTimeout(() => {
      this.onStoreChange(state);
    }, 400);
  }

  async onStoreChange(state) {
    if (!this.signerConfig) return;

    if (state.notes) {
      for (const note of state.notes) {
        const lastPublished = this.publishedEventsMap.get(note.id) || 0;
        if (note.updated_at > lastPublished) {
          await this.publishNote(note);
        }
      }
    }

    if (state.pendingDeletions && state.pendingDeletions.size > 0) {
      for (const [id, tombstone] of state.pendingDeletions.entries()) {
        const published = await this.publishNote(tombstone);
        if (published) {
          await notesStore.clearPendingDeletion(id);
        }
      }
    }
  }

  async publishNote(note) {
    if (!this.signerConfig || !this.signerConfig.pubkeyHex) return;

    try {
      this.syncState = 'syncing';
      this.notify();

      const plaintext = JSON.stringify(note);
      const ciphertext = await encryptPayload(plaintext, this.signerConfig);

      const tags = [
        ['d', 'monstr-note:' + note.id],
        ['t', 'monstr-notes'],
        ['client', 'monstr-note-extension'],
        ['updated_at', String(note.updated_at)]
      ];

      if (note.deleted) {
        tags.push(['deleted', 'true']);
      }

      const signedEvent = await createSignedEvent({
        kind: 30078,
        content: ciphertext,
        tags,
        signerConfig: this.signerConfig,
        createdAt: Math.floor(note.updated_at / 1000)
      });

      const publishedCount = await this.pool.publish(signedEvent);
      this.publishedEventsMap.set(note.id, note.updated_at);

      this.syncState = publishedCount > 0 ? 'synced' : 'error';
      this.lastSyncedAt = Date.now();
      this.notify();
      return publishedCount > 0;
    } catch (err) {
      console.error('[SyncEngine] Failed to publish note to relays:', err);
      this.syncState = 'error';
      this.notify();
      return false;
    }
  }

  onSyncStateChange(listener) {
    this.listeners.add(listener);
    listener(this.getStatus());
    return () => this.listeners.delete(listener);
  }

  getStatus() {
    return {
      syncState: this.syncState,
      lastSyncedAt: this.lastSyncedAt,
      connectedCount: this.pool.getConnectedCount(),
      totalRelays: this.pool.relayUrls.length
    };
  }

  notify() {
    const status = this.getStatus();
    for (const listener of this.listeners) {
      try {
        listener(status);
      } catch (err) {
        console.error('SyncEngine listener error:', err);
      }
    }
  }
}

export const syncEngine = new SyncEngine();
