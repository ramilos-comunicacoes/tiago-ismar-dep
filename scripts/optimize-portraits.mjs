#!/usr/bin/env node
// node scripts/optimize-portraits.mjs --photo-root <folder-with-LIC-files>
// Optional: --sharp-root <node_modules-folder-containing-sharp>
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const assets = fileURLToPath(new URL('../assets/', import.meta.url));
const sources = [
  { role: 'intro', filename: 'LIC04519.JPG', sha256: '937ba8c1b85a09369c5654518d7c698c3820fdf3507eb88ab2e31a57b5879029' },
  { role: 'contato', filename: 'LIC04470.JPG', sha256: '695f6e3cd286ae52c30af8879b09ec1bb9be900407f2a40963814a16745b20f8' },
];

async function main() {
  const args = process.argv.slice(2);
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    if (!['--photo-root', '--sharp-root'].includes(flag) || !args[index + 1] || args[index + 1].startsWith('--') || options[flag]) {
      throw new Error('Usage: node scripts/optimize-portraits.mjs --photo-root <folder> [--sharp-root <node_modules-folder>]');
    }
    options[flag] = args[index + 1];
  }
  if (!options['--photo-root']) throw new Error('--photo-root is required; original JPGs remain outside the repository.');
  const sharp = options['--sharp-root'] ? require(path.resolve(options['--sharp-root'], 'sharp')) : require('sharp');
  const photoRoot = path.resolve(options['--photo-root']);
  // Verify both originals before writing any derived asset.
  const inputs = await Promise.all(sources.map(async source => {
    const input = await readFile(path.join(photoRoot, source.filename));
    const actualHash = createHash('sha256').update(input).digest('hex');
    if (actualHash !== source.sha256) throw new Error(`Unexpected original photo: ${source.filename}. Its SHA-256 differs from the selected source.`);
    return { ...source, input, metadata: await sharp(input).metadata() };
  }));
  await mkdir(assets, { recursive: true });
  const photos = [];
  for (const source of inputs) {
    const derivatives = [];
    for (const [suffix, width] of [['', 1200], ['-mobile', 640]]) {
      const file = `tiago-real-${source.role}${suffix}.webp`;
      const target = path.join(assets, file);
      const temporary = `${target}.${process.pid}.tmp`;
      // No crop, retouching or generated content. Sharp strips metadata by default.
      const result = await sharp(source.input).rotate().resize({ width, withoutEnlargement: true })
        .webp({ quality: 88, effort: 6 }).toFile(temporary);
      await rename(temporary, target);
      derivatives.push({ file, width: result.width, height: result.height, bytes: result.size });
    }
    photos.push({ role: source.role, originalFilename: source.filename, originalSha256: source.sha256,
      originalWidth: source.metadata.width, originalHeight: source.metadata.height, derivatives });
  }
  const manifest = {
    source: 'Original photographs supplied by the site owner',
    processing: {
      tool: 'sharp',
      pipeline: 'rotate().resize({ width, withoutEnlargement: true }).webp({ quality: 88, effort: 6 })',
      metadata: 'EXIF, XMP and other input metadata omitted from public derivatives',
      retouching: false,
      generativeEditing: false,
      cropping: false,
      originalFilesPublished: false,
    },
    photos,
  };
  await writeFile(path.join(assets, 'tiago-photo-sources.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`Optimized ${photos.length} original photographs into 4 WebP assets; manifest saved.`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
