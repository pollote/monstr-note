import { renderMarkdown } from './markdown.js';

export function exportNoteAsMarkdown(note) {
  const filename = sanitizeFilename(note.title || 'note') + '.md';
  const content = note.content || '';
  triggerDownload(filename, content, 'text/markdown;charset=utf-8;');
}

export function exportNoteAsHTML(note) {
  const filename = sanitizeFilename(note.title || 'note') + '.html';
  const htmlBody = renderMarkdown(note.content || '');
  const htmlDocument = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(note.title || 'Monstr Note')}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; max-width: 700px; margin: 40px auto; padding: 0 20px; line-height: 1.6; color: #202124; background: #fff; }
    h1, h2, h3 { color: #1a73e8; }
    code { background: #f1f3f4; padding: 2px 6px; border-radius: 4px; font-family: monospace; }
    pre code { display: block; padding: 12px; overflow-x: auto; }
    blockquote { border-left: 4px solid #4285f4; margin: 0; padding-left: 16px; color: #5f6368; }
    .task-list-item { display: flex; align-items: center; gap: 8px; margin: 4px 0; }
    .completed { text-decoration: line-through; opacity: 0.7; }
  </style>
</head>
<body>
  ${htmlBody}
</body>
</html>`;
  triggerDownload(filename, htmlDocument, 'text/html;charset=utf-8;');
}

export function exportNoteAsTXT(note) {
  const filename = sanitizeFilename(note.title || 'note') + '.txt';
  const content = (note.title ? note.title + '\n\n' : '') + (note.content || '');
  triggerDownload(filename, content, 'text/plain;charset=utf-8;');
}

let lastExportedHash = null;

function computeVaultHash(notes, settings) {
  if (!Array.isArray(notes)) return '';
  const noteString = notes.map((n) => `${n.id}:${n.updated_at}:${n.title}:${n.content}`).join('|');
  const settingsString = JSON.stringify(settings || {});
  return noteString + '__' + settingsString;
}

export async function exportVaultJSON(notes, settings, { isAuto = false, force = false } = {}) {
  const currentHash = computeVaultHash(notes, settings);
  if (isAuto && !force && currentHash === lastExportedHash) {
    return;
  }
  lastExportedHash = currentHash;

  const filename = isAuto ? 'monstr-note-backup-auto.json' : `monstr-note-vault-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const vaultData = {
    app: 'Monstr Note (Encrypted Nostr)',
    exported_at: new Date().toISOString(),
    notes,
    settings
  };

  const jsonContent = JSON.stringify(vaultData, null, 2);
  const dataUrl = 'data:application/json;charset=utf-8,' + encodeURIComponent(jsonContent);
  const extensionApi = typeof browser !== 'undefined' && browser.downloads ? browser : (typeof chrome !== 'undefined' && chrome.downloads ? chrome : null);

  if (extensionApi && extensionApi.downloads && typeof extensionApi.downloads.download === 'function') {
    try {
      const downloadOptions = {
        url: dataUrl,
        filename,
        saveAs: !isAuto,
        conflictAction: 'overwrite'
      };

      const result = extensionApi.downloads.download(downloadOptions);
      if (result && typeof result.then === 'function') {
        await result;
      }
      return;
    } catch (err) {
      console.warn('[Exporter] browser.downloads failed, falling back to Blob link:', err);
    }
  }

  triggerDownload(filename, jsonContent, 'application/json;charset=utf-8;');
}

export function parseBackupJSON(jsonText) {
  try {
    const data = JSON.parse(jsonText);
    let notes = [];
    if (Array.isArray(data)) {
      notes = data;
    } else if (data && Array.isArray(data.notes)) {
      notes = data.notes;
    } else if (data && Array.isArray(data.manifest)) {
      const contents = data.contents || {};
      notes = data.manifest.map((item) => ({
        id: item.id,
        title: item.title || '',
        isManualTitle: Boolean(item.customTitle || item.isManualTitle),
        content: (contents[item.id] !== undefined ? contents[item.id] : item.content) || '',
        pinned: Boolean(item.pinned),
        color: item.color && item.color !== 'none' ? item.color : 'fox-accent',
        tags: Array.isArray(item.tags) ? item.tags : [],
        created_at: item.createdAt || item.updatedAt || Date.now(),
        updated_at: item.updatedAt || Date.now()
      }));
    } else if (data && typeof data === 'object' && (data.id || data.content !== undefined || data.title !== undefined)) {
      notes = [data];
    } else {
      throw new Error('Invalid backup file format: missing notes array.');
    }

    const validNotes = notes.filter((n) => n && typeof n === 'object' && (n.id || n.content !== undefined || n.title !== undefined));
    return {
      success: true,
      notes: validNotes,
      settings: data.settings || null
    };
  } catch (err) {
    return {
      success: false,
      error: err.message || 'Failed to parse JSON backup file.'
    };
  }
}

function triggerDownload(filename, textContent, mimeType) {
  if (typeof document === 'undefined') return;
  const blob = new Blob([textContent], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9_\-\s]/g, '').trim() || 'monstr-note';
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
