import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';

const distDir = path.resolve('dist');
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

console.log('Building Monstr Note WebExtension bundles...');

await esbuild.build({
  entryPoints: {
    'background.bundle': 'src/background/background.js',
    'sidebar.bundle': 'src/sidebar/sidebar.js',
    'popup.bundle': 'src/popup/popup.js',
    'page.bundle': 'src/page/page.js',
    'content-bridge.bundle': 'src/content-script/content-bridge.js'
  },
  bundle: true,
  outdir: 'dist',
  format: 'iife',
  target: 'es2022',
  platform: 'browser',
  sourcemap: true,
  minify: false
});

console.log('Build completed successfully in dist/');
