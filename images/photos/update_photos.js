#!/usr/bin/env node

/**
 * Photography build script
 *
 * Reads camera originals from originals/, produces:
 *   full/        — 3200px max dimension, quality 85, progressive JPEG (4K-ready)
 *   thumbnails/  — 1200px max dimension, quality 80, progressive JPEG (retina grid)
 *   photos.json  — manifest consumed by photography.js
 *
 * Skips images whose output already exists and is newer than the source.
 * Removes orphaned outputs that no longer have a matching original.
 *
 * Usage:
 *   node update_photos.js            (incremental — skip unchanged)
 *   node update_photos.js --force    (rebuild everything)
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = __dirname;
const ORIGINALS_DIR = path.join(ROOT, 'originals');
const FULL_DIR = path.join(ROOT, 'full');
const THUMB_DIR = path.join(ROOT, 'thumbnails');
const JSON_PATH = path.join(ROOT, 'photos.json');

const FULL_SIZE = 3200;
const FULL_QUALITY = 85;
const THUMB_SIZE = 1200;
const THUMB_QUALITY = 80;

const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif']);
const FORCE = process.argv.includes('--force');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`  Created ${path.relative(ROOT, dir)}/`);
  }
}

function getImages(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => {
    return ALLOWED_EXT.has(path.extname(f).toLowerCase()) && !f.startsWith('.');
  });
}

function isStale(src, dest) {
  if (FORCE) return true;
  if (!fs.existsSync(dest)) return true;
  const srcTime = fs.statSync(src).mtimeMs;
  const destTime = fs.statSync(dest).mtimeMs;
  return srcTime > destTime;
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function dirSize(dir) {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).reduce((sum, f) => {
    const fp = path.join(dir, f);
    const stat = fs.statSync(fp);
    return sum + (stat.isFile() ? stat.size : 0);
  }, 0);
}

async function processImage(file) {
  const srcPath = path.join(ORIGINALS_DIR, file);
  const fullPath = path.join(FULL_DIR, file);
  const thumbPath = path.join(THUMB_DIR, file);

  const results = { file, fullSkipped: false, thumbSkipped: false };

  if (!isStale(srcPath, fullPath)) {
    results.fullSkipped = true;
  } else {
    await sharp(srcPath)
      .resize({
        width: FULL_SIZE,
        height: FULL_SIZE,
        fit: 'inside',
        withoutEnlargement: true
      })
      .jpeg({ quality: FULL_QUALITY, progressive: true, mozjpeg: true })
      .toFile(fullPath);
  }

  if (!isStale(srcPath, thumbPath)) {
    results.thumbSkipped = true;
  } else {
    await sharp(srcPath)
      .resize({
        width: THUMB_SIZE,
        height: THUMB_SIZE,
        fit: 'inside',
        withoutEnlargement: true
      })
      .jpeg({ quality: THUMB_QUALITY, progressive: true, mozjpeg: true })
      .toFile(thumbPath);
  }

  return results;
}

function removeOrphans(sourceFiles, outputDir) {
  const sourceSet = new Set(sourceFiles);
  const outputFiles = getImages(outputDir);
  let removed = 0;
  for (const f of outputFiles) {
    if (!sourceSet.has(f)) {
      fs.unlinkSync(path.join(outputDir, f));
      removed++;
    }
  }
  return removed;
}

function writeManifest(files) {
  const photos = files.map(file => ({
    thumbnail: `/images/photos/thumbnails/${file}`,
    full: `/images/photos/full/${file}`,
    alt: path.basename(file, path.extname(file)).replace(/[_-]+/g, ' ')
  }));

  fs.writeFileSync(JSON_PATH, JSON.stringify({ photos }, null, 2), 'utf8');
}

async function main() {
  console.log('\n  Photography Build\n  ' + '—'.repeat(40) + '\n');

  ensureDir(ORIGINALS_DIR);
  ensureDir(FULL_DIR);
  ensureDir(THUMB_DIR);

  const originals = getImages(ORIGINALS_DIR);

  if (originals.length === 0) {
    console.log('  No images found in originals/');
    console.log('  Drop your camera files there and run again.\n');
    return;
  }

  console.log(`  Found ${originals.length} originals${FORCE ? ' (force rebuild)' : ''}\n`);

  let processed = 0;
  let skipped = 0;
  let errors = 0;

  for (const file of originals) {
    try {
      const result = await processImage(file);
      if (result.fullSkipped && result.thumbSkipped) {
        skipped++;
      } else {
        processed++;
        process.stdout.write(`  ✓ ${file}\n`);
      }
    } catch (err) {
      errors++;
      console.error(`  ✗ ${file}: ${err.message}`);
    }
  }

  const orphansFull = removeOrphans(originals, FULL_DIR);
  const orphansThumb = removeOrphans(originals, THUMB_DIR);
  const totalOrphans = orphansFull + orphansThumb;

  writeManifest(originals);

  const fullSize = dirSize(FULL_DIR);
  const thumbSize = dirSize(THUMB_DIR);
  const origSize = dirSize(ORIGINALS_DIR);

  console.log('\n  ' + '—'.repeat(40));
  console.log(`  Processed:  ${processed}`);
  if (skipped) console.log(`  Skipped:    ${skipped} (unchanged)`);
  if (errors) console.log(`  Errors:     ${errors}`);
  if (totalOrphans) console.log(`  Orphans:    ${totalOrphans} removed`);
  console.log('');
  console.log(`  Originals:  ${formatBytes(origSize)} (${originals.length} files — NOT committed)`);
  console.log(`  Full:       ${formatBytes(fullSize)} (3200px, q${FULL_QUALITY})`);
  console.log(`  Thumbnails: ${formatBytes(thumbSize)} (1200px, q${THUMB_QUALITY})`);
  console.log(`  Manifest:   photos.json (${originals.length} entries)`);
  console.log('');
}

main().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});
