import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

console.log('Starting file watcher for Firefox Notes...');
console.log('Target XPI file: /home/pollote/Documents/antigravity/jolly-tesla/dist/firefox-notes-encrypted.xpi');

let rebuildTimeout = null;

function triggerRebuild() {
  if (rebuildTimeout) clearTimeout(rebuildTimeout);
  rebuildTimeout = setTimeout(() => {
    try {
      console.log(`\n[${new Date().toLocaleTimeString()}] Changes detected. Updating XPI package...`);
      execSync('node scripts/package.js', { stdio: 'inherit' });
      console.log(`✨ Updated: /home/pollote/Documents/antigravity/jolly-tesla/dist/firefox-notes-encrypted.xpi`);
    } catch (err) {
      console.error('Rebuild failed:', err.message);
    }
  }, 200);
}

// Initial package build
triggerRebuild();

// Watch directories
const watchDirs = ['src', 'scripts', 'manifest.json'];
watchDirs.forEach((dir) => {
  if (fs.existsSync(dir)) {
    fs.watch(dir, { recursive: true }, (eventType, filename) => {
      if (filename && !filename.includes('dist/') && !filename.includes('.git')) {
        triggerRebuild();
      }
    });
  }
});
