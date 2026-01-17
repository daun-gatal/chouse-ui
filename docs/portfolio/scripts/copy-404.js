#!/usr/bin/env node
/**
 * Copy index.html to 404.html for GitHub Pages SPA routing support
 * 
 * GitHub Pages serves 404.html for any 404 errors, which allows
 * Single Page Applications to handle client-side routing properly.
 * This ensures Googlebot and other crawlers get the correct content
 * instead of redirect errors.
 */

import { copyFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const distPath = join(__dirname, '..', 'dist');
const indexPath = join(distPath, 'index.html');
const notFoundPath = join(distPath, '404.html');

if (!existsSync(indexPath)) {
  console.error('✗ index.html not found in dist/');
  console.error(`  Expected at: ${indexPath}`);
  process.exit(1);
}

try {
  copyFileSync(indexPath, notFoundPath);
  console.log('✓ Copied index.html to 404.html for GitHub Pages SPA routing');
  console.log(`  This ensures Googlebot and other crawlers get proper content instead of redirect errors`);
} catch (error) {
  console.error('✗ Failed to copy index.html to 404.html:', error.message);
  process.exit(1);
}
