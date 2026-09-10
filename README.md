# Monstr Note (Encrypted Nostr Sync) 👾🔒

**Monstr Note** is a privacy-first, end-to-end encrypted WebExtension for managing notes and web snippets. It features real-time, decentralized cross-device synchronization powered by the **Nostr protocol** ([NIP-44 v2 encryption](https://github.com/nostr-protocol/nips/blob/master/44.md)).

---

## 🌟 Key Features

* 🔒 **End-to-End Encryption (E2EE)**: All notes are encrypted client-side using NIP-44 v2 before reaching any storage relay or network socket.
* 🌐 **Decentralized Real-Time Sync**: Sync notes automatically across your browser instances over custom Nostr relays without centralized backend servers.
* 🔑 **Flexible Signer Modes**:
  * **Built-in Key Vault**: Generates and securely manages your Nostr secret key (`nsec`) locally within extension storage.
  * **External Signer (NIP-07)**: Delegates signing and encryption to external browser extensions such as **nos2x-fox**, **Alby**, or **nos2x**.
* ✂️ **Web Clipper & Context Menu**: Right-click any selected text or link on any webpage to save snippets directly into your encrypted notes.
* 📝 **Rich Markdown & Organization**: Live Markdown rendering, task checklists, pin status, custom color tagging, auto-derived titles, and search filtering.
* 💾 **Local Storage & Auto-Backup**: Primary state is persisted in extension local storage (`chrome.storage.local` / `browser.storage.local`) with optional local JSON backups.

---

## 🔍 How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                    Monstr Note Extension                    │
│                                                             │
│  [ Sidebar / Popup UI ] ───► [ Local Extension Storage ]    │
│            │                             │                  │
│            ▼                             ▼                  │
│  [ NIP-44 v2 Encryption ] ◄───► [ Sync Engine ]              │
└────────────┬─────────────────────────────┬──────────────────┘
             │ (Ciphertext Only)           │
             ▼                             ▼
┌─────────────────────────────────────────────────────────────┐
│                       Nostr Relays                          │
│   wss://relay.damus.io | wss://nos.lol | wss://relay.deepmarks.org │
└─────────────────────────────────────────────────────────────┘
```

1. **Local State**: Notes are edited in the Sidebar or Popup and saved locally using the WebExtension storage API for immediate offline access.
2. **Client-Side Encryption**: When a note is created or updated, the content payload is encrypted using NIP-44 v2 conversation keys derived from your secret key (`nsec`) and public key (`npub`).
3. **Nostr Relay Publication**: The encrypted payload is wrapped in a Nostr **Kind 30078** event (`monstr-note:<id>`) and published to configured Nostr relays.
4. **Cross-Device Sync**: Other instances subscribed to your public key receive the event, decrypt it locally, and update their local storage.

---

## 🛡️ Security & Privacy Architecture

* **Zero Plaintext Storage**: Relays and network observers receive only encrypted ciphertext bytes. It is mathematically impossible for relay operators or third parties to read your notes.
* **NIP-44 v2 Cryptographic Stack**:
  * **Curve**: Secp256k1
  * **Key Agreement**: ECDH (Elliptic-Curve Diffie-Hellman)
  * **Key Derivation**: HKDF-SHA256
  * **Authenticated Encryption**: ChaCha20-Poly1305
* **Zero Telemetry**: Monstr Note collects no telemetry, analytics, or user metrics (`data_collection_permissions: { required: ["none"] }`).

---

## 💾 Data & Storage Breakdown

| Storage Location | Content Stored | Encryption Level |
| :--- | :--- | :--- |
| **Local Browser Storage** (`chrome.storage.local`) | Notes, Settings, Keypair / Signer Config | Local extension sandbox |
| **Nostr Relays** (`wss://...`) | Kind 30078 Events (Ciphertext Payload) | End-to-End Encrypted (NIP-44 v2) |
| **Local Export Backups** | Full JSON Snapshots | Local JSON file export |

---

## 🚀 Getting Started & Installation

### Build from Source

```bash
# Clone repository
git clone https://github.com/pollote/monstr-note.git
cd monstr-note

# Install dependencies
npm install

# Run unit tests
npm test

# Build extension bundles
npm run build
```

### Load Unpacked Extension

#### Firefox
1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Click **Load Temporary Add-on...**.
3. Select `manifest.json` from the project folder.

#### Chrome / Edge / Brave
1. Open `chrome://extensions/`.
2. Enable **Developer mode** in the top right.
3. Click **Load unpacked** and select the project directory.

---

## 🛠️ Project Structure

```
├── manifest.json            # WebExtension Manifest V3
├── package.json             # NPM package setup & test scripts
├── scripts/                 # esbuild & packaging scripts
├── src/
│   ├── background/          # Extension background service script
│   ├── content-script/      # NIP-07 extension bridge content script
│   ├── lib/
│   │   ├── crypto/          # NIP-44 v2 & Nostr keypair utilities
│   │   ├── storage/         # Notes state store & extension storage wrapper
│   │   ├── sync/            # Relay pool manager & sync engine
│   │   └── utils/           # Markdown renderer & exporter
│   ├── popup/               # Popup UI (HTML/JS)
│   └── sidebar/             # Sidebar UI (HTML/JS)
└── tests/                   # Automated unit test suite
```

---

## 📜 License

This project is licensed under the **GNU General Public License v3.0** (`GPL-3.0-only`).
