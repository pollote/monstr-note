import test from 'node:test';
import assert from 'node:assert';
import { parseBackupJSON } from '../src/lib/utils/exporter.js';

test('parseBackupJSON - Standard array format', () => {
  const input = JSON.stringify({
    app: 'Monstr Note (Encrypted Nostr)',
    notes: [
      { id: '1', title: 'Note 1', content: 'Content 1' },
      { id: '2', title: 'Note 2', content: 'Content 2' }
    ]
  });

  const parsed = parseBackupJSON(input);
  assert.strictEqual(parsed.success, true);
  assert.strictEqual(parsed.notes.length, 2);
  assert.strictEqual(parsed.notes[0].title, 'Note 1');
});

test('parseBackupJSON - Sidebar Notepad manifest + contents format', () => {
  const input = JSON.stringify({
    app: 'Sidebar Notepad',
    version: '1.0',
    exportedAt: 1788830000000,
    manifest: [
      { id: 'n_1', title: 'Note 1', updatedAt: 1788830000001, pinned: true, color: 'none', customTitle: false },
      { id: 'n_2', title: 'Custom Title', updatedAt: 1788830000002, pinned: false, color: 'red', customTitle: true }
    ],
    contents: {
      n_1: 'Hello world from note 1',
      n_2: 'Hello world from note 2'
    }
  });

  const parsed = parseBackupJSON(input);
  assert.strictEqual(parsed.success, true);
  assert.strictEqual(parsed.notes.length, 2);
  assert.strictEqual(parsed.notes[0].id, 'n_1');
  assert.strictEqual(parsed.notes[0].content, 'Hello world from note 1');
  assert.strictEqual(parsed.notes[0].pinned, true);
  assert.strictEqual(parsed.notes[1].id, 'n_2');
  assert.strictEqual(parsed.notes[1].isManualTitle, true);
  assert.strictEqual(parsed.notes[1].content, 'Hello world from note 2');
});
