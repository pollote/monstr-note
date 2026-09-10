import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

console.log('Packaging Monstr Note WebExtension...');

// First run build
execSync('node scripts/build.js', { stdio: 'inherit' });

const packageZipPath = path.resolve('dist/monstr-note-extension.zip');
const packageXpiPath = path.resolve('dist/monstr-note-encrypted.xpi');
const legacyXpiPath = path.resolve('dist/firefox-notes-encrypted.xpi');

// Files to include in WebExtension package
const includes = [
  'manifest.json',
  'src/sidebar/sidebar.html',
  'src/popup/popup.html',
  'src/page/index.html',
  'src/styles/theme.css',
  'src/styles/notes.css',
  'dist/background.bundle.js',
  'dist/sidebar.bundle.js',
  'dist/popup.bundle.js',
  'dist/page.bundle.js',
  'dist/content-bridge.bundle.js',
  'icons/icon-16.png',
  'icons/icon-32.png',
  'icons/icon-48.png',
  'icons/icon-128.png'
];

try {
  // Zip the files to .zip
  const cmdZip = `zip -r -FS "${packageZipPath}" ${includes.join(' ')}`;
  execSync(cmdZip, { stdio: 'inherit' });

  // Copy or zip to .xpi
  const cmdXpi = `zip -r -FS "${packageXpiPath}" ${includes.join(' ')}`;
  execSync(cmdXpi, { stdio: 'inherit' });

  // Maintain legacy alias for xpi
  fs.copyFileSync(packageXpiPath, legacyXpiPath);

  console.log(`\n🎉 Monstr Note Extension packaged successfully:`);
  console.log(`- ZIP: ${packageZipPath}`);
  console.log(`- XPI: ${packageXpiPath}`);
} catch (err) {
  console.error('Failed to create package:', err);
  process.exit(1);
}
