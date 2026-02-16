#!/usr/bin/env node

import { writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const distPath = join(__dirname, '..', 'dist');
const sitemapPath = join(distPath, 'sitemap.xml');
const siteUrl = 'https://chouse-ui.com';
const lastMod = new Date().toISOString().split('T')[0];

if (!existsSync(distPath)) {
    console.error('✗ dist/ directory not found. Please run build first.');
    process.exit(1);
}

const sitemapContent = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9
        http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd">
  
  <!-- Homepage -->
  <url>
    <loc>${siteUrl}/</loc>
    <lastmod>${lastMod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  
  <!-- Documentation (external link, but good to have) -->
  <url>
    <loc>${siteUrl}/docs/</loc>
    <lastmod>${lastMod}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
  
</urlset>`;

try {
    writeFileSync(sitemapPath, sitemapContent);
    console.log(`✓ Generated sitemap.xml at ${sitemapPath}`);
    console.log(`  Lastmod date set to: ${lastMod}`);
} catch (error) {
    console.error('✗ Failed to generate sitemap.xml:', error.message);
    process.exit(1);
}
