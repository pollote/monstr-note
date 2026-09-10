import test from 'node:test';
import assert from 'node:assert';
import { notesStore } from '../src/lib/storage/notes-store.js';
import { createNewKeypair } from '../src/lib/crypto/nostr-crypto.js';

test('NotesStore - Create, Update, Delete & Conflict Resolution', async () => {
  await notesStore.init();

  // 1. Create Note
  const note = await notesStore.createNote({
    title: 'Sync Test Note',
    content: 'Initial body'
  });

  assert.ok(note.id);
  assert.strictEqual(note.title, 'Sync Test Note');

  // 2. Remote Note Merge (Newer Remote Note)
  const remoteUpdated = {
    ...note,
    content: 'Updated from Firefox Instance B',
    updated_at: note.updated_at + 1000
  };

  const merged = await notesStore.mergeRemoteNote(remoteUpdated);
  assert.strictEqual(merged, true);

  const active = notesStore.getActiveNote();
  assert.strictEqual(active.content, 'Updated from Firefox Instance B');

  // 3. Older Remote Note (Should be rejected)
  const olderRemote = {
    ...note,
    content: 'Stale content',
    updated_at: note.updated_at - 5000
  };

  const mergedOlder = await notesStore.mergeRemoteNote(olderRemote);
  assert.strictEqual(mergedOlder, false);

  // 4. Delete Note & Remote Ignored
  await notesStore.deleteNote(note.id);
  const reMergeDeleted = await notesStore.mergeRemoteNote(remoteUpdated);
  assert.strictEqual(reMergeDeleted, false);

  // 4b. Test Remote Deletion Payload Sync
  const note2 = await notesStore.createNote({ title: 'Remote Delete Test', content: 'Body' });
  const remoteDeletion = { id: note2.id, deleted: true, updated_at: Date.now() + 100 };
  const mergedDeletion = await notesStore.mergeRemoteNote(remoteDeletion);
  assert.strictEqual(mergedDeletion, true);
  assert.strictEqual(notesStore.getState().notes.some((n) => n.id === note2.id), false);

  // 5. Verify isPaired state transition on setKeypair
  const validKp = createNewKeypair();
  const newKp = await notesStore.setKeypair(validKp.nsec);
  assert.strictEqual(notesStore.getState().isPaired, true);
  assert.ok(newKp.nsec);

  // 6. Test Auto Title Derivation from First Words & Manual Title Override
  const autoNote = await notesStore.createNote({ title: '', content: '' });
  assert.strictEqual(autoNote.isManualTitle, false);
  
  // Updating content without manual title should derive title from first words
  const updatedAutoNote = await notesStore.updateNote(autoNote.id, { content: '# Meeting Notes for Project X\nDetails here...' });
  assert.strictEqual(updatedAutoNote.title, 'Meeting Notes for Project X');
  assert.strictEqual(updatedAutoNote.isManualTitle, false);

  // Manually assigning a title locks isManualTitle = true
  const manualTitleNote = await notesStore.updateNote(autoNote.id, { title: 'Custom Project Title' });
  assert.strictEqual(manualTitleNote.title, 'Custom Project Title');
  assert.strictEqual(manualTitleNote.isManualTitle, true);

  // 7. Test Local Backup Export & Restore Import
  const backupImportList = [
    { id: 'note_backup_1', title: 'Backup Note 1', content: 'Restored content 1', updated_at: Date.now() },
    { id: 'note_backup_2', title: 'Backup Note 2', content: 'Restored content 2', updated_at: Date.now() }
  ];
  const importRes = await notesStore.importBackupNotes(backupImportList);
  assert.strictEqual(importRes.importedCount, 2);
  assert.strictEqual(notesStore.getState().notes.some((n) => n.id === 'note_backup_1'), true);
  assert.strictEqual(notesStore.getState().notes.some((n) => n.id === 'note_backup_2'), true);

  // 8. Test Selecting / Opening Note Moves It to Top of List
  await notesStore.selectNote('note_backup_1');
  const currentNotes = notesStore.getState().notes;
  const firstUnpinned = currentNotes.find((n) => !n.pinned);
  assert.strictEqual(firstUnpinned.id, 'note_backup_1');

  // 9. Test Updating Note Tags & Color
  const updatedTagColorNote = await notesStore.updateNote('note_backup_1', {
    tags: ['work', 'urgent'],
    color: 'red'
  });
  assert.deepStrictEqual(updatedTagColorNote.tags, ['work', 'urgent']);
  assert.strictEqual(updatedTagColorNote.color, 'red');

  // 10. Test Setting & Triggering Reminders / Timers
  const remNote1 = await notesStore.createNote({ title: 'Reminder Note 1', content: 'Alert me' });

  // Set reminder for past timestamp so checkReminders triggers immediately
  const pastTs = Date.now() - 5000;
  await notesStore.setNoteReminder(remNote1.id, pastTs);
  
  const stateWithReminder = notesStore.getState();
  const targetNote = stateWithReminder.notes.find((n) => n.id === remNote1.id);
  assert.strictEqual(targetNote.reminder_at, pastTs);
  assert.strictEqual(targetNote.reminder_triggered, false);

  // Trigger reminders
  const triggered = await notesStore.checkReminders();
  assert.strictEqual(triggered.length, 1);
  assert.strictEqual(triggered[0].id, remNote1.id);
  assert.strictEqual(triggered[0].reminder_triggered, true);

  // Triggered note must now be at top of unpinned notes list
  const notesAfterTrigger = notesStore.getState().notes;
  const topUnpinned = notesAfterTrigger.find((n) => !n.pinned);
  assert.strictEqual(topUnpinned.id, remNote1.id);

  // Clear reminder
  await notesStore.clearNoteReminder(remNote1.id);
  const clearedNote = notesStore.getState().notes.find((n) => n.id === remNote1.id);
  assert.strictEqual(clearedNote.reminder_at, null);
  assert.strictEqual(clearedNote.reminder_triggered, false);
});

