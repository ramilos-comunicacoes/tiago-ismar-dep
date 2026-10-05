/**
 * Encode responsive WebP copies without modifying original photographs.
 * Requires Node.js and sharp (available in the Codex bundled runtime).
 *
 * From the project root:
 * node scripts/optimize-assets.mjs --sharp-root "/path/to/node_modules"
 *
 * When sharp is installed in the project, omit --sharp-root.
 * This script only auto-orients, resizes and encodes; it does not retouch content.
 */
import { createRequire } from 'node:module';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assetsDirectory = join(projectRoot, 'assets');
const argumentIndex = process.argv.indexOf('--sharp-root');
const sharpRoot = argumentIndex === -1 ? null : process.argv[argumentIndex + 1];
if (argumentIndex !== -1 && !sharpRoot) throw new Error('--sharp-root requires a node_modules directory.');
const require = createRequire(import.meta.url);
const sharp = sharpRoot ? require(join(resolve(sharpRoot), 'sharp')) : require('sharp');

const jobs = [
  { file: 'serra-panorama.jpg', desktopWidth: 2560, mobileWidth: 960, quality: 82 },
  { file: 'serra-nuvens.jpg', desktopWidth: 1920, mobileWidth: 960, quality: 82 },
  { file: 'serra-estrada.jpg', desktopWidth: 1920, mobileWidth: 960, quality: 82 },
];
const landscapeSources = JSON.parse(await readFile(join(assetsDirectory, 'serra-sources.json'), 'utf8'));
const results = [];

for (const job of jobs) {
  const inputPath = join(assetsDirectory, job.file);
  const originalStats = await stat(inputPath);
  const inputMetadata = await sharp(inputPath).metadata();
  const source = landscapeSources.find((item) => item.file === job.file);
  const stem = job.file.replace(/\.[^.]+$/, '');
  const derivatives = [];

  for (const [variant, width] of [['desktop', job.desktopWidth], ['mobile', job.mobileWidth]]) {
    const file = `${stem}${variant === 'mobile' ? '-mobile' : ''}.webp`;
    const outputPath = join(assetsDirectory, file);
    const output = await sharp(inputPath)
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: job.quality, effort: 6 })
      .toFile(outputPath);
    derivatives.push({
      file,
      variant,
      width: output.width,
      height: output.height,
      bytes: output.size,
      quality: job.quality,
      changes: 'EXIF auto-orientation, proportional resize and WebP encoding. No content retouching.',
    });
  }

  results.push({
    original: job.file,
    originalBytes: originalStats.size,
    originalRawWidth: inputMetadata.width,
    originalRawHeight: inputMetadata.height,
    originalExifOrientation: inputMetadata.orientation || 1,
    ...(source ? {
      author: source.author,
      sourceUrl: source.pageUrl,
      license: source.license,
      licenseUrl: source.licenseUrl,
    } : {}),
    derivatives,
  });
}

await writeFile(join(assetsDirectory, 'optimized-assets.json'), `${JSON.stringify({
  generator: 'scripts/optimize-assets.mjs',
  sharpVersion: sharp.versions.sharp,
  originalFilesPreserved: true,
  assets: results,
}, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(results.flatMap((item) => item.derivatives), null, 2));
