
import fs from 'node:fs';
import path from 'node:path';

const SOURCE_DIR = path.resolve(process.cwd(), '../../public/screenshots');
const DEST_DIR = path.resolve(process.cwd(), 'public/screenshots');
const JSON_OUTPUT = path.resolve(process.cwd(), 'public/screenshots.json');

console.log('🔄 Syncing screenshots...');

if (!fs.existsSync(SOURCE_DIR)) {
    console.error(`❌ Source directory not found: ${SOURCE_DIR}`);
    process.exit(1);
}

if (!fs.existsSync(DEST_DIR)) {
    fs.mkdirSync(DEST_DIR, { recursive: true });
}

// Copy files
const files = fs.readdirSync(SOURCE_DIR);
const screenshots = files.filter(file => /\.(png|jpg|jpeg|gif|webp)$/i.test(file));

for (const file of screenshots) {
    fs.copyFileSync(path.join(SOURCE_DIR, file), path.join(DEST_DIR, file));
}

console.log(`✅ Copied ${screenshots.length} screenshots to ${DEST_DIR}`);

// Generate JSON
fs.writeFileSync(JSON_OUTPUT, JSON.stringify(screenshots, null, 2));
console.log(`✅ Generated screenshots.json at ${JSON_OUTPUT}`);
